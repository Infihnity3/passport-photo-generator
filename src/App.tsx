import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { jsPDF } from 'jspdf';
import QRCode from 'react-qr-code';
import './App.css';
import { useBackgroundRemoval } from './hooks/useBackgroundRemoval';
import { useFaceDetection } from './hooks/useFaceDetection';
import { useMemoryCleanup } from './hooks/useMemoryCleanup';
import {
  PASSPORT_STANDARDS,
  DEFAULT_STANDARD,
  getPixelDimensions,
  type PassportStandard,
} from './utils/passportStandards';
import {
  loadImage,
  applyBackground,
  cropAndResize,
  centerFaceInFrame,
  addWatermark,
  canvasToBlob,
  generatePrintLayout,
} from './utils/imageProcessing';
import { trackBlobUrl } from './utils/security';
import { clearAllImageData } from './utils/security';
import {
  COMPRESSION_PRESETS,
  estimateFileSize,
  formatFileSize,
} from './utils/compression';

type Step = 'upload' | 'background' | 'crop' | 'export' | 'complete';

const BACKGROUND_COLORS = [
  { label: 'White', hex: '#FFFFFF', description: 'International standard' },
  { label: 'Light Gray', hex: '#E9ECEF', description: 'UK and common alternative' },
  { label: 'Blue', hex: '#0059A5', description: 'Malaysian standard' },
  { label: 'Light Blue', hex: '#8BBCDB', description: 'Alternative standard' },
  { label: 'Red', hex: '#CC0000', description: 'Regional standard' },
  { label: 'Dark Gray', hex: '#808080', description: 'Generic dark background' },
];

