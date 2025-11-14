// 1. Importar as bibliotecas
require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, OAuth } = require('mercadopago');
const cors = require('cors');

// 2. Configurações Iniciais
const app = express();
const port = process.env.PORT || 3000;

// 3. Middlewares
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// 4. Configurar o Cliente Mercado Pago (para o Marketplace)
// Usamos as credenciais do Marketplace para GERENCIAR o OAuth
const marketplaceClient = new MercadoPagoConfig({
  accessToken: process.env.MP_MARKETPLACE_SECRET_KEY,
  options: {
    appId: process.env.MP_MARKETPLACE_APP_ID
  }
});

const oauth = new OAuth(marketplaceClient);
const redirectUri = `${process.env.BACKEND_URL}/mp-callback`;

// -----------------------------------------------------------------
// 🚀 ROTA 1: Iniciar a Conexão do Vendedor
// -----------------------------------------------------------------
// O seu frontend deve ter um link/botão para esta rota
app.get('/conectar-vendedor', async (req, res) => {
  try {
    // Gera a URL de autorização
    const authUrl = await oauth.getAuthorizationUrl({
      options: {
        redirectUri: redirectUri,
        platformId: 'mp', // mp = Mercado Pago
        // 'state' é opcional, mas recomendado para segurança.
        // Você pode passar o ID do vendedor do seu sistema
        // state: 'SEU_ID_INTERNO_DO_VENDEDOR' 
      }
    });

    console.log('Redirecionando vendedor para:', authUrl);
    // Redireciona o navegador do vendedor para a tela do MP
    res.redirect(authUrl);

  } catch (error) {
    console.error('Erro ao gerar URL de autorização:', error);
    res.status(500).send('Erro ao conectar com Mercado Pago');
  }
});

// -----------------------------------------------------------------
// 🚀 ROTA 2: Callback (Onde o MP devolve o vendedor)
// -----------------------------------------------------------------
// O Mercado Pago chama esta rota após o vendedor autorizar
app.get('/mp-callback', async (req, res) => {
  try {
    // Pega o "code" que o MP enviou na URL
    const { code } = req.query;

    if (!code) {
      // Se o vendedor clicou em "cancelar"
      return res.redirect('/pagina-de-erro-conexao.html');
    }

    console.log('Recebido código de autorização:', code);

    // Troca o código (code) pelo token de acesso permanente
    const credentials = await oauth.createCredentials({
      body: {
        code: code,
        redirectUri: redirectUri
      }
    });

    // ⭐️ O OURO ESTÁ AQUI ⭐️
    const sellerAccessToken = credentials.accessToken;
    const sellerRefreshToken = credentials.refreshToken;
    const sellerMpUserId = credentials.userId;

    console.log('--- CREDENCIAIS DO VENDEDOR OBTIDAS ---');
    console.log('Access Token:', sellerAccessToken);
    console.log('Refresh Token:', sellerRefreshToken);
    console.log('Mercado Pago User ID:', sellerMpUserId);
    console.log('-----------------------------------------');

    // 
    // ⬇️ AÇÃO MAIS IMPORTANTE ⬇️
    //
    // **AQUI VOCÊ DEVE SALVAR ESTES DADOS NO SEU BANCO DE DADOS**
    // Associe 'sellerAccessToken' e 'sellerRefreshToken' ao
    // perfil do vendedor no seu sistema.
    // 
    // Exemplo (simulado):
    // const vendedorId = req.query.state; // Se você usou o 'state'
    // await seuBancoDeDados.salvarTokens(vendedorId, {
    //   mp_access_token: sellerAccessToken,
    //   mp_refresh_token: sellerRefreshToken,
    //   mp_user_id: sellerMpUserId
    // });
    //

    // Redireciona o vendedor de volta para o painel dele
    res.redirect('http://seu-frontend.com/painel-vendedor?status=sucesso');

  } catch (error) {
    console.error('Erro ao obter credenciais:', error);
    res.status(500).send('Erro ao processar autorização do Mercado Pago');
  }
});


// -----------------------------------------------------------------
// 🚀 ROTA 3: Criar Pagamento (A Lógica Real)
// -----------------------------------------------------------------
// Esta é a rota que seu cliente (comprador) usa
const { Preference } = require('mercadopago');

app.post('/create_preference', async (req, res) => {
  try {
    // 1. Identificar o vendedor (ex: vindo do 'req.body')
    const { produtoId } = req.body; // O frontend envia qual produto é
    
    // 2. Buscar o vendedor e o token dele no SEU banco de dados
    //    (Simulação abaixo)
    // const vendedor = await seuBancoDeDados.findSellerByProductId(produtoId);
    // const sellerToken = vendedor.mp_access_token;
    
    // --- SIMULAÇÃO ---
    // ATENÇÃO: Em produção, você NUNCA deve usar um token fixo aqui.
    // Você deve buscar o token do vendedor do produto no seu DB.
    // Estou pegando o token do marketplace SÓ PARA TESTE se vc não tiver um de vendedor ainda.
    // O CORRETO é usar o token obtido no /mp-callback
    
    const sellerToken = "TOKEN_DO_VENDEDOR_QUE_VOCE_SALVOU_NO_DB"; // Substitua pelo token real do vendedor
    
    if (sellerToken === "TOKEN_DO_VENDEDOR_QUE_VOCE_SALVOU_NO_DB") {
      console.warn("AVISO: Usando token de simulação. Substitua pelo token real do vendedor do seu banco de dados.");
      // Se não tiver um token de vendedor, use um de teste para não quebrar
      // const sellerToken = process.env.MP_SELLER_TEST_ACCESS_TOKEN; 
      // Mas o split SÓ FUNCIONA com o token do vendedor real obtido via OAuth
    }
    // --- FIM DA SIMULAÇÃO ---

    // 3. Configurar o cliente com o TOKEN DO VENDEDOR
    const sellerClient = new MercadoPagoConfig({ accessToken: sellerToken });
    const preference = new Preference(sellerClient);

    // 4. Lógica do Split (igual ao exemplo anterior)
    const itemPrice = 10.00;
    const TAXA_FIXA_MARKETPLACE = 5.00;
    const marketplace_fee_percentage = (TAXA_FIXA_MARKETPLACE / itemPrice) * 100;

    const body = {
      items: [
        {
          id: 'produto-001',
          title: 'Produto de Teste (Split)',
          unit_price: itemPrice,
          quantity: 1,
        }
      ],
      // É AQUI QUE O SPLIT ACONTECE:
      marketplace_fee: parseFloat(marketplace_fee_percentage.toFixed(2)), // 50% (R$ 5,00)
      
      back_urls: {
        success: 'https://lorda.dev/success',
        failure: 'https://lorda.dev/failure',
      },
      notification_url: `${process.env.BACKEND_URL}/webhook-mp`,
    };

    // 5. Criar a preferência
    const response = await preference.create({ body });
    res.json({ init_point: response.init_point });

  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    res.status(500).send('Erro interno do servidor');
  }
});


// 6. Iniciar o Servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`Para conectar um vendedor, acesse: http://localhost:${port}/conectar-vendedor`);
});
