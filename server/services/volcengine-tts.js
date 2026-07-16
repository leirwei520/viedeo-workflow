/**
 * volcengine-tts.js
 *
 * Volcengine (火山引擎) Doubao Seed-TTS voice synthesis service.
 * - TTS synthesis: V3 WebSocket bidirectional streaming API (openspeech.bytedance.com)
 * - Voice listing: ListSpeakers Open API (open.volcengineapi.com) with HMAC-SHA256 signing
 *
 * Docs:
 *   TTS:    https://www.volcengine.com/docs/6561/1598757
 *   Voices: https://www.volcengine.com/docs/6561/2160690
 */

import crypto from 'crypto';
import WebSocket from 'ws';
import zlib from 'zlib';

// ============================================================================
// TTS Synthesis — V3 WebSocket Bidirectional Streaming
// ============================================================================

const WS_TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

const EVT = {
    START_CONNECTION:    1,
    FINISH_CONNECTION:   2,
    CONNECTION_STARTED:  50,
    CONNECTION_FAILED:   51,
    CONNECTION_FINISHED: 52,
    START_SESSION:       100,
    CANCEL_SESSION:      101,
    FINISH_SESSION:      102,
    SESSION_STARTED:     150,
    SESSION_CANCELED:    151,
    SESSION_FINISHED:    152,
    SESSION_FAILED:      153,
    TASK_REQUEST:        200,
    TTS_SENTENCE_START:  350,
    TTS_SENTENCE_END:    351,
    TTS_RESPONSE:        352,
    TTS_SUBTITLE:        360,
};

const MSG_TYPE = {
    FULL_CLIENT_REQ:     0x1,
    FULL_SERVER_RESP:    0x9,
    AUDIO_ONLY_RESP:     0xB,
    ERROR:               0xF,
};

/**
 * Build a client-side binary frame for the V3 bidirectional protocol.
 *
 * Frame layout:
 *   [0]    0x11            — protocol v1, 4-byte header
 *   [1]    0x14            — Full-client request + has-event flag
 *   [2]    0x10            — JSON serialization, no compression
 *   [3]    0x00            — reserved
 *   [4-7]  int32(event)    — event code
 *   [8-11] uint32(idLen)   — (session events only) session_id length
 *   [...]  session_id      — (session events only)
 *   [+0~3] uint32(pLen)    — payload length
 *   [...]  payload JSON
 */
function buildFrame(event, sessionId, payloadStr) {
    const payload = Buffer.from(payloadStr, 'utf-8');
    const sid = sessionId ? Buffer.from(sessionId, 'utf-8') : null;

    let size = 4 + 4;
    if (sid) size += 4 + sid.length;
    size += 4 + payload.length;

    const buf = Buffer.alloc(size);
    let off = 0;

    buf[off++] = 0x11;
    buf[off++] = 0x14;
    buf[off++] = 0x10;
    buf[off++] = 0x00;

    buf.writeInt32BE(event, off); off += 4;

    if (sid) {
        buf.writeUInt32BE(sid.length, off); off += 4;
        sid.copy(buf, off); off += sid.length;
    }

    buf.writeUInt32BE(payload.length, off); off += 4;
    payload.copy(buf, off);

    return buf;
}

function decompressPayload(buf, method) {
    if (method === 1) return zlib.gunzipSync(buf);
    return buf;
}

/**
 * Parse a server binary frame.
 */
