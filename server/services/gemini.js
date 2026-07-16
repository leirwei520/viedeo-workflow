/**
 * gemini.js
 * 
 * Google Gemini/Veo API service for image and video generation.
 * Uses custom API endpoint for Gemini calls.
 */

import { GoogleGenAI } from '@google/genai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://your-gemini-endpoint.example.com/v1beta/models';

// ============================================================================
// CLIENT SETUP (for Veo video generation)
// ============================================================================

let _ai = null;

/**
 * Get or create Gemini AI client (used for Veo video generation)
 */
export function getGeminiClient(apiKey) {
    if (!_ai) {
        if (!apiKey) {
            throw new Error('Gemini API key not configured');
        }
        _ai = new GoogleGenAI({ apiKey });
    }
    return _ai;
}

// ============================================================================
// TEXT GENERATION
// ============================================================================

/**
 * Generate text content using Gemini via custom API endpoint
 * @param {Object} options - Generation options
 * @param {string} options.model - Model name (e.g., 'gemini-2.0-flash')
 * @param {Array} options.parts - Content parts (text, images, etc.)
 * @param {string} options.apiKey - API key
 * @param {Object} [options.generationConfig] - Optional generation config
 * @returns {Promise<Object>} API response
 */
export async function generateGeminiContent({ model, parts, apiKey, generationConfig }) {
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
    
    const payload = {
        contents: [
            {
                role: "user",
                parts: parts
            }
        ]
    };

    if (generationConfig) {
        payload.generationConfig = generationConfig;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    
    // Add helper method to match old SDK interface
    result.response = {
        text: () => {
            if (result.candidates && result.candidates.length > 0) {
                const candidate = result.candidates[0];
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    return candidate.content.parts[0].text || "";
                }
            }
            return "";
        }
    };

    return result;
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

/**
 * Generate image using Gemini via custom API endpoint
 * @returns {Promise<Buffer>} Image buffer
 */
export async function generateGeminiImage({ prompt, imageBase64Array, aspectRatio, resolution, apiKey }) {
    const modelName = 'gemini-3-pro-image-preview';
    const url = `${GEMINI_BASE_URL}/${modelName}:generateContent`;

    const parts = [];

    // Add input images
    if (imageBase64Array && imageBase64Array.length > 0) {
        for (const img of imageBase64Array) {
            const match = img.match(/^data:(image\/\w+);base64,/);
            const mimeType = match ? match[1] : "image/png";
            const base64Clean = img.replace(/^data:image\/\w+;base64,/, "");
            parts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: base64Clean
                }
            });
        }
    }

    parts.push({ text: prompt });

    // Map aspect ratio - Gemini supports: "1:1", "3:4", "4:3", "9:16", "16:9"
    // Default to 16:9 for video-ready format
    const ratioMap = {
        'Auto': '16:9',
        '1:1': '1:1',
        '3:4': '3:4',
        '4:3': '4:3',
        '3:2': '3:2',
        '2:3': '2:3',
        '4:5': '4:5',
        '5:4': '5:4',
        '9:16': '9:16',
        '16:9': '16:9',
        '21:9': '16:9' // Fallback for ultra-wide
    };
    const mappedRatio = ratioMap[aspectRatio] || '1:1';

    // Map resolution - Supports 1K, 2K, 4K (must be uppercase)
    // Default to 1K if not specified or 'Auto'
    const resolutionMap = {
        'Auto': '1K',
        '1K': '1K',
        '2K': '2K',
        '4K': '4K'
    };
    const mappedResolution = resolutionMap[resolution] || '1K';

    console.log('[Gemini Image] Generating with:', {
        model: modelName,
        url: url,
        hasInputImages: imageBase64Array?.length || 0,
        aspectRatio: mappedRatio,
        resolution: mappedResolution,
        promptPreview: prompt?.substring(0, 80) + '...'
    });

    const payload = {
        contents: [
            {
                role: "user",
                parts: parts
            }
        ],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            temperature: 1.0,
            imageConfig: {
                aspectRatio: mappedRatio,
                imageSize: mappedResolution
            }
        }
    };

    let response;
    let attempt = 0;
    const MAX_WAIT = 60000;

    while (true) {
        attempt++;
        try {
            const fetchResponse = await fetch(url, {
                method: 'POST',
                headers: {
                    'x-goog-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (fetchResponse.status === 429) {
                const retryAfter = fetchResponse.headers.get('retry-after');
                const waitTime = retryAfter
                    ? parseInt(retryAfter) * 1000
                    : Math.min(attempt * 5000, MAX_WAIT);
                console.log(`[Gemini Image] Rate limited (429), attempt ${attempt}, waiting ${waitTime/1000}s...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            if (!fetchResponse.ok) {
                const errorText = await fetchResponse.text();
                throw new Error(`Gemini API error (${fetchResponse.status}): ${errorText}`);
            }

            response = await fetchResponse.json();
            break;

        } catch (error) {
            if (error.message && (error.message.includes('429') || error.message.includes('Resource exhausted') || error.message.includes('rate limit'))) {
                const waitTime = Math.min(attempt * 5000, MAX_WAIT);
                console.log(`[Gemini Image] Rate limit error, attempt ${attempt}, waiting ${waitTime/1000}s...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            console.error('[Gemini Image] API Error Details:', {
                message: error.message,
                attempt,
                hasInputImages: imageBase64Array?.length || 0,
                aspectRatio: mappedRatio,
                resolution: mappedResolution
            });
            throw error;
        }
    }

    // Log raw response for debugging
    console.log('[Gemini Image] Response:', JSON.stringify({
        hasCandidates: !!(response.candidates?.length),
        candidatesCount: response.candidates?.length || 0,
        firstCandidate: response.candidates?.[0] ? {
            hasContent: !!response.candidates[0].content,
            partsCount: response.candidates[0].content?.parts?.length || 0,
            partTypes: response.candidates[0].content?.parts?.map(p => 
                p.text ? 'text' : p.inlineData ? 'inlineData' : 'unknown'
            )
        } : null,
        promptFeedback: response.promptFeedback,
        error: response.error
    }, null, 2));

    const candidates = response.candidates || [];
    if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                console.log('[Gemini Image] Found image data, size:', part.inlineData.data.length);
                return Buffer.from(part.inlineData.data, 'base64');
            }
        }
    }

    // More detailed error message
    const errorDetails = [];
    if (!candidates.length) errorDetails.push('No candidates in response');
    if (candidates[0] && !candidates[0].content) errorDetails.push('No content in candidate');
    if (response.promptFeedback) errorDetails.push(`Prompt feedback: ${JSON.stringify(response.promptFeedback)}`);
    if (response.error) errorDetails.push(`API error: ${JSON.stringify(response.error)}`);
    
    throw new Error(`No image data returned from Gemini. ${errorDetails.join('. ')}`);
}

