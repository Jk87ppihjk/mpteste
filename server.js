// server.js (Código Final com Webhook Integrado)

require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const cors = require('cors');
const mysql = require('mysql2/promise');
const https = require('https'); 

const app = express();
const port = process.env.PORT || 3000;

// Middleware para Webhook: O Mercado Pago envia dados como application/json ou x-www-form-urlencoded.
// Garantimos que o corpo da requisição seja lido.
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Necessário para Webhooks
app.use(cors());
app.use(express.static('public'));

// --- CONFIGURAÇÃO DE DB e Funções (Mantidas) ---
// (Pool de conexão, getSellerTokenByProductId, saveSellerToken...)
// ... [Mantenha aqui as funções de DB, que devem estar no topo] ...

// --- FUNÇÕES DE INTERAÇÃO COM O BANCO DE DADOS (Início) ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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
        return sellerToken;
    } catch (error) {
        console.error(`[DB ERRO] Falha ao buscar token:`, error);
        return null;
    }
}

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
}
// --- FUNÇÕES DE INTERAÇÃO COM O BANCO DE DADOS (Fim) ---


// --- CLIENTES MERCADO PAGO ---
const marketplaceClient = new MercadoPagoConfig({
  accessToken: process.env.MP_MARKETPLACE_SECRET_KEY, // Seu token de Marketplace (TEST_ ou PROD_)
  options: { appId: process.env.MP_MARKETPLACE_APP_ID }
});
const paymentClient = new Payment(marketplaceClient); // Cliente para buscar dados de pagamento

const redirectUri = `${process.env.BACKEND_URL}/mp-callback`;

// -----------------------------------------------------------------
// ROTAS DE OAUTH E SPLIT (Mantidas)
// -----------------------------------------------------------------

// ROTA 1: Iniciar Conexão (OAuth)
app.get('/conectar-vendedor', async (req, res) => {
    // ... (Mantida)
    const internalSellerId = req.query.seller_id || 'vendedor_teste_001'; 
    const authUrl = 'https://auth.mercadopago.com/authorization?' +
        `client_id=${process.env.MP_MARKETPLACE_APP_ID}` +
        `&response_type=code` +
        `&platform_id=mp` +
        `&state=${internalSellerId}` +
        `&redirect_uri=${redirectUri}`;
    res.redirect(authUrl); 
});

// ROTA 2: Callback e Troca de Token (OAuth)
app.get('/mp-callback', async (req, res) => {
    // ... (Mantida)
    const { code, state: sellerId } = req.query; 
    if (!code) return res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=cancelado`);

    const tokenResponse = await new Promise((resolve, reject) => {
        const data = JSON.stringify({
            client_id: process.env.MP_MARKETPLACE_APP_ID,
            client_secret: process.env.MP_MARKETPLACE_SECRET_KEY,
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });
        // ... (Lógica de requisição HTTPS direta)
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
    res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=sucesso`);
});

// ROTA 3: Criar Pagamento com Split
app.post('/create_preference', async (req, res) => {
  // ... (Mantida, usa TAXA_FIXA_MARKETPLACE = 0.01)
  try {
    const itemPrice = 2.00;
    const { productId } = req.body; 
    const sellerToken = await getSellerTokenByProductId(productId || 'produto-split-real'); 
    
    if (!sellerToken) return res.status(404).json({ error: 'Token não encontrado.' });

    const TAXA_FIXA_MARKETPLACE = 0.01; 
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / itemPrice) * 100;

    const sellerClient = new MercadoPagoConfig({ accessToken: sellerToken });
    const preference = new Preference(sellerClient);

    const body = {
      items: [ { id: productId || 'produto-split-real', title: 'Produto de Teste Split (R$ 2,00)', unit_price: itemPrice, quantity: 1 } ],
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), 
      
      payment_methods: {
          installments: 1, 
          excluded_payment_types: [
              { id: "ticket" }, { id: "atm" }, { id: "debit_card" }, { id: "bank_transfer" }
          ],
      },
      
      back_urls: { success: `${process.env.BACKEND_URL}/success`, failure: `${process.env.BACKEND_URL}/failure` },
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`, // A ROTA NOVA!
    };

    const response = await preference.create({ body });
    res.json({ init_point: response.init_point });

  } catch (error) {
    console.error('ERRO CRÍTICO NA CRIAÇÃO DA PREFERÊNCIA:', error.message);
    res.status(500).send('Erro interno.');
  }
});


// -----------------------------------------------------------------
// 🚀 ROTA 4: WEBHOOK / NOTIFICAÇÃO DE PAGAMENTO (IPN)
// -----------------------------------------------------------------
app.post('/webhook-mp', async (req, res) => {
    // Mercado Pago pode enviar dados via query (se for IPN) ou body (se for Webhook v2)
    const topic = req.query.topic || req.body.topic;
    const notificationId = req.query.id || req.body.data?.id;

    console.log(`--- WEBHOOK RECEBIDO --- Topic: ${topic}, ID: ${notificationId}`);

    // 1. Verificação: Só processamos notificações de 'payment'
    if (topic !== 'payment' || !notificationId) {
        // Retorna 200 OK, mas não processa
        return res.status(200).send('Notificação ignorada.'); 
    }

    try {
        // 2. Consulta à API (Verificação Antifraude)
        // Usamos o cliente do Marketplace para buscar os dados do pagamento
        const paymentInfo = await paymentClient.get({ id: notificationId });

        console.log(`Status do Pagamento: ${paymentInfo.status}`);
        console.log(`Valor Total: ${paymentInfo.transaction_amount}`);
        console.log(`Vendedor ID: ${paymentInfo.collector_id}`); // ID do coletor do pagamento (será o vendedor)
        
        // 3. Processamento e Lógica do Marketplace
        if (paymentInfo.status === 'approved') {
            // 🚀 LÓGICA DE NEGÓCIO AQUI:
            // - BUSCAR O SEU ORDER ID USANDO paymentInfo.external_reference
            // - MARCAR O PEDIDO COMO PAGO NO SEU DB
            // - INICIAR O ENVIO DO PRODUTO/SERVIÇO
            
            console.log('--- PAGAMENTO APROVADO! ---');
        } else if (paymentInfo.status === 'pending') {
            console.log('--- PAGAMENTO PENDENTE (AGUARDANDO PIX/BOLETO) ---');
        }

    } catch (error) {
        console.error('ERRO NO PROCESSAMENTO DO WEBHOOK:', error.message);
        // Se a consulta falhar, retornamos 500 para que o MP tente reenviar
        return res.status(500).send('Erro no servidor ao processar notificação.'); 
    }

    // 4. Reconhecimento: Retorna 200 OK (Obrigatório)
    res.status(200).send('Webhook processado.');
});


// Rotas de Simulação (Mantidas)
app.get('/success', (req, res) => res.send('Pagamento Aprovado (Simulação de Retorno)'));
app.get('/failure', (req, res) => res.send('Pagamento Falhou (Simulação de Retorno)'));
app.get('/painel-vendedor', (req, res) => res.send(`Conexão OAuth: ${req.query.status}. Verifique o seu DB.`));

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