function parseFrame(raw) {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length < 4) return { type: 'unknown' };

    const msgType  = (buf[1] >> 4) & 0x0F;
    const flags    = buf[1] & 0x0F;
    const serial   = (buf[2] >> 4) & 0x0F;
    const compress = buf[2] & 0x0F;
    const hasEvent = (flags & 0x04) !== 0;
    let off = 4;

    if (msgType === MSG_TYPE.ERROR) {
        const errorCode = off + 4 <= buf.length ? buf.readInt32BE(off) : 0;
        off += 4;
        if (off + 4 > buf.length) return { type: 'error', errorCode, payload: null };
        const pLen = buf.readUInt32BE(off); off += 4;
        const pBuf = decompressPayload(buf.slice(off, off + pLen), compress);
        let payload;
        try { payload = JSON.parse(pBuf.toString()); } catch { payload = pBuf.toString(); }
        return { type: 'error', errorCode, payload };
    }

    let event = 0;
    if (hasEvent) {
        event = buf.readInt32BE(off); off += 4;
    }

    let id = '';
    if (event >= 50 && off + 4 <= buf.length) {
        const idLen = buf.readUInt32BE(off); off += 4;
        if (idLen > 0 && off + idLen <= buf.length) {
            id = buf.slice(off, off + idLen).toString('utf-8');
            off += idLen;
        }
    }

    if (off + 4 > buf.length) return { type: 'event', event, id, msgType, payload: null };

    const pLen = buf.readUInt32BE(off); off += 4;
    let payloadBuf = buf.slice(off, off + pLen);
    payloadBuf = decompressPayload(payloadBuf, compress);

    let payload;
    if (msgType === MSG_TYPE.AUDIO_ONLY_RESP) {
        payload = payloadBuf;
    } else if (serial === 1) {
        try { payload = JSON.parse(payloadBuf.toString()); } catch { payload = payloadBuf.toString(); }
    } else {
        payload = payloadBuf;
    }

    return { type: 'event', event, id, msgType, payload };
}

/**
 * Synthesize text to audio using Volcengine Seed-TTS V3 WebSocket bidirectional streaming.
 */
