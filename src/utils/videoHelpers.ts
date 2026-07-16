/**
 * videoHelpers.ts
 * 
 * Utility functions for video processing and manipulation.
 * Handles video frame extraction and conversion operations.
 */

/**
 * Extracts the last frame from a video URL as a base64 encoded image
 * 
 * @param videoUrl - URL of the video to extract from (can be data URI or HTTP URL)
 * @returns Promise resolving to base64 encoded PNG image
 * @throws Error if video fails to load or canvas context is unavailable
 * 
 * @example
 * const lastFrame = await extractVideoLastFrame(videoUrl);
 * // Returns: "data:image/png;base64,iVBORw0KGgo..."
 */
export const extractVideoLastFrame = (videoUrl: string, timeoutMs = 15_000): Promise<string> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';

        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                video.src = '';
                reject(new Error('Frame extraction timed out'));
            }
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timer);
            settled = true;
        };

        video.onloadeddata = () => {
            if (settled) return;
            if (video.duration && isFinite(video.duration)) {
                video.currentTime = video.duration;
            } else {
                cleanup();
                video.src = '';
                reject(new Error('Invalid video duration'));
            }
        };

        video.onseeked = () => {
            if (settled) return;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0);
                cleanup();
                resolve(canvas.toDataURL('image/png'));
            } else {
                cleanup();
                reject(new Error('Canvas context unavailable'));
            }
            video.src = '';
        };

        video.onerror = () => {
            if (settled) return;
            cleanup();
            reject(new Error('Video load failed'));
        };

        video.src = videoUrl;
    });
};
