/**
 * storyboard.js
 *
 * Agent skill: Generate storyboard scripts from a story description.
 * Wraps the core logic from server/routes/storyboard.js.
 */

import { chatComplete, retryWithBackoff, parseJsonResponse } from './llm.js';

function STORYBOARD_TEXT_MODEL() {
    return process.env.STORYBOARD_MODEL || 'gemini-2.5-flash';
}

export function createStoryboardTool(context) {
    return {
        name: 'storyboard_generate',
        description: 'Generate cinematic storyboard scripts from a story description. Returns structured scene descriptions with camera angles, lighting, and mood. Use this when the user wants to create a storyboard, decompose a story into scenes, or plan a video from a concept.',
        parameters: {
            type: 'object',
            properties: {
                story: { type: 'string', description: 'The story synopsis or concept to decompose into storyboard scenes' },
                sceneCount: { type: 'number', description: 'Number of scenes to generate (1-10, default 5)' },
                characterDescriptions: { type: 'string', description: 'Optional character descriptions for consistency' },
                language: { type: 'string', enum: ['zh', 'en'], description: 'Output language (zh for Chinese, en for English). Default: match user language.' },
            },
            required: ['story'],
        },
        func: async ({ story, sceneCount = 5, characterDescriptions, language = 'zh' }) => {
            const { apiKey, baseUrl } = context;
            const isZh = language === 'zh';

            const count = Math.max(1, Math.min(10, parseInt(sceneCount, 10) || 5));

            const langInstruction = isZh
                ? `\n\nLANGUAGE: ALL output text MUST be written in Chinese (中文). Only JSON keys remain in English.`
                : '';

            const systemPrompt = `You are a professional film storyboard artist and cinematographer.

Create a cinematic storyboard that tells a REAL story like a movie scene, with professional camera work.

REQUIREMENTS:
1. **Character Consistency**: Create a detailed specific look and keep it consistent.
2. **Cinematic Camera Progression**: Vary camera angles like a real film.
3. **Story Arc**: Beginning → Rising action → Climax → Resolution
4. **Lighting Consistency**: Maintain logical lighting throughout
${langInstruction}

${characterDescriptions ? `\nCHARACTERS:\n${characterDescriptions}` : ''}

STORY SYNOPSIS:
${story}

Generate exactly ${count} scenes. Return a JSON object with:
- "styleAnchor": A consistent style description
- "characterDNA": Object with detailed description for each character
- "scenes": Array of scene objects

Each scene must have:
- "sceneNumber": Scene number
- "description": Detailed visual description (2-3 sentences)
- "cameraAngle": Professional camera terminology${isZh ? ' (用中文)' : ''}
- "cameraMovement": ${isZh ? '用中文' : 'Static, Pan, Tilt, Dolly, Tracking, Crane, Handheld'}
- "lighting": Description of lighting
- "mood": Emotional tone${isZh ? ' (用中文)' : ''}

Respond ONLY with valid JSON, no other text.`;

            const result = await retryWithBackoff(() => chatComplete({
                messages: [{ role: 'user', content: systemPrompt }],
                apiKey, baseUrl, model: STORYBOARD_TEXT_MODEL(),
            }));

            const parsed = parseJsonResponse(result.text);
            const { styleAnchor, characterDNA, scenes } = parsed;
            const scripts = scenes || parsed.scripts || parsed;

            if (!Array.isArray(scripts) || scripts.length === 0) {
                return JSON.stringify({ error: 'Failed to generate valid storyboard scripts. Please try again.' });
            }

            const storyboardData = {
                scripts,
                styleAnchor: styleAnchor || 'photorealistic, cinematic lighting, high detail',
                characterDNA: characterDNA || {},
                sceneCount: scripts.length,
            };

            const sceneSummary = scripts.map((s, i) =>
                `Scene ${i + 1}: ${s.description || ''}\n  Camera: ${s.cameraAngle || ''} / ${s.cameraMovement || ''}\n  Lighting: ${s.lighting || ''}\n  Mood: ${s.mood || ''}`
            ).join('\n');

            const charSummary = Object.entries(storyboardData.characterDNA || {}).map(([name, desc]) =>
                `  ${name}: ${desc}`
            ).join('\n');

            return `Successfully generated ${scripts.length} storyboard scenes. Nodes created on canvas.\n\nStyle Anchor: ${storyboardData.styleAnchor}\nCharacters:\n${charSummary || '  auto-generated'}\n\nScenes:\n${sceneSummary}\n\n[NEXT STEP: When user confirms, call image_generate_batch. Build each prompt as: "{styleAnchor}, {full scene description with character details from characterDNA}, {cameraAngle}, {lighting}, {mood}"]`;
        },
    };
}
