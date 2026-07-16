/**
 * storyboard.js
 * 
 * Routes for AI storyboard script generation.
 * Uses Gemini 2.0 Flash for generating scene descriptions from user story input.
 */

import express from 'express';
import { generateGeminiContent, generateGeminiImage } from '../services/gemini.js';
import { generateChuhaibangImage } from '../services/chuhaibang.js';
import { authMiddleware } from '../middleware/auth.js';
import { logUsage, checkBalance, preDeduct } from './generation.js';
import { getModelPrice, calculateCost } from './pricing.js';
import { refundBalance } from '../services/balance.js';
import { saveImage } from '../services/storage.js';

const router = express.Router();

function STORYBOARD_TEXT_MODEL() { return process.env.STORYBOARD_MODEL || 'gemini-2.5-flash'; }

function extractTokens(result) {
    if (result?.usage) return (result.usage.total_tokens || 0);
    const u = result?.usageMetadata;
    return (u?.totalTokenCount || u?.promptTokenCount || 0) + (u?.candidatesTokenCount || 0);
}

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMentionMarkdown(text) {
    return String(text || '')
        .replace(/\*{2,}\s*(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*]+(?:\s+\S+)*?)\s*\*{2,}/g, '$1')
        .replace(/_{2,}\s*(@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*_]+(?:\s+\S+)*?)\s*_{2,}/g, '$1')
        .replace(/`\s*(@[^`]+?)\s*`/g, '$1');
}

function extractMentionTokens(text) {
    const normalized = normalizeMentionMarkdown(text);
    const raw = normalized.match(/@[^\s@，。！？,.!?:：；;、（）()「」『』[\]{}<>《》"'“”‘’*]+/g) || [];
    return Array.from(new Set(raw.map(t => t.trim()).filter(Boolean)));
}

function enforceMentionsInScripts(scripts, mentionTokens = []) {
    if (!Array.isArray(scripts) || scripts.length === 0) return scripts;
    if (!Array.isArray(mentionTokens) || mentionTokens.length === 0) return scripts;

    const uniqueMentions = Array.from(new Set(
        mentionTokens
            .map(m => String(m || '').trim())
            .filter(Boolean)
    ));
    if (uniqueMentions.length === 0) return scripts;

    const names = uniqueMentions.map(m => m.startsWith('@') ? m.slice(1) : m).filter(Boolean);
    const mentionSet = new Set(uniqueMentions.map(m => m.startsWith('@') ? m : `@${m}`));
    const fallbackMention = Array.from(mentionSet)[0];

    return scripts.map((scene) => {
        const originalDesc = String(scene?.description || '');
        let nextDesc = originalDesc;

        // Convert plain name usage to @name usage.
        for (const name of names) {
            const nameRegex = new RegExp(`(^|[^@\\w])(${escapeRegex(name)})(?=\\b)`, 'g');
            nextDesc = nextDesc.replace(nameRegex, (full, prefix, matchedName) => `${prefix}@${matchedName}`);
        }

        // If scene still has no mention token, prepend one so downstream link/render keeps association.
        const hasMention = /@\S+/.test(nextDesc);
        if (!hasMention && fallbackMention) {
            nextDesc = `${fallbackMention} ${nextDesc}`.trim();
        }

        return { ...scene, description: nextDesc };
    });
}

/**
 * Call LLM via OpenAI-compatible chat completions API (Tencent proxy)
 */
async function chatComplete({ parts, apiKey, baseUrl, model, generationConfig }) {
    const content = [];
    for (const p of parts) {
        if (typeof p === 'string') {
            content.push({ type: 'text', text: p });
        } else if (p.text) {
            content.push({ type: 'text', text: p.text });
        } else if (p.imageUrl) {
            content.push({
                type: 'image_url',
                image_url: { url: p.imageUrl },
            });
        } else if (p.inlineData) {
            content.push({
                type: 'image_url',
                image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
            });
        }
    }

    const body = {
        model: model || STORYBOARD_TEXT_MODEL(),
        messages: [{ role: 'user', content }],
        temperature: 0.7,
    };

    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Chat API error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return {
        ...data,
        response: { text: () => text },
        candidates: [{ content: { parts: [{ text }] } }],
    };
}

/**
 * Helper to retry async operations with exponential backoff
 */
async function retryOperation(operation, maxRetries = 3, initialDelayMs = 2000) {
    let delay = initialDelayMs;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;
            console.warn(`[Storyboard] API Call Failed (Attempt ${i + 1}/${maxRetries}):`, error.message);

            if (isLastAttempt) throw error;

            console.log(`[Storyboard] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
}

// ============================================================================
// SCRIPT GENERATION
// ============================================================================

/**
 * Generate storyboard scripts using Gemini LLM
 * 
 * POST /api/storyboard/generate-scripts
 * Body: { story, characterDescriptions, sceneCount }
 * Returns: { scripts: [{ sceneNumber, description, cameraAngle, mood }] }
 */
