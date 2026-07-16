/**
 * useFaceDetection.ts
 * 
 * Hook for browser-based face detection using face-api.js
 * Detects faces in images and returns bounding boxes for overlay display.
 */

import { useState, useCallback, useEffect } from 'react';

interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface UseFaceDetectionReturn {
    detectFaces: (imageUrl: string) => Promise<FaceBox[]>;
    isModelLoaded: boolean;
    isLoading: boolean;
}

let faceapiModule: typeof import('face-api.js') | null = null;
let faceapiLoadPromise: Promise<typeof import('face-api.js')> | null = null;
let modelsLoaded = false;

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.2/model';

async function ensureFaceApi(): Promise<typeof import('face-api.js')> {
    if (faceapiModule && modelsLoaded) return faceapiModule;
    if (faceapiLoadPromise) return faceapiLoadPromise;

    faceapiLoadPromise = (async () => {
        console.log('[Face Detection] Lazy-loading face-api.js...');
        const mod = await import('face-api.js');
        faceapiModule = mod;
        await mod.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        modelsLoaded = true;
        console.log('[Face Detection] Models loaded successfully');
        return mod;
    })();

    return faceapiLoadPromise;
}

export const useFaceDetection = (): UseFaceDetectionReturn => {
    const [isModelLoaded, setIsModelLoaded] = useState(modelsLoaded);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (modelsLoaded) { setIsModelLoaded(true); return; }
        ensureFaceApi().then(() => setIsModelLoaded(true)).catch(() => {});
    }, []);

    const detectFaces = useCallback(async (imageUrl: string): Promise<FaceBox[]> => {
        setIsLoading(true);
        try {
            const faceapi = await ensureFaceApi();

            const img = document.createElement('img');
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = imageUrl;
            });

            const detections = await faceapi.detectAllFaces(
                img,
                new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
            );

            const faces: FaceBox[] = detections.map(detection => {
                const box = detection.box;
                return {
                    x: (box.x / img.naturalWidth) * 100,
                    y: (box.y / img.naturalHeight) * 100,
                    width: (box.width / img.naturalWidth) * 100,
                    height: (box.height / img.naturalHeight) * 100
                };
            });

            return faces;
        } catch (error) {
            console.error('[Face Detection] Detection failed:', error);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { detectFaces, isModelLoaded, isLoading };
};
