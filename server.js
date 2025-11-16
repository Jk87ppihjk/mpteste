// ! server.js (COMPLETO E CORRIGIDO PARA mpteste.onrender.com)
// Este é o serviço de pagamentos (Split)

require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const cors = require('cors');
const https = require('https'); 
const axios = require('axios'); // <-- ADICIONADO para notificar o webhook

// --- IMPORTAÇÃO DAS FUNÇÕES DE BANCO DE DADOS ---
// Em vez de definir as funções aqui, importamos do seu 'database.js'
const { getSellerTokenByProductId, saveSellerToken } = require('./database'); 

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DE MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(cors());
app.use(express.static('public'));

// --- CONFIGURAÇÕES DE CLIENTES MERCADO PAGO ---
const marketplaceClient = new MercadoPagoConfig({
  accessToken: process.env.MP_MARKETPLACE_SECRET_KEY, 
  options: { appId: process.env.MP_MARKETPLACE_APP_ID }
});
const paymentClient = new Payment(marketplaceClient); 

// URL de Redirecionamento do OAuth (deve ser a URL deste backend)
const redirectUri = `${process.env.BACKEND_URL}/mp-callback`;

// -----------------------------------------------------------------
// ROTA 1: Iniciar Conexão (OAuth)
// (O Lojista da 'prp-jiww' é enviado para cá)
// -----------------------------------------------------------------
app.get('/conectar-vendedor', async (req, res) => {
  try {
    // O 'seller_id' deve vir do seu app principal (prp-jiww)
    const internalSellerId = req.query.seller_id; 
    
    if (!internalSellerId) {
        return res.status(400).send('Erro: O seller_id interno (do app principal) é obrigatório.');
    }

    // Construção manual da URL de Autorização 
    const authUrl = 'https://auth.mercadopago.com/authorization?' +
        `client_id=${process.env.MP_MARKETPLACE_APP_ID}` +
        `&response_type=code` +
        `&platform_id=mp` +
        `&state=${internalSellerId}` + // O ID interno é enviado no 'state'
        `&redirect_uri=${redirectUri}`;
    
    res.redirect(authUrl); 
    
  } catch (error) {
    console.error('Erro ao gerar URL de autorização:', error); 
    res.status(500).send('Erro ao conectar com Mercado Pago.');
  }
});

