// server.js (Código de Produção Final e Consolidado)

require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const cors = require('cors');
const mysql = require('mysql2/promise');
const https = require('https'); 

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DE MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Necessário para Webhooks
app.use(cors());
app.use(express.static('public'));

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- FUNÇÕES DE INTERAÇÃO COM O BANCO DE DADOS ---

/** Busca o Access Token do vendedor no MySQL. */
async function getSellerTokenByProductId(productId) {
    const query = `
        SELECT t1.mp_access_token 
        FROM vendedores t1
        JOIN produtos t2 ON t1.seller_id = t2.seller_id
        WHERE t2.produto_id = ?
        LIMIT 1
    `;
    try {
        const [rows] = await pool.execute(query, [productId]);
        if (rows.length === 0) return null;
        
        const sellerToken = rows[0].mp_access_token;
        if (!sellerToken) return null;
        
        // Mantido o console.log para debugging
        console.log(`[DB] Token de Vendedor encontrado. Prefixo: ${sellerToken.substring(0, 8)}...`);
        return sellerToken;

    } catch (error) {
        console.error(`[DB ERRO] Falha ao buscar token:`, error);
        return null;
    }
}

/** Salva ou atualiza os tokens de acesso e refresh do vendedor. */
async function saveSellerToken(sellerId, accessToken, refreshToken) {
    const query = `
        INSERT INTO vendedores (seller_id, mp_access_token, mp_refresh_token, data_conexao)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
        mp_access_token = VALUES(mp_access_token), 
        mp_refresh_token = VALUES(mp_refresh_token),
        data_conexao = VALUES(data_conexao);
    `;
    await pool.execute(query, [sellerId, accessToken, refreshToken]);
    console.log(`[DB] Tokens salvos/atualizados para o vendedor ID: ${sellerId}`);
}

// --- CONFIGURAÇÕES DE CLIENTES MERCADO PAGO ---
const marketplaceClient = new MercadoPagoConfig({
  accessToken: process.env.MP_MARKETPLACE_SECRET_KEY, 
  options: { appId: process.env.MP_MARKETPLACE_APP_ID }
});
const paymentClient = new Payment(marketplaceClient); 

const redirectUri = `${process.env.BACKEND_URL}/mp-callback`;

// -----------------------------------------------------------------
// ROTAS DE OAUTH
// -----------------------------------------------------------------

// ROTA 1: Iniciar Conexão (OAuth)
app.get('/conectar-vendedor', async (req, res) => {
  try {
    const internalSellerId = req.query.seller_id || 'vendedor_teste_001'; 
    
    // Construção manual da URL de Autorização 
    const authUrl = 'https://auth.mercadopago.com/authorization?' +
        `client_id=${process.env.MP_MARKETPLACE_APP_ID}` +
        `&response_type=code` +
        `&platform_id=mp` +
        `&state=${internalSellerId}` +
        `&redirect_uri=${redirectUri}`;
    
    res.redirect(authUrl); 
    
  } catch (error) {
    console.error('Erro ao gerar URL de autorização:', error); 
    res.status(500).send('Erro ao conectar com Mercado Pago.');
  }
});

// ROTA 2: Callback e Troca de Token (OAuth)
app.get('/mp-callback', async (req, res) => {
  try {
    const { code, state: sellerId } = req.query; 

    if (!code) {
      return res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=cancelado`);
    }

    // CHAMADA HTTP DIRETA PARA O MERCADO PAGO para trocar o código pelo token
    const tokenResponse = await new Promise((resolve, reject) => {
        const data = JSON.stringify({
            client_id: process.env.MP_MARKETPLACE_APP_ID,
            client_secret: process.env.MP_MARKETPLACE_SECRET_KEY,
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        const reqOptions = {
            hostname: 'api.mercadopago.com', path: '/oauth/token', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        };

        const clientReq = https.request(reqOptions, (clientRes) => {
            let responseData = ''; clientRes.on('data', (chunk) => { responseData += chunk; });
            clientRes.on('end', () => {
                try {
                    const jsonResponse = JSON.parse(responseData);
                    if (clientRes.statusCode !== 200) return reject(new Error(jsonResponse.message));
                    resolve(jsonResponse);
                } catch (e) { reject(new Error('Erro ao analisar resposta JSON do MP.')); }
            });
        });

        clientReq.on('error', (e) => { reject(e); });
        clientReq.write(data); clientReq.end();
    });

    const accessToken = tokenResponse.access_token;
    const refreshToken = tokenResponse.refresh_token;

    if (sellerId && accessToken) { await saveSellerToken(sellerId, accessToken, refreshToken); } 
    
    console.log(`✅ CREDENCIAIS SALVAS NO DB para vendedor: ${sellerId}`);
    res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=sucesso`);

  } catch (error) {
    console.error('Erro ao obter/salvar credenciais:', error.message);
    res.status(500).send('Erro ao processar autorização.');
  }
});

