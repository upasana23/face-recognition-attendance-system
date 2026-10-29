/**
 * SmartFace Attendance System - WebRTC Camera & Face Canvas Overlay Engine
 */

class WebcamController {
  constructor() {
    this.stream = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.audioCtx = null;
  }

  async startCamera(videoElement, canvasElement, facingMode = 'user') {
    this.videoEl = videoElement;
    this.canvasEl = canvasElement;

    if (this.stream) {
      this.stopCamera();
    }

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: facingMode
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      
      // Synchronize canvas size with video resolution
      this.videoEl.onloadedmetadata = () => {
        if (this.canvasEl) {
          this.canvasEl.width = this.videoEl.videoWidth || 640;
          this.canvasEl.height = this.videoEl.videoHeight || 480;
        }
      };
      return true;
    } catch (err) {
      console.error("[WebcamController] Camera access error:", err);
      throw new Error(`Unable to access camera: ${err.message}. Please check browser permissions.`);
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.clearOverlay();
  }

  captureBase64(videoElement = this.videoEl, quality = 0.92) {
    if (!videoElement || videoElement.readyState < 2) {
      throw new Error("Camera video stream is not ready for capture.");
    }

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = videoElement.videoWidth || 640;
    offscreenCanvas.height = videoElement.videoHeight || 480;
    
    const ctx = offscreenCanvas.getContext("2d");
    ctx.drawImage(videoElement, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    return offscreenCanvas.toDataURL("image/jpeg", quality);
  }

  drawBoundingBox(bbox, status = 'recognized', labelText = '') {
    if (!this.canvasEl || !bbox || bbox.length < 4) return;
    const ctx = this.canvasEl.getContext('2d');
    const [x, y, w, h] = bbox;

    // Clear previous overlay
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

    let color = '#38bdf8'; // Default cyan
    if (status === 'marked_present' || status === 'recognized') {
      color = '#10b981'; // Green
    } else if (status === 'already_marked') {
      color = '#f59e0b'; // Amber
    } else if (status === 'unknown_face') {
      color = '#ef4444'; // Red
    }

    // Modern HUD bracket box
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    // Rounded rectangle outline
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.stroke();

    // Corner accent brackets
    const cornerLength = Math.min(25, w * 0.25);
    ctx.lineWidth = 5;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLength); ctx.lineTo(x, y); ctx.lineTo(x + cornerLength, y);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLength, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLength);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLength); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLength, y + h);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLength, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLength);
    ctx.stroke();

    // Label tag
    if (labelText) {
      ctx.shadowBlur = 0;
      ctx.font = 'bold 14px Outfit, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const tagWidth = textMetrics.width + 20;
      const tagHeight = 26;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, Math.max(0, y - tagHeight - 6), tagWidth, tagHeight, 6);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.fillText(labelText, x + 10, Math.max(18, y - 10));
    }

    ctx.restore();

    // Auto clear after 2.5 seconds
    setTimeout(() => {
      this.clearOverlay();
    }, 2500);
  }

  clearOverlay() {
    if (this.canvasEl) {
      const ctx = this.canvasEl.getContext('2d');
      ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
  }

  // Pure Web Audio API chimes (No external sound files required)
  playAudioFeedback(type = 'success') {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.audioCtx = new AudioContextClass();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'success') {
        // High ascending joyful beep
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'warning') {
        // Double pulse for duplicate
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'error') {
        // Low descending rejection tone
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.25);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // Audio autoplay policy might silently block before user interaction
    }
  }
}

window.webcamController = new WebcamController();