// ============================================================================
// VIDEO GENERATION
// ============================================================================

/**
 * Generate video using Veo
 * @returns {Promise<Buffer>} Video buffer
 */
export async function generateVeoVideo({ prompt, imageBase64, lastFrameBase64, aspectRatio, resolution, duration, generateAudio = true, apiKey }) {
    const ai = getGeminiClient(apiKey);
    const model = 'veo-3.1-fast-generate-preview';

    // Map resolution
    const resolutionMap = {
        '1080p': '1080p',
        '720p': '720p',
        '512p': '512p',
        'Auto': '720p'
    };
    const mappedResolution = resolutionMap[resolution] || '720p';

    // Map aspect ratio
    const ratioMap = {
        'Auto': '16:9',
        '16:9': '16:9',
        '9:16': '9:16'
    };
    const mappedRatio = ratioMap[aspectRatio] || '16:9';

    // Map duration - Veo 3 supports 4, 6, or 8 seconds only
    const validDurations = [4, 6, 8];
    const mappedDuration = validDurations.includes(duration) ? duration : 8;

    // Build API arguments
    // Note: generateAudio is NOT supported by @google/genai library yet (throws error)
    // Even though Veo 3.1 API docs mention it, the SDK doesn't expose this parameter
    const args = {
        model: model,
        prompt: prompt,
        config: {
            numberOfVideos: 1,
            durationSeconds: mappedDuration,
            resolution: mappedResolution,
            aspectRatio: mappedRatio
            // generateAudio: not available in current @google/genai SDK
        }
    };

    // Add image inputs
    if (imageBase64) {
        const match = imageBase64.match(/^data:(image\/\w+);base64,/);
        let mimeType = match ? match[1] : "image/png";
        let base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");

        // Veo prefers JPEG, but accepts other formats
        // Just update the mimeType header - the API handles conversion
        if (mimeType === 'image/png' || mimeType === 'image/webp') {
            mimeType = 'image/jpeg';
        }

        args.image = {
            imageBytes: base64Clean,
            mimeType: mimeType
        };
    }

    // Add last frame for interpolation
    if (lastFrameBase64) {
        const match = lastFrameBase64.match(/^data:(image\/\w+);base64,/);
        let mimeType = match ? match[1] : "image/png";
        let base64Clean = lastFrameBase64.replace(/^data:image\/\w+;base64,/, "");

        // Veo prefers JPEG
        if (mimeType === 'image/png' || mimeType === 'image/webp') {
            mimeType = 'image/jpeg';
        }

        args.referenceImages = [{
            referenceId: 1,
            referenceType: 'REFERENCE_TYPE_LAST_FRAME',
            image: {
                imageBytes: base64Clean,
                mimeType: mimeType
            }
        }];
    }

    console.log('Calling Veo API with args:', {
        model: args.model,
        prompt: args.prompt.substring(0, 100) + '...',
        config: args.config,
        image: args.image ? { mimeType: args.image.mimeType, length: args.image.imageBytes?.length } : undefined,
        requestedDuration: duration,
        mappedDuration: mappedDuration
    });

    // Start generation
    let operation = await ai.models.generateVideos(args);

    // Poll for completion
    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.get({ operation: operation });
    }

    // Get video data - Veo returns either a URI or direct bytes
    const response = operation.response;
    const generatedVideo = response?.generatedVideos?.[0];

    if (!generatedVideo) {
        console.error('Veo API response structure:', JSON.stringify(response, null, 2));
        throw new Error('No video generated by Veo');
    }

    // Check if we got a URI (need to download) or direct bytes
    if (generatedVideo.video?.uri) {
        // Download video from URI - need to add API key for authentication
        console.log('Downloading video from Veo URI...');
        const downloadUrl = new URL(generatedVideo.video.uri);
        downloadUrl.searchParams.set('key', apiKey);

        const videoResponse = await fetch(downloadUrl.toString());
        if (!videoResponse.ok) {
            throw new Error(`Failed to download video from Veo: ${videoResponse.status}`);
        }
        return Buffer.from(await videoResponse.arrayBuffer());
    } else if (generatedVideo.video?.videoBytes) {
        // Direct bytes
        return Buffer.from(generatedVideo.video.videoBytes, 'base64');
    } else if (generatedVideo.videoBytes) {
        return Buffer.from(generatedVideo.videoBytes, 'base64');
    }

    console.error('Veo API response structure:', JSON.stringify(response, null, 2));
    throw new Error('No video data in response');
}