// -----------------------------------------------------------------
// ROTA 2: Callback e Troca de Token (OAuth)
// (O Mercado Pago redireciona o lojista para cá)
// -----------------------------------------------------------------
app.get('/mp-callback', async (req, res) => {
  try {
    const { code, state: sellerId } = req.query; // O 'sellerId' é recuperado do 'state'

    // Se o usuário cancelou ou o código não veio
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/painel-vendedor?status=cancelado`);
    }

    // CHAMADA HTTP DIRETA PARA O MERCADO PAGO para trocar o código pelo token
    // (Usando sua lógica robusta com 'https')
    const tokenResponse = await new Promise((resolve, reject) => {
        const data = JSON.stringify({
            client_id: process.env.MP_MARKETPLACE_APP_ID, client_secret: process.env.MP_MARKETPLACE_SECRET_KEY,
            code: code, redirect_uri: redirectUri, grant_type: 'authorization_code'
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

    // Salva os tokens no DB deste serviço (mpteste)
    if (sellerId && accessToken) { 
        await saveSellerToken(sellerId, accessToken, refreshToken); 
    } 
    
    // Redireciona de volta ao painel do frontend principal
    res.redirect(`${process.env.FRONTEND_URL}/painel-vendedor?status=sucesso`);

  } catch (error) {
    console.error('Erro ao obter/salvar credenciais:', error.message);
    res.status(500).send('Erro ao processar autorização.');
  }
});

// -----------------------------------------------------------------
// ROTA 3: Criar Pagamento com Split (PIX E CARTÃO)
// (Chamada pelo backend 'prp-jiww' no checkout)
// -----------------------------------------------------------------
app.post('/create_preference', async (req, res) => {
  try {
    // 1. RECEBE OS DADOS VINDOS DO BACKEND PRINCIPAL (prp-jiww)
    const { productId, payerEmail, totalAmount, orderId } = req.body; 
    
    // Validação
    if (!productId || !payerEmail || !totalAmount || !orderId) {
        return res.status(400).json({ error: 'Dados insuficientes: productId, payerEmail, totalAmount e orderId são obrigatórios.' });
    }

    // 2. BUSCA O TOKEN DO VENDEDOR (usando a função importada)
    const sellerToken = await getSellerTokenByProductId(productId); 
    
    if (!sellerToken) {
      return res.status(404).json({ error: 'Vendedor ou Token de Produção não encontrado no DB.' });
    }

    // 3. Lógica do Split (Ex: R$ 0.01 fixo para o marketplace)
    const TAXA_FIXA_MARKETPLACE = 0.01; 
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / totalAmount) * 100;

    // 4. Configura o cliente com o TOKEN DO VENDEDOR
    const sellerClient = new MercadoPagoConfig({ accessToken: sellerToken });
    const preference = new Preference(sellerClient);

    const body = {
      items: [
        {
          id: productId.toString(),
          title: `Pedido #${orderId} - Marketplace`,
          description: `Pagamento referente ao pedido ${orderId}`,
          unit_price: parseFloat(totalAmount), // <-- USA O VALOR REAL
          quantity: 1,
        }
      ],
      payer: {
          email: payerEmail
      },
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), 
      
      // Referência externa para sabermos qual pedido atualizar no webhook
      external_reference: orderId.toString(), 

      payment_methods: {
          installments: 1, // Limita cartão a 1 parcela
          excluded_payment_types: [
              { id: "debit_card" },   // Exclui Cartão de Débito
              { id: "ticket" },       // Exclui Boleto
              { id: "atm" }           // Exclui Transferência (Geral)
          ],
      },
      
      back_urls: {
        // Redireciona o usuário para o frontend principal
        success: `${process.env.FRONTEND_URL}/meus-pedidos?status=success&order_id=${orderId}`,
        failure: `${process.env.FRONTEND_URL}/meus-pedidos?status=failure&order_id=${orderId}`,
      },
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`, // Notifica este backend
    };

    const response = await preference.create({ body });
    
    // 5. RETORNA O LINK E O ID DA PREFERÊNCIA para o 'prp-jiww'
    res.json({ 
        init_point: response.init_point,
        preference_id: response.id 
    });

  } catch (error) {
    console.error('ERRO CRÍTICO NA CRIAÇÃO DA PREFERÊNCIA:', error);
    res.status(500).send('Erro interno.');
  }
});

// -----------------------------------------------------------------
// ROTA 4: WEBHOOK / NOTIFICAÇÃO DE PAGAMENTO (IPN)
// (O Mercado Pago notifica este backend)
// -----------------------------------------------------------------
app.post('/webhook-mp', async (req, res) => {
    const topic = req.query.topic || req.body.topic;
    const notificationId = req.query.id || req.body.data?.id; // Este é o PAYMENT_ID

    if (topic !== 'payment' || !notificationId) {
        return res.status(200).send('Notificação ignorada (Não é "payment" ou falta ID).'); 
    }

    try {
        // 1. Busca o pagamento no Mercado Pago
        const paymentInfo = await paymentClient.get({ id: notificationId });
        console.log(`--- WEBHOOK MP RECEBIDO --- Status: ${paymentInfo.status}, ID: ${notificationId}`);
        
        if (paymentInfo.status === 'approved') {
            console.log('--- PAGAMENTO MP APROVADO! ---');
            
            // 2. Obtém o ID da Preferência
            // (que o 'prp-jiww' salvou no 'payment_transaction_id')
            const preferenceId = paymentInfo.preference_id;
            
            if (preferenceId) {
                // 3. Notifica o Backend Principal (prp-jiww)
                const mainAppUrl = process.env.MAIN_APP_WEBHOOK_RECEIVER;
                const internalKey = process.env.INTERNAL_API_KEY;

                await axios.post(mainAppUrl, {
                    preference_id: preferenceId,
                    internal_api_key: internalKey
                });
                
                console.log(`[WEBHOOK/MP] Notificação enviada para o app principal (Pref ID: ${preferenceId}).`);
            } else {
                 console.warn(`[WEBHOOK/MP] Pagamento ${notificationId} aprovado, mas sem preference_id.`);
            }
        } 

    } catch (error) {
        console.error('ERRO NO PROCESSAMENTO DO WEBHOOK:', error.response ? error.response.data : error.message);
        // Retorna 500 para que o MP tente novamente se falharmos
        return res.status(500).send('Erro no servidor ao processar notificação.'); 
    }

    // Retorna 200 para o Mercado Pago confirmar o recebimento
    res.status(200).send('Webhook processado.');
});


// --- INICIAR O SERVIDOR ---
app.listen(port, () => {
  console.log(`🚀 Servidor Split MP (mpteste) rodando na porta ${port}`);
});
