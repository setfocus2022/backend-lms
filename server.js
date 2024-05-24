
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt-nodejs');
const { Pool } = require('pg');
const jwtSecret = 'suus02201998##';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const app = express();
const path = require('path');
const pool = new Pool({
  connectionString: 'postgresql://avalie_imoveis_owner:rqBTYR6N5bks@ep-dawn-forest-a5321xho.us-east-2.aws.neon.tech/avalie_imoveis?sslmode=require',
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors({
  origin: ['http://localhost:3000','https://backend-painel.onrender.com', 'https://painel-swart.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use('/pdf', express.static('pdfs'));

app.use(express.json());




const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
app.post('/api/user/check-email', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length > 0) {
      // O usuário existe, prossiga com a lógica de envio do código
      const code = generateCode(); // Gera um novo código de 6 dígitos
      await pool.query('UPDATE users SET cod_rec = $1 WHERE email = $2', [code, email]); // Atualiza o código na tabela do usuário

      // Envia o código por e-mail
      await sendVerificationCode(email, code);

      res.json({ success: true, message: 'E-mail encontrado. Enviando código...' });
    } else {
      // Usuário não encontrado
      res.status(404).json({ success: false, message: 'E-mail não encontrado.' });
    }
  } catch (error) {
    console.error('Erro ao verificar e-mail:', error);
    res.status(500).json({ success: false, message: 'Erro ao verificar e-mail.' });
  }
});


const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true for 465, false for other ports como 587 com TLS
    auth: {
        user: 'suporte.fmatch@outlook.com',
        pass: '@Desenho1977##',
    },
});

const sendVerificationCode = async (email, code) => {
    const mailOptions = {
        from: 'suporte.fmatch@outlook.com', // endereço do remetente
        to: email, // endereço do destinatário
        subject: 'Código de Verificação',
        text: `Seu código de verificação é: ${code}`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Código de verificação enviado para:', email);
    } catch (error) {
        console.error('Erro ao enviar código de verificação:', error);
    }
};


app.post('/api/user/verify-code', async (req, res) => {
  const { email, code } = req.body;
  // Verifica se o código e o e-mail correspondem ao que está no banco
  const user = await pool.query('SELECT * FROM users WHERE email = $1 AND cod_rec = $2', [email, code]);
  if (user.rows.length > 0) {
    // Código correto, limpa o cod_rec e avisa o usuário para mudar a senha
    await pool.query('UPDATE users SET cod_rec = NULL WHERE email = $1', [email]);
    res.json({ success: true, message: 'Código verificado com sucesso. Por favor, redefinir sua senha.' });
  } else {
    res.status(401).json({ success: false, message: 'Código de verificação inválido.' });
  }
});

app.post('/api/user/update-password', (req, res) => {
  const { email, newPassword } = req.body;

  bcrypt.genSalt(10, (err, salt) => { // Gerar salt com callback
    if (err) {
      console.error('Erro ao gerar salt:', err);
      return res.status(500).json({ success: false, message: 'Erro ao atualizar senha' });
    }

    bcrypt.hash(newPassword, salt, async (err, hashedPassword) => { // Hash com callback
      if (err) {
        console.error('Erro ao gerar hash da senha:', err);
        return res.status(500).json({ success: false, message: 'Erro ao atualizar senha' });
      }

      try {
        await pool.query('UPDATE users SET senha = $1 WHERE email = $2', [hashedPassword, email]);
        res.json({ success: true, message: 'Senha atualizada com sucesso.' });
      } catch (error) {
        console.error('Erro ao atualizar senha:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar senha' });
      }
    });
  });
});




app.get('/api/empresa/compras', authenticateToken, async (req, res) => {
  const empresaNome = req.user.username;

  try {
    const query = `
      SELECT cc.id, c.nome AS curso_nome, cc.periodo, cc.created_at AS data_compra, cc.status, u.nome AS aluno_nome
      FROM compras_cursos cc
      JOIN cursos c ON cc.curso_id = c.id
      JOIN users u ON cc.user_id = u.id
      WHERE u.empresa = $1
      ORDER BY cc.created_at DESC
    `;
    const { rows: compras } = await pool.query(query, [empresaNome]);

    // Formatar a data da compra
    const comprasFormatadas = compras.map(compra => ({
      ...compra,
      data_compra: new Date(compra.data_compra).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    }));

    res.json(comprasFormatadas);
  } catch (error) {
    console.error('Erro ao buscar histórico de compras da empresa:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar histórico de compras' });
  }
});