export async function synthesize({
    apiKey,
    text,
    speaker,
    model = 'seed-tts-2.0',
    format = 'mp3',
    sampleRate = 24000,
    bitRate,
    speechRate,
    loudnessRate,
    emotion,
    emotionScale,
    pitch,
    contextTexts,
    enableSubtitle,
    silenceDuration,
    uid = '0',
}) {
    if (!apiKey) throw new Error('VOLC_TTS_API_KEY is not configured');
    if (!text)   throw new Error('Text is required');
    if (!speaker) throw new Error('Speaker is required');

    const connectId = crypto.randomUUID();
    const sessionId = crypto.randomUUID().replace(/-/g, '');

    const effectiveBitRate = bitRate || (format === 'mp3' || format === 'ogg_opus' ? 128000 : undefined);

    console.log(`[VolcTTS] Synthesizing (WS bidirectional): model=${model}, speaker=${speaker}, text="${text.slice(0, 60)}…", connectId=${connectId}`);

    return new Promise((resolve, reject) => {
        let settled = false;
        const audioChunks = [];
        const subtitles = [];
        let usage = null;

        function finish(err, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
            if (err) reject(err);
            else resolve(result);
        }

        const timeoutMs = Math.max(30_000, Math.min(300_000, text.length * 200));
        const timer = setTimeout(() => finish(new Error(`TTS WebSocket timeout (${(timeoutMs / 1000).toFixed(0)}s)`)), timeoutMs);

        const ws = new WebSocket(WS_TTS_URL, {
            headers: {
                'X-Api-Key':        apiKey,
                'X-Api-Resource-Id': model,
                'X-Api-Connect-Id':  connectId,
                'X-Control-Require-Usage-Tokens-Return': 'text_words',
            },
        });

        ws.binaryType = 'arraybuffer';

        ws.on('open', () => {
            ws.send(buildFrame(EVT.START_CONNECTION, null, '{}'));
        });

        ws.on('unexpected-response', (_req, res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => finish(new Error(`WebSocket handshake failed (${res.statusCode}): ${body}`)));
        });

        ws.on('message', (data, isBinary) => {
            if (!isBinary) {
                finish(new Error(`TTS text-frame error: ${data.toString()}`));
                return;
            }

            let frame;
            try { frame = parseFrame(data); } catch (e) {
                finish(new Error(`Failed to parse TTS frame: ${e.message}`));
                return;
            }

            if (frame.type === 'error') {
                const msg = frame.payload?.message || JSON.stringify(frame.payload);
                finish(new Error(`TTS error (${frame.errorCode}): ${msg}`));
                return;
            }

            switch (frame.event) {
                case EVT.CONNECTION_STARTED: {
                    const audioParams = { format, sample_rate: sampleRate };
                    if (effectiveBitRate) audioParams.bit_rate = effectiveBitRate;
                    if (speechRate != null)   audioParams.speech_rate   = speechRate;
                    if (loudnessRate != null) audioParams.loudness_rate = loudnessRate;
                    if (emotion)              audioParams.emotion       = emotion;
                    if (emotionScale != null) audioParams.emotion_scale = emotionScale;
                    audioParams.enable_subtitle = true;

                    const reqParams = { speaker, audio_params: audioParams };

                    const additions = {};
                    if (contextTexts?.length > 0) additions.context_texts = contextTexts;
                    if (silenceDuration != null) additions.silence_duration = silenceDuration;
                    if (pitch != null && pitch !== 0) additions.post_process = { pitch };
                    additions.disable_markdown_filter = true;
                    additions.enable_language_detector = true;
                    additions.cache_config = { text_type: 1, use_cache: true, use_segment_cache: true };
                    reqParams.additions = JSON.stringify(additions);

                    const sessionPayload = JSON.stringify({
                        user: { uid: String(uid) },
                        event: EVT.START_SESSION,
                        namespace: 'BidirectionalTTS',
                        req_params: reqParams,
                    });

                    ws.send(buildFrame(EVT.START_SESSION, sessionId, sessionPayload));
                    break;
                }

                case EVT.CONNECTION_FAILED: {
                    const msg = frame.payload?.message || 'Connection failed';
                    finish(new Error(`TTS connection failed: ${msg}`));
                    break;
                }

                case EVT.SESSION_STARTED: {
                    const taskPayload = JSON.stringify({
                        event: EVT.TASK_REQUEST,
                        req_params: { text },
                    });
                    ws.send(buildFrame(EVT.TASK_REQUEST, sessionId, taskPayload));
                    ws.send(buildFrame(EVT.FINISH_SESSION, sessionId, '{}'));
                    break;
                }

                case EVT.SESSION_FAILED: {
                    const msg  = frame.payload?.message     || 'Session failed';
                    const code = frame.payload?.status_code || 'unknown';
                    finish(new Error(`TTS session failed (${code}): ${msg}`));
                    break;
                }

                case EVT.TTS_RESPONSE: {
                    if (Buffer.isBuffer(frame.payload) && frame.payload.length > 0) {
                        audioChunks.push(frame.payload);
                    }
                    break;
                }

                case EVT.SESSION_FINISHED: {
                    if (frame.payload?.usage) usage = frame.payload.usage;
                    ws.send(buildFrame(EVT.FINISH_CONNECTION, null, '{}'));
                    break;
                }

                case EVT.CONNECTION_FINISHED: {
                    if (audioChunks.length === 0) {
                        finish(new Error('TTS synthesis returned no audio data'));
                        return;
                    }
                    const audioBuffer = Buffer.concat(audioChunks);
                    console.log(`[VolcTTS] Done: ${(audioBuffer.length / 1024).toFixed(1)} KB, subtitles=${subtitles.length}, usage=${JSON.stringify(usage)}`);
                    finish(null, { audioBuffer, format, usage, subtitles: subtitles.length > 0 ? subtitles : null });
                    break;
                }

                case EVT.TTS_SENTENCE_START:
                case EVT.TTS_SENTENCE_END:
                case EVT.SESSION_CANCELED:
                    break;

                case EVT.TTS_SUBTITLE: {
                    const p = frame.payload;
                    console.log(`[VolcTTS] Subtitle event raw:`, JSON.stringify(p).slice(0, 500));
                    if (p && typeof p === 'object' && Array.isArray(p.words)) {
                        const segment = {
                            text: p.text || '',
                            words: p.words.map(w => ({
                                word: w.word || w.text || '',
                                startTime: typeof w.start_time === 'number' ? w.start_time / 1000 : (w.startTime ?? 0),
                                endTime: typeof w.end_time === 'number' ? w.end_time / 1000 : (w.endTime ?? 0),
                                confidence: w.confidence ?? 1,
                            })),
                        };
                        subtitles.push(segment);
                    }
                    break;
                }

                default: {
                    if (frame.payload && typeof frame.payload === 'object' && Array.isArray(frame.payload.words)) {
                        console.log(`[VolcTTS] Unknown event ${frame.event} with words:`, JSON.stringify(frame.payload).slice(0, 500));
                        const p = frame.payload;
                        const segment = {
                            text: p.text || '',
                            words: p.words.map(w => ({
                                word: w.word || w.text || '',
                                startTime: typeof w.start_time === 'number' ? w.start_time / 1000 : (w.startTime ?? 0),
                                endTime: typeof w.end_time === 'number' ? w.end_time / 1000 : (w.endTime ?? 0),
                                confidence: w.confidence ?? 1,
                            })),
                        };
                        subtitles.push(segment);
                    }
                    break;
                }
            }
        });

        ws.on('error', (err) => {
            finish(new Error(`WebSocket error: ${err.message}`));
        });

        ws.on('close', () => {
            finish(new Error('WebSocket closed before synthesis completed'));
        });
    });
}