function SectionCard({
  title,
  description,
  children,
  className = '',
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`section-card ${className}`.trim()}>
      <div className="section-card-header">
        <div>
          <h2 className="section-card-title">{title}</h2>
          {description && <p className="section-card-description">{description}</p>}
        </div>
        {actions && <div className="section-card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function StepFrame({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`step-frame ${className}`.trim()}>
      <header className="step-hero">
        <div className="step-hero-copy">
          {eyebrow && <p className="step-eyebrow">{eyebrow}</p>}
          <h1 className="step-title">{title}</h1>
          <p className="step-subtitle">{subtitle}</p>
        </div>
        {actions && <div className="step-hero-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function Callout({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: 'info' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  return <div className={`callout callout-${tone} ${className}`.trim()}>{children}</div>;
}

function App() {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const steps: Step[] = ['upload', 'background', 'crop', 'export', 'complete'];

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showCamera, setShowCamera] = useState(false);
  const [showPhoneCameraFallback, setShowPhoneCameraFallback] = useState(false);
  const [phoneCameraUrl, setPhoneCameraUrl] = useState('');
  const [cameraFallbackReason, setCameraFallbackReason] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [selectedBackground, setSelectedBackground] = useState(BACKGROUND_COLORS[2].hex);
  const [processedImageUrl, setProcessedImageUrl] = useState('');

  const [selectedStandard, setSelectedStandard] = useState<PassportStandard>(DEFAULT_STANDARD);
  const [showStandardDropdown, setShowStandardDropdown] = useState(false);
  const [standardSearch, setStandardSearch] = useState('');
  const [autoCropApproved, setAutoCropApproved] = useState<boolean | null>(null);
  const [manualCrop, setManualCrop] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [croppedCanvas, setCroppedCanvas] = useState<HTMLCanvasElement | null>(null);

  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png' | 'pdf'>('jpeg');
  const [quality, setQuality] = useState(85);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [estimatedSize, setEstimatedSize] = useState('');
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [showWatermarkWarning, setShowWatermarkWarning] = useState(false);
  const [enablePrintLayout, setEnablePrintLayout] = useState(false);
  const [printSize, setPrintSize] = useState<'4x6' | 'A4'>('4x6');

  const [isDownloading, setIsDownloading] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);

  const bgRemoval = useBackgroundRemoval();
  const faceDetection = useFaceDetection();
  const { cleanup } = useMemoryCleanup();

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (JPEG, PNG, or WebP).');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      alert('File too large. Maximum size is 20MB.');
      return;
    }

    const url = URL.createObjectURL(file);
    trackBlobUrl(url);
    setOriginalFile(file);
    setOriginalImageUrl(url);
    setCurrentStep('background');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const buildPhoneCameraUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';

    const url = new URL(window.location.href);
    url.searchParams.set('camera', 'phone');
    return url.toString();
  }, []);

  const openPhoneCameraFallback = useCallback((reason: string) => {
    setCameraFallbackReason(reason);
    setPhoneCameraUrl(buildPhoneCameraUrl());
    setShowPhoneCameraFallback(true);
    setShowCamera(false);
  }, [buildPhoneCameraUrl]);

  const startCamera = useCallback(async () => {
    setShowPhoneCameraFallback(false);
    setCameraFallbackReason('');

    if (!navigator.mediaDevices?.getUserMedia) {
      openPhoneCameraFallback('This browser does not support direct camera access on this device.');
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideoInput = devices.some((device) => device.kind === 'videoinput');

      if (!hasVideoInput) {
        openPhoneCameraFallback('No camera was detected on this computer.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      setShowCamera(true);
      setShowPhoneCameraFallback(false);
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
        openPhoneCameraFallback('No camera was detected on this computer.');
        return;
      }

      const message = err instanceof Error ? err.message : 'Permissions denied';
      alert(`Unable to access camera: ${message}.`);
    }
  }, [openPhoneCameraFallback]);

  useEffect(() => {
    if (showCamera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [showCamera]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('camera') === 'phone') {
      void startCamera();
    }
  }, [startCamera]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  }, []);

  const closePhoneCameraFallback = useCallback(() => {
    setShowPhoneCameraFallback(false);
    setCameraFallbackReason('');
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
      handleFile(file);
      stopCamera();
    }, 'image/jpeg', 0.95);
  }, [handleFile, stopCamera]);

  const processBackground = useCallback(async () => {
    if (!originalFile || !originalImageUrl) return;

    const img = await loadImage(originalImageUrl);
    const faceResult = await faceDetection.detectFace(img);

    if (!faceResult?.faceBox) {
      alert('No human face detected. Please upload a clearer photo with a visible head and shoulders.');
      faceDetection.reset();
      return;
    }

    await bgRemoval.processImage(originalFile);
  }, [originalFile, originalImageUrl, bgRemoval, faceDetection]);

  useEffect(() => {
    if (!bgRemoval.result || !selectedBackground) return;

    let revoked = false;

    const applyBg = async () => {
      const img = await loadImage(bgRemoval.result!);
      if (revoked) return;

      const canvas = applyBackground(img, selectedBackground, img.naturalWidth, img.naturalHeight);
      const blob = await canvasToBlob(canvas, 'image/png', 1);
      const url = URL.createObjectURL(blob);
      trackBlobUrl(url);
      setProcessedImageUrl(url);
    };

    applyBg();

    return () => {
      revoked = true;
    };
  }, [bgRemoval.result, selectedBackground]);

  const goToCropStep = useCallback(() => {
    if (processedImageUrl) {
      setAutoCropApproved(null);
      setManualCrop(false);
      setCurrentStep('crop');
    }
  }, [processedImageUrl]);

  const performAutoCrop = useCallback(async () => {
    if (!processedImageUrl) return;

    const img = await loadImage(processedImageUrl);
    const result = await faceDetection.detectFace(img);

    if (result?.faceBox) {
      const aspect = selectedStandard.width / selectedStandard.height;
      const cropRegion = centerFaceInFrame(img, result.faceBox, aspect);
      const { width: targetW, height: targetH } = getPixelDimensions(selectedStandard);
      const canvas = cropAndResize(img, cropRegion, targetW, targetH);
      setCroppedCanvas(canvas);
      setAutoCropApproved(null);
    }
  }, [processedImageUrl, faceDetection, selectedStandard]);

  useEffect(() => {
    if (currentStep === 'crop' && processedImageUrl) {
      performAutoCrop();
    }
  }, [currentStep, processedImageUrl, performAutoCrop]);

  const acceptAutoCrop = useCallback(() => {
    setAutoCropApproved(true);
    setCurrentStep('export');
  }, []);

  const rejectAutoCrop = useCallback(() => {
    setAutoCropApproved(false);
    setManualCrop(true);
  }, []);

  const onCropComplete = useCallback((_: Area, croppedArea: Area) => {
    setCroppedAreaPixels(croppedArea);
  }, []);

  const applyManualCrop = useCallback(async () => {
    if (!croppedAreaPixels || !processedImageUrl) return;

    const img = await loadImage(processedImageUrl);
    const { width: targetW, height: targetH } = getPixelDimensions(selectedStandard);
    const canvas = cropAndResize(img, croppedAreaPixels, targetW, targetH);
    setCroppedCanvas(canvas);
    setAutoCropApproved(true);
    setManualCrop(false);
    setCurrentStep('export');
  }, [croppedAreaPixels, processedImageUrl, selectedStandard]);

  useEffect(() => {
    if (currentStep !== 'export' || !croppedCanvas) return;

    const updateEstimate = async () => {
      const mimeType = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
      const size = await estimateFileSize(croppedCanvas, quality / 100, mimeType as 'image/jpeg' | 'image/png');
      setEstimatedSize(formatFileSize(size));
    };

    updateEstimate();
  }, [quality, exportFormat, croppedCanvas, currentStep]);

  const handlePreset = useCallback(async (index: number, maxSizeKB: number) => {
    if (!croppedCanvas) return;

    setActivePreset(index);
    let lo = 10;
    let hi = 100;
    let bestQ = 50;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const size = await estimateFileSize(croppedCanvas, mid / 100, 'image/jpeg');
      if (size <= maxSizeKB * 1024) {
        bestQ = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    setQuality(bestQ);
    setExportFormat('jpeg');
  }, [croppedCanvas]);

  const handleDownload = useCallback(async () => {
    if (!croppedCanvas) return;

    setIsDownloading(true);

    try {
      let finalCanvas = croppedCanvas;

      if (enableWatermark) {
        const watermarkCanvas = document.createElement('canvas');
        watermarkCanvas.width = croppedCanvas.width;
        watermarkCanvas.height = croppedCanvas.height;
        const watermarkCtx = watermarkCanvas.getContext('2d');
        if (!watermarkCtx) return;
        watermarkCtx.drawImage(croppedCanvas, 0, 0);
        addWatermark(watermarkCanvas);
        finalCanvas = watermarkCanvas;
      }

      if (exportFormat === 'pdf') {
        const blob = await canvasToBlob(finalCanvas, 'image/jpeg', quality / 100);
        const imgUrl = URL.createObjectURL(blob);
        const pdf = new jsPDF({
          orientation: selectedStandard.width > selectedStandard.height ? 'landscape' : 'portrait',
          unit: 'mm',
          format: [selectedStandard.width, selectedStandard.height],
        });
        pdf.addImage(imgUrl, 'JPEG', 0, 0, selectedStandard.width, selectedStandard.height);
        pdf.save(`passport-photo-${selectedStandard.code}.pdf`);
        URL.revokeObjectURL(imgUrl);
      } else {
        const mimeType = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
        const blob = await canvasToBlob(finalCanvas, mimeType as 'image/jpeg' | 'image/png', quality / 100);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `passport-photo-${selectedStandard.code}.${exportFormat === 'png' ? 'png' : 'jpg'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      if (enablePrintLayout) {
        const printCanvas = generatePrintLayout(
          finalCanvas,
          printSize,
          selectedStandard.width,
          selectedStandard.height
        );
        const printBlob = await canvasToBlob(printCanvas, 'image/jpeg', 0.95);
        const printUrl = URL.createObjectURL(printBlob);
        const link = document.createElement('a');
        link.href = printUrl;
        link.download = `passport-photo-print-${printSize}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(printUrl);
      }

      setCleanupProgress(0);
      setCurrentStep('complete');

      window.setTimeout(() => {
        let progress = 0;
        const interval = window.setInterval(() => {
          progress += 5;
          setCleanupProgress(progress);
          if (progress >= 100) {
            window.clearInterval(interval);
            cleanup();
            clearAllImageData();
          }
        }, 30);
      }, 500);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [croppedCanvas, enableWatermark, exportFormat, quality, selectedStandard, enablePrintLayout, printSize, cleanup]);

  const resetApp = useCallback(() => {
    cleanup();
    clearAllImageData();
    setOriginalFile(null);
    setOriginalImageUrl('');
    setProcessedImageUrl('');
    setCroppedCanvas(null);
    setCroppedAreaPixels(null);
    setAutoCropApproved(null);
    setManualCrop(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setQuality(85);
    setActivePreset(null);
    setEnableWatermark(false);
    setEnablePrintLayout(false);
    setExportFormat('jpeg');
    setCleanupProgress(0);
    setCurrentStep('upload');
    bgRemoval.reset();
    faceDetection.reset();
  }, [cleanup, bgRemoval, faceDetection]);

  const filteredStandards = PASSPORT_STANDARDS.filter((s) =>
    s.country.toLowerCase().includes(standardSearch.toLowerCase()) ||
    s.code.toLowerCase().includes(standardSearch.toLowerCase())
  );

  const currentStepIndex = Math.max(0, steps.indexOf(currentStep));

  const stepMeta: Record<Step, { label: string; description: string }> = {
    upload: { label: 'Upload', description: 'Choose a photo' },
    background: { label: 'Background', description: 'Match the standard' },
    crop: { label: 'Crop', description: 'Frame the face' },
    export: { label: 'Export', description: 'Set output options' },
    complete: { label: 'Done', description: 'Download finished' },
  };

  const renderStepIndicator = () => (
    <nav className="workflow-steps" aria-label="Workflow progress">
      {steps.map((step, index) => {
        const state = index === currentStepIndex ? 'active' : index < currentStepIndex ? 'completed' : 'upcoming';
        return (
          <div key={step} className={`workflow-step ${state}`}>
            <span className="workflow-step-number">{index + 1}</span>
            <span className="workflow-step-copy">
              <span className="workflow-step-label">{stepMeta[step].label}</span>
              <span className="workflow-step-description">{stepMeta[step].description}</span>
            </span>
          </div>
        );
      })}
    </nav>
  );

  const renderUploadStep = () => (
    <StepFrame
      eyebrow="Step 1"
      title="Upload your photo"
      subtitle="Choose an existing image or capture a fresh one from your camera."
    >
      <div className="workflow-grid workflow-grid-upload">
        <SectionCard title="Add a photo" description="JPEG, PNG, or WebP up to 20 MB." className="upload-card">
          {!showPhoneCameraFallback ? (
            !showCamera ? (
              <>
                <div
                  className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="upload-icon">Upload</div>
                  <div className="upload-text">Drop your photo here</div>
                  <div className="upload-subtext">or click to browse</div>
                  <div className="upload-formats">Supports JPEG, PNG, WebP. Max 20 MB.</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                    className="sr-only"
                  />
                </div>

                <div className="upload-actions">
                  <div className="divider-chip">or</div>
                  <button className="btn btn-camera" onClick={startCamera}>
                    Use camera
                  </button>
                </div>
              </>
            ) : (
              <div className="camera-container">
                <div className="camera-preview-wrapper">
                  <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
                  <div className="camera-overlay">
                    <div className="camera-instruction">Position your face within the frame</div>
                    <div className="face-outline" />
                    <div className="camera-tips">
                      <span className="camera-tip">Keep lighting even</span>
                      <span className="camera-tip">Remove glasses if possible</span>
                    </div>
                  </div>
                </div>
                <div className="action-row action-row-center">
                  <button className="btn btn-outline" onClick={stopCamera}>
                    Cancel
                  </button>
                  <button className="capture-btn" onClick={capturePhoto}>
                    Capture
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="camera-handoff">
              <div className="camera-handoff-copy">
                <p className="step-eyebrow">Phone camera fallback</p>
                <h2 className="section-card-title">Use your phone camera instead</h2>
                <p className="section-card-description">
                  {cameraFallbackReason} Scan the QR code to open this photo flow on your phone, then use the phone camera normally.
                </p>
                <div className="handoff-steps">
                  <div className="handoff-step">
                    <span className="handoff-step-number">1</span>
                    Scan the QR code.
                  </div>
                  <div className="handoff-step">
                    <span className="handoff-step-number">2</span>
                    Open the link on your phone.
                  </div>
                  <div className="handoff-step">
                    <span className="handoff-step-number">3</span>
                    Tap Use camera and take the photo.
                  </div>
                </div>
                <div className="handoff-url">{phoneCameraUrl}</div>
                <div className="action-row">
                  <button className="btn btn-outline" onClick={closePhoneCameraFallback}>
                    Back
                  </button>
                  <button className="btn btn-primary" onClick={startCamera}>
                    Check again
                  </button>
                </div>
              </div>
              <div className="camera-handoff-qr">
                {phoneCameraUrl && <QRCode value={phoneCameraUrl} size={220} />}
              </div>
            </div>
          )}
        </SectionCard>

        <aside className="sidebar-stack">
          <SectionCard title="Private by design" description="Everything stays in your browser.">
            <Callout tone="success">
              Your photos never leave your device. No upload, no storage, no sharing.
            </Callout>
          </SectionCard>
          <SectionCard title="Quick tips" description="A better source photo improves detection.">
            <div className="tip-list">
              <div className="tip-item">Use a bright, evenly lit image.</div>
              <div className="tip-item">Keep shoulders visible and face centered.</div>
              <div className="tip-item">Use the camera for a quick retake if needed.</div>
            </div>
          </SectionCard>
        </aside>
      </div>
    </StepFrame>
  );

  const renderBackgroundStep = () => (
    <StepFrame
      eyebrow="Step 2"
      title="Choose a background"
      subtitle="Pick the closest match to the official document standard."
    >
      <div className="workflow-grid workflow-grid-background">
        <SectionCard
          title="Background options"
          description="Select the color that best matches your destination."
          className="background-card"
        >
          <div className="bg-options">
            {BACKGROUND_COLORS.map((bg) => (
              <button
                key={bg.hex}
                type="button"
                className={`bg-option ${selectedBackground === bg.hex ? 'selected' : ''}`}
                onClick={() => setSelectedBackground(bg.hex)}
              >
                <div className="bg-swatch" style={{ backgroundColor: bg.hex }} />
                <div className="bg-label">{bg.label}</div>
                <div className="bg-hex">{bg.hex}</div>
                <div className="bg-description">{bg.description}</div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Preview"
          description="Compare the source image and the background-applied version."
          className="preview-card"
        >
          {originalImageUrl ? (
            <div className="comparison-grid">
              <div className="comparison-panel">
                <div className="panel-label">Original</div>
                <div className="photo-frame">
                  <img src={originalImageUrl} alt="Original" className="preview-image" />
                </div>
              </div>
              <div className="comparison-panel">
                <div className="panel-label">Preview</div>
                <div className="photo-frame" style={{ backgroundColor: selectedBackground }}>
                  {processedImageUrl ? (
                    <img src={processedImageUrl} alt="Processed" className="preview-image" />
                  ) : (
                    <div className="empty-preview">
                      {bgRemoval.isProcessing ? 'Processing...' : 'Run background removal to preview the result.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <Callout tone="info">Upload an image first to see the preview.</Callout>
          )}
        </SectionCard>
      </div>

      {bgRemoval.isProcessing && (
        <SectionCard title="Processing" description="This usually takes only a few seconds.">
          <div className="progress-container">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${bgRemoval.progress}%` }} />
            </div>
            <div className="progress-text">{bgRemoval.progressMessage}</div>
          </div>
        </SectionCard>
      )}

      {bgRemoval.error && (
        <Callout tone="warning" className="status-callout">
          {bgRemoval.error}
        </Callout>
      )}

      <div className="action-row action-row-center">
        <button className="btn btn-outline" onClick={() => setCurrentStep('upload')}>
          Back
        </button>
        {!processedImageUrl ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={processBackground}
            disabled={bgRemoval.isProcessing || faceDetection.isDetecting}
          >
            {bgRemoval.isProcessing || faceDetection.isDetecting ? (
              <>
                <span className="spinner" /> Processing...
              </>
            ) : (
              'Remove background'
            )}
          </button>
        ) : (
          <button className="btn btn-success btn-lg" onClick={goToCropStep}>
            Continue
          </button>
        )}
      </div>
    </StepFrame>
  );

  const renderCropStep = () => {
    const aspect = selectedStandard.width / selectedStandard.height;

    return (
      <StepFrame
        eyebrow="Step 3"
        title="Crop and adjust"
        subtitle="Review the auto-crop or switch to manual control."
      >
        <div className="workflow-grid workflow-grid-crop">
          <SectionCard
            title="Passport standard"
            description="Search and switch to another official size."
            className="selector-card"
          >
            <div className="standard-selector">
              <button
                className="standard-selector-trigger"
                onClick={() => setShowStandardDropdown((open) => !open)}
                type="button"
              >
                <span className="flag">{selectedStandard.flag}</span>
                <span className="selected-standard-copy">
                  {selectedStandard.country} ({selectedStandard.width} x {selectedStandard.height} mm)
                </span>
                <span className={`chevron ${showStandardDropdown ? 'open' : ''}`}>▾</span>
              </button>

              {showStandardDropdown && (
                <div className="standard-dropdown">
                  <div className="standard-search">
                    <input
                      type="text"
                      placeholder="Search country..."
                      value={standardSearch}
                      onChange={(e) => setStandardSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {filteredStandards.map((std) => (
                    <button
                      key={std.code}
                      type="button"
                      className={`standard-option ${std.code === selectedStandard.code ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedStandard(std);
                        setShowStandardDropdown(false);
                        setStandardSearch('');
                        setAutoCropApproved(null);
                        setManualCrop(false);
                        setCroppedCanvas(null);
                        setTimeout(() => performAutoCrop(), 100);
                      }}
                    >
                      <span className="flag">{std.flag}</span>
                      <span className="details">
                        <span className="country-name">{std.country}</span>
                        <span className="dimensions">
                          {std.width} x {std.height} mm · {std.notes.split('.')[0]}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title={manualCrop ? 'Manual crop' : 'Auto crop review'}
            description={
              manualCrop
                ? 'Drag to reposition the photo and zoom as needed.'
                : 'Check that the face is centered before accepting.'
            }
            className="crop-stage-card"
          >
            {!manualCrop ? (
              <div className="photo-preview-area">
                {faceDetection.isDetecting && (
                  <Callout tone="info">
                    <span className="inline-status">
                      <span className="spinner" /> Detecting face...
                    </span>
                  </Callout>
                )}

                {croppedCanvas && !faceDetection.isDetecting && (
                  <>
                    <Callout tone="success" className="status-callout">
                      Face detected and centered for the {selectedStandard.country} standard.
                    </Callout>
                    <div className="photo-frame photo-frame-crop">
                      <canvas
                        ref={(el) => {
                          if (el && croppedCanvas) {
                            el.width = croppedCanvas.width;
                            el.height = croppedCanvas.height;
                            const ctx = el.getContext('2d');
                            if (ctx) ctx.drawImage(croppedCanvas, 0, 0);
                          }
                        }}
                        className="preview-canvas"
                      />
                      <div className="face-guide-overlay">
                        <div className="guide-line guide-line-v" style={{ left: '50%' }} />
                        <div className="guide-line guide-line-h" style={{ top: '33%' }} />
                        <div className="guide-line guide-line-h" style={{ top: '75%' }} />
                      </div>
                    </div>
                    <div className="dimensions-badge">
                      {selectedStandard.width} x {selectedStandard.height} mm
                    </div>

                    {autoCropApproved === null && (
                      <div className="action-row action-row-center">
                        <button className="btn btn-success" onClick={acceptAutoCrop}>
                          Accept
                        </button>
                        <button className="btn btn-outline" onClick={rejectAutoCrop}>
                          Adjust manually
                        </button>
                      </div>
                    )}
                  </>
                )}

                {faceDetection.error && !faceDetection.isDetecting && (
                  <div className="error-stack">
                    <Callout tone="warning">{faceDetection.error}</Callout>
                    <button className="btn btn-primary" onClick={rejectAutoCrop}>
                      Crop manually
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="photo-preview-area">
                <Callout tone="info">
                  Drag to reposition and scroll to zoom. The crop remains centered on the chosen standard.
                </Callout>
                <div className="cropper-container">
                  <Cropper
                    image={processedImageUrl}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspect}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                    style={{
                      containerStyle: { borderRadius: '16px' },
                    }}
                  />
                </div>
                <div className="action-row action-row-center">
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setManualCrop(false);
                      setAutoCropApproved(null);
                    }}
                  >
                    Back to auto crop
                  </button>
                  <button className="btn btn-success" onClick={applyManualCrop}>
                    Apply crop
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="action-row action-row-center">
          <button className="btn btn-outline" onClick={() => setCurrentStep('background')}>
            Back
          </button>
        </div>
      </StepFrame>
    );
  };

  const renderExportStep = () => (
    <StepFrame
      eyebrow="Step 4"
      title="Export options"
      subtitle="Choose a file format, tune compression, and prepare the final download."
    >
      <div className="export-layout">
        <SectionCard
          title="Final preview"
          description="This is the image that will be exported."
          className="export-preview"
        >
          {croppedCanvas && (
            <canvas
              ref={(el) => {
                if (el && croppedCanvas) {
                  el.width = croppedCanvas.width;
                  el.height = croppedCanvas.height;
                  const ctx = el.getContext('2d');
                  if (ctx) ctx.drawImage(croppedCanvas, 0, 0);
                }
              }}
              className="export-preview-canvas"
            />
          )}
          <div className="dimensions-badge dimensions-badge-center">
            {selectedStandard.flag} {selectedStandard.width} x {selectedStandard.height} mm
          </div>
        </SectionCard>

        <div className="export-options">
          <SectionCard title="Format" description="Pick the output type that fits your use case.">
            <div className="format-toggles">
              {(['jpeg', 'png', 'pdf'] as const).map((fmt) => (
                <button
                  key={fmt}
                  className={`format-toggle ${exportFormat === fmt ? 'active' : ''}`}
                  onClick={() => setExportFormat(fmt)}
                  type="button"
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="option-help">
              {exportFormat === 'jpeg' && 'Best for passport submissions and smallest file size.'}
              {exportFormat === 'png' && 'Lossless output with larger file size.'}
              {exportFormat === 'pdf' && 'Single-page PDF for print workflows.'}
            </p>
          </SectionCard>

          <SectionCard title="Compression" description="Balance clarity against file size.">
            <div className="quality-slider-container">
              <div className="quality-header">
                <span className="quality-label">Quality</span>
                <span className="quality-value">{quality}%</span>
              </div>
              <input
                type="range"
                className="quality-slider"
                min="10"
                max="100"
                value={quality}
                onChange={(e) => {
                  setQuality(Number(e.target.value));
                  setActivePreset(null);
                }}
              />
              <div className="file-size-estimate">
                Estimated size: <strong>{estimatedSize || '...'}</strong>
              </div>
              <p className="quality-explanation">
                {quality >= 80
                  ? 'Higher quality preserves fine detail and is recommended for official submissions.'
                  : quality >= 50
                    ? 'Balanced quality for everyday use.'
                    : 'Lower quality reduces size but may introduce visible compression.'}
              </p>
            </div>

            <div className="preset-buttons">
              {COMPRESSION_PRESETS.map((preset, index) => (
                <button
                  key={preset.label}
                  className={`preset-btn ${activePreset === index ? 'active' : ''}`}
                  onClick={() => handlePreset(index, preset.maxSizeKB)}
                  type="button"
                >
                  <span className="label">{preset.label}</span>
                  <span className="desc">{preset.description}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Watermark" description="Leave this off for government submissions.">
            <div className="toggle-row">
              <span className="option-toggle-copy">Add watermark</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enableWatermark}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setShowWatermarkWarning(true);
                    } else {
                      setEnableWatermark(false);
                    }
                  }}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            {!enableWatermark ? (
              <Callout tone="success" className="status-callout">
                Photos are watermark-free and suitable for official use.
              </Callout>
            ) : (
              <Callout tone="warning" className="status-callout">
                Watermarked photos will be rejected by most government agencies.
              </Callout>
            )}
          </SectionCard>

          <SectionCard title="Print layout" description="Generate a print-ready sheet if needed.">
            <div className="toggle-row">
              <span className="option-toggle-copy">Create a print sheet</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enablePrintLayout}
                  onChange={(e) => setEnablePrintLayout(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
            {enablePrintLayout && (
              <div className="format-toggles format-toggles-secondary">
                <button
                  className={`format-toggle ${printSize === '4x6' ? 'active' : ''}`}
                  onClick={() => setPrintSize('4x6')}
                  type="button"
                >
                  4 x 6 inch
                </button>
                <button
                  className={`format-toggle ${printSize === 'A4' ? 'active' : ''}`}
                  onClick={() => setPrintSize('A4')}
                  type="button"
                >
                  A4
                </button>
              </div>
            )}
          </SectionCard>

          <div className="action-row action-row-stretch">
            <button
              className="btn btn-outline"
              onClick={() => {
                setCurrentStep('crop');
                setAutoCropApproved(null);
                setManualCrop(false);
              }}
            >
              Back
            </button>
            <button
              className="btn btn-primary btn-lg action-flex"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <>
                  <span className="spinner" /> Downloading...
                </>
              ) : (
                'Download'
              )}
            </button>
          </div>
        </div>
      </div>
    </StepFrame>
  );

  const renderCompleteStep = () => (
    <StepFrame
      eyebrow="Step 5"
      title="Download complete"
      subtitle="Your photo has been saved and the in-memory image data has been cleared."
    >
      <div className="complete-screen">
        <div className="complete-card">
          <div className="complete-icon">Done</div>
          <h2 className="complete-title">Your file is ready</h2>
          <p className="complete-message">
            The photo is saved locally on your device. All temporary image data has been cleared from memory.
          </p>

          <div className="progress-container progress-container-centered">
            <div className="progress-header">
              <span className="progress-label">Clearing memory</span>
              <span className="progress-value">{cleanupProgress}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill green" style={{ width: `${cleanupProgress}%` }} />
            </div>
          </div>

          <div className="complete-actions">
            <button className="btn btn-primary btn-lg" onClick={resetApp}>
              Process another photo
            </button>
            <button className="btn btn-outline" onClick={resetApp}>
              Back to home
            </button>
          </div>

          <div className="complete-privacy">No copies of your photo have been stored.</div>
        </div>
      </div>
    </StepFrame>
  );

  const renderWatermarkWarning = () => {
    if (!showWatermarkWarning) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowWatermarkWarning(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-icon">Warning</div>
          <div className="modal-title">Enable watermark?</div>
          <div className="modal-message">
            Watermarked photos will usually be rejected by government agencies.
            Only use this option for personal or preview use.
          </div>
          <div className="modal-actions">
            <button className="btn btn-outline" onClick={() => setShowWatermarkWarning(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setEnableWatermark(true);
                setShowWatermarkWarning(false);
              }}
            >
              I understand, enable it
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={resetApp} type="button">
          <img src="/favicon.png" alt="Infihnity ID logo" className="app-logo-icon" />
          <span className="app-logo-text">Infihnity ID</span>
        </button>
        <div className="privacy-badge">Private on device</div>
      </header>

      <main className="app-main">
        {renderStepIndicator()}
        {currentStep === 'upload' && renderUploadStep()}
        {currentStep === 'background' && renderBackgroundStep()}
        {currentStep === 'crop' && renderCropStep()}
        {currentStep === 'export' && renderExportStep()}
        {currentStep === 'complete' && renderCompleteStep()}
      </main>

      {renderWatermarkWarning()}
    </div>
  );
}

export default App;
