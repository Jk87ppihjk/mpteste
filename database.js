// database.js (Conexão e Funções de DB)

require('dotenv').config();
const mysql = require('mysql2/promise');

// ⚠️ SUBSTITUA OS VALORES NA CONEXÃO PELOS DO SEU .env
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- FUNÇÃO DE BUSCA (USADA EM /create_preference) ---

/**
 * Busca o Access Token de PRODUÇÃO do vendedor no MySQL.
 * @param {string} productId - O ID do produto que está sendo comprado.
 * @returns {Promise<string|null>} O token de acesso de produção do vendedor.
 */
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

        if (rows.length === 0) {
            console.warn(`[DB] Produto/Vendedor não encontrado para ID: ${productId}`);
            return null;
        }

        const sellerToken = rows[0].mp_access_token;

        if (!sellerToken || !sellerToken.startsWith('PROD')) {
             console.error(`[DB] Token inválido ou não é de PRODUÇÃO para ${productId}.`);
             return null;
        }

        console.log(`[DB] Token de Vendedor de PRODUÇÃO encontrado.`);
        return sellerToken;

    } catch (error) {
        console.error(`[DB ERRO] Falha ao consultar o banco de dados:`, error);
        return null;
    }
}

// --- FUNÇÃO DE SALVAMENTO (USADA EM /mp-callback) ---

/**
 * Salva ou atualiza os tokens de acesso e refresh do vendedor.
 */
async function saveSellerToken(sellerId, accessToken, refreshToken) {
    // ⚠️ Certifique-se de que sua tabela 'vendedores' tem uma chave única em 'seller_id'
    const query = `
        INSERT INTO vendedores (seller_id, mp_access_token, mp_refresh_token, data_conexao)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
        mp_access_token = VALUES(mp_access_token), 
        mp_refresh_token = VALUES(mp_refresh_token),
        data_conexao = VALUES(data_conexao);
    `;
    
    // ATENÇÃO: O 'sellerId' deve vir do 'state' da ROTA 1
    await pool.execute(query, [sellerId, accessToken, refreshToken]);
}


module.exports = { getSellerTokenByProductId, saveSellerToken };
