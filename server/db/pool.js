import mysql from 'mysql2/promise';

let pool = null;
let dbAvailable = false;

export function getPool() {
    if (!pool) {
        const host = process.env.MYSQL_HOST;
        const database = process.env.MYSQL_DATABASE;

        if (!host || !database) {
            console.warn('[DB] MySQL not configured (MYSQL_HOST / MYSQL_DATABASE missing). Cloud sync disabled.');
            return null;
        }

        pool = mysql.createPool({
            host,
            port: parseInt(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || '',
            database,
            charset: process.env.MYSQL_CHARSET || 'utf8mb4',
            timezone: '+08:00',
            waitForConnections: true,
            connectionLimit: parseInt(process.env.MYSQL_POOL_SIZE) || 30,
            queueLimit: 0,
            connectTimeout: 5000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000,
        });
    }
    return pool;
}

export async function testConnection() {
    const p = getPool();
    if (!p) return false;
    try {
        const conn = await p.getConnection();
        await conn.ping();
        conn.release();
        dbAvailable = true;
        console.log('[DB] MySQL connection established.');
        return true;
    } catch (err) {
        dbAvailable = false;
        console.warn(`[DB] MySQL connection failed: ${err.message}. Cloud sync disabled.`);
        return false;
    }
}

export function isDbAvailable() {
    return dbAvailable;
}

export function setDbAvailable(val) {
    dbAvailable = val;
}
