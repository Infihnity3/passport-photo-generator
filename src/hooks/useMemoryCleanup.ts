import { useCallback } from 'react';
import { clearAllImageData } from '../utils/security';

export function useMemoryCleanup() {
    const cleanup = useCallback(() => {
        clearAllImageData();
    }, []);

    return { cleanup };
}
