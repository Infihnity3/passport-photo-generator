import { useState, useCallback, useRef } from 'react';
import { removeBackground } from '@imgly/background-removal';

interface BackgroundRemovalState {
    isProcessing: boolean;
    progress: number;
    progressMessage: string;
    result: Blob | null;
    error: string | null;
}

export function useBackgroundRemoval() {
    const [state, setState] = useState<BackgroundRemovalState>({
        isProcessing: false,
        progress: 0,
        progressMessage: '',
        result: null,
        error: null,
    });
    const abortRef = useRef(false);

    const processImage = useCallback(async (imageSource: File | Blob | string) => {
        abortRef.current = false;
        setState({
            isProcessing: true,
            progress: 0,
            progressMessage: 'Initializing background removal model...',
            result: null,
            error: null,
        });

        try {
            const blob = await removeBackground(imageSource, {
                fetchArgs: { cache: 'no-store' },
                progress: (key: string, current: number, total: number) => {
                    if (abortRef.current) return;
                    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                    let msg = 'Processing...';
                    if (key.includes('fetch') || key.includes('download')) {
                        msg = 'Downloading AI model (first time only)...';
                    } else if (key.includes('compute') || key.includes('inference')) {
                        msg = 'Removing background...';
                    }
                    setState((prev) => ({
                        ...prev,
                        progress: pct,
                        progressMessage: msg,
                    }));
                },
                output: {
                    format: 'image/png',
                    quality: 1,
                },
            });

            if (!abortRef.current) {
                setState({
                    isProcessing: false,
                    progress: 100,
                    progressMessage: 'Complete',
                    result: blob,
                    error: null,
                });
            }
        } catch (err) {
            if (!abortRef.current) {
                setState({
                    isProcessing: false,
                    progress: 0,
                    progressMessage: '',
                    result: null,
                    error: err instanceof Error ? err.message : 'Background removal failed',
                });
            }
        }
    }, []);

    const reset = useCallback(() => {
        abortRef.current = true;
        setState({
            isProcessing: false,
            progress: 0,
            progressMessage: '',
            result: null,
            error: null,
        });
    }, []);

    return { ...state, processImage, reset };
}
