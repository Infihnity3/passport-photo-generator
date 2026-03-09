import { trackBlobUrl, trackCanvas } from './security';

/**
 * Load an image from a File or Blob and return an HTMLImageElement.
 */
export function loadImage(source: File | Blob | string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));

        if (typeof source === 'string') {
            img.src = source;
        } else {
            const url = URL.createObjectURL(source);
            trackBlobUrl(url);
            img.src = url;
        }
    });
}

/**
 * Apply a solid background color to an image with transparent areas.
 */
export function applyBackground(
    imageData: ImageData | HTMLCanvasElement | HTMLImageElement,
    backgroundColor: string,
    width: number,
    height: number
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    trackCanvas(canvas);

    const ctx = canvas.getContext('2d')!;

    // Fill with background color
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Draw image on top
    if (imageData instanceof ImageData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0, width, height);
    } else {
        ctx.drawImage(imageData, 0, 0, width, height);
    }

    return canvas;
}

/**
 * Crop an image to specified region and resize to target dimensions.
 */
export function cropAndResize(
    source: HTMLCanvasElement | HTMLImageElement,
    cropArea: { x: number; y: number; width: number; height: number },
    targetWidth: number,
    targetHeight: number
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    trackCanvas(canvas);

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
        source,
        cropArea.x,
        cropArea.y,
        cropArea.width,
        cropArea.height,
        0,
        0,
        targetWidth,
        targetHeight
    );

    return canvas;
}

/**
 * Auto-center a face within passport photo dimensions.
 */
export function centerFaceInFrame(
    source: HTMLCanvasElement | HTMLImageElement,
    faceBox: { x: number; y: number; width: number; height: number },
    targetAspectRatio: number // width / height
): { x: number; y: number; width: number; height: number } {
    const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
    const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;

    // Face center point
    const faceCenterX = faceBox.x + faceBox.width / 2;
    const faceCenterY = faceBox.y + faceBox.height / 2;

    // For passport photos, the face should be roughly 70-80% of the frame height
    // Calculate the crop area based on face size
    const faceToFrameRatio = 0.65; // face height should be ~65% of total frame
    const cropHeight = faceBox.height / faceToFrameRatio;
    const cropWidth = cropHeight * targetAspectRatio;

    // Position crop so face is in the upper portion (head/chin ratio)
    // Typically, top of head is ~10% from top, chin is ~75% from top
    const headOffset = cropHeight * 0.35; // Face center should be ~35% from top
    let cropX = faceCenterX - cropWidth / 2;
    let cropY = faceCenterY - headOffset;

    // Clamp to image boundaries
    cropX = Math.max(0, Math.min(cropX, sourceWidth - cropWidth));
    cropY = Math.max(0, Math.min(cropY, sourceHeight - cropHeight));

    // If crop is larger than source, scale down
    const finalWidth = Math.min(cropWidth, sourceWidth);
    const finalHeight = Math.min(cropHeight, sourceHeight);

    return {
        x: Math.round(cropX),
        y: Math.round(cropY),
        width: Math.round(finalWidth),
        height: Math.round(finalHeight),
    };
}

/**
 * Add a text watermark to a canvas.
 */
export function addWatermark(canvas: HTMLCanvasElement, text: string = 'PREVIEW'): HTMLCanvasElement {
    const ctx = canvas.getContext('2d')!;
    const fontSize = Math.max(12, canvas.width * 0.06);

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';

    // Diagonal watermark pattern
    const angle = -Math.PI / 6;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle);

    for (let y = -canvas.height; y < canvas.height; y += fontSize * 3) {
        for (let x = -canvas.width; x < canvas.width; x += ctx.measureText(text).width * 1.5) {
            ctx.fillText(text, x, y);
        }
    }

    ctx.restore();
    return canvas;
}

/**
 * Convert canvas to Blob with specified format and quality.
 */
export function canvasToBlob(
    canvas: HTMLCanvasElement,
    format: 'image/jpeg' | 'image/png' = 'image/jpeg',
    quality: number = 0.92
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to convert canvas to blob'));
            },
            format,
            format === 'image/jpeg' ? quality : undefined
        );
    });
}

/**
 * Generate a print layout with multiple passport photos arranged on a sheet.
 */
export function generatePrintLayout(
    photoCanvas: HTMLCanvasElement,
    sheetSize: '4x6' | 'A4',
    photoWidthMm: number,
    photoHeightMm: number
): HTMLCanvasElement {
    const DPI = 300;
    const mmToPixels = (mm: number) => Math.round((mm / 25.4) * DPI);
    const GAP_MM = 3; // 3mm gap between photos

    let sheetWidthMm: number, sheetHeightMm: number;
    if (sheetSize === '4x6') {
        sheetWidthMm = 152.4; // 6 inches
        sheetHeightMm = 101.6; // 4 inches
    } else {
        sheetWidthMm = 210; // A4 width
        sheetHeightMm = 297; // A4 height
    }

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = mmToPixels(sheetWidthMm);
    sheetCanvas.height = mmToPixels(sheetHeightMm);
    trackCanvas(sheetCanvas);

    const ctx = sheetCanvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);

    const photoW = mmToPixels(photoWidthMm);
    const photoH = mmToPixels(photoHeightMm);
    const gapPx = mmToPixels(GAP_MM);
    const marginX = mmToPixels(5);
    const marginY = mmToPixels(5);

    let x = marginX;
    let y = marginY;

    while (y + photoH <= sheetCanvas.height - marginY) {
        while (x + photoW <= sheetCanvas.width - marginX) {
            // Draw cut guides
            ctx.strokeStyle = '#CCCCCC';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(x, y, photoW, photoH);
            ctx.setLineDash([]);

            // Draw photo
            ctx.drawImage(photoCanvas, x, y, photoW, photoH);
            x += photoW + gapPx;
        }
        x = marginX;
        y += photoH + gapPx;
    }

    return sheetCanvas;
}
