/**
 * tts.js
 *
 * Agent skill: Generate text-to-speech audio.
 * Returns a canvas action for the frontend to handle TTS generation.
 */

export function createTTSTool(context) {
    return {
        name: 'tts_generate',
        description: 'Generate text-to-speech audio from text. Use this when the user wants to add narration or voiceover to their video project.',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'The text to convert to speech' },
                voice: { type: 'string', description: 'Voice ID to use. If not specified, uses default voice.' },
                language: { type: 'string', enum: ['zh', 'en'], description: 'Language of the text. Default: zh' },
            },
            required: ['text'],
        },
        func: async ({ text, voice, language }) => {
            if (!text || text.trim().length === 0) {
                return 'No text provided for TTS generation.';
            }

            context.addAction({
                type: 'generate_tts',
                data: {
                    text: text.trim(),
                    voice: voice || null,
                    language: language || 'zh',
                },
            });

            return `已打开语音合成弹窗，文案已预填入（${text.length} 字）。用户需要在弹窗中选择音色并点击合成按钮来生成语音，语音尚未生成。请告知用户弹窗已打开，让他们去操作。`;
        },
    };
}
