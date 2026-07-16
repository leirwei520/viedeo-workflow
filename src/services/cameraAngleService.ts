/**
 * cameraAngleService.ts
 * 
 * Service for calling the Modal Camera Angle API.
 * Transforms images by adjusting the camera viewing angle.
 */

// ============================================================================
// TYPES
// ============================================================================

interface CameraAngleRequest {
    image: string;      // base64-encoded image
    rotation: number;   // -180 to 180 degrees (horizontal)
    tilt: number;       // -90 to 90 degrees (vertical)
    zoom: number;       // 0-100 (close-up effect, mapped to 0-10 for API)
    seed?: number;      // optional reproducibility seed
    numSteps?: number;  // optional, default 4
}

interface CameraAngleResponse {
    image: string;           // base64-encoded result
    prompt: string;          // generated prompt
    seed: number;            // seed used
    inference_time_ms: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

import { API_URL, authFetch } from '../config/api';

const MODAL_ENDPOINT = `${API_URL}/camera-angle/generate`;

// Timeout for API calls (5 minutes for cold start)
const API_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a URL or blob URL to a base64-encoded string
 */
async function urlToBase64(url: string): Promise<string> {
    // Already base64
    if (url.startsWith('data:image')) {
        return url;
    }

    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[CameraAngle] Error converting URL to base64:', error);
        throw new Error('Failed to load image');
    }
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await authFetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error: any) {
        clearTimeout(id);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. The server may be starting up (cold start). Please try again in a few minutes.');
        }
        throw error;
    }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Generate a camera-angle-adjusted version of an image.
 * 
 * @param imageUrl - URL or base64 of the source image
 * @param rotation - Horizontal rotation in degrees (-180 to 180)
 * @param tilt - Vertical tilt in degrees (-90 to 90)
 * @param zoom - Zoom level (0-100, will be scaled to 0-10 for API)
 * @returns Promise with the resulting image as a data URL
 */
export async function generateCameraAngle(
    imageUrl: string,
    rotation: number,
    tilt: number,
    zoom: number
): Promise<{ imageUrl: string; seed: number; inferenceTimeMs: number }> {
    console.log('[CameraAngle] generateCameraAngle called:', { rotation, tilt, zoom });

    // If no change, throw a clear error instead of silently returning the original
    if (rotation === 0 && tilt === 0 && zoom === 0) {
        throw new Error('Please adjust the camera angle before generating. Drag the colored spheres on the 3D control to change rotation or tilt.');
    }

    // Convert image to base64
    const imageBase64 = await urlToBase64(imageUrl);

    // Strip data URL prefix if present for API
    const base64Data = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

    // Build request
    const request: CameraAngleRequest = {
        image: base64Data,
        rotation,
        tilt,
        zoom: zoom / 10, // Scale 0-100 to 0-10 for API
    };

    console.log('[CameraAngle] Calling API via backend proxy...');
    const startTime = Date.now();

    try {
        const response = await fetchWithTimeout(
            MODAL_ENDPOINT,
            {
                method: 'POST',
                headers: {},
                body: JSON.stringify(request),
            },
            API_TIMEOUT_MS
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[CameraAngle] API error:', response.status, errorText);
            throw new Error(`Camera angle API error: ${response.status} - ${errorText}`);
        }

        const result: CameraAngleResponse = await response.json();
        const totalTime = Date.now() - startTime;

        console.log('[CameraAngle] Success!', {
            inferenceTimeMs: result.inference_time_ms,
            totalTimeMs: totalTime,
            seed: result.seed
        });

        // Return as data URL
        return {
            imageUrl: `data:image/png;base64,${result.image}`,
            seed: result.seed,
            inferenceTimeMs: result.inference_time_ms
        };
    } catch (error: any) {
        console.error('[CameraAngle] Request failed:', error);
        throw error;
    }
}

/**
 * Check if the Modal endpoint is configured (always true when using backend proxy)
 */
export function isEndpointConfigured(): boolean {
    return true;
}