app.get('/api/empresa/cursos/total', authenticateToken, async (req, res) => {
  const empresaNome = req.user.username;

  try {
    const query = `
      SELECT COUNT(DISTINCT cc.curso_id) AS total_cursos
      FROM compras_cursos cc
      JOIN users u ON cc.user_id = u.id
      WHERE u.empresa = $1 AND cc.status = 'aprovado'
    `;
    const { rows } = await pool.query(query, [empresaNome]);
    const totalCursos = rows[0].total_cursos;

    res.json({ success: true, totalCursos });
  } catch (error) {
    console.error('Erro ao buscar total de cursos da empresa:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar total de cursos' });
  }
});

app.post('/api/add-user', (req, res) => {
  const { username, nome, sobrenome, email, role, empresa, senha, cep, cidade, endereco, pais } = req.body;

  bcrypt.hash(senha, 10, async (err, hashedPassword) => {
    if (err) {
      console.error('Erro ao criar usuário:', err);
      return res.status(500).json({ success: false, message: 'Erro ao criar usuário' });
    }

    try {
      const client = await pool.connect();
      const query = `
        INSERT INTO users (username, nome, sobrenome, email, role, empresa, senha, cep, cidade, endereco, pais)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;
      const values = [username, nome, sobrenome, email, role, empresa, hashedPassword, cep, cidade, endereco, pais];
      await client.query(query, values);
      client.release();
      res.json({ success: true, message: 'Usuário criado com sucesso!' });
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      res.status(500).json({ success: false, message: 'Erro ao criar usuário' });
    }
  });
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
      { id: user.id, role: user.acesso, instituicaoNome: user.instituicaonome },
      jwtSecret,
      { expiresIn: '10h' }
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
      instituicaoNome: user.instituicaonome 
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
  const { userId, nome, sobrenome, email, endereco, cidade, cep, pais, role, username, empresa } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'ID de usuário não fornecido.' });
  }

  try {
    const client = await pool.connect();

    // Adicionar 'empresa' à query SQL
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
        username = $9,
        empresa = $10
      WHERE id = $11
    `;

    // Adicionar 'empresa' aos valores
    const values = [nome, sobrenome, email, endereco, cidade, cep, pais, role, username, empresa, userId];

    await client.query(query, values);

    client.release();

    res.json({ success: true, message: 'Perfil atualizado com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar perfil do usuário:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor ao atualizar perfil.' });
  }
});

app.post('/api/Updateempresas', (req, res) => {
  const { cnpj, nome, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone, responsavel, email, senha } = req.body;

  bcrypt.hash(senha, 10, async (err, hashedPassword) => {
    if (err) {
      console.error('Erro ao cadastrar empresa:', err);
      return res.status(500).json({ success: false, message: 'Erro ao cadastrar empresa' });
    }

    try {
      const client = await pool.connect();
      const query = `
        INSERT INTO empresas (cnpj, nome, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone, responsavel, email, senha)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `;
      const values = [cnpj, nome, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone, responsavel, email, hashedPassword];
      await client.query(query, values);
      client.release();
      res.json({ success: true, message: 'Empresa cadastrada com sucesso!' });
    } catch (error) {
      console.error('Erro ao cadastrar empresa:', error);
      res.status(500).json({ success: false, message: 'Erro ao cadastrar empresa' });
    }
  });
});

// Rota para buscar todas as empresas
app.get('/api/empresas', async (req, res) => {
  try {
    const query = 'SELECT * FROM empresas';
    const client = await pool.connect();
    const { rows } = await client.query(query);
    client.release();
    res.json(rows);
  } catch (error) {
    console.error('Erro ao buscar empresas:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar empresas' });
  }
});

app.delete('/api/empresas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const query = 'DELETE FROM empresas WHERE id = $1';
    const client = await pool.connect();
    await client.query(query, [id]);
    client.release();
    res.json({ success: true, message: 'Empresa excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir empresa:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir empresa' });
  }
});

// Rota para atualizar uma empresa
app.put('/api/empresas/:id', async (req, res) => {
  const { id } = req.params;
  const { cnpj, nome, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone, responsavel, email } = req.body;

  try {
    const client = await pool.connect();
    const query = `
      UPDATE empresas
      SET cnpj = $1, nome = $2, logradouro = $3, numero = $4, complemento = $5, 
          bairro = $6, cidade = $7, estado = $8, cep = $9, telefone = $10, 
          responsavel = $11, email = $12
      WHERE id = $13
    `;
    const values = [cnpj, nome, logradouro, numero, complemento, bairro, cidade, estado, cep, telefone, responsavel, email, id];
    await client.query(query, values);
    client.release();
    res.json({ success: true, message: 'Empresa atualizada com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar empresa' });
  }
});

