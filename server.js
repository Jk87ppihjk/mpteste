// server.js (Fluxo de Produção Completo)

require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, OAuth, Preference } = require('mercadopago');
const cors = require('cors');

// Importa as funções de DB
const { getSellerTokenByProductId, saveSellerToken } = require('./database'); 

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configuração do Cliente Mercado Pago (usando chaves de PRODUÇÃO do Marketplace)
const marketplaceClient = new MercadoPagoConfig({
  accessToken: process.env.MP_MARKETPLACE_SECRET_KEY,
  options: {
    appId: process.env.MP_MARKETPLACE_APP_ID
  }
});

const oauth = new OAuth(marketplaceClient);
const redirectUri = `${process.env.BACKEND_URL}/mp-callback`;

// -----------------------------------------------------------------
// ROTA 1: Iniciar Conexão (OAuth)
// -----------------------------------------------------------------
app.get('/conectar-vendedor', async (req, res) => {
  try {
    // ⚠️ Adicione o ID interno do vendedor ao 'state' para salvá-lo depois
    const internalSellerId = req.query.seller_id || 'vendedor_teste_001'; 
    
    const authUrl = await oauth.getAuthorizationUrl({
      options: {
        redirectUri: redirectUri,
        platformId: 'mp',
        state: internalSellerId, // Passa o ID do vendedor pelo fluxo
      }
    });
    res.redirect(authUrl);
  } catch (error) {
    console.error('Erro ao gerar URL de autorização:', error);
    res.status(500).send('Erro ao conectar com Mercado Pago.');
  }
});

// -----------------------------------------------------------------
// ROTA 2: Callback e Troca de Token (OAuth)
// -----------------------------------------------------------------
app.get('/mp-callback', async (req, res) => {
  try {
    const { code, state: sellerId } = req.query; // 'state' é o sellerId
    if (!code) {
      return res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=cancelado`);
    }

    const credentials = await oauth.createCredentials({
      body: { code: code, redirectUri: redirectUri }
    });

    // 🚀 NOVO: SALVANDO OS TOKENS NO MYSQL REAL!
    if (sellerId) {
         await saveSellerToken(sellerId, credentials.accessToken, credentials.refreshToken);
    }
    
    console.log(`✅ CREDENCIAIS SALVAS NO DB para vendedor: ${sellerId}`);
    res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=sucesso`);

  } catch (error) {
    console.error('Erro ao obter/salvar credenciais:', error);
    res.status(500).send('Erro ao processar autorização.');
  }
});

// -----------------------------------------------------------------
// ROTA 3: Criar Pagamento com Split (PRODUÇÃO)
// -----------------------------------------------------------------
app.post('/create_preference', async (req, res) => {
  try {
    const itemPrice = 2.00; // Preço do item
    
    // 1. Recebe o produto e busca o token automaticamente no MySQL
    const { productId } = req.body; 
    const sellerToken = await getSellerTokenByProductId(productId || 'produto-split-real'); 
    
    if (!sellerToken) {
      return res.status(404).send({ error: 'Vendedor ou Token de Produção não encontrado no DB. Verifique o produto ID.' });
    }

    // 2. Lógica do Split: R$ 1,00 para o Marketplace (50%)
    const TAXA_FIXA_MARKETPLACE = 1.00;
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / itemPrice) * 100; // Resulta em 50

    // 3. Configura o cliente com o TOKEN DE PRODUÇÃO DO VENDEDOR
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
      // Parâmetro essencial para o Split: 50%
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), 
      
      back_urls: {
        success: `${process.env.BACKEND_URL}/success`,
        failure: `${process.env.BACKEND_URL}/failure`,
      },
      // ⚠️ Use sua URL de Webhook real aqui
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`, 
    };

    const response = await preference.create({ body });
    res.json({ init_point: response.init_point });

  } catch (error) {
    console.error('ERRO CRÍTICO NA CRIAÇÃO DA PREFERÊNCIA:', error.message);
    res.status(500).send('Erro interno. Verifique o console do servidor.');
  }
});

// Rotas de Simulação para fins de teste
app.get('/success', (req, res) => res.send('Pagamento Aprovado (Simulação de Retorno)'));
app.get('/failure', (req, res) => res.send('Pagamento Falhou (Simulação de Retorno)'));
app.get('/painel-vendedor', (req, res) => res.send(`Conexão OAuth: ${req.query.status}`));

app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
