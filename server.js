const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const jwtSecret = 'suus02201998##';

const app = express();

const pool = new Pool({
  connectionString: 'postgresql://connectfamead:q0rRK1gyMALN@ep-white-sky-a52j6d6i.us-east-2.aws.neon.tech/lms_mmstrok?sslmode=require',
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({
  origin: ['http://localhost:3000', 'https://bell-bottoms-goat.cyclic.app', 'https://connect-ead.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));



app.use(express.json());

const mercadopago = require("mercadopago");
// Configure o SDK com suas credenciais
mercadopago.configure({
  access_token: "TEST-2963469360015665-021322-f1fffd21061a732ce2e6e9acb4968e84-266333751",
});

app.post("/api/checkout", async (req, res) => {
  const { items, userId } = req.body;

  try {
    const compras = await Promise.all(items.map(async item => {
      const { rows } = await pool.query(
        "INSERT INTO compras_cursos (user_id, curso_id, status, periodo, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id",
        [userId, item.id, 'pendente', item.periodo]
      );
      return rows[0].id;
    }));

    // Inicia um monitoramento para cada compra registrada
    compras.forEach(compraId => {
      setTimeout(async () => {
        const { rows } = await pool.query('SELECT status FROM compras_cursos WHERE id = $1', [compraId]);
        if (rows.length > 0 && rows[0].status === 'pendente') {
          await pool.query('DELETE FROM compras_cursos WHERE id = $1', [compraId]);
          console.log(`Compra pendente expirada com ID ${compraId} foi excluída.`);
        }
      }, 300000); // 5 minutos
    });

    const preference = {
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        unit_price: item.unit_price,
        quantity: 1,
      })),
      external_reference: compras.join('-'),
    };

    const response = await mercadopago.preferences.create(preference);
    res.json({ preferenceId: response.body.id, comprasRegistradas: compras });
  } catch (error) {
    console.error("Erro ao criar a preferência de pagamento:", error);
    res.status(500).json({ error: error.toString() });
  }
});



async function processarNotificacao(notification) {
  // Supondo que a notification tenha um campo 'data.id'
  const paymentId = notification.data.id;

  try {
    // Busca o pagamento pelo ID para obter detalhes
    const paymentResponse = await mercadopago.payment.get(paymentId);
    const paymentInfo = paymentResponse.body;

    if (paymentInfo.status === 'approved') {
      // Supondo que o external_reference seja o ID da compra
      const compraId = paymentInfo.external_reference;
      const query = 'UPDATE compras_cursos SET status = $1 WHERE id = $2';
      await pool.query(query, ['aprovado', compraId]);
    }
  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    throw error;
  }
}



app.post("/api/pagamento/notificacao", async (req, res) => {
  const { data } = req.body;

  try {
    const payment = await mercadopago.payment.findById(data.id);
    const externalReference = payment.body.external_reference;
    const compraIds = externalReference.split('-'); // Divide o external_reference nos IDs das compras
    const paymentStatus = payment.body.status; // Status do pagamento

    // Processa cada ID de compra baseado no status do pagamento
    await Promise.all(compraIds.map(async compraId => {
      const newStatus = paymentStatus === 'approved' ? 'aprovado' : 'reprovado'; // Atualiza o status baseado no status do pagamento
      await pool.query('UPDATE compras_cursos SET status = $1 WHERE id = $2', [newStatus, compraId]);
    }));

    res.send("Notificação processada com sucesso.");
  } catch (error) {
    console.error("Erro ao processar notificação:", error);
    res.status(500).send("Erro interno do servidor");
  }
});


app.post('/api/add-aluno', async (req, res) => {
  const { nome, sobrenome, email, senha, username, role } = req.body; // Incluído username

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const query = 'INSERT INTO users (nome, sobrenome, email, senha, username, role) VALUES ($1, $2, $3, $4, $5, $6)'; // Adicionado username na query
    const values = [nome, sobrenome, email, senhaHash, username, role]; // Adicionado username nos valores
    await pool.query(query, values);

    res.json({ success: true, message: 'Usuário criado com sucesso.' });
  } catch (error) {
    console.error('Erro ao adicionar aluno:', error);
    res.status(500).json({ success: false, message: 'Erro ao criar usuário.' });
  }
});

const getAulasPorCursoId = async (cursoId) => {
  const query = 'SELECT * FROM aulas WHERE curso_id = $1';
  const client = await pool.connect();
  const { rows } = await client.query(query, [cursoId]);
  client.release();
  return rows;
};
app.post('/login', async (req, res) => {
  const { identificador, senha } = req.body;
  let connection;

  try {
    connection = await pool.connect();
    const query = 'SELECT * FROM Usuarios WHERE identificador = $1';
    const { rows } = await connection.query(query, [identificador]);

    if (rows.length === 0) {
      console.log('Nenhum usuário encontrado com o identificador fornecido');
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = rows[0];

    if (senha !== user.senha) {
      console.log('Senha fornecida não corresponde à senha do usuário no banco de dados');
      return res.status(401).json({ success: false, message: 'Wrong password' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.acesso, instituicaoNome: user.instituicaonome }, // Atenção à capitalização
      jwtSecret,
      { expiresIn: '1h' }
    );

    if (!token) {
      console.log('Falha ao criar o token JWT');
      return res.status(500).json({ success: false, message: 'Failed to create token' });
    }

    res.json({
      success: true,
      username: user.identificador,
      role: user.acesso,
      token,
      instituicaoNome: user.instituicaonome // Atenção à capitalização
    });
  } catch (err) {
    console.log('Erro na consulta do banco de dados:', err);
    res.status(500).json({ success: false, message: 'Database query error' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
app.put('/api/user/profileEdit', async (req, res) => {
  const { userId, nome, sobrenome, email, endereco, cidade, cep, pais, role, username } = req.body;

  if (!userId) {
      return res.status(400).json({ success: false, message: 'ID de usuário não fornecido.' });
  }

  try {
      const client = await pool.connect();

      const query = `
          UPDATE users
          SET
              nome = $1,
              sobrenome = $2,
              email = $3,
              endereco = $4,
              cidade = $5,
              cep = $6,
              pais = $7,
              role = $8,
              username = $9
          WHERE id = $10
      `;
      const values = [nome, sobrenome, email, endereco, cidade, cep, pais, role, username, userId];

      await client.query(query, values);

      client.release();

      res.json({ success: true, message: 'Perfil atualizado com sucesso!' });
  } catch (error) {
      console.error('Erro ao atualizar perfil do usuário:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor ao atualizar perfil.' });
  }
});
app.delete('/api/delete-aluno/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const query = 'DELETE FROM users WHERE id = $1';
    const client = await pool.connect();
    await client.query(query, [userId]);
    client.release();

    res.json({ success: true, message: 'Aluno excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir aluno:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir aluno' });
  }
});
app.post('/api/cursos/acesso/:cursoId', async (req, res) => {
  const { cursoId } = req.params;
  const { userId } = req.body;

  try {
    // Consulta para obter os dados do curso comprado
    const cursoRows = await pool.query(
      'SELECT periodo, data_inicio_acesso FROM compras_cursos WHERE user_id = $1 AND curso_id = $2',
      [userId, cursoId]
    );

    if (cursoRows.rowCount > 0 && cursoRows.rows[0].data_inicio_acesso == null) {
      let intervalo;
      // Definindo o intervalo de acordo com o período do curso
      switch(cursoRows.rows[0].periodo) {
        case '15d':
          intervalo = '15 days';
          break;
        case '30d':
          intervalo = '30 days';
          break;
        case '6m':
          intervalo = '6 months';
          break;
        default:
          return res.status(400).json({ success: false, message: 'Período de curso inválido.' });
      }

      // Atualiza a data de início e fim de acesso, convertendo para o fuso horário de São Paulo
      await pool.query(`
        UPDATE compras_cursos 
        SET 
          data_inicio_acesso = (NOW() AT TIME ZONE 'America/Sao_Paulo'), 
          data_fim_acesso = ((NOW() AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '${intervalo}')
        WHERE user_id = $1 AND curso_id = $2
      `, [userId, cursoId]);

      res.json({ success: true, message: 'Acesso ao curso registrado com sucesso.' });
    } else if (cursoRows.rowCount > 0) {
      res.json({ success: true, message: 'Acesso ao curso já registrado anteriormente.' });
    } else {
      res.status(404).json({ success: false, message: 'Curso não encontrado.' });
    }
  } catch (error) {
    console.error('Erro ao registrar acesso:', error);
    res.status(500).json({ success: false, message: 'Erro ao registrar acesso ao curso.', error: error.message });
  }
});


app.post('/api/cursos/progresso', async (req, res) => {
  const { userId, cursoId, aulaAtual, progresso } = req.body;

  try {
    const client = await pool.connect();
    const query = `
      INSERT INTO progresso_cursos (user_id, curso_id, aula_atual, progresso)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, curso_id) DO UPDATE
      SET aula_atual = $3, progresso = $4;
    `;
    await client.query(query, [userId, cursoId, aulaAtual, progresso]);
    client.release();
    res.json({ success: true, message: 'Progresso atualizado com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar progresso:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar progresso', error: error.message });
  }
});

app.get('/api/cursos', async (req, res) => {
  try {
    const query = 'SELECT id, nome, descricao, thumbnail, valor_15d, valor_30d, valor_6m FROM cursos';
    const client = await pool.connect();
    const { rows } = await client.query(query);
    client.release();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar cursos', error });
  }
});

app.get('/api/cursos/progresso/:userId/:cursoId', async (req, res) => {
  const { userId, cursoId } = req.params;

  try {
    const client = await pool.connect();
    const query = 'SELECT * FROM progresso_cursos WHERE user_id = $1 AND curso_id = $2';
    const { rows } = await client.query(query, [userId, cursoId]);
    client.release();
    res.json(rows.length > 0 ? rows[0] : { progresso: 0, aula_atual: null });
  } catch (error) {
    console.error('Erro ao recuperar progresso:', error);
    res.status(500).json({ success: false, message: 'Erro ao recuperar progresso' });
  }
});


// Rota para contar alunos cadastrados
app.get('/api/alunos/count', async (req, res) => {
  try {
    const client = await pool.connect();
    // Adiciona a cláusula WHERE para filtrar por role 'Aluno'
    const { rows } = await client.query("SELECT COUNT(*) FROM users WHERE role = 'Aluno'");
    client.release();
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error("Erro ao contar alunos:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});
// Rota para contar alunos que mudaram a senha padrão
app.get('/api/alunos/password-changed/count', async (req, res) => {
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT COUNT(*) FROM users WHERE role = 'Aluno' AND senha != 'senha_padrao'");
    client.release();
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error("Erro ao contar acessos de alunos:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});

// Rota para contar cursos cadastrados
app.get('/api/cursos/count', async (req, res) => {
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT COUNT(*) FROM cursos");
    client.release();
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error("Erro ao contar cursos:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});
app.get("/alunos", async (req, res) => {
  try {
    const query = "SELECT  id, nome, sobrenome, email, endereco, cidade, cep, pais, role, username FROM Users WHERE role = $1";
    const client = await pool.connect();
    const results = await client.query(query, ['Aluno']);
    client.release();

    res.json(results.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.post('/register_usuario', async (req, res) => {
  const { usuario, nome, email, senha, unidade, setor, acesso } = req.body;

  try {
    // Criptografe a senha antes de armazenar no banco de dados
    const senhaHash = await bcrypt.hash(senha, 10);

    const query = 'INSERT INTO login_register (usuario, nome, email, senha, unidade, setor, acesso) VALUES ($1, $2, $3, $4, $5, $6, $7)';
    const values = [usuario, nome, email, senhaHash, unidade, setor, acesso];

    const client = await pool.connect();
    const result = await client.query(query, values);

    res.send({ success: true });
  } catch (err) {
    console.log(err);
    return res.send({ success: false, message: err.message });
  } finally {
    if (client) client.release();
  }
});


app.delete('/deleteAllUsers', async (req, res) => {
  const query = 'DELETE FROM login_register';
  
  try {
    const client = await pool.connect();
    const result = await client.query(query);

    if (result.rowCount > 0) {
      res.send({ success: true, message: `${result.rowCount} usuário(s) foram excluídos.` });
    } else {
      res.send({ success: false, message: 'Não há usuários para excluir.' });
    }
  } catch (err) {
    console.log(err);
    return res.send({ success: false, message: 'Falha ao excluir usuários: ' + err.message });
  } finally {
    if (client) client.release();
  }
});


app.post("/api/user/login", async (req, res) => {
  const { Email, senha } = req.body;

  if (!Email || !senha) {
    return res.status(400).json({ success: false, message: 'Dados incompletos.' });
  }

  // Tenta encontrar o usuário pelo e-mail ou username
  const query = "SELECT * FROM users WHERE email = $1 OR username = $1";

  try {
    const client = await pool.connect();
    const results = await client.query(query, [Email]);
    client.release();

    if (results.rows.length > 0) {
      const user = results.rows[0];

      // Compara a senha fornecida com a hash armazenada
      const senhaValida = await bcrypt.compare(senha, user.senha);
      if (senhaValida) {
        const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: '1h' });

        res.json({
          success: true,
          message: 'Login bem-sucedido!',
          token: token,
          username: user.username,
          userId: user.id,
          role: user.role
        });
      } else {
        res.status(401).json({ success: false, message: 'Credenciais inválidas!' });
      }
    } else {
      res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});



app.post('/api/comprar-curso', async (req, res) => {
  const { userId, cursoId } = req.body;
  
  const query = 'INSERT INTO compras_cursos (user_id, curso_id) VALUES ($1, $2)';
  try {
    const client = await pool.connect();
    await client.query(query, [userId, cursoId]);
    client.release();

    res.json({ success: true, message: 'Curso comprado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro ao comprar curso' });
  }
});

app.post('/api/add-aluno', async (req, res) => {
  const { username, nome, sobrenome, email, role } = req.body;

  try {
    const senhaPadrao = 'senha_padrao'; // Pode definir uma senha padrão ou gerar aleatoriamente

    const query = 'INSERT INTO users (username, nome, sobrenome, email, role, senha) VALUES ($1, $2, $3, $4, $5, $6)';
    const values = [username, nome, sobrenome, email, role, senhaPadrao]; // Incluímos a senha aqui

    const client = await pool.connect();
    await client.query(query, values);
    client.release();

    res.json({ success: true, message: 'Aluno adicionado com sucesso!' });
  } catch (error) {
    console.error('Erro ao adicionar aluno:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar aluno' });
  }
});



// Rota para atualizar as informações do perfil do usuário
app.put('/api/user/profile', async (req, res) => {
  const { userId, email, nome, sobrenome, endereco, cidade, pais, cep } = req.body;

  if (!userId) {
      return res.status(400).json({ success: false, message: 'ID de usuário não fornecido.' });
  }

  try {
      const client = await pool.connect();

      const query = `
          UPDATE users
          SET
              email = $1,
              nome = $2,
              sobrenome = $3,
              endereco = $4,
              cidade = $5,
              pais = $6,
              cep = $7
          WHERE id = $8
      `;
      const values = [email, nome, sobrenome, endereco, cidade, pais, cep, userId];

      await client.query(query, values);

      client.release();

      res.json({ success: true, message: 'Perfil atualizado com sucesso!' });
  } catch (error) {
      console.error('Erro ao atualizar perfil do usuário:', error);
      res.status(500).json({ success: false, message: 'Erro interno do servidor ao atualizar perfil.' });
  }
});


app.get('/api/user/profile/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const client = await pool.connect();
    const query = 'SELECT nome, sobrenome, email, endereco, cidade, pais, cep FROM users WHERE username = $1';
    const { rows } = await client.query(query, [username]);
    client.release();

    if (rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
  } catch (error) {
    console.error("Erro no servidor: ", error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});
const cron = require('node-cron');

// Rotina que executa todos os dias à meia-noite GMT-3
cron.schedule('0 0 0 * * *', async () => {
  console.log('Executando a rotina de verificação de fim de acesso...');
  try {
    const client = await pool.connect();
    // Exclui entradas onde o fim do acesso já passou
    const query = `
      DELETE FROM compras_cursos 
      WHERE data_fim_acesso < NOW() AT TIME ZONE 'America/Sao_Paulo';
    `;
    const result = await client.query(query);
    console.log(`Exclusão concluída: ${result.rowCount} curso(s) removido(s) do banco de dados.`);
    client.release();
  } catch (error) {
    console.error('Erro durante a rotina de limpeza:', error);
  }
}, {
  scheduled: true,
  timezone: "America/Sao_Paulo"
});
// Adiciona uma rota para verificar o status de uma compra específica
app.get('/api/compra/status/:compraId', async (req, res) => {
  const { compraId } = req.params;

  try {
    // Busca o status da compra pelo ID fornecido
    const { rows } = await pool.query('SELECT status FROM compras_cursos WHERE id = $1', [compraId]);

    if (rows.length > 0) {
      const status = rows[0].status;
      res.json({ status });
    } else {
      res.status(404).json({ message: 'Compra não encontrada.' });
    }
  } catch (error) {
    console.error('Erro ao buscar o status da compra:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});
app.get('/api/cursos-comprados/:userId', async (req, res) => {
  const { userId } = req.params;

  const query = `
    SELECT c.*, cc.data_inicio_acesso, cc.data_fim_acesso
    FROM cursos c
    INNER JOIN compras_cursos cc ON c.id = cc.curso_id
    WHERE cc.user_id = $1 AND cc.status = 'aprovado'
  `;

  try {
    const client = await pool.connect();
    const { rows } = await client.query(query, [userId]);
    client.release();
    res.json(rows);
  } catch (error) {
    console.error('Erro ao listar cursos comprados:', error);
    res.status(500).json({ success: false, message: 'Erro ao listar cursos comprados' });
  }
});


// Exemplo de rota para obter aulas de um curso
app.get('/api/cursos/:cursoId/aulas', async (req, res) => {
  const { cursoId } = req.params;
  try {
    
    const aulas = await pool.query('SELECT * FROM aulas WHERE curso_id = $1 ORDER BY ordem', [cursoId]);
    res.json(aulas.rows);
  } catch (err) {
    res.status(500).send('Erro no servidor');
  }
});

app.get('/api/cursos/:cursoId/avaliacoes', async (req, res) => {
  const { cursoId } = req.params;
  try {
    const avaliacoes = await pool.query('SELECT * FROM avaliacoes WHERE curso_id = $1', [cursoId]);
    res.json(avaliacoes.rows);
  } catch (err) {
    res.status(500).send('Erro no servidor');
  }
});

app.post('/api/cursos/:cursoId/verificarAvaliacao', async (req, res) => {
  const { cursoId } = req.params;
  const { respostasUsuario } = req.body; // Espera um objeto { idPergunta: 'resposta' }

  try {
    const avaliacoes = await pool.query('SELECT * FROM avaliacoes WHERE curso_id = $1', [cursoId]);
    let pontuacao = 0;
    avaliacoes.rows.forEach(avaliacao => {
      if (respostasUsuario[avaliacao.id] === avaliacao.resposta_correta) {
        pontuacao += 1;
      }
    });

    res.json({ pontuacao, total: avaliacoes.rows.length });
  } catch (err) {
    res.status(500).send('Erro no servidor');
  }
});


app.post('/api/recordLogout', async (req, res) => {
  const { username, instituicaoNome } = req.body;

  try {
    const client = await pool.connect();
    await client.query(
      "INSERT INTO Auditoria (username, instituicaoNome, action) VALUES ($1, $2, 'Logout')",
      [username, instituicaoNome]
    );
    client.release();

    res.json({ message: 'Logout registrado com sucesso.' });
  } catch (error) {
    console.error('Erro ao registrar o logout:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

app.post('/api/verifyUser', async (req, res) => {
  const { Email } = req.body;
  try {
    const client = await pool.connect();
    const { rows } = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [Email]
    );
    client.release();
    if (rows.length > 0) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao verificar usuário' });
  }
});


app.post('/api/registerPassword', async (req, res) => {
  const { Email, Senha } = req.body;
  
  if (!Email || !Senha) {
    return res.status(400).json({ success: false, message: 'Dados incompletos.' });
  }
  
  try {
    const client = await pool.connect();
    await client.query(
      'UPDATE users SET senha = $1 WHERE email = $2',
      [Senha, Email]
    );
    client.release();
    res.json({ success: true });
  } catch (error) {
    console.error("Erro no servidor: ", error);
    res.status(500).json({ success: false, message: 'Erro ao cadastrar senha' });
  }
});



app.delete('/deleteAll', async (req, res) => {
  const query = 'DELETE FROM cadastro_clientes';

  try {
    const client = await pool.connect();
    const result = await client.query(query);

    if (result.rowCount > 0) {
      res.send({ success: true, message: `${result.rowCount} registro(s) foram excluídos.` });
    } else {
      res.send({ success: false, message: 'Não há registros para excluir.' });
    }
    client.release();
  } catch (err) {
    console.log(err);
    res.send({ success: false, message: 'Falha ao excluir registros: ' + err.message });
  }
});



app.use((req, res, next) => {
  // Se não há token na requisição, passe para a próxima rota
  if (!req.headers.authorization) return next();

  // Decodificar o token
  const token = req.headers.authorization.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
  } catch (error) {
    console.log('Error decoding JWT: ', error);
  }
  

  next();
});

const protectedRoutes = [
  { url: '/deleteAll', methods: ['DELETE'], roles: ['admin'] },
  // Adicione outras rotas protegidas aqui
];

app.use((req, res, next) => {
  if (!req.user) return next();

  const protectedRoute = protectedRoutes.find(
    (route) => route.url === req.path && route.methods.includes(req.method)
  );

  if (protectedRoute && !protectedRoute.roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  next();
});
const port = process.env.PORT || 5000;

app.listen(port, () => console.log(`Server is running on port ${port}`));