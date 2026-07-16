import amqp from 'amqplib';

let connection = null;
let channel = null;
let connecting = false;
let reconnectTimer = null;
const reconnectDelay = 5000;
const reconnectCallbacks = [];

export const QUEUES = {
    IMAGE: 'generation.image',
    VIDEO: 'generation.video',
};

const DEAD_LETTER_EXCHANGE = 'generation.dlx';
const DEAD_LETTER_QUEUE = 'generation.failed';

function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectRabbitMQ();
    }, reconnectDelay);
}

export async function connectRabbitMQ() {
    if (connection && channel) return channel;
    if (connecting) {
        await new Promise(r => setTimeout(r, 1000));
        return channel;
    }

    connecting = true;
    const url = process.env.RABBITMQ_URL || 'amqp://localhost';

    try {
        connection = await amqp.connect(url);
        channel = await connection.createChannel();

        await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
        await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
        await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');

        const queueOpts = {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
                'x-message-ttl': 30 * 60 * 1000,
            }
        };

        await channel.assertQueue(QUEUES.IMAGE, queueOpts);
        await channel.assertQueue(QUEUES.VIDEO, queueOpts);

        connection.on('error', (err) => {
            console.error('[RabbitMQ] Connection error:', err.message);
            connection = null;
            channel = null;
        });

        connection.on('close', () => {
            console.warn('[RabbitMQ] Connection closed. Reconnecting...');
            connection = null;
            channel = null;
            scheduleReconnect();
        });

        console.log('[RabbitMQ] Connection established.');
        connecting = false;

        for (const cb of reconnectCallbacks) {
            try { await cb(channel); } catch (e) {
                console.error('[RabbitMQ] Reconnect callback error:', e.message);
            }
        }

        return channel;
    } catch (err) {
        connecting = false;
        connection = null;
        channel = null;
        console.error(`[RabbitMQ] Connect failed: ${err.message}. Retrying in ${reconnectDelay / 1000}s...`);
        scheduleReconnect();
        return null;
    }
}

export function getChannel() {
    return channel;
}

export function onReconnect(callback) {
    reconnectCallbacks.push(callback);
}

export async function closeRabbitMQ() {
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
    } catch { /* ignore */ }
    channel = null;
    connection = null;
}