router.post('/generate-scripts', authMiddleware, async (req, res) => {
    try {
        const { story, characterDescriptions, sceneCount, referenceImages, characterImages, language } = req.body;
        const { CHAT_API_KEY, CHAT_BASE_URL } = req.app.locals;
        const isZh = language && language.startsWith('zh');

        await checkBalance(req.userId, STORYBOARD_TEXT_MODEL());

        if (!CHAT_API_KEY) {
            return res.status(500).json({ error: "CHAT_API_KEY not configured" });
        }

        if (!story || !sceneCount) {
            return res.status(400).json({
                error: "Missing required fields: story and sceneCount"
            });
        }

        // Validate sceneCount
        const count = parseInt(sceneCount, 10);
        if (isNaN(count) || count < 1 || count > 10) {
            return res.status(400).json({
                error: "sceneCount must be between 1 and 10"
            });
        }

        console.log(`[Storyboard] Generating ${count} scene scripts`);

        // Categorize reference images
        const refs = referenceImages || [];
        const characterRefs = refs.filter(r => r.category === 'Character');
        const sceneRefs = refs.filter(r => r.category === 'Scene');
        const itemRefs = refs.filter(r => r.category === 'Item');
        const styleRefs = refs.filter(r => r.category === 'Style');
        const otherRefs = refs.filter(r => !['Character', 'Scene', 'Item', 'Style'].includes(r.category));

        // Build reference context based on categories
        let referenceContext = '';

        if (characterRefs.length > 0) {
            referenceContext += `\n\nCHARACTER REFERENCES (create detailed "Character DNA" for each - MUST be consistent across all scenes):\n`;
            referenceContext += characterRefs.map((c, i) => `${i + 1}. ${c.name}: Use the provided reference image as the ABSOLUTE TRUTH for this character's appearance.`).join('\n');
        }

        if (sceneRefs.length > 0) {
            referenceContext += `\n\nSCENE/ENVIRONMENT REFERENCES (use these as visual inspiration for environments):\n`;
            referenceContext += sceneRefs.map((s, i) => `${i + 1}. ${s.name}: Incorporate this environment/setting style into relevant scenes.`).join('\n');
        }

        if (itemRefs.length > 0) {
            referenceContext += `\n\nPROP/ITEM REFERENCES (include these objects in scenes where appropriate):\n`;
            referenceContext += itemRefs.map((item, i) => `${i + 1}. ${item.name}: Feature this item/prop in the storyboard where it fits the narrative.`).join('\n');
        }

        if (styleRefs.length > 0) {
            referenceContext += `\n\nVISUAL STYLE REFERENCES (match this art style across ALL panels):\n`;
            referenceContext += styleRefs.map((s, i) => `${i + 1}. ${s.name}: Use this as the visual style guide for the entire storyboard.`).join('\n');
        }

        if (otherRefs.length > 0) {
            referenceContext += `\n\nADDITIONAL REFERENCES:\n`;
            referenceContext += otherRefs.map((r, i) => `${i + 1}. ${r.name}: Incorporate elements from this reference where appropriate.`).join('\n');
        }

        // Also support legacy characterDescriptions format
        const characterContext = characterDescriptions && characterDescriptions.length > 0 && !referenceContext
            ? `\n\nCHARACTERS (create a detailed "Character DNA" for each - this MUST be repeated verbatim in every scene):\n${characterDescriptions.map((c, i) => `${i + 1}. ${c.name}: ${c.description || 'Create a detailed physical description including age, ethnicity, hair style/color, distinctive features, and exact clothing'}`).join('\n')}`
            : '';

        const langInstruction = isZh
            ? `\n\nLANGUAGE: ALL output text (description, cameraAngle, cameraMovement, lighting, mood, styleAnchor, characterDNA values) MUST be written in Chinese (中文). Only JSON keys remain in English.`
            : '';
        const storyForPrompt = normalizeMentionMarkdown(story);
        const referenceMentionList = (referenceImages || [])
            .map(r => r?.name)
            .filter(name => typeof name === 'string' && name.trim().length > 0);
        const mentionRule = referenceMentionList.length > 0
            ? `\n\nMENTION TOKENS:\n- Available mention tokens from selected references: ${referenceMentionList.map(n => `@${n}`).join(', ')}\n- If a selected reference is mentioned in STORY SYNOPSIS or scene text, KEEP the exact @Name token without renaming, translating, or removing '@'.`
            : '';

        const systemPrompt = `You are a professional film storyboard artist and cinematographer.

Create a cinematic storyboard that tells a REAL story like a movie scene, with professional camera work.

REQUIREMENTS:
1. **Character Consistency**: 
   - If reference images are provided, use them as the ABSOLUTE GROUND TRUTH for gender, age, clothing, and physical appearance.
   - If no image is provided, create a detailed specific look and keep it consistent.

2. **Cinematic Camera Progression**: Vary camera angles like a real film:
   - Scene 1: Establishing shot (Wide/Extreme wide) - set the scene
   - Middle scenes: Mix of Medium shots, Close-ups, Over-the-shoulder
   - Final scene: Impactful shot (can be wide for epic, or close-up for emotional)

3. **Story Arc**: Beginning → Rising action → Climax → Resolution

4. **Lighting Consistency**: Maintain logical lighting throughout (time of day, indoor/outdoor)
${langInstruction}

${referenceContext || characterContext}${mentionRule}

STORY SYNOPSIS:
${storyForPrompt}

Generate exactly ${count} scenes. Return a JSON object with:
- "styleAnchor": A consistent style description (e.g., "${isZh ? '写实风格，电影级灯光，35mm胶片质感，高细节' : 'photorealistic, cinematic lighting, 35mm film grain, high detail'}")
- "characterDNA": Object with detailed description for each character that stays CONSTANT
- "scenes": Array of scene objects

Each scene must have:
- "sceneNumber": Scene number
- "description": Detailed visual description (2-3 sentences) that:
  * Uses the character's NAME primarily (do NOT repeat their physical description every time if it's already in characterDNA)
  * Describes the action, environment, and emotion
  * Specifies lighting and atmosphere
- "cameraAngle": Professional camera terminology${isZh ? ' (用中文，如"远景"、"特写"、"中景"、"过肩镜头")' : ''}
- "cameraMovement": ${isZh ? '用中文（静止、平移、倾斜、推轨、跟拍、摇臂、手持）' : 'Static, Pan, Tilt, Dolly, Tracking, Crane, Handheld'}
- "lighting": Description of lighting
- "mood": Emotional tone${isZh ? ' (用中文描述情绪基调)' : ''}

IMPORTANT: When referring to the specific characters listed above, YOU MUST use the format @CharacterName (e.g., if the character is "${isZh ? '小明' : 'Shawn'}", write "@${isZh ? '小明' : 'Shawn'}"). This triggers the asset link in the UI.
Also, NEVER remove or rewrite any existing @Name mention already present in STORY SYNOPSIS. Keep the exact token text unchanged.

Example format:
{
  "styleAnchor": "${isZh ? '写实风格，电影级灯光，35mm胶片，浅景深' : 'photorealistic, cinematic, 35mm film, shallow depth of field'}",
  "characterDNA": {
    "${isZh ? '小明' : 'Shawn'}": "${isZh ? '亚洲男性，25岁左右，粉色染烫卷发，圆框金属眼镜，穿浅蓝色牛仔夹克搭白色T恤，深色牛仔裤' : 'Asian male, mid-20s, pink dyed wavy hair, round wire-frame glasses, clean-shaven, wearing light blue denim jacket over white t-shirt, dark jeans'}"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "${isZh ? '@小明站在一座废弃仓库的门口，午后的阳光透过破碎的窗户洒下，光束中尘粒飞舞...' : '@Shawn stands in the doorway of an abandoned warehouse...'}",
      "cameraAngle": "${isZh ? '远景' : 'Wide shot'}",
      "cameraMovement": "${isZh ? '静止' : 'Static'}",
      "lighting": "${isZh ? '午后阳光透过破碎窗户洒下的光束，尘埃飞舞' : 'Dusty beams of afternoon sunlight streaming through broken windows'}",
      "mood": "${isZh ? '神秘、好奇' : 'Mysterious, curious'}"
    }
  ]
}

Respond ONLY with valid JSON, no other text.`;

        // Process images for multimodal prompt
        const promptParts = [systemPrompt];

        // Process reference images for multimodal prompt (new format with categories)
        // Pass URLs directly to the API (same approach as ChatPanel agent)
        if (referenceImages && referenceImages.length > 0) {
            console.log('[Storyboard] Processing reference images for scripts...');
            for (const ref of referenceImages) {
                if (!ref.url) continue;

                let imageLabel;
                switch (ref.category) {
                    case 'Character':
                        imageLabel = `REFERENCE IMAGE FOR CHARACTER: ${ref.name}\n(This image is the visual truth for ${ref.name}. Ignore any conflicting text description. Ensure the script matches this character's gender, clothing, and appearance.)`;
                        break;
                    case 'Scene':
                        imageLabel = `REFERENCE IMAGE FOR SCENE/ENVIRONMENT: ${ref.name}\n(Use this as visual inspiration for environment, setting, and atmosphere in relevant scenes.)`;
                        break;
                    case 'Item':
                        imageLabel = `REFERENCE IMAGE FOR PROP/ITEM: ${ref.name}\n(Feature this item/object in scenes where appropriate to the narrative.)`;
                        break;
                    case 'Style':
                        imageLabel = `VISUAL STYLE REFERENCE: ${ref.name}\n(Use this image as the art style guide for ALL panels. Match the color palette, rendering technique, and visual aesthetic.)`;
                        break;
                    default:
                        imageLabel = `REFERENCE IMAGE: ${ref.name}\n(Incorporate elements from this reference where appropriate.)`;
                }

                promptParts.push(imageLabel);
                promptParts.push({ imageUrl: ref.url });
                console.log(`[Storyboard] Added ref image for scripts: ${ref.name} (${ref.category})`);
            }
        }
        // Fallback: support legacy characterImages format for backwards compatibility
        else if (characterImages && Object.keys(characterImages).length > 0) {
            console.log('[Storyboard] Processing character images for scripts...');
            for (const [name, url] of Object.entries(characterImages)) {
                if (!url) continue;
                promptParts.push(`\nREFERENCE IMAGE FOR CHARACTER: ${name}\n(This image is the visual truth for ${name}. Ignore any conflicting text description. Ensure the script matches this character's gender, clothing, and appearance.)\n`);
                promptParts.push({ imageUrl: url });
                console.log(`[Storyboard] Added ref image for scripts: ${name}`);
            }
        }

        const result = await retryOperation(() => chatComplete({
            parts: promptParts.map(p => typeof p === 'string' ? { text: p } : p),
            apiKey: CHAT_API_KEY, baseUrl: CHAT_BASE_URL,
        }));
        const responseText = result.response.text();

        let parsed;
        try {
            let jsonStr = responseText;
            if (responseText.includes('```json')) {
                jsonStr = responseText.split('```json')[1].split('```')[0].trim();
            } else if (responseText.includes('```')) {
                jsonStr = responseText.split('```')[1].split('```')[0].trim();
            }
            parsed = JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('[Storyboard] Failed to parse response:', responseText?.slice(0, 500));
            return res.status(500).json({ error: "Failed to parse AI response. Please try again." });
        }

        const { styleAnchor, characterDNA, scenes } = parsed;
        const rawScripts = scenes || parsed.scripts || parsed;

        if (!Array.isArray(rawScripts) || rawScripts.length === 0) {
            return res.status(500).json({ error: "AI returned invalid script format. Please try again." });
        }

        const mentionTokensFromStory = extractMentionTokens(story || '');
        const mentionTokensFromRefs = (referenceImages || [])
            .map(r => r?.name)
            .filter(name => typeof name === 'string' && name.trim().length > 0)
            .map(name => `@${name}`);
        const scripts = enforceMentionsInScripts(rawScripts, [...mentionTokensFromStory, ...mentionTokensFromRefs]);

        console.log(`[Storyboard] Generated ${scripts.length} scripts successfully`);

        const tokens = extractTokens(result);
        const price = await getModelPrice(STORYBOARD_TEXT_MODEL());
        const cost = calculateCost(price, { tokens });
        logUsage({ userId: req.userId, type: 'text', model: STORYBOARD_TEXT_MODEL(), prompt: 'generate-scripts', cost, tokens, status: 'success' });

        return res.json({
            scripts,
            styleAnchor: styleAnchor || 'photorealistic, cinematic lighting, high detail',
            characterDNA: characterDNA || {}
        });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("[Storyboard] Script Generation Error:", error);
        res.status(500).json({ error: error.message || "Script generation failed" });
    }
});

