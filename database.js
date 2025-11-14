// database.js (Conexão MySQL Real)

require('dotenv').config();
const mysql = require('mysql2/promise');

// Cria o pool de conexões (melhor performance para um servidor web)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * Função REAL que busca o Access Token de PRODUÇÃO do vendedor no MySQL.
 * * @param {string} productId - O ID do produto que está sendo comprado.
 * @returns {Promise<string|null>} O token de acesso de produção do vendedor.
 */
async function getSellerTokenByProductId(productId) {
    // Consulta SQL: Busca o token do vendedor que vende o produto específico.
    // ⚠️ ATENÇÃO: A tabela e as colunas devem refletir seu schema real.
    const query = `
        SELECT mp_access_token 
        FROM vendedores 
        WHERE produto_id = ?
        LIMIT 1
    `;

    try {
        // Executa a query com o ID do produto como parâmetro seguro
        const [rows] = await pool.execute(query, [productId]);

        if (rows.length === 0) {
            console.warn(`[DB] Produto/Vendedor não encontrado para ID: ${productId}`);
            return null;
        }

        // Retorna o token da primeira linha encontrada
        const sellerToken = rows[0].mp_access_token;

        if (!sellerToken || !sellerToken.startsWith('PROD')) {
             console.error(`[DB] Token encontrado para ${productId} é inválido ou não é de PRODUÇÃO.`);
             return null;
        }

        console.log(`[DB] Token de Vendedor de PRODUÇÃO encontrado e retornado com sucesso.`);
        return sellerToken;

    } catch (error) {
        console.error(`[DB ERRO] Falha ao consultar o banco de dados:`, error);
        return null;
    }
}

// Implemente a função para salvar o token aqui (usada no /mp-callback)
async function saveSellerToken(sellerId, accessToken, refreshToken) {
    const query = `
        INSERT INTO vendedores (seller_id, mp_access_token, mp_refresh_token, data_conexao)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
        mp_access_token = VALUES(mp_access_token), 
        mp_refresh_token = VALUES(mp_refresh_token);
    `;
    // Assumindo que você tem 'seller_id' na sua rota /mp-callback via 'state'
    await pool.execute(query, [sellerId, accessToken, refreshToken]);
    console.log(`[DB] Tokens salvos/atualizados para o vendedor ID: ${sellerId}`);
}


module.exports = { getSellerTokenByProductId, saveSellerToken };
