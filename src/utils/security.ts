/**
 * Security and memory cleanup utilities.
 * Ensures no image data persists after download.
 */

const blobUrls: Set<string> = new Set();
const canvasRefs: Set<HTMLCanvasElement> = new Set();

export function trackBlobUrl(url: string): void {
    blobUrls.add(url);
}

export function trackCanvas(canvas: HTMLCanvasElement): void {
    canvasRefs.add(canvas);
}

export function revokeBlobUrl(url: string): void {
    URL.revokeObjectURL(url);
    blobUrls.delete(url);
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
    canvasRefs.delete(canvas);
}

export function clearAllImageData(): void {
    // Revoke all tracked blob URLs
    blobUrls.forEach((url) => {
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Ignore errors on revocation
        }
    });
    blobUrls.clear();

    // Clear all tracked canvases
    canvasRefs.forEach((canvas) => {
        try {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            canvas.width = 0;
            canvas.height = 0;
        } catch {
            // Ignore errors on cleanup
        }
    });
    canvasRefs.clear();

    // Clear any image elements from body
    const images = document.querySelectorAll('img[src^="blob:"]');
    images.forEach((img) => {
        const imgEl = img as HTMLImageElement;
        try {
            URL.revokeObjectURL(imgEl.src);
        } catch {
            // Ignore
        }
        imgEl.src = '';
        imgEl.removeAttribute('src');
    });
}

export function clearFileInput(input: HTMLInputElement | null): void {
    if (input) {
        input.value = '';
    }
}

// Register cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        clearAllImageData();
    });
}
