const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const jwtSecret = 'suus02201998##';

const app = express();

const pool = new Pool({
  connectionString: 'postgres://MmSTRoK-br:6NCzLOkrnVW9@ep-holy-rain-67858682.us-east-2.aws.neon.tech/psico-connectfam',
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({
  origin: ['http://localhost:3000', 'https://bored-cuff-links-foal.cyclic.app','https://www.psicofam.com.br' , 'https://psicofam.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));


app.use(express.json());

app.get('/checkAvaliacao', async (req, res) => {
  const { cpf, instituicaoNome } = req.query;

  console.log("Rota CheckAvaliacao acionada. CPF:", cpf, ", Instituição:", instituicaoNome);
  
  const client = await pool.connect();

  try {
    const avaliacaoResult = await client.query(
      'SELECT avaliacao_realizada FROM avaliacoes_realizadas WHERE cpf = $1 AND instituicaonome = $2',
      [cpf, instituicaoNome]
    );

    if (avaliacaoResult.rows.length > 0) {
      const avaliacaoRealizada = avaliacaoResult.rows[0].avaliacao_realizada;
      
      // Se a avaliação foi realizada, atualize a data_avaliacao
      if (avaliacaoRealizada) {
        await client.query(
          'UPDATE avaliacoes_realizadas SET data_avaliacao = CURRENT_TIMESTAMP WHERE cpf = $1 AND instituicaonome = $2',
          [cpf, instituicaoNome]
        );
      }
      res.status(200).json({ avaliacaoRealizada });
    } else {
      console.log("Avaliação ainda não realizada.");
      res.status(200).json({ avaliacaoRealizada: false });
    }
  } catch (error) {
    console.error('Database query failed:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
  }
});

app.get('/api/evaluations/count', async (req, res) => {
  const instituicaoNome = req.query.instituicaoNome;
  
  try {
    // Consulta para contar todas as avaliações
    const { rows: totalEvaluations } = await pool.query(
      'SELECT COUNT(*) as total FROM avaliacoes_realizadas WHERE instituicaoNome = $1 AND avaliacao_realizada = true',
      [instituicaoNome]
    );

    // Consulta para contar as avaliações feitas hoje usando a nova coluna data_avaliacao
    const { rows: evaluationsToday } = await pool.query(
      'SELECT COUNT(*) as today FROM avaliacoes_realizadas WHERE instituicaoNome = $1 AND avaliacao_realizada = true AND DATE(data_avaliacao) = CURRENT_DATE',
      [instituicaoNome]
    );

    res.json({ total: totalEvaluations[0].total, today: evaluationsToday[0].today });
  } catch (error) {
    console.error("Erro ao executar consulta SQL:", error);
    res.status(500).json({ message: 'Erro ao recuperar contagens de avaliações' });
  }
});

app.post('/register', async (req, res) => {
  const {
    NomeCompleto,
    Email,
    Data_de_Nascimento,
    Genero,
    Telefone,
    Telefone2,
    CPF,
    CNPJ,
    Matricula,
    Observacoes,
    Endereco,
    Numero,
    Complemento,
    Bairro,
    Cidade,
    Estado,
    Pais,
    CEP,
    Unidade,
    Setor,
    Cargo,
    Instituicao,
    Acesso,
  } = req.body;

  try {
    // Verifique se um usuário com o mesmo email já existe
    const { rows: existingUsers } = await pool.query(
      'SELECT * FROM cadastro_clientes WHERE Email = $1',
      [Email]
    );
    if (existingUsers.length > 0) {
      return res.send({ success: false, message: 'Usuario (Email de acesso) já existente na sua Instituição.' });
    }

    const query =
      'INSERT INTO cadastro_clientes (NomeCompleto, Email, Data_de_Nascimento, Genero, Telefone, Telefone2, CPF, CNPJ, Matricula, Observacoes, Endereco, Numero, Complemento, Bairro, Cidade, Estado, Pais, CEP, Unidade, Setor, Cargo, Instituicao, instituicaoNome, Acesso) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)';
    const values = [
      NomeCompleto,
      Email,
      Data_de_Nascimento,
      Genero,
      Telefone,
      Telefone2,
      CPF,
      CNPJ,
      Matricula,
      Observacoes,
      Endereco,
      Numero,
      Complemento,
      Bairro,
      Cidade,
      Estado,
      Pais,
      CEP,
      Unidade,
      Setor,
      Cargo,
      Instituicao,
      Instituicao,
      Acesso,
    ];
    await pool.query(query, values);
    return res.send({ success: true, message: 'Usuário registrado com sucesso.' });
    
  } catch (err) {
    console.log(err);
    return res.send({ success: false, message: err.message });
  }
});

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
app.post('/instituicoes', async (req, res) => {
  // Iniciar uma transação no PostgreSQL
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { cnpj, nome, inscricaoEstadual, razaoSocial, logradouro, numero, complemento, bairro, cidade, estado, pais, cep, contatos, unidades, setores, cargos, usuarios } = req.body;

    // Verifique se uma instituição com o mesmo CNPJ já existe
    const { rows: existingInstitutions } = await client.query('SELECT * FROM Instituicoes WHERE cnpj = $1', [cnpj]);
    if (existingInstitutions.length > 0) {
      return res.status(400).send('Erro ao cadastrar Instituição, já existe uma instituição com esse CNPJ');
    }

    // Inserir dados em Instituicoes
    const { rows: instituicaoRows } = await client.query(
      'INSERT INTO Instituicoes (instituicao, cnpj, inscricaoEstadual, razaoSocial, logradouro, numero, complemento, bairro, cidade, estado, pais, cep) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id',
      [nome, cnpj, inscricaoEstadual, razaoSocial, logradouro, numero, complemento, bairro, cidade, estado, pais, cep]
    );

    const instituicaoId = instituicaoRows[0].id;
    const instituicaoNome = nome; // Nome da instituição

    // Inserir dados em Contatos, Unidades, Setores, Cargos e Usuarios
    await Promise.all([
      contatos.map(contato => client.query(
        'INSERT INTO Contatos (instituicaoId, categoria, categoriaEspecifica, nomeCompleto, telefone, instituicaoNome) VALUES ($1, $2, $3, $4, $5, $6)',
        [instituicaoId, contato.categoria, contato.categoriaEspecifica, contato.nomeCompleto, contato.telefone, instituicaoNome]
      )),
      unidades.map(unidade => client.query('INSERT INTO Unidades (instituicaoId, instituicaoNome, unidade) VALUES ($1, $2, $3)', [instituicaoId, instituicaoNome, unidade])),
      setores.map(setor => client.query('INSERT INTO Setores (instituicaoId, instituicaoNome, setor) VALUES ($1, $2, $3)', [instituicaoId, instituicaoNome, setor])),
      cargos.map(cargo => client.query('INSERT INTO Cargos (instituicaoId, instituicaoNome, cargo) VALUES ($1, $2, $3)', [instituicaoId, instituicaoNome, cargo])),
      usuarios.map(usuario => client.query(
        'INSERT INTO Usuarios (instituicaoId, instituicaoNome, nome, identificador, senha, acesso) VALUES ($1, $2, $3, $4, $5, $6)',
        [instituicaoId, instituicaoNome, usuario.nome, usuario.identificador, usuario.senha, 'Administrador']
      )),
    ]);

    // Confirmação da transação
    await client.query('COMMIT');
    res.status(201).send('Instituição registrada com sucesso!');
  } catch (error) {
    // Desfaz a transação
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).send('Erro ao registrar a instituição');
  } finally {
    client.release();
  }
});

app.put('/instituicoes/:id', async (req, res) => {
  const connection = await pool.getConnection();
  const instituicaoId = req.params.id;

  const {
    nome, cnpj, inscricaoEstadual, razaoSocial, logradouro, numero, complemento,
    bairro, cidade, estado, pais, cep, contatos, unidades, setores, cargos, usuarios,
  } = req.body;

  try {
    // Atualizar os detalhes da instituição na tabela Instituicoes
    await connection.query(
      'UPDATE Instituicoes SET nome = ?, cnpj = ?, inscricaoEstadual = ?, razaoSocial = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ?, pais = ?, cep = ? WHERE id = ?',
      [nome, cnpj, inscricaoEstadual, razaoSocial, logradouro, numero, complemento, bairro, cidade, estado, pais, cep, instituicaoId]
    );

    // Atualizar outras tabelas (Contatos, Unidades, Setores, Cargos, Usuarios) se necessário

    res.status(200).send('Instituição atualizada com sucesso!');
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao atualizar a instituição');
  } finally {
    connection.release();
  }
});

app.delete('/instituicoes/:id', async (req, res) => {
  console.log('Objeto completo de parâmetros:', req.params); // Log dos parâmetros

  // Assumindo que o ID é extraído diretamente dos parâmetros (ajuste conforme necessário)
  const instituicaoId = req.params.id;

  console.log('ID da instituição:', instituicaoId); // Log do ID

  // Iniciar uma transação no PostgreSQL
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lista de tabelas relacionadas
    const relatedTables = ['Contatos', 'Unidades', 'Setores', 'Cargos', 'Usuarios'];
    
    // Excluir dados relacionados em outras tabelas usando instituicaoId
    for (const table of relatedTables) {
      const { rowCount: affectedRows } = await client.query(`DELETE FROM ${table} WHERE instituicaoId = $1`, [instituicaoId]);
      console.log(`Registros excluídos da tabela ${table}:`, affectedRows);
      if (affectedRows === 0) {
        console.warn(`Nenhum registro encontrado para exclusão na tabela ${table} para instituicaoId: ${instituicaoId}`);
      }
    }

    // Excluir a instituição da tabela Instituicoes usando o ID
    const { rowCount: affectedRowsInstituicao } = await client.query('DELETE FROM Instituicoes WHERE id = $1', [instituicaoId]);
    if (affectedRowsInstituicao === 0) {
      throw new Error(`Instituição com ID ${instituicaoId} não encontrada`);
    }

    // Confirmar transação
    await client.query('COMMIT');
    res.status(200).send('Instituição excluída com sucesso!');
  } catch (error) {
    // Reverter transação em caso de erro
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).send('Erro ao excluir a instituição');
  } finally {
    client.release();
  }
});


app.get('/instituicao-detalhes', async (req, res) => {
  const instituicaoId = req.query.instituicaoId;

  try {
    // Consulta ao banco de dados
    const { rows: instituicao } = await pool.query(
      'SELECT instituicao, cnpj, inscricaoEstadual, razaoSocial, logradouro, numero, complemento, bairro, cidade, estado, pais, cep FROM Instituicoes WHERE id = $1',
      [instituicaoId]
    );

    if (instituicao.length === 0) {
      return res.status(404).send('Instituição não encontrada');
    }

    res.status(200).json(instituicao[0]);
  } catch (error) {
    console.error('Erro na consulta do banco de dados:', error);
    res.status(500).send('Erro ao buscar detalhes da instituição');
  }
});
// Rota para buscar Cargos
app.get('/cargos', async (req, res) => {
  const instituicaoId = req.query.instituicaoId;

  try {
    const { rows: cargos } = await pool.query('SELECT * FROM Cargos WHERE instituicaoId = $1', [instituicaoId]);
    res.status(200).json(cargos);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar os cargos');
  }
});

// Rota para buscar Contatos
app.get('/contatos', async (req, res) => {
  const instituicaoId = req.query.instituicaoId;

  try {
    const { rows: contatos } = await pool.query('SELECT * FROM Contatos WHERE instituicaoId = $1', [instituicaoId]);
    res.status(200).json(contatos);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar os contatos');
  }
});

// Rota para buscar Setores
app.get('/setores', async (req, res) => {
  const instituicaoId = req.query.instituicaoId;

  try {
    const { rows: setores } = await pool.query('SELECT * FROM Setores WHERE instituicaoId = $1', [instituicaoId]);
    res.status(200).json(setores);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar os setores');
  }
});

// Rota para buscar Unidades
app.get('/unidades', async (req, res) => {
  const instituicaoId = req.query.instituicaoId;

  try {
    const { rows: unidades } = await pool.query('SELECT * FROM Unidades WHERE instituicaoId = $1', [instituicaoId]);
    res.status(200).json(unidades);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar as unidades');
  }
});

app.get('/usuarios', async (req, res) => {
  let connection;
  const instituicaoNome = req.query.instituicaoNome;

  try {
    connection = await pool.connect();
    const query = instituicaoNome ?
      'SELECT * FROM cadastro_clientes WHERE instituicaoNome = $1' : 
      'SELECT * FROM cadastro_clientes';
    const params = instituicaoNome ? [instituicaoNome] : [];
    const { rows: usuarios } = await connection.query(query, params);
    res.status(200).json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar os usuários');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});


app.get('/usuarios_instituicao', async (req, res) => {
  const instituicaoId = req.query.instituicaoId; // Obter o ID da instituição da query

  try {
    // Execute a query para buscar usuários da tabela Usuarios que correspondem ao ID da instituição
    const [usuarios] = await pool.query('SELECT nome, identificador, senha, acesso FROM Usuarios WHERE instituicaoId = ?', [instituicaoId]);
    
    // Enviar os usuários como resposta JSON
    res.status(200).json(usuarios);
  } catch (error) {
    console.error(error);
    res.status(500).send('Erro ao buscar usuários');
  }
});


app.post('/salvar-instituicao', async (req, res) => {
  const client = await pool.connect();

  try {
    const { instituicoes, cargos, contatos, setores, unidades, usuarios } = req.body;

    await client.query('BEGIN');

    if (instituicoes && instituicoes.length > 0) {
      const instituicoesData = instituicoes[0];
      const instituicoesValues = Object.values(instituicoesData);
      const instituicoesQuery = `UPDATE Instituicoes SET instituicao = $1, cnpj = $2, inscricaoEstadual = $3, razaoSocial = $4, logradouro = $5, numero = $6, complemento = $7, bairro = $8, cidade = $9, estado = $10, pais = $11, cep = $12 WHERE id = $13;`;
      await client.query(instituicoesQuery, instituicoesValues);
    }

    const updateQueries = {
      Cargos: 'UPDATE Cargos SET cargo = $1 WHERE id = $2 AND instituicaoId = $3;',
      Contatos: 'UPDATE Contatos SET categoria = $1, categoriaEspecifica = $2, nomeCompleto = $3, telefone = $4 WHERE id = $5 AND instituicaoId = $6;',
      Setores: 'UPDATE Setores SET setor = $1 WHERE id = $2 AND instituicaoId = $3;',
      Unidades: 'UPDATE Unidades SET unidade = $1 WHERE id = $2 AND instituicaoId = $3;',
      Usuarios: 'UPDATE Usuarios SET nome = $1, identificador = $2, senha = $3, acesso = $4 WHERE id = $5 AND instituicaoId = $6;'
    };

    for (const [table, query] of Object.entries(updateQueries)) {
      const data = req.body[table.toLowerCase()];
      for (const item of data) {
        const values = Object.values(item).filter(value => value !== undefined);
        if (values.length < Object.keys(item).length) {
          console.error(`Campos indefinidos na tabela ${table}:`, item);
          continue;
        }
        await client.query(query, values);
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar as alterações:', error);
    res.status(500).send('Erro ao salvar as alterações');
  } finally {
    client.release();
  }
});

app.post('/webhook/zoho', async (req, res) => {
  const payload = req.body;
  console.log("Received payload:", payload);

  const { cpf } = payload;

  if (typeof cpf === 'undefined') {
    return res.status(400).send('Bad Request: CPF is undefined');
  }

  const client = await pool.connect();

  try {
    // Primeiro, buscar o nome completo com base no CPF na tabela cadastro_clientes
    const clientesResult = await client.query(
      'SELECT nomecompleto, instituicaonome FROM cadastro_clientes WHERE cpf = $1',
      [cpf]
    );
    
    if (clientesResult.rows.length === 0) {
      return res.status(404).send('Cliente não encontrado');
    }

    // Acessar as propriedades com letras minúsculas, como definido na tabela do banco de dados
    const { nomecompleto, instituicaonome } = clientesResult.rows[0];
    if (!nomecompleto || !instituicaonome) {
      console.error('Nome completo ou instituicaoNome estão undefined');
      return res.status(400).send('Bad Request: Nome completo ou Instituição estão undefined');
    }
    
    // Agora, atualizar a tabela avaliacoes_realizadas com a coluna 'nome'
    const insertResult = await client.query(
      'INSERT INTO avaliacoes_realizadas (cpf, instituicaonome, nome, avaliacao_realizada) VALUES ($1, $2, $3, TRUE) RETURNING *',
      [cpf, instituicaonome, nomecompleto] // Aqui nós usamos 'nomecompleto' para a coluna 'nome'
    );

    // Se a inserção foi bem-sucedida, atualize a coluna data_avaliacao
    if (insertResult.rows.length > 0) {
      await client.query(
        'UPDATE avaliacoes_realizadas SET data_avaliacao = CURRENT_TIMESTAMP WHERE cpf = $1 AND instituicaonome = $2',
        [cpf, instituicaonome]
      );
      res.status(200).send('Webhook received and database updated');
    } else {
      res.status(500).send('Database update failed');
    }
  } catch (error) {
    console.error('Database update failed:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
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
    console.log('Dados incompletos recebidos.');
    return res.status(400).json({ success: false, message: 'Dados incompletos.' });
  }
  
  console.log(`Valores recebidos: Email = ${Email}, senha = ${senha}`);

  const query = "SELECT * FROM cadastro_clientes WHERE Email = $1 AND senha = $2";

  try {
    const client = await pool.connect();
    const results = await client.query(query, [Email, senha]);
    client.release();

    if (results.rows.length > 0) {
      const user = results.rows[0];

      const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

      res.json({
        success: true,
        message: 'Login bem-sucedido!',
        token: token,
        username: user.nomecompleto,
        institution: user.instituicaonome,
        role: 'Visualizador',
        birthDate: user.data_de_nascimento,
        cpf: user.cpf
      });
    } else {
      res.status(401).json({ success: false, message: 'Credenciais inválidas!' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
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

app.get('/api/AuditEventsByInstitution', async (req, res) => {
  const institutionName = req.query.instituicaoNome;

  try {
    const client = await pool.connect();
    const { rows } = await client.query(
      "SELECT * FROM Auditoria WHERE instituicaoNome = $1 ORDER BY timestamp DESC",
      [institutionName]
    );
    client.release();

    res.json({ auditEvents: rows });
  } catch (error) {
    console.error('Erro ao buscar eventos de auditoria:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

app.post('/programas', async (req, res) => {
  try {
    const { nome_programa, link_form, instituicaoNome } = req.body;
    const client = await pool.connect();
    await client.query(
      'INSERT INTO programas (nome_programa, link_form, instituicaoNome) VALUES ($1, $2, $3)',
      [nome_programa, link_form, instituicaoNome]
    );
    client.release();
    res.json({ success: true, message: 'Programa criado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro ao criar programa' });
  }
});

app.get('/programas', async (req, res) => {
  try {
    const instituicaoNome = req.query.instituicaoNome;
    const client = await pool.connect();
    const { rows } = await client.query(
      'SELECT * FROM programas WHERE instituicaoNome = $1',
      [instituicaoNome]
    );
    client.release();
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro ao listar programas' });
  }
});

app.put('/programas/:id', async (req, res) => {
  try {
    const { nome_programa, link_form } = req.body;
    const { id } = req.params;
    const client = await pool.connect();
    await client.query(
      'UPDATE programas SET nome_programa = $1, link_form = $2 WHERE id = $3',
      [nome_programa, link_form, id]
    );
    client.release();
    res.json({ success: true, message: 'Programa atualizado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar programa' });
  }
});

app.delete('/programas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    await client.query('DELETE FROM programas WHERE id = $1', [id]);
    client.release();
    res.json({ success: true, message: 'Programa excluído com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erro ao excluir programa' });
  }
});

app.post('/api/verifyUser', async (req, res) => {
  const { Email } = req.body;
  try {
    const client = await pool.connect();
    const { rows } = await client.query(
      'SELECT * FROM cadastro_clientes WHERE Email = $1',
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
      'UPDATE cadastro_clientes SET senha = $1 WHERE Email = $2',
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

// Nova rota para obter a contagem de usuários por instituição
app.get('/api/UserCountByInstitution', async (req, res) => {
  const institutionName = req.query.instituicaoNome;

  try {
    // Obter uma conexão do pool
    const client = await pool.connect();

    // Consulta SQL para contar os usuários com o mesmo nome de instituição
    const query = "SELECT COUNT(*) AS count FROM cadastro_clientes WHERE instituicaoNome = $1";
    const result = await client.query(query, [institutionName]);

    // Liberar a conexão de volta para o pool
    client.release();

    // Enviar a contagem como resposta
    res.json({ count: result.rows[0].count });
  } catch (error) {
    console.error('Erro ao contar usuários:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

app.post('/api/RegisterUserActivity', async (req, res) => {
  const { userID, activityType, activityData } = req.body;
  const timestamp = new Date();

  try {
    // Obter uma conexão do pool
    const client = await pool.connect();
    
    // Consulta SQL para inserir a atividade do usuário
    const query = "INSERT INTO UserActivity (userID, activityType, activityData, timestamp) VALUES ($1, $2, $3, $4)";
    await client.query(query, [userID, activityType, activityData, timestamp]);
    
    // Liberar a conexão de volta para o pool
    client.release();

    res.status(200).send('Atividade registrada com sucesso');
  } catch (error) {
    console.error('Erro ao registrar atividade:', error);
    res.status(500).send('Erro interno do servidor');
  }
});

app.put('/cadastro_clientes/:id', async (req, res) => {
  const id = req.params.id;
  const {
    nomecompleto, email, data_de_nascimento, genero, telefone, telefone2, cpf, cnpj,
    matricula, observacoes, endereco, numero, complemento, bairro, cidade, estado,
    pais, cep, unidade, setor, cargo, instituicao, acesso, senha
  } = req.body;
  try {
    const query = `
      UPDATE cadastro_clientes SET
        NomeCompleto = $1,
        Email = $2,
        Data_de_Nascimento = $3,
        Genero = $4,
        Telefone = $5,
        Telefone2 = $6,
        CPF = $7,
        CNPJ = $8,
        Matricula = $9,
        Observacoes = $10,
        Endereco = $11,
        Numero = $12,
        Complemento = $13,
        Bairro = $14,
        Cidade = $15,
        Estado = $16,
        Pais = $17,
        CEP = $18,
        Unidade = $19,
        Setor = $20,
        Cargo = $21,
        Instituicao = $22,
        Acesso = $23,
        senha = $24
      WHERE id = $25
    `;

    const values = [
      nomecompleto, email, data_de_nascimento, genero, telefone, telefone2, cpf, cnpj,
      matricula, observacoes, endereco, numero, complemento, bairro, cidade, estado,
      pais, cep, unidade, setor, cargo, instituicao, acesso, senha,
      id
    ];

    await pool.query(query, values);

    res.status(200).json({ message: 'Usuário atualizado com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ message: 'Erro ao atualizar usuário.' });
  }
});



// 3. Deletar um usuário
app.delete('/usuarios/:id', async (req, res) => {
  const userId = req.params.id;

  try {
      // Obter uma conexão do pool
      const client = await pool.connect();

      // Executar a query
      const result = await client.query('DELETE FROM cadastro_clientes WHERE id = $1', [userId]);

      // Liberar a conexão de volta para o pool
      client.release();

      if (result.rowCount === 0) {
          res.status(404).send('Usuário não encontrado.');
          return;
      }
      res.send('Usuário deletado com sucesso.');
  } catch (error) {
      console.error(error);
      res.status(500).send('Erro ao deletar usuário.');
  }
});

const port = process.env.PORT || 5000;

app.listen(port, () => console.log(`Server is running on port ${port}`));
