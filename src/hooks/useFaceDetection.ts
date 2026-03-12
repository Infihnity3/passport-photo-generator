import { useState, useCallback, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';

interface FaceDetectionResult {
    faceBox: { x: number; y: number; width: number; height: number } | null;
    landmarks: faceapi.FaceLandmarks68 | null;
    isDetecting: boolean;
    isModelLoaded: boolean;
    error: string | null;
}

let modelsLoaded = false;

export function useFaceDetection() {
    const [state, setState] = useState<FaceDetectionResult>({
        faceBox: null,
        landmarks: null,
        isDetecting: false,
        isModelLoaded: modelsLoaded,
        error: null,
    });
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (modelsLoaded) return;

        const loadModels = async () => {
            try {
                const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                ]);
                modelsLoaded = true;
                if (mountedRef.current) {
                    setState((prev) => ({ ...prev, isModelLoaded: true }));
                }
            } catch (err) {
                if (mountedRef.current) {
                    setState((prev) => ({
                        ...prev,
                        error: 'Failed to load face detection models. Please refresh.',
                    }));
                }
                console.error('Face detection model load error:', err);
            }
        };

        loadModels();
    }, []);

    const detectFace = useCallback(
        async (source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement) => {
            if (!modelsLoaded) {
                setState((prev) => ({ ...prev, error: 'Models not loaded yet' }));
                return null;
            }

            setState((prev) => ({ ...prev, isDetecting: true, error: null }));

            try {
                const detection = await faceapi
                    .detectSingleFace(source, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
                    .withFaceLandmarks();

                if (!mountedRef.current) return null;

                if (detection) {
                    const box = detection.detection.box;
                    const faceBox = {
                        x: box.x,
                        y: box.y,
                        width: box.width,
                        height: box.height,
                    };

                    setState({
                        faceBox,
                        landmarks: detection.landmarks,
                        isDetecting: false,
                        isModelLoaded: true,
                        error: null,
                    });

                    return { faceBox, landmarks: detection.landmarks };
                } else {
                    setState({
                        faceBox: null,
                        landmarks: null,
                        isDetecting: false,
                        isModelLoaded: true,
                        error: 'No human face detected. Please ensure you are in a well-lit area with your face clearly visible, or import a clearer photo.',
                    });
                    return null;
                }
            } catch (err) {
                if (mountedRef.current) {
                    setState({
                        faceBox: null,
                        landmarks: null,
                        isDetecting: false,
                        isModelLoaded: true,
                        error: err instanceof Error ? err.message : 'Face detection failed',
                    });
                }
                return null;
            }
        },
        []
    );

    const reset = useCallback(() => {
        setState({
            faceBox: null,
            landmarks: null,
            isDetecting: false,
            isModelLoaded: modelsLoaded,
            error: null,
        });
    }, []);

    return { ...state, detectFace, reset };
}
