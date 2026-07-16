/**
 * llm.js
 *
 * Shared LLM helper for agent skills.
 * Wraps the OpenAI-compatible chat completions API used across the project.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

export async function chatComplete({ messages, apiKey, baseUrl, model, temperature = 0.7, maxTokens = 8192 }) {
    const url = `${baseUrl}/chat/completions`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature,
            max_completion_tokens: maxTokens,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`LLM API error: ${res.status} - ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const totalTokens = data.usage?.total_tokens || 0;
    return { text, totalTokens, raw: data };
}

export async function retryWithBackoff(fn, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const status = err?.status ?? 0;
            if (status !== 429 || attempt === retries) throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

export function parseJsonResponse(text) {
    let jsonStr = text;
    if (text.includes('```json')) {
        jsonStr = text.split('```json')[1].split('```')[0].trim();
    } else if (text.includes('```')) {
        jsonStr = text.split('```')[1].split('```')[0].trim();
    }
    return JSON.parse(jsonStr);
}