// ============================================================================
// STORY BRAINSTORMING
// ============================================================================

/**
 * Brainstorm a story using Gemini LLM based on selected characters
 * 
 * POST /api/storyboard/brainstorm-story
 * Body: { characterDescriptions, genre? }
 * Returns: { story: string }
 */
router.post('/brainstorm-story', authMiddleware, async (req, res) => {
    try {
        const { characterDescriptions, genre, referenceImages, characterImages, language } = req.body;
        const { CHAT_API_KEY, CHAT_BASE_URL } = req.app.locals;
        const isZh = language && language.startsWith('zh');

        await checkBalance(req.userId, STORYBOARD_TEXT_MODEL());

        if (!CHAT_API_KEY) {
            return res.status(500).json({ error: "CHAT_API_KEY not configured" });
        }

        console.log(`[Storyboard] Brainstorming story with ${characterDescriptions?.length || 0} characters`);

        // Build character context
        const characterContext = characterDescriptions && characterDescriptions.length > 0
            ? `Characters to feature in the story:\n${characterDescriptions.map((c, i) => `${i + 1}. ${c.name}: ${c.description || 'A unique character'}`).join('\n')}`
            : 'Create original characters as needed for the story.';

        const genreHint = genre ? `\nGenre preference: ${genre}` : '';

        const referenceMentionList = (referenceImages || [])
            .map(r => r?.name)
            .filter(name => typeof name === 'string' && name.trim().length > 0);
        const mentionRule = referenceMentionList.length > 0
            ? `\nMention tokens to use when references are involved: ${referenceMentionList.map(n => `@${n}`).join(', ')}`
            : '';

        const systemPrompt = `You are a creative storyteller specializing in visual narratives perfect for storyboards.
        
${characterContext}${genreHint}

Create a compelling, concise story synopsis (3-5 sentences) that would make for an exciting visual storyboard.
The story should:
- Have a clear beginning, middle, and end
- Include vivid visual moments that would look great as images
- Feature the characters in interesting situations
- Be suitable for AI image generation
- INCORPORATE VISUAL DETAILS from the provided reference images where applicable.
${isZh ? '- The story MUST be written entirely in Chinese (中文).' : ''}
${mentionRule}

IMPORTANT: When referring to the specific characters listed above, YOU MUST use the format @CharacterName (e.g., if the character is "Shawn", write "@Shawn"). This triggers the asset link in the UI.
If you mention any selected reference, use and keep the exact @Name token. Do NOT remove '@' and do NOT rename the token.

Respond with ONLY the story synopsis, no additional text or formatting.`;

        // Process reference images for multimodal prompt
        const promptParts = [systemPrompt];

        if (referenceImages && referenceImages.length > 0) {
            console.log('[Storyboard] Processing reference images for brainstorming...');
            for (const ref of referenceImages) {
                if (!ref.url) continue;
                promptParts.push(`REFERENCE IMAGE: ${ref.name} (${ref.category}) - Use visuals from this image for inspiration.`);
                promptParts.push({ imageUrl: ref.url });
                console.log(`[Storyboard] Added ref image for brainstorm: ${ref.name} (${ref.category})`);
            }
        }
        // Fallback for legacy
        else if (characterImages && Object.keys(characterImages).length > 0) {
            for (const [name, url] of Object.entries(characterImages)) {
                if (!url) continue;
                promptParts.push(`REFERENCE IMAGE: ${name}`);
                promptParts.push({ imageUrl: url });
            }
        }

        const result = await retryOperation(() => chatComplete({
            parts: promptParts.map(p => typeof p === 'string' ? { text: p } : p),
            apiKey: CHAT_API_KEY, baseUrl: CHAT_BASE_URL,
        }));
        const story = normalizeMentionMarkdown(result.response.text().trim());

        console.log(`[Storyboard] Generated story: ${story.substring(0, 100)}...`);

        const tokens = extractTokens(result);
        const price = await getModelPrice(STORYBOARD_TEXT_MODEL());
        const cost = calculateCost(price, { tokens });
        logUsage({ userId: req.userId, type: 'text', model: STORYBOARD_TEXT_MODEL(), prompt: 'brainstorm-story', cost, tokens, status: 'success' });

        return res.json({ story });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("[Storyboard] Story Brainstorm Error:", error);
        res.status(500).json({ error: error.message || "Story brainstorming failed" });
    }
});