// -----------------------------------------------------------------
// ROTA 3: Criar Pagamento com Split (PRODUÇÃO)
// -----------------------------------------------------------------
app.post('/create_preference', async (req, res) => {
  try {
    const itemPrice = 2.00;
    const { productId } = req.body; 
    
    // 1. BUSCA O TOKEN AUTOMATICAMENTE NO MYSQL
    const sellerToken = await getSellerTokenByProductId(productId || 'produto-split-real'); 
    
    if (!sellerToken) {
      return res.status(404).json({ error: 'Vendedor ou Token de Produção não encontrado no DB. Execute o OAuth.' });
    }

    // 2. Lógica do Split: R$ 0,01 para o Marketplace (0.5%)
    const TAXA_FIXA_MARKETPLACE = 0.01; 
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / itemPrice) * 100; // Resulta em 0.5%

    // 3. Configura o cliente com o TOKEN DO VENDEDOR
    const sellerClient = new MercadoPagoConfig({ accessToken: sellerToken });
    const preference = new Preference(sellerClient);

    const body = {
      items: [
        {
          id: productId || 'produto-split-real',
          title: 'Produto de Teste Split (R$ 2,00)',
          description: `Split: R$ ${TAXA_FIXA_MARKETPLACE.toFixed(2)} para o Marketplace`,
          unit_price: itemPrice,
          quantity: 1,
        }
      ],
      // Parâmetro essencial para o Split
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), 
      
      // CONFIGURAÇÃO PARA FORÇAR PIX/CARTÃO DE CRÉDITO
      payment_methods: {
          installments: 1, 
          excluded_payment_types: [
              { id: "ticket" }, { id: "atm" }, { id: "debit_card" }, { id: "bank_transfer" }
          ],
      },
      
      back_urls: {
        success: `${process.env.BACKEND_URL}/success`,
        failure: `${process.env.BACKEND_URL}/failure`,
      },
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`, 
    };

    const response = await preference.create({ body });
    res.json({ init_point: response.init_point });

  } catch (error) {
    console.error('ERRO CRÍTICO NA CRIAÇÃO DA PREFERÊNCIA:', error.message);
    res.status(500).send('Erro interno.');
  }
});

// -----------------------------------------------------------------
// ROTA 4: WEBHOOK / NOTIFICAÇÃO DE PAGAMENTO (IPN)
// -----------------------------------------------------------------
app.post('/webhook-mp', async (req, res) => {
    const topic = req.query.topic || req.body.topic;
    const notificationId = req.query.id || req.body.data?.id;

    if (topic !== 'payment' || !notificationId) {
        return res.status(200).send('Notificação ignorada.'); 
    }

    try {
        // Consulta à API (Verificação Antifraude)
        const paymentInfo = await paymentClient.get({ id: notificationId });

        console.log(`--- WEBHOOK RECEBIDO --- Status: ${paymentInfo.status}, ID: ${notificationId}`);
        
        // LÓGICA DE NEGÓCIO:
        if (paymentInfo.status === 'approved') {
            // Lógica para marcar o pedido como pago e iniciar o envio.
            console.log('--- PAGAMENTO APROVADO! --- (Valor dividido: R$ 0.01 para Marketplace)');
        } 

    } catch (error) {
        console.error('ERRO NO PROCESSAMENTO DO WEBHOOK:', error.message);
        return res.status(500).send('Erro no servidor ao processar notificação.'); 
    }

    // Reconhecimento: Retorna 200 OK (Obrigatório)
    res.status(200).send('Webhook processado.');
});


// Rotas de Simulação
app.get('/success', (req, res) => res.send('Pagamento Aprovado (Simulação de Retorno)'));
app.get('/failure', (req, res) => res.send('Pagamento Falhou (Simulação de Retorno)'));
app.get('/painel-vendedor', (req, res) => res.send(`Conexão OAuth: ${req.query.status}. Verifique o seu DB.`));

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