// ============================================================================
// Voice Clone — V3 Training & Status Query
// ============================================================================

const VOICE_CLONE_URL = 'https://openspeech.bytedance.com/api/v3/tts/voice_clone';
const GET_VOICE_URL   = 'https://openspeech.bytedance.com/api/v3/tts/get_voice';

/**
 * Train a cloned voice by uploading reference audio.
 *
 * @returns {{ speaker_id, status, available_training_times, speaker_status, ... }}
 */
export async function trainVoice({ apiKey, speakerId, audioBase64, audioFormat, language = 0, enableDenoise, demoText }) {
    if (!apiKey) throw new Error('VOLC_TTS_API_KEY is not configured');
    if (!speakerId) throw new Error('speaker_id is required');
    if (!audioBase64) throw new Error('Audio data is required');

    const requestId = crypto.randomUUID();
    const body = {
        speaker_id: speakerId,
        audio: {
            data: audioBase64,
            ...(audioFormat ? { format: audioFormat } : {}),
        },
        language,
    };

    const extraParams = {};
    if (enableDenoise !== undefined) extraParams.enable_audio_denoise = !!enableDenoise;
    if (demoText) extraParams.demo_text = demoText;
    if (Object.keys(extraParams).length > 0) body.extra_params = extraParams;

    console.log(`[VolcTTS] TrainVoice: speakerId=${speakerId}, format=${audioFormat || 'auto'}, lang=${language}`);

    const response = await fetch(VOICE_CLONE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
            'X-Api-Request-Id': requestId,
        },
        body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
        const code = data.code || response.status;
        const msg = data.message || 'Voice clone training failed';
        throw new Error(`Voice clone error (${code}): ${msg}`);
    }

    console.log(`[VolcTTS] TrainVoice result: status=${data.status}, remaining=${data.available_training_times}`);
    return data;
}

/**
 * Query the training status of a cloned voice.
 *
 * Status values: 0=NotFound, 1=Training, 2=Success, 3=Failed, 4=Active
 */
export async function getVoiceStatus({ apiKey, speakerId }) {
    if (!apiKey) throw new Error('VOLC_TTS_API_KEY is not configured');
    if (!speakerId) throw new Error('speaker_id is required');

    const requestId = crypto.randomUUID();

    const response = await fetch(GET_VOICE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
            'X-Api-Request-Id': requestId,
        },
        body: JSON.stringify({ speaker_id: speakerId }),
    });

    const data = await response.json();
    if (!response.ok) {
        const code = data.code || response.status;
        const msg = data.message || 'Voice status query failed';
        throw new Error(`Voice status error (${code}): ${msg}`);
    }

    return data;
}

// ============================================================================
// ListSpeakers — Volcengine Open API with HMAC-SHA256 V4 signing
// ============================================================================

const OPEN_API_HOST = 'open.volcengineapi.com';
const OPEN_API_SERVICE = 'speech_saas_prod';
const OPEN_API_REGION = 'cn-north-1';
const LIST_SPEAKERS_ACTION = 'ListSpeakers';
const LIST_SPEAKERS_VERSION = '2025-05-20';

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

function getFormattedDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function getDateStamp(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function signRequest({ method, host, path, query, body, accessKey, secretKey, region, service }) {
    const date = new Date();
    const xDate = getFormattedDate(date);
    const dateStamp = getDateStamp(date);

    const payloadHash = sha256(body || '');

    const signedHeaderKeys = ['host', 'x-content-sha256', 'x-date'];
    const canonicalHeaders =
        `host:${host}\n` +
        `x-content-sha256:${payloadHash}\n` +
        `x-date:${xDate}\n`;
    const signedHeaders = signedHeaderKeys.join(';');

    const sortedQuery = query
        ? query.split('&').sort().join('&')
        : '';

    const canonicalRequest = [
        method,
        path,
        sortedQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/request`;
    const stringToSign = [
        'HMAC-SHA256',
        xDate,
        credentialScope,
        sha256(canonicalRequest),
    ].join('\n');

    let signingKey = hmacSha256(secretKey, dateStamp);
    signingKey = hmacSha256(signingKey, region);
    signingKey = hmacSha256(signingKey, service);
    signingKey = hmacSha256(signingKey, 'request');

    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        'X-Date': xDate,
        'X-Content-Sha256': payloadHash,
        'Authorization': authorization,
    };
}

/**
 * Fetch voice list from Volcengine ListSpeakers API.
 */
export async function listSpeakers({ accessKey, secretKey, resourceId, page = 1, limit = 100 }) {
    if (!accessKey || !secretKey) {
        throw new Error('VOLC_ACCESS_KEY / VOLC_SECRET_KEY not configured');
    }

    const body = JSON.stringify({
        ResourceIDs: [resourceId],
        Page: page,
        Limit: limit,
    });

    const queryString = `Action=${LIST_SPEAKERS_ACTION}&Version=${LIST_SPEAKERS_VERSION}`;
    const authHeaders = signRequest({
        method: 'POST',
        host: OPEN_API_HOST,
        path: '/',
        query: queryString,
        body,
        accessKey,
        secretKey,
        region: OPEN_API_REGION,
        service: OPEN_API_SERVICE,
    });

    const url = `https://${OPEN_API_HOST}/?${queryString}`;
    console.log(`[VolcTTS] ListSpeakers: resourceId=${resourceId}, page=${page}, limit=${limit}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Host': OPEN_API_HOST,
            ...authHeaders,
        },
        body,
    });

    const data = await response.json();

    if (data.ResponseMetadata?.Error) {
        const err = data.ResponseMetadata.Error;
        throw new Error(`ListSpeakers failed (${err.Code}): ${err.Message}`);
    }

    const result = data.Result || {};
    const speakers = (result.Speakers || []).map(s => ({
        id: s.VoiceType,
        name: s.Name,
        avatar: s.Avatar || '',
        gender: s.Gender || '',
        age: s.Age || '',
        description: s.Description || '',
        resourceId: s.ResourceID || resourceId,
        languages: (s.Languages || []).map(l => ({ lang: l.Language, text: l.Text, flag: l.Flag })),
        emotions: (s.Emotions || []).map(e => ({ icon: e.Icon, label: e.Label, value: e.Value })),
        categories: (s.Categories || []).flatMap(c => c.Categories || []),
        labels: [...(s.NormalLabels || []), ...(s.SpecialLabels || [])],
        trialUrl: s.TrialURL || '',
        emoji: s.Emoji || '',
    }));

    console.log(`[VolcTTS] ListSpeakers: got ${speakers.length} / ${result.Total || 0} speakers`);
    return { total: result.Total || 0, speakers };
}

const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 100;

/**
 * Fetch every speaker for a ResourceID by paging ListSpeakers until all rows are collected.
 */
export async function listSpeakersAll({ accessKey, secretKey, resourceId }) {
    const all = [];
    let total = 0;
    let page = 1;

    while (page <= LIST_MAX_PAGES) {
        const { total: t, speakers } = await listSpeakers({
            accessKey,
            secretKey,
            resourceId,
            page,
            limit: LIST_PAGE_SIZE,
        });
        total = t || total;
        all.push(...speakers);

        if (speakers.length === 0) break;
        if (all.length >= total) break;
        if (speakers.length < LIST_PAGE_SIZE) break;

        page += 1;
    }

    if (page > LIST_MAX_PAGES && all.length < total) {
        console.warn(`[VolcTTS] ListSpeakers: stopped at max pages (${LIST_MAX_PAGES}), got ${all.length}/${total}`);
    }

    console.log(`[VolcTTS] ListSpeakersAll: ${all.length} speakers (reported total ${total})`);
    return { total, speakers: all };
}
