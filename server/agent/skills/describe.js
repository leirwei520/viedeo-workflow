/**
 * describe.js
 *
 * Agent skill: Describe an image using LLM vision.
 * Useful for reverse-prompting or understanding canvas content.
 */

import { chatComplete, retryWithBackoff } from './llm.js';

export function createDescribeTool(context) {
    return {
        name: 'describe_image',
        description: 'Analyze and describe an image in detail. Use this when the user shares an image or wants to understand/reverse-engineer a prompt from an existing image on the canvas.',
        parameters: {
            type: 'object',
            properties: {
                imageUrl: { type: 'string', description: 'URL of the image to describe' },
                purpose: {
                    type: 'string',
                    enum: ['general', 'prompt', 'character'],
                    description: 'Purpose of description: "general" for overview, "prompt" for reverse-engineering a generation prompt, "character" for character appearance details. Default: general',
                },
            },
            required: ['imageUrl'],
        },
        func: async ({ imageUrl, purpose }) => {
            const { apiKey, baseUrl } = context;

            const purposePrompts = {
                general: 'Describe this image in detail. Include subjects, composition, lighting, colors, mood, and any notable elements.',
                prompt: 'Analyze this image and write a detailed prompt that could recreate it with an AI image generator. Include style, subject, composition, lighting, colors, and quality descriptors.',
                character: 'Describe the character/person in this image in detail. Include age, gender, ethnicity, hair style/color, clothing, pose, expression, and any distinctive features. Be very specific for character consistency purposes.',
            };

            const systemPrompt = purposePrompts[purpose] || purposePrompts.general;

            const result = await retryWithBackoff(() => chatComplete({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: systemPrompt },
                        { type: 'image_url', image_url: { url: imageUrl } },
                    ],
                }],
                apiKey, baseUrl, model: process.env.CHAT_MODEL || 'gemini-3.1-pro-preview',
            }));

            return result.text || 'Failed to describe the image.';
        },
    };
}