app.delete('/api/delete-historico/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const query = 'DELETE FROM historico WHERE user_id = $1'; // Corrigido: removendo compras_cursos
    const client = await pool.connect();
    await client.query(query, [userId]);
    client.release();

    res.json({ success: true, message: 'Histórico do aluno excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir histórico do aluno:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir histórico do aluno' });
  }
});

app.delete('/api/delete-aluno/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const client = await pool.connect();

    // 1. Exclua os registros relacionados na tabela "historico" (opcional)
    // await client.query('DELETE FROM historico WHERE user_id = $1', [userId]);

    // 2. Exclua os registros relacionados na tabela "compras_cursos"
    await client.query('DELETE FROM compras_cursos WHERE user_id = $1', [userId]);

    // 3. Exclua o usuário da tabela "users"
    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    client.release();

    res.json({ success: true, message: 'Aluno excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir aluno:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir aluno' });
  }
});




app.get('/api/cursos', async (req, res) => {
  try {
    const query = 'SELECT id, nome, descricao, thumbnail, valor_10d, valor_30d, valor_6m FROM cursos';
    const client = await pool.connect();
    const { rows } = await client.query(query);
    client.release();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar cursos', error });
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


app.get("/alunos", async (req, res) => {
  try {
    const query = "SELECT  empresa, id, nome, sobrenome, email, endereco, cidade, cep, pais, role, username FROM Users WHERE role = $1";
    const client = await pool.connect();
    const results = await client.query(query, ['Aluno']);
    client.release();

    res.json(results.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.post('/register_usuario', (req, res) => {
  const { usuario, nome, email, senha, unidade, setor, acesso } = req.body;

  bcrypt.hash(senha, 10, async (err, senhaHash) => {
    if (err) {
      console.log(err);
      return res.send({ success: false, message: err.message });
    }

    try {
      const query = 'INSERT INTO login_register (usuario, nome, email, senha, unidade, setor, acesso) VALUES ($1, $2, $3, $4, $5, $6, $7)';
      const values = [usuario, nome, email, senhaHash, unidade, setor, acesso];

      const client = await pool.connect();
      await client.query(query, values);
      client.release();

      res.send({ success: true });
    } catch (err) {
      console.log(err);
      return res.send({ success: false, message: err.message });
    }
  });
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
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extrai o token do cabeçalho Authorization

  if (token == null) return res.sendStatus(401); // Se não houver token, retorna 401 (Não Autorizado)

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403); // Se houver um erro na verificação, retorna 403 (Proibido)

    // Adicionando os detalhes do usuário ao objeto de solicitação
    req.user = {
      userId: user.userId, // Certifique-se de que o payload do token tenha 'userId'
      role: user.role, // Certifique-se de que o payload do token tenha 'role'
      username: user.username // Certifique-se de que o payload do token tenha 'username'
    };

    next(); // Chama o próximo middleware na pilha
  });
}
app.get('/api/validateToken', authenticateToken, (req, res) => {
  res.json({
    isValid: true,
    userId: req.user.userId,
    role: req.user.role,
    username: req.user.username
  });
});

app.post("/api/user/login", (req, res) => {
  const { Email, senha } = req.body;
  console.log("Dados recebidos:", Email, senha);

  if (!Email || !senha) {
    console.log("Dados incompletos.");
    return res.status(400).json({ success: false, message: 'Dados incompletos.' });
  }

  try {
    console.log("Iniciando processo de login...");

    // 1. Verificar na tabela 'users'
    const userQuery = "SELECT * FROM users WHERE email = $1 OR username = $1";
    pool.connect((err, client, release) => {
      if (err) {
        console.error("Erro ao conectar ao banco de dados:", err);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
      }

      client.query(userQuery, [Email], (err, userResults) => {
        release(); // Liberar a conexão imediatamente após a consulta
        if (err) {
          console.error("Erro na consulta 'users':", err);
          return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
        }

        console.log("Resultados da consulta 'users':", userResults.rows);

        if (userResults.rows.length > 0) {
          const user = userResults.rows[0];
          console.log("Usuário encontrado:", user);

          bcrypt.compare(senha, user.senha, (err, senhaValida) => {
            if (err) {
              console.error("Erro ao comparar senhas:", err);
              return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
            }

            console.log("Senha válida:", senhaValida);

            if (senhaValida) {
              const token = jwt.sign({ userId: user.id, role: user.role, username: user.username }, jwtSecret, { expiresIn: '10h' });
              console.log("Token gerado:", token);
              return res.json({
                success: true,
                message: 'Login bem-sucedido!',
                token: token,
                username: user.username,
                userId: user.id,
                role: user.role
              });
            } else {
              console.log("Credenciais inválidas (senha incorreta).");
              return res.status(401).json({ success: false, message: 'Credenciais inválidas!' });
            }
          });
        } else {
          console.log("Nenhum usuário encontrado com o email/username fornecido.");

          // 2. Verificar na tabela 'empresas'
          const empresaQuery = "SELECT * FROM empresas WHERE email = $1";
          client.query(empresaQuery, [Email], (err, empresaResults) => {
            if (err) {
              console.error("Erro na consulta 'empresas':", err);
              return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
            }

            console.log("Resultados da consulta 'empresas':", empresaResults.rows);

            if (empresaResults.rows.length > 0) {
              const empresa = empresaResults.rows[0];
              console.log("Empresa encontrada:", empresa);

              bcrypt.compare(senha, empresa.senha, (err, senhaValida) => {
                if (err) {
                  console.error("Erro ao comparar senhas:", err);
                  return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
                }

                console.log("Senha válida:", senhaValida);

                if (senhaValida) {
                  const token = jwt.sign({ userId: empresa.id, role: 'Empresa', username: empresa.nome }, jwtSecret, { expiresIn: '10h' });
                  console.log("Token gerado:", token);
                  return res.json({
                    success: true,
                    message: 'Login bem-sucedido!',
                    token: token,
                    username: empresa.nome,
                    userId: empresa.id,
                    role: 'Empresa'
                  });
                } else {
                  console.log("Credenciais inválidas (senha incorreta).");
                  return res.status(401).json({ success: false, message: 'Credenciais inválidas!' });
                }
              });
            } else {
              console.log("Nenhuma empresa encontrada com o email fornecido.");
              return res.status(401).json({ success: false, message: 'Credenciais inválidas!' });
            }
          });
        }
      });
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Rota para contar alunos de uma empresa específica
app.get('/api/alunos/empresa/:empresaNome/count', async (req, res) => {
  const { empresaNome } = req.params;
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT COUNT(*) FROM users WHERE role = 'Aluno' AND empresa = $1", [empresaNome]);
    client.release();
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error("Erro ao contar alunos da empresa:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});

// Rota para buscar alunos de uma empresa específica
app.get('/alunos/empresa/:empresaNome', async (req, res) => {
  const { empresaNome } = req.params;
  try {
    const query = "SELECT empresa, id, nome, sobrenome, email, endereco, cidade, cep, pais, role, username FROM Users WHERE role = 'Aluno' AND empresa = $1";
    const client = await pool.connect();
    const results = await client.query(query, [empresaNome]);
    client.release();

    res.json(results.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Rota para contar alunos de uma empresa específica que mudaram a senha padrão
app.get('/api/alunos/empresa/:empresaNome/password-changed/count', async (req, res) => {
  const { empresaNome } = req.params;
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT COUNT(*) FROM users WHERE role = 'Aluno' AND empresa = $1 AND senha != 'senha_padrao'", [empresaNome]);
    client.release();
    res.json({ success: true, count: parseInt(rows[0].count, 10) });
  } catch (error) {
    console.error("Erro ao contar acessos de alunos da empresa:", error);
    res.status(500).json({ success: false, message: "Erro interno do servidor" });
  }
});



app.post('/api/add-aluno', (req, res) => {
  const { username, nome, sobrenome, email, role, senha } = req.body;

  bcrypt.hash(senha, 10, async (err, hashedPassword) => { // Usando bcrypt-nodejs com callback
    if (err) {
      console.error('Erro ao adicionar aluno:', err);
      return res.status(500).json({ success: false, message: 'Erro ao adicionar aluno' });
    }

    try {
      // Query para inserir o novo aluno no banco de dados
      const query = 'INSERT INTO users (username, nome, sobrenome, email, role, senha) VALUES ($1, $2, $3, $4, $5, $6)';
      const values = [username, nome, sobrenome, email, role, hashedPassword];

      // Executa a query e aguarda o resultado
      await pool.query(query, values);

      res.json({ success: true, message: 'Aluno adicionado com sucesso!' });

    } catch (error) {
      console.error('Erro ao adicionar aluno:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
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


app.get('/api/check-username/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const query = 'SELECT COUNT(*) FROM users WHERE username = $1';
    const result = await pool.query(query, [username]);
    const exists = result.rows[0].count > 0;
    res.json({ exists });
  } catch (error) {
    console.error('Erro ao verificar username:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/api/check-email/:email', async (req, res) => {
  const { email } = req.params;

  try {
    const query = 'SELECT COUNT(*) FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    const exists = result.rows[0].count > 0;
    res.json({ exists });
  } catch (error) {
    console.error('Erro ao verificar email:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
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

app.listen(port, () => console.log(`Server is running on port ${port}`))