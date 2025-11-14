// server.js (Código de Produção com Split de R$ 2,00)

require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, OAuth, Preference } = require('mercadopago');
const cors = require('cors');

// Importa a função que busca o token real no seu DB (ou no módulo que criamos acima)
const { getSellerTokenByProductId } = require('./database'); 

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 1. Configurar o Cliente Mercado Pago (usando chaves de PRODUÇÃO do Marketplace)
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
// (Usa credenciais do Marketplace)
// -----------------------------------------------------------------
app.get('/conectar-vendedor', async (req, res) => {
  try {
    const authUrl = await oauth.getAuthorizationUrl({
      options: {
        redirectUri: redirectUri,
        platformId: 'mp',
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
// (Usa credenciais do Marketplace para obter token do Vendedor)
// -----------------------------------------------------------------
app.get('/mp-callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.redirect('/pagina-de-erro-conexao.html');
    }

    const credentials = await oauth.createCredentials({
      body: {
        code: code,
        redirectUri: redirectUri
      }
    });

    // 🚨 AQUI VOCÊ DEVE SALVAR credentials.accessToken e credentials.refreshToken 
    //    no seu BANCO DE DADOS REAL, associado ao vendedor.
    
    console.log('✅ CREDENCIAIS DE PRODUÇÃO DO VENDEDOR OBTIDAS COM SUCESSO.');
    // Redireciona o vendedor de volta para o painel dele
    res.redirect(`${process.env.BACKEND_URL}/painel-vendedor?status=sucesso`);

  } catch (error) {
    console.error('Erro ao obter credenciais:', error);
    res.status(500).send('Erro ao processar autorização do Mercado Pago.');
  }
});

// -----------------------------------------------------------------
// ROTA 3: Criar Pagamento com Split (PRODUÇÃO)
// (Usa credenciais do Vendedor)
// -----------------------------------------------------------------
app.post('/create_preference', async (req, res) => {
  try {
    // Produto com preço de R$ 2,00 para dividir em R$ 1,00 + R$ 1,00
    const itemPrice = 2.00; 
    
    // 1. Receber o ID do produto do frontend e buscar o token real do vendedor
    const { productId } = req.body; 
    const sellerToken = await getSellerTokenByProductId(productId || 'produto-split-real'); 
    
    if (!sellerToken) {
      return res.status(404).send({ error: 'Token do vendedor não encontrado. Conexão OAuth falhou.' });
    }

    // 2. Lógica do Split: R$ 1,00 para o Marketplace
    const TAXA_FIXA_MARKETPLACE = 1.00;
    
    // Calcula o percentual: (1.00 / 2.00) * 100 = 50%
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / itemPrice) * 100;

    // 3. Configurar o cliente com o TOKEN DE PRODUÇÃO DO VENDEDOR
    const sellerClient = new MercadoPagoConfig({ accessToken: sellerToken });
    const preference = new Preference(sellerClient);

    const body = {
      items: [
        {
          id: productId || 'produto-split-real',
          title: 'Produto de Teste Split (R$ 2,00)',
          description: 'R$ 1,00 para o vendedor, R$ 1,00 para o Marketplace',
          unit_price: itemPrice,
          quantity: 1,
        }
      ],
      // Split de 50%
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), 
      
      back_urls: {
        success: `${process.env.BACKEND_URL}/success`,
        failure: `${process.env.BACKEND_URL}/failure`,
      },
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`,
    };

    const response = await preference.create({ body });
    res.json({ init_point: response.init_point });

  } catch (error) {
    console.error('ERRO CRÍTICO NA CRIAÇÃO DA PREFERÊNCIA:', error);
    res.status(500).send('Erro interno: Verifique se suas chaves de PRODUÇÃO estão corretas.');
  }
});


app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});