// ============================================================================
// STORY OPTIMIZATION
// ============================================================================

/**
 * Optimize an existing story idea for visual storyboard generation
 * 
 * POST /api/storyboard/optimize-story
 * Body: { story: string }
 * Returns: { optimizedStory: string }
 */
router.post('/optimize-story', authMiddleware, async (req, res) => {
    try {
        const { story, characterNames, language, referenceImages, characterImages, mentionTokens, selectedReferences } = req.body;
        const { CHAT_API_KEY, CHAT_BASE_URL } = req.app.locals;
        const isZh = language && language.startsWith('zh');

        await checkBalance(req.userId, STORYBOARD_TEXT_MODEL());

        if (!CHAT_API_KEY) {
            return res.status(500).json({ error: "CHAT_API_KEY not configured" });
        }

        if (!story || typeof story !== 'string') {
            return res.status(400).json({
                error: "Missing required field: story"
            });
        }

        console.log(`[Storyboard] Optimizing story length: ${story.length} chars`);
        console.log(`[Storyboard] Optimize refs: ${Array.isArray(referenceImages) ? referenceImages.length : 0}`);

        const storyForPrompt = normalizeMentionMarkdown(story);
        const existingMentions = extractMentionTokens(storyForPrompt);
        const clientMentions = Array.isArray(mentionTokens)
            ? mentionTokens
                .map(m => String(m || '').trim())
                .filter(Boolean)
                .map(m => (m.startsWith('@') ? m : `@${m}`))
            : [];
        const referenceMentionList = (referenceImages || [])
            .map(r => r?.name)
            .filter(name => typeof name === 'string' && name.trim().length > 0)
            .map(name => `@${name}`);
        const lockedMentions = Array.from(new Set([...existingMentions, ...referenceMentionList, ...clientMentions]));
        const selectedReferenceContext = Array.isArray(selectedReferences) && selectedReferences.length > 0
            ? selectedReferences
                .map((r, idx) => `${idx + 1}. ${r?.name || 'Unknown'} (${r?.category || 'Others'})${r?.description ? `: ${r.description}` : ''}`)
                .join('\n')
            : '';

        const refImageList = (referenceImages && referenceImages.length > 0)
            ? referenceImages.filter(r => r?.url)
            : (characterImages && Object.keys(characterImages).length > 0)
                ? Object.entries(characterImages).filter(([, url]) => url).map(([name, url]) => ({ name, url, category: 'Others' }))
                : [];

        const categoryLabel = (cat) => {
            const map = { Character: 'a character/person', Scene: 'a scene/location', Item: 'a prop/object', Style: 'an art style reference' };
            return map[cat] || 'a visual reference';
        };

        const imageDescBlock = refImageList.length > 0
            ? refImageList.map(r => `• @${r.name} — This is ${categoryLabel(r.category)}. LOOK at the attached image for @${r.name} and describe what you SEE: appearance, clothing, colors, pose, environment, texture, style.`).join('\n')
            : '';

        const systemPrompt = `You are an expert cinematic storyboard writer with keen visual observation skills.

TASK: Rewrite and optimize the story below for AI image generation. You MUST carefully observe every attached reference image and weave their ACTUAL visual details into the story.

ORIGINAL STORY:
"${storyForPrompt}"

REFERENCE IMAGES (attached below):
${imageDescBlock || 'None'}

RULES:
1. **Observe images first**: Before writing, study each attached image carefully. Note specific visual details — colors, textures, shapes, poses, backgrounds, lighting, style.
2. **Weave real details**: Replace generic descriptions with concrete details from the images. If @我的素材 shows a girl in a red dress, write "red dress" not "a person". If @我的素材 1 shows neon-lit Tokyo streets, describe those exact streets.
3. **Cinematic language**: Use vivid, concise, visual language. Describe camera angles, lighting, atmosphere.
4. **Keep it short**: Under 150 words. Every sentence should paint a picture.
5. **Preserve @mentions exactly**: Use these tokens as-is: ${lockedMentions.length > 0 ? lockedMentions.join(', ') : 'None'}. Never remove '@', never rename, never translate mention text.
6. **Match categories**: Characters → describe their look/action. Scenes → describe the environment. Items → describe the object and how it's used.
${isZh ? '7. **Language**: Write entirely in Chinese (中文).' : ''}

${selectedReferenceContext ? `REFERENCE DETAILS:\n${selectedReferenceContext}\n` : ''}Respond with ONLY the optimized story text. No explanations, no markdown formatting.`;

        const promptParts = [systemPrompt];
        if (refImageList.length > 0) {
            console.log('[Storyboard] Processing reference images for story optimization...');
            for (const ref of refImageList) {
                promptParts.push(`[IMAGE for @${ref.name} (${ref.category || 'Others'})]: Observe this image carefully. Describe what you see and use those visual details in the story.`);
                promptParts.push({ imageUrl: ref.url });
                console.log(`[Storyboard] Optimize image attached: ${ref?.name || 'unknown'} (${ref?.category || 'Others'})`);
            }
        }

        const mappedParts = promptParts.map(p => typeof p === 'string' ? { text: p } : p);
        console.log('[Storyboard][Optimize] === FULL PROMPT TO AI ===');
        mappedParts.forEach((p, i) => {
            if (p.text) console.log(`  Part[${i}] TEXT: ${p.text.substring(0, 200)}${p.text.length > 200 ? '...' : ''}`);
            if (p.imageUrl) console.log(`  Part[${i}] IMAGE URL: ${p.imageUrl}`);
        });
        console.log('[Storyboard][Optimize] === END PROMPT ===');

        const result = await retryOperation(() => chatComplete({
            parts: mappedParts,
            apiKey: CHAT_API_KEY, baseUrl: CHAT_BASE_URL,
        }));
        const optimizedStory = normalizeMentionMarkdown(result.response.text().trim());

        console.log(`[Storyboard] Optimized story: ${optimizedStory.substring(0, 50)}...`);

        const tokens = extractTokens(result);
        const price = await getModelPrice(STORYBOARD_TEXT_MODEL());
        const cost = calculateCost(price, { tokens });
        logUsage({ userId: req.userId, type: 'text', model: STORYBOARD_TEXT_MODEL(), prompt: 'optimize-story', cost, tokens, status: 'success' });

        return res.json({ optimizedStory });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("[Storyboard] Story Optimization Error:", error);
        res.status(500).json({ error: error.message || "Story optimization failed" });
    }
});

