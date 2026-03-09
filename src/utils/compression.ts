import imageCompression from 'browser-image-compression';

export interface CompressionPreset {
    label: string;
    maxSizeKB: number;
    description: string;
}

export const COMPRESSION_PRESETS: CompressionPreset[] = [
    {
        label: 'Under 200KB',
        maxSizeKB: 200,
        description: 'Suitable for most online passport & visa applications.',
    },
    {
        label: 'Under 100KB',
        maxSizeKB: 100,
        description: 'For portals with strict file size limits (e.g., some embassy websites).',
    },
    {
        label: 'Under 50KB',
        maxSizeKB: 50,
        description: 'Maximum compression. May noticeably reduce quality.',
    },
];

/**
 * Compress an image file to a target size.
 */
export async function compressToTarget(
    file: File,
    maxSizeKB: number,
    maxWidthOrHeight: number = 1200
): Promise<File> {
    const maxSizeMB = maxSizeKB / 1024;

    const compressedFile = await imageCompression(file, {
        maxSizeMB,
        maxWidthOrHeight,
        useWebWorker: true,
        fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        initialQuality: 0.9,
    });

    return compressedFile;
}

/**
 * Compress with a specific quality level (0-1).
 */
export async function compressWithQuality(
    canvas: HTMLCanvasElement,
    quality: number,
    format: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Compression failed'));
            },
            format,
            format === 'image/jpeg' ? quality : undefined
        );
    });
}

/**
 * Estimate file size at a given quality level.
 */
export async function estimateFileSize(
    canvas: HTMLCanvasElement,
    quality: number,
    format: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<number> {
    const blob = await compressWithQuality(canvas, quality, format);
    return blob.size;
}

/**
 * Format bytes to human-readable string.
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
