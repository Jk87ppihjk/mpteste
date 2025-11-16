// ! Arquivo: database.js (COMPLETO E CORRIGIDO: Removida TODA checagem de prefixo no token)

require('dotenv').config();
const mysql = require('mysql2/promise');

// ⚠️ Configuração do Pool de Conexão
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
 * Busca o Access Token do vendedor no MySQL.
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
            console.warn(`[DB] Produto/Vendedor não encontrado (sem mapeamento) para ID: ${productId}`);
            return null;
        }

        const sellerToken = rows[0].mp_access_token;

        // **CORREÇÃO FINAL:** Retorna o token se ele existir, sem verificar o prefixo.
        if (!sellerToken) { 
             console.error(`[DB] Token nulo para o Vendedor/Produto ID ${productId}.`);
             return null;
        }
        
        console.log(`[DB] Token de Vendedor encontrado. Prosseguindo para API MP.`);
        return sellerToken; // Retorna o token APP_USR-...

    } catch (error) {
        console.error(`[DB ERRO] Falha ao consultar o banco de dados:`, error);
        return null;
    }
}

// --- FUNÇÃO DE SALVAMENTO (USADA EM /mp-callback - OAuth) ---

/**
 * Salva ou atualiza os tokens de acesso e refresh do vendedor.
 */
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


// --- FUNÇÕES DE SINCRONIZAÇÃO ---

/**
 * Salva ou atualiza o mapeamento Produto ID -> Seller ID.
 */
async function syncProductMapping(productId, sellerId) {
    const query = `
        INSERT INTO produtos (produto_id, seller_id)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE seller_id = VALUES(seller_id);
    `;
    return pool.execute(query, [productId, sellerId]);
}

/**
 * Garante que o vendedor existe na tabela 'vendedores' para o OAuth.
 */
async function createSellerIfNotExists(sellerId) {
    const query = `
        INSERT IGNORE INTO vendedores (seller_id)
        VALUES (?)
    `;
    return pool.execute(query, [sellerId]);
}


module.exports = { 
    getSellerTokenByProductId, 
    saveSellerToken,
    syncProductMapping,     
    createSellerIfNotExists
};