// ============================================================================
// COMPOSITE STORYBOARD GENERATION
// ============================================================================

/**
 * Generate a composite storyboard image with all scenes in a grid
 * 
 * POST /api/storyboard/generate-composite
 * Body: { scripts, styleAnchor, characterDNA, sceneCount }
 * Returns: { imageUrl: string }
 */
router.post('/generate-composite', authMiddleware, async (req, res) => {
    try {
        const { scripts, styleAnchor, characterDNA, sceneCount, referenceImages, characterImages } = req.body;
        const { CHAT_API_KEY, CHAT_BASE_URL } = req.app.locals;

        if (!CHAT_API_KEY) {
            return res.status(500).json({ error: "CHAT_API_KEY not configured" });
        }

        if (!scripts || scripts.length === 0) {
            return res.status(400).json({
                error: "Missing required field: scripts"
            });
        }

        await checkBalance(req.userId, 'chuhaibang');

        const count = scripts.length;
        console.log(`[Storyboard] Request Recieved: Generating composite image with ${count} panels`);

        // Log deep debug info
        console.log(`[Storyboard] Style Anchor: ${styleAnchor?.substring(0, 50)}...`);
        console.log(`[Storyboard] Character DNA Keys: ${characterDNA ? Object.keys(characterDNA).join(', ') : 'None'}`);
        console.log(`[Storyboard] Reference Images: ${referenceImages ? referenceImages.map(r => `${r.name}(${r.category})`).join(', ') : 'None'}`);

        // Determine grid layout based on scene count
        let layout;
        if (count <= 3) layout = `1x${count}`;
        else if (count === 4) layout = '2x2';
        else if (count <= 6) layout = '2x3';
        else if (count <= 9) layout = '3x3';
        else layout = '2x5';

        // Helper to normalize names for matching (remove spaces, lowercase)
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Prepare multimodal prompt parts
        const promptParts = [];
        let hasReferenceImages = false;
        let hasStyleReference = false;
        const scriptNamesWithImages = new Set();

        // Process reference images with categories (new format)
        // Pass URLs directly to the API (same approach as ChatPanel agent)
        if (referenceImages && referenceImages.length > 0) {
            console.log('[Storyboard] Processing categorized reference images...');
            for (const ref of referenceImages) {
                if (!ref.url) continue;

                let imageLabel;
                switch (ref.category) {
                    case 'Character':
                        let linkedScriptName = ref.name;
                        if (characterDNA) {
                            const normName = normalize(ref.name);
                            const match = Object.keys(characterDNA).find(k => normalize(k) === normName);
                            if (match) linkedScriptName = match;
                            else {
                                const partialMatch = Object.keys(characterDNA).find(k => normalize(k).includes(normName) || normName.includes(normalize(k)));
                                if (partialMatch) linkedScriptName = partialMatch;
                            }
                        }
                        scriptNamesWithImages.add(linkedScriptName);
                        imageLabel = `REFERENCE IMAGE for character "${ref.name}". In the scripts, this character is referred to as "@${ref.name}" or "${ref.name}". (This image is the ABSOLUTE TRUTH for their appearance).`;
                        break;
                    case 'Scene':
                        imageLabel = `SCENE/ENVIRONMENT REFERENCE "${ref.name}" (@${ref.name}) - use this for environment, setting, and atmosphere inspiration:`;
                        break;
                    case 'Item':
                        imageLabel = `PROP/ITEM REFERENCE "${ref.name}" (@${ref.name}) - feature this item in scenes where narrative-appropriate:`;
                        break;
                    case 'Style':
                        imageLabel = `VISUAL STYLE REFERENCE "${ref.name}" - match this art style, color palette, and rendering technique across ALL panels:`;
                        hasStyleReference = true;
                        break;
                    default:
                        imageLabel = `REFERENCE IMAGE "${ref.name}" (@${ref.name}):`;
                }

                promptParts.push({ text: imageLabel });
                promptParts.push({ imageUrl: ref.url });
                hasReferenceImages = true;
                console.log(`[Storyboard] Added reference image for ${ref.name} (${ref.category})`);
            }
        }
        // Fallback: support legacy characterImages format for backwards compatibility
        else if (characterImages && Object.keys(characterImages).length > 0) {
            console.log('[Storyboard] Processing character reference images (legacy format)...');
            for (const [name, url] of Object.entries(characterImages)) {
                if (!url) continue;

                let linkedScriptName = name;
                if (characterDNA) {
                    const normName = normalize(name);
                    const match = Object.keys(characterDNA).find(k => normalize(k) === normName);
                    if (match) linkedScriptName = match;
                    else {
                        const partialMatch = Object.keys(characterDNA).find(k => normalize(k).includes(normName) || normName.includes(normalize(k)));
                        if (partialMatch) linkedScriptName = partialMatch;
                    }
                }
                scriptNamesWithImages.add(linkedScriptName);

                promptParts.push({ text: `REFERENCE IMAGE for character "${name}" (referred to as "${linkedScriptName}" in script):` });
                promptParts.push({ imageUrl: url });
                hasReferenceImages = true;
                console.log(`[Storyboard] Added reference image for ${name} (linked to ${linkedScriptName})`);
            }
        }

        // Build character DNA context
        // FILTERED: Remove DNA descriptions for characters that have reference images
        const characterDNAContext = characterDNA && Object.keys(characterDNA).length > 0
            ? `\n\nCHARACTER APPEARANCES (must be consistent across ALL panels):\n${Object.entries(characterDNA)
                .filter(([name]) => !scriptNamesWithImages.has(name)) // OMIT if image exists
                .map(([name, desc]) => `- ${name}: ${desc}`)
                .join('\n')
            }`
            : '';

        // Build the composite generation prompt
        // STRIPPED: Remove parenthetical descriptions from scripts for characters with images
        const panelDescriptions = scripts.map((script, i) => {
            let cleanDesc = script.description;

            // For characters with images, strip their text description aggressively
            for (const name of scriptNamesWithImages) {
                // Escape name for regex
                const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Regex matches: Name (optional 's) followed by optional whitespace and ANY parenthetical group
                // We look for name, maybe 's, maybe space, then an opening paren
                const regex = new RegExp(`${escapedName}(?:'s)?\\s*\\([^)]+\\)`, 'gi');

                const before = cleanDesc;
                cleanDesc = cleanDesc.replace(regex, (match) => {
                    // Return just the name part (stripping the parenthesis)
                    return match.split('(')[0].trim();
                });

                if (before !== cleanDesc) {
                    console.log(`[Storyboard] STRIPPED description for ${name} in Panel ${i + 1}`);
                    console.log(`   BEFORE: ${before.substring(before.indexOf(name), before.indexOf(name) + 50)}...`);
                    console.log(`   AFTER:  ${cleanDesc.substring(cleanDesc.indexOf(name), cleanDesc.indexOf(name) + 20)}...`);
                } else {
                    console.log(`[Storyboard] NO MATCH for ${name} in Panel ${i + 1} (Regex: ${regex})`);
                }
            }

            return `Panel ${i + 1}: ${cleanDesc}. Camera: ${script.cameraAngle}. Mood: ${script.mood}.`;
        }).join('\n');

        console.log('[Storyboard] Panel Descriptions Being Sent to Gemini:');
        console.log(panelDescriptions.substring(0, 500) + '...');

        // FORCE UNIFORM aspect ratio and layout
        const [rows, cols] = layout.split('x');
        const compositePrompt = `Create a cohesive, professional movie storyboard sheet with ${count} panels.
        
LAYOUT INSTRUCTIONS:
- STRICT ${rows}x${cols} GRID (${rows} rows, ${cols} columns).
- ALL PANELS MUST BE EXACTLY THE SAME SIZE AND ASPECT RATIO.
- NO COLLAGES. NO VARYING ASPECT RATIOS. NO DUPLICATE PANELS.
- Do NOT Create a 2x2 grid if 1x3 is requested.
- The layout must be a perfect, regular grid.
- Draw distinct borders between panels.
- Add HIGH-CONTRAST WHITE SCENE NUMBERS (1, 2, 3...) in the top-left corner of each panel.

${hasReferenceImages ? 'IMPORTANT: USE THE PROVIDED REFERENCE IMAGES as the ABSOLUTE GROUND TRUTH for the characters\' appearance, gender, and clothing. \n- If the character name (e.g. "Fashion Model") implies a specific gender/look but the image shows otherwise, OBEY THE IMAGE.\n- Do NOT default to stereotypes. The image is the only truth.' : ''}
        
STORY CONTEXT: The panels depict a sequence where the environment changes according to the script.
        
ART STYLE: ${styleAnchor || 'photorealistic, cinematic lighting, detailed illustration'}
Maintain this exact art style, color grading, and rendering technique across all panels.

${hasReferenceImages ? 'IMPORTANT: USE THE PROVIDED REFERENCE IMAGES as the ABSOLUTE GROUND TRUTH for the characters\' facial features, hair, and body type. Do NOT change their identity. If the text description conflicts with the reference image regarding physical appearance, FOLLOW THE IMAGE. The provided scripts have stripped text descriptions for these characters to rely solely on your visual understanding of the reference image.' : ''}
        
${characterDNAContext}
        
PANEL INSTRUCTIONS (Note: "@Name" refers to the specific reference image for that character/item):
${panelDescriptions}
        
CRITICAL: 
1. Draw all panels on a SINGLE sheet with thin borders separating them.
2. Keep character faces, body types, and clothing details 100% consistent with the reference images/descriptions.
3. LABELING: ADD A VISIBLE, HIGH-CONTRAST WHITE NUMBER (1, ${count > 1 ? '2, ' : ''}...) in the corner of each panel.`;

        console.log(`[Storyboard] Composite prompt preview: ${compositePrompt.substring(0, 100)}...`);
        console.log(`[Storyboard] Sending request to Gemini... Parts: ${promptParts.length + 1}`);

        promptParts.push({ text: compositePrompt });

        const compositeModel = process.env.STORYBOARD_IMAGE_MODEL || STORYBOARD_TEXT_MODEL();
        const CHB_API_KEY = process.env.CHB_API_KEY;
        const CHB_BASE_URL = process.env.CHB_BASE_URL;

        if (!CHB_API_KEY) {
            return res.status(500).json({ error: "CHB_API_KEY not configured for image generation" });
        }

        const startTime = Date.now();

        // Step 1: Use chat model to generate a detailed image prompt from reference images + scripts
        const content = [];
        for (const p of promptParts) {
            if (p.text) {
                content.push({ type: 'text', text: p.text });
            } else if (p.imageUrl) {
                content.push({
                    type: 'image_url',
                    image_url: { url: p.imageUrl },
                });
            } else if (p.inlineData) {
                content.push({
                    type: 'image_url',
                    image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
                });
            }
        }
        content.push({
            type: 'text',
            text: `Based on all the above reference images, character descriptions, and panel instructions, write ONE highly detailed image generation prompt (in English) that produces a single storyboard sheet. Output ONLY the prompt text, no markdown, no explanation, no JSON, no code blocks. The prompt should capture every visual detail from the reference images so the image generator can recreate them without seeing the originals.`,
        });

        console.log(`[Storyboard] Step 1: Generating image prompt via chat (${compositeModel})...`);
        const promptResult = await retryOperation(async () => {
            const resp = await fetch(`${CHAT_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CHAT_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: compositeModel,
                    messages: [{ role: 'user', content }],
                    temperature: 0.7,
                }),
            });
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`Chat API error (${resp.status}): ${errText}`);
            }
            return resp.json();
        });

        let imagePrompt = promptResult.choices?.[0]?.message?.content || '';

        // If model returned a DALL-E / tool-call JSON, extract the prompt from it
        try {
            const parsed = JSON.parse(imagePrompt);
            if (parsed.action_input) {
                const inner = typeof parsed.action_input === 'string' ? JSON.parse(parsed.action_input) : parsed.action_input;
                imagePrompt = inner.prompt || imagePrompt;
            } else if (parsed.prompt) {
                imagePrompt = parsed.prompt;
            }
        } catch { /* not JSON, use as-is */ }

        imagePrompt = imagePrompt.replace(/```[a-z]*\n?/g, '').trim();
        console.log(`[Storyboard] Generated prompt (${imagePrompt.length} chars): ${imagePrompt.substring(0, 200)}...`);

        // Step 2: Generate image via ChuHaiBang async API
        console.log(`[Storyboard] Step 2: Generating image via ChuHaiBang...`);
        const imageUrl = await generateChuhaibangImage({
            prompt: imagePrompt.substring(0, 4000),
            apiKey: CHB_API_KEY,
            baseUrl: CHB_BASE_URL,
            aspectRatio: '16:9',
        });

        const duration = Date.now() - startTime;
        console.log(`[Storyboard] Composite image generated in ${duration}ms: ${imageUrl}`);

        if (!imageUrl) {
            return res.status(500).json({
                error: "Failed to generate composite image. Please try again."
            });
        }

        const price = await getModelPrice('chuhaibang');
        const cost = calculateCost(price);
        logUsage({ userId: req.userId, type: 'image', model: 'chuhaibang', prompt: 'generate-composite', cost, status: 'success' });

        return res.json({ imageUrl });

    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        console.error("[Storyboard] Composite Generation Error:", error);
        res.status(500).json({ error: error.message || "Composite generation failed" });
    }
});

export default router;
