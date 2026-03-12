import { useState, useRef, useCallback, useEffect } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { jsPDF } from 'jspdf';
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
  { label: 'Light Gray', hex: '#E0E0E0', description: 'UK & common alternative' },
  { label: 'Blue (Malaysian)', hex: '#0059A5', description: 'Malaysian standard (Dark Blue)' },
  { label: 'Light Blue', hex: '#8bbcdb', description: 'Alternative standard' },
  { label: 'Red', hex: '#cc0000', description: 'Indonesian standard' },
  { label: 'Dark Gray', hex: '#808080', description: 'Generic dark background' }
];

function App() {
  // Step management
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const steps: Step[] = ['upload', 'background', 'crop', 'export', 'complete'];

  // Upload state
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Camera state
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Background state
  const [selectedBackground, setSelectedBackground] = useState(BACKGROUND_COLORS[2].hex); // Default: Malaysian blue
  const [processedImageUrl, setProcessedImageUrl] = useState<string>('');

  // Crop state
  const [selectedStandard, setSelectedStandard] = useState<PassportStandard>(DEFAULT_STANDARD);
  const [showStandardDropdown, setShowStandardDropdown] = useState(false);
  const [standardSearch, setStandardSearch] = useState('');
  const [autoCropApproved, setAutoCropApproved] = useState<boolean | null>(null); // null = pending
  const [manualCrop, setManualCrop] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [croppedCanvas, setCroppedCanvas] = useState<HTMLCanvasElement | null>(null);

  // Export state
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png' | 'pdf'>('jpeg');
  const [quality, setQuality] = useState(85);
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<string>('');
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [showWatermarkWarning, setShowWatermarkWarning] = useState(false);
  const [enablePrintLayout, setEnablePrintLayout] = useState(false);
  const [printSize, setPrintSize] = useState<'4x6' | 'A4'>('4x6');

  // Download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);

  // Hooks
  const bgRemoval = useBackgroundRemoval();
  const faceDetection = useFaceDetection();
  const { cleanup } = useMemoryCleanup();

  // ===================================================
  // Upload Handlers
  // ===================================================

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

  // ===================================================
  // Camera Handlers
  // ===================================================

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Camera access is not supported by your browser. Please ensure you are using a secure connection (HTTPS or localhost).');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      setShowCamera(true);
    } catch (err: any) {
      console.error('Camera error:', err);
      alert(`Unable to access camera: ${err.message || 'Permissions denied'}. Please ensure camera permissions are enabled.`);
    }
  }, []);

  // Attach stream to video element when it mounts
  useEffect(() => {
    if (showCamera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [showCamera]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    // Mirror the image (since video is mirrored)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
        handleFile(file);
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  }, [handleFile, stopCamera]);

  // ===================================================
  // Background Processing
  // ===================================================

  const processBackground = useCallback(async () => {
    if (!originalFile || !originalImageUrl) return;

    // First detect a face to ensure we are processing a human image
    const img = await loadImage(originalImageUrl);
    const faceResult = await faceDetection.detectFace(img);

    if (!faceResult || !faceResult.faceBox) {
      alert("No human face detected. Please import a clearer image where a human head and shoulders are visibly present before proceeding.");
      faceDetection.reset();
      return;
    }

    await bgRemoval.processImage(originalFile);
  }, [originalFile, originalImageUrl, bgRemoval, faceDetection]);

  // When background removal completes, apply the selected color
  useEffect(() => {
    if (bgRemoval.result && selectedBackground) {
      const applyBg = async () => {
        const img = await loadImage(bgRemoval.result!);
        const canvas = applyBackground(img, selectedBackground, img.naturalWidth, img.naturalHeight);
        const blob = await canvasToBlob(canvas, 'image/png', 1);
        const url = URL.createObjectURL(blob);
        trackBlobUrl(url);
        setProcessedImageUrl(url);
      };
      applyBg();
    }
  }, [bgRemoval.result, selectedBackground]);

  const goToCropStep = useCallback(() => {
    if (processedImageUrl) {
      setAutoCropApproved(null);
      setManualCrop(false);
      setCurrentStep('crop');
    }
  }, [processedImageUrl]);

  // ===================================================
  // Face Detection & Cropping
  // ===================================================

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
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ===================================================
  // Export & Download
  // ===================================================

  // Estimate file size when quality changes
  useEffect(() => {
    if (currentStep === 'export' && croppedCanvas) {
      const updateEstimate = async () => {
        const mimeType = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
        const size = await estimateFileSize(croppedCanvas, quality / 100, mimeType as 'image/jpeg' | 'image/png');
        setEstimatedSize(formatFileSize(size));
      };
      updateEstimate();
    }
  }, [quality, exportFormat, croppedCanvas, currentStep]);

  const handlePreset = useCallback(async (index: number, maxSizeKB: number) => {
    if (!croppedCanvas) return;
    setActivePreset(index);

    // Binary search for the right quality level
    let lo = 10, hi = 100, bestQ = 50;
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

      // Apply watermark if enabled
      if (enableWatermark) {
        const wCanvas = document.createElement('canvas');
        wCanvas.width = croppedCanvas.width;
        wCanvas.height = croppedCanvas.height;
        const wCtx = wCanvas.getContext('2d')!;
        wCtx.drawImage(croppedCanvas, 0, 0);
        addWatermark(wCanvas);
        finalCanvas = wCanvas;
      }

      if (exportFormat === 'pdf') {
        // PDF export
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
        // Image export
        const mimeType = exportFormat === 'png' ? 'image/png' : 'image/jpeg';
        const blob = await canvasToBlob(finalCanvas, mimeType as 'image/jpeg' | 'image/png', quality / 100);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `passport-photo-${selectedStandard.code}.${exportFormat === 'png' ? 'png' : 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // Download print layout if enabled
      if (enablePrintLayout) {
        const printCanvas = generatePrintLayout(
          finalCanvas,
          printSize,
          selectedStandard.width,
          selectedStandard.height
        );
        const printBlob = await canvasToBlob(printCanvas, 'image/jpeg', 0.95);
        const printUrl = URL.createObjectURL(printBlob);
        const a = document.createElement('a');
        a.href = printUrl;
        a.download = `passport-photo-print-${printSize}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(printUrl);
      }

      // Cleanup and show completion
      setCleanupProgress(0);
      setCurrentStep('complete');

      // Animated cleanup
      const animateCleanup = () => {
        let progress = 0;
        const interval = setInterval(() => {
          progress += 5;
          setCleanupProgress(progress);
          if (progress >= 100) {
            clearInterval(interval);
            cleanup();
            clearAllImageData();
          }
        }, 30);
      };
      setTimeout(animateCleanup, 500);

    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [croppedCanvas, enableWatermark, exportFormat, quality, selectedStandard, enablePrintLayout, printSize, cleanup]);

  // ===================================================
  // Reset
  // ===================================================

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

  // ===================================================
  // Filtered standards for dropdown
  // ===================================================

  const filteredStandards = PASSPORT_STANDARDS.filter((s) =>
    s.country.toLowerCase().includes(standardSearch.toLowerCase()) ||
    s.code.toLowerCase().includes(standardSearch.toLowerCase())
  );

  // ===================================================
  // Render Helpers
  // ===================================================

  const renderStepIndicator = () => (
    <div className="step-indicator">
      {steps.map((step, i) => (
        <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            className={`step-dot ${step === currentStep ? 'active' : steps.indexOf(currentStep) > i ? 'completed' : ''
              }`}
          />
          {i < steps.length - 1 && (
            <div
              className={`step-connector ${steps.indexOf(currentStep) > i ? 'completed' : ''}`}
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderUploadStep = () => (
    <div className="step-container animate-fade-in">
      <div className="step-header">
        <h1 className="step-title">Upload Your Photo</h1>
        <p className="step-subtitle">
          Upload a photo or use your camera to get started
        </p>
      </div>

      {!showCamera ? (
        <>
          <div
            className={`upload-zone ${isDragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">📷</div>
            <div className="upload-text">Drop your photo here</div>
            <div className="upload-subtext">or click to browse</div>
            <div className="upload-formats">
              Supports JPEG, PNG, WebP • Max 20MB
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              style={{ display: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="divider-or">or</div>
            <button className="btn btn-camera" onClick={startCamera}>
              📸 Use Camera
            </button>
          </div>
        </>
      ) : (
        <div className="camera-container">
          <div className="camera-preview-wrapper">
            <video
              ref={videoRef}
              className="camera-video"
              autoPlay
              playsInline
              muted
            />
            <div className="camera-overlay">
              <div className="camera-instruction">
                Position your face within the frame
              </div>
              <div className="face-outline" />
              <div className="camera-tips">
                <span className="camera-tip">💡 Ensure even lighting</span>
                <span className="camera-tip">👓 Remove glasses if possible</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button className="btn btn-outline" onClick={stopCamera}>
              ✕ Cancel
            </button>
            <button className="capture-btn" onClick={capturePhoto}>
              📷
            </button>
          </div>
        </div>
      )}

      <div className="privacy-banner">
        <span className="shield">🔒</span>
        <span>
          <strong>Your photos never leave your device.</strong> All processing
          happens in your browser. No data is uploaded, stored, or shared.
        </span>
      </div>
    </div>
  );

  const renderBackgroundStep = () => (
    <div className="step-container animate-fade-in">
      <div className="step-header">
        <h1 className="step-title">Choose Background</h1>
        <p className="step-subtitle">
          Select a background color for your passport photo (required)
        </p>
      </div>

      <div className="bg-selector">
        <div className="bg-options">
          {BACKGROUND_COLORS.map((bg) => (
            <div
              key={bg.hex}
              className={`bg-option ${selectedBackground === bg.hex ? 'selected' : ''}`}
              onClick={() => setSelectedBackground(bg.hex)}
            >
              <div className="bg-swatch" style={{ backgroundColor: bg.hex }} />
              <div className="bg-label">{bg.label}</div>
              <div className="bg-hex">{bg.hex}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {bg.description}
              </div>
            </div>
          ))}
        </div>

        {/* Original preview */}
        {originalImageUrl && (
          <div className="photo-preview-area" style={{ marginTop: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%', maxWidth: '500px' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', textAlign: 'center' }}>Original</div>
                <div className="photo-frame">
                  <img src={originalImageUrl} alt="Original" style={{ maxHeight: '250px', width: '100%', objectFit: 'contain' }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', textAlign: 'center' }}>Preview</div>
                <div className="photo-frame" style={{ backgroundColor: selectedBackground }}>
                  {processedImageUrl ? (
                    <img src={processedImageUrl} alt="Processed" style={{ maxHeight: '250px', width: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
                      {bgRemoval.isProcessing ? 'Processing...' : 'Click "Remove Background" to preview'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Progress */}
        {bgRemoval.isProcessing && (
          <div className="progress-container" style={{ margin: '0 auto' }}>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${bgRemoval.progress}%` }}
              />
            </div>
            <div className="progress-text">{bgRemoval.progressMessage}</div>
          </div>
        )}

        {bgRemoval.error && (
          <div style={{ color: 'var(--accent-red)', textAlign: 'center', fontSize: '14px' }}>
            ⚠️ {bgRemoval.error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
          <button className="btn btn-outline" onClick={() => setCurrentStep('upload')}>
            ← Back
          </button>
          {!processedImageUrl ? (
            <button
              className="btn btn-primary btn-lg"
              onClick={processBackground}
              disabled={bgRemoval.isProcessing || faceDetection.isDetecting}
            >
              {(bgRemoval.isProcessing || faceDetection.isDetecting) ? (
                <><span className="spinner" /> Processing...</>
              ) : (
                '✨ Remove Background & Apply'
              )}
            </button>
          ) : (
            <button className="btn btn-success btn-lg" onClick={goToCropStep}>
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderCropStep = () => {
    const aspect = selectedStandard.width / selectedStandard.height;

    return (
      <div className="step-container animate-fade-in">
        <div className="step-header">
          <h1 className="step-title">Crop & Adjust</h1>
          <p className="step-subtitle">Review auto-detected face positioning or adjust manually</p>
        </div>

        {/* Standard selector */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div className="standard-selector">
            <button
              className="standard-selector-trigger"
              onClick={() => setShowStandardDropdown(!showStandardDropdown)}
            >
              <span className="flag">{selectedStandard.flag}</span>
              <span>{selectedStandard.country} ({selectedStandard.width}×{selectedStandard.height}mm)</span>
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
                  <div
                    key={std.code}
                    className={`standard-option ${std.code === selectedStandard.code ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedStandard(std);
                      setShowStandardDropdown(false);
                      setStandardSearch('');
                      // Re-run auto crop with new standard
                      setAutoCropApproved(null);
                      setManualCrop(false);
                      setCroppedCanvas(null);
                      setTimeout(() => performAutoCrop(), 100);
                    }}
                  >
                    <span className="flag">{std.flag}</span>
                    <div className="details">
                      <div className="country-name">{std.country}</div>
                      <div className="dimensions">{std.width}×{std.height}mm • {std.notes.split('.')[0]}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Show crop result or manual crop */}
        {!manualCrop ? (
          <div className="photo-preview-area">
            {faceDetection.isDetecting && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
                <span className="spinner" /> Detecting face...
              </div>
            )}

            {croppedCanvas && !faceDetection.isDetecting && (
              <>
                <div className="crop-info">
                  ℹ️ Face detected and auto-centered to {selectedStandard.country} standard
                </div>
                <div className="photo-frame">
                  <canvas
                    ref={(el) => {
                      if (el && croppedCanvas) {
                        el.width = croppedCanvas.width;
                        el.height = croppedCanvas.height;
                        const ctx = el.getContext('2d');
                        if (ctx) ctx.drawImage(croppedCanvas, 0, 0);
                      }
                    }}
                    style={{ maxWidth: '300px', height: 'auto' }}
                  />
                  <div className="face-guide-overlay">
                    <div className="guide-line guide-line-v" style={{ left: '50%' }} />
                    <div className="guide-line guide-line-h" style={{ top: '33%' }} />
                    <div className="guide-line guide-line-h" style={{ top: '75%' }} />
                  </div>
                </div>
                <div className="dimensions-badge">
                  📐 {selectedStandard.width}×{selectedStandard.height}mm ({selectedStandard.country})
                </div>

                {autoCropApproved === null && (
                  <div className="crop-actions">
                    <button className="btn btn-success" onClick={acceptAutoCrop}>
                      ✓ Accept
                    </button>
                    <button className="btn btn-outline" onClick={rejectAutoCrop}>
                      ✂ Adjust Manually
                    </button>
                  </div>
                )}
              </>
            )}

            {faceDetection.error && !faceDetection.isDetecting && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--accent-yellow)', marginBottom: '12px' }}>
                  ⚠️ {faceDetection.error}
                </div>
                <button className="btn btn-primary" onClick={rejectAutoCrop}>
                  ✂ Crop Manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="photo-preview-area">
            <div className="crop-info">
              ℹ️ Drag to reposition, scroll to zoom. The photo will be auto-centered.
            </div>
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
                  containerStyle: { borderRadius: '12px' },
                }}
              />
            </div>
            <div className="crop-actions">
              <button className="btn btn-outline" onClick={() => {
                setManualCrop(false);
                setAutoCropApproved(null);
              }}>
                ← Auto Crop
              </button>
              <button className="btn btn-success" onClick={applyManualCrop}>
                ✓ Apply Crop
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
          <button className="btn btn-outline" onClick={() => setCurrentStep('background')}>
            ← Back
          </button>
        </div>
      </div>
    );
  };

  const renderExportStep = () => (
    <div className="step-container animate-fade-in">
      <div className="step-header">
        <h1 className="step-title">Export Options</h1>
        <p className="step-subtitle">Configure format, quality, and download your passport photo</p>
      </div>

      <div className="export-layout">
        {/* Preview */}
        <div className="export-preview">
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Final Preview
          </div>
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
              style={{ width: '100%', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1px solid var(--border-subtle)' }}
            />
          )}
          <div className="dimensions-badge" style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
            {selectedStandard.flag} {selectedStandard.width}×{selectedStandard.height}mm
          </div>
        </div>

        {/* Options */}
        <div className="export-options">
          {/* Format */}
          <div className="option-card glass-card">
            <div className="option-card-title">🎨 Format</div>
            <div className="format-toggles">
              {(['jpeg', 'png', 'pdf'] as const).map((fmt) => (
                <button
                  key={fmt}
                  className={`format-toggle ${exportFormat === fmt ? 'active' : ''}`}
                  onClick={() => setExportFormat(fmt)}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
              {exportFormat === 'jpeg' && 'Best for passport submissions. Smallest file size.'}
              {exportFormat === 'png' && 'Lossless quality. Larger file size. Preserves transparency.'}
              {exportFormat === 'pdf' && 'Single-page PDF document. Ideal for printing.'}
            </div>
          </div>

          {/* Quality / File Size */}
          <div className="option-card glass-card">
            <div className="option-card-title">📦 File Size Optimization</div>

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
              <div className="quality-explanation">
                {quality >= 80
                  ? 'Higher quality preserves fine details. Recommended for official submissions.'
                  : quality >= 50
                    ? 'Moderate quality. Good balance between file size and clarity.'
                    : 'Low quality. Noticeable compression artifacts may appear. Use only for strict size limits.'}
              </div>
            </div>

            <div className="preset-buttons">
              {COMPRESSION_PRESETS.map((preset, i) => (
                <button
                  key={preset.label}
                  className={`preset-btn ${activePreset === i ? 'active' : ''}`}
                  onClick={() => handlePreset(i, preset.maxSizeKB)}
                >
                  <span className="label">{preset.label}</span>
                  <span className="desc">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Watermark */}
          <div className="option-card glass-card">
            <div className="toggle-row">
              <div>
                <div className="option-card-title" style={{ marginBottom: 0 }}>🔖 Watermark</div>
              </div>
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
              <div className="watermark-notice">
                ✅ Photos are watermark-free — suitable for government submissions
              </div>
            ) : (
              <div className="watermark-notice watermark-warning">
                ⚠️ Watermarked photos will be rejected by government agencies
              </div>
            )}
          </div>

          {/* Print Layout */}
          <div className="option-card glass-card">
            <div className="option-card-title">🖨️ Print Layout</div>
            <div className="toggle-row">
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Generate print-ready sheet with multiple photos
              </span>
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
              <div className="format-toggles" style={{ marginTop: '12px' }}>
                <button
                  className={`format-toggle ${printSize === '4x6' ? 'active' : ''}`}
                  onClick={() => setPrintSize('4x6')}
                >
                  4×6 inch
                </button>
                <button
                  className={`format-toggle ${printSize === 'A4' ? 'active' : ''}`}
                  onClick={() => setPrintSize('A4')}
                >
                  A4
                </button>
              </div>
            )}
          </div>

          {/* Download button */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-outline" onClick={() => {
              setCurrentStep('crop');
              setAutoCropApproved(null);
              setManualCrop(false);
            }}>
              ← Back
            </button>
            <button
              className="btn btn-primary btn-lg"
              style={{ flex: 1 }}
              onClick={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <><span className="spinner" /> Downloading...</>
              ) : (
                '⬇️ Download'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCompleteStep = () => (
    <div className="step-container animate-fade-in">
      <div className="complete-screen">
        <div className="complete-icon animate-scale-in">✓</div>
        <h1 className="complete-title animate-slide-up">Download Complete!</h1>
        <div className="complete-message animate-slide-up" style={{ animationDelay: '0.1s' }}>
          🛡️ Your photo has been saved. All image data has been cleared from memory.
        </div>

        <div className="progress-container" style={{ animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Clearing memory...</span>
            <span style={{ fontSize: '13px', color: 'var(--accent-green)' }}>{cleanupProgress}%</span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill green"
              style={{ width: `${cleanupProgress}%` }}
            />
          </div>
        </div>

        <div className="complete-actions animate-slide-up" style={{ animationDelay: '0.3s' }}>
          <button className="btn btn-primary btn-lg" onClick={resetApp}>
            📷 Process Another Photo
          </button>
          <button className="btn btn-outline" onClick={resetApp}>
            🏠 Back to Home
          </button>
        </div>

        <div className="complete-privacy animate-slide-up" style={{ animationDelay: '0.4s' }}>
          🔒 No copies of your photo have been stored.
        </div>
      </div>
    </div>
  );

  // ===================================================
  // Watermark Warning Modal
  // ===================================================

  const renderWatermarkWarning = () => {
    if (!showWatermarkWarning) return null;
    return (
      <div className="modal-overlay" onClick={() => setShowWatermarkWarning(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-icon">⚠️</div>
          <div className="modal-title">Enable Watermark?</div>
          <div className="modal-message">
            Watermarked photos <strong>will be rejected</strong> by government agencies
            (passports, visas, IDs, and official documents).
            <br /><br />
            Only enable watermarks for personal or preview use.
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-outline"
              onClick={() => setShowWatermarkWarning(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setEnableWatermark(true);
                setShowWatermarkWarning(false);
              }}
              style={{ background: 'var(--accent-yellow)', color: '#000' }}
            >
              I Understand, Enable
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ===================================================
  // Main Render
  // ===================================================

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo" onClick={resetApp}>
          <img src="/favicon.png" alt="Infihnity ID Logo" className="app-logo-icon" />
          <span className="app-logo-text">Infihnity ID</span>
        </div>
        <div className="privacy-badge">
          🔒 100% Private
        </div>
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
