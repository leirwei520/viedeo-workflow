import Redis from 'ioredis';

let client = null;
let available = false;

export function getRedis() {
  if (client) return client;

  const host = process.env.REDIS_HOST;
  if (!host) {
    console.warn('[Redis] Not configured (REDIS_HOST missing). Using in-memory fallback.');
    return null;
  }

  client = new Redis({
    host,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DATABASE) || 0,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: true,
  });

  client.on('error', (err) => {
    if (available) {
      console.warn(`[Redis] Connection error: ${err.message}`);
      available = false;
    }
  });

  client.on('connect', () => {
    available = true;
  });

  return client;
}

export async function testRedisConnection() {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.connect();
    await r.ping();
    available = true;
    console.log('[Redis] Connection established.');
    return true;
  } catch (err) {
    available = false;
    console.warn(`[Redis] Connection failed: ${err.message}. Using in-memory fallback.`);
    return false;
  }
}

export function isRedisAvailable() {
  return available && client?.status === 'ready';
}
