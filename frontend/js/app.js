/**
 * SmartFace Attendance System — Core Application Controller
 * FIXED: dual camera handling, inline auto-train, file upload registration,
 *        registration camera starts on tab open, proper state management.
 */

// ─── API Config ───────────────────────────────────────────────────────────────
const API_CONFIG = {
  getBaseUrl() {
    const saved = localStorage.getItem("SMARTFACE_API_URL");
    if (saved) return saved.replace(/\/+$/, "");
    return window.location.origin;
  },
  setBaseUrl(url) {
    localStorage.setItem("SMARTFACE_API_URL", url.replace(/\/+$/, ""));
  }
};

// ─── Global State ────────────────────────────────────────────────────────────
const state = {
  activeTab: "attendance",
  autoScanInterval: null,
  isScanning: false,
  registrationSamples: [],
  targetSampleCount: 20,
  activeStudentId: null,
  activeStudentName: null,
  attendanceCamStream: null,
  regCamStream: null,
};

// ─── Separate Webcam Controllers for Attendance & Registration ───────────────
// This avoids the single shared controller conflicting between tabs
const AttendanceCam = new (class {
  constructor() { this.stream = null; this.audioCtx = null; }

  async start(videoEl, canvasEl) {
    if (this.stream) this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false
    });
    this.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    if (canvasEl) {
      videoEl.onloadedmetadata = () => {
        canvasEl.width = videoEl.videoWidth || 640;
        canvasEl.height = videoEl.videoHeight || 480;
      };
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  capture(videoEl, quality = 0.92) {
    const c = document.createElement("canvas");
    c.width = videoEl.videoWidth || 640;
    c.height = videoEl.videoHeight || 480;
    c.getContext("2d").drawImage(videoEl, 0, 0);
    return c.toDataURL("image/jpeg", quality);
  }

  drawBox(canvasEl, bbox, status, label) {
    if (!canvasEl || !bbox) return;
    const ctx = canvasEl.getContext("2d");
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    const [x, y, w, h] = bbox;
    const color = { marked_present: "#10b981", already_marked: "#f59e0b", unknown_face: "#ef4444" }[status] || "#38bdf8";
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.stroke();
    const cl = Math.min(25, w * 0.2);
    [[x, y+cl, x, y, x+cl, y],[x+w-cl, y, x+w, y, x+w, y+cl],
     [x, y+h-cl, x, y+h, x+cl, y+h],[x+w-cl, y+h, x+w, y+h, x+w, y+h-cl]]
      .forEach(pts => { ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(pts[0],pts[1]); ctx.lineTo(pts[2],pts[3]); ctx.lineTo(pts[4],pts[5]); ctx.stroke(); });
    if (label) {
      ctx.shadowBlur=0; ctx.font="bold 13px Outfit,sans-serif";
      const tw = ctx.measureText(label).width + 20;
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, Math.max(0, y-30), tw, 26, 6); ctx.fill();
      ctx.fillStyle = "#0f172a"; ctx.fillText(label, x+10, Math.max(18, y-8));
    }
    ctx.restore();
    setTimeout(() => ctx.clearRect(0, 0, canvasEl.width, canvasEl.height), 3000);
  }

  beep(type = "success") {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.audioCtx) this.audioCtx = new AC();
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();
      const t = this.audioCtx.currentTime;
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.connect(g); g.connect(this.audioCtx.destination);
      if (type === "success") { o.frequency.setValueAtTime(587, t); o.frequency.exponentialRampToValueAtTime(880, t+0.15); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.3); o.start(t); o.stop(t+0.3); }
      else if (type === "warning") { o.frequency.setValueAtTime(440, t); g.gain.setValueAtTime(0.15,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.2); o.start(t); o.stop(t+0.2); }
      else { o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(150, t+0.25); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.3); o.start(t); o.stop(t+0.3); }
    } catch(e) {}
  }
})();

const RegCam = new (class {
  constructor() { this.stream = null; }

  async start(videoEl) {
    if (this.stream) this.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });
      this.stream = stream;
      videoEl.srcObject = stream;
      await videoEl.play();
      return true;
    } catch (err) {
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  capture(videoEl, quality = 0.92) {
    if (!videoEl || videoEl.readyState < 2) throw new Error("Camera not ready");
    const c = document.createElement("canvas");
    c.width = videoEl.videoWidth || 640;
    c.height = videoEl.videoHeight || 480;
    c.getContext("2d").drawImage(videoEl, 0, 0);
    return c.toDataURL("image/jpeg", quality);
  }

  isActive() { return this.stream !== null; }
})();

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = "info", duration = 4500) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${icons[type]||"ℹ️"}</span><span style="flex:1">${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity="0"; t.style.transform="translateX(120%)"; setTimeout(()=>t.remove(), 350); }, duration);
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function apiCall(endpoint, options = {}) {
  const url = `${API_CONFIG.getBaseUrl()}${endpoint}`;
  const headers = {};
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data?.detail) || res.statusText || "API error");
  return data;
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll(".nav-item").forEach(el =>
    el.classList.toggle("active", el.dataset.tab === tabId)
  );
  document.querySelectorAll(".tab-content").forEach(el =>
    el.classList.toggle("active", el.id === `tab-${tabId}`)
  );

  // Stop auto-scan when leaving attendance
  if (tabId !== "attendance") {
    stopAutoScan();
    if (tabId !== "registration") {
      // Stop attendance camera when not in attendance
      AttendanceCam.stop();
      const v = document.getElementById("cameraVideo");
      if (v) v.srcObject = null;
    }
  }

  if (tabId === "attendance") {
    // Stop reg camera, start attendance camera
    RegCam.stop();
    const rv = document.getElementById("regCameraVideo");
    if (rv) rv.srcObject = null;
    startAttendanceCamera();
    loadDashboardStats();
    loadAttendanceFeed();
  }

  if (tabId === "registration") {
    // Stop attendance camera, start registration camera immediately
    AttendanceCam.stop();
    const av = document.getElementById("cameraVideo");
    if (av) av.srcObject = null;
    startRegistrationCamera();
  }

  if (tabId === "training") loadTrainingStatus();
  if (tabId === "reports") { loadReportsAnalytics(); loadDateAttendanceReport(); }
}

// ─── 1. ATTENDANCE ────────────────────────────────────────────────────────────
async function startAttendanceCamera() {
  const v = document.getElementById("cameraVideo");
  const c = document.getElementById("cameraCanvasOverlay");
  const pill = document.getElementById("cameraStatusPill");
  try {
    await AttendanceCam.start(v, c);
    if (pill) pill.innerHTML = `<div class="status-dot"></div><span>Webcam Active</span>`;
  } catch (err) {
    if (pill) pill.innerHTML = `<div class="status-dot offline"></div><span>Camera Unavailable</span>`;
    showToast("Webcam unavailable — use 'Upload Photo' to mark attendance.", "warning");
  }
}

async function markAttendanceCurrentFrame() {
  if (state.isScanning) return;
  state.isScanning = true;
  const btn = document.getElementById("btnCaptureAttendance");
  if (btn) { btn.disabled = true; btn.textContent = "Scanning..."; }

  try {
    const v = document.getElementById("cameraVideo");
    const b64 = AttendanceCam.capture(v);
    const session = document.getElementById("sessionSelector")?.value || "Daily";
    const result = await apiCall("/api/attendance/mark", {
      method: "POST",
      body: JSON.stringify({ image: b64, session_name: session })
    });
    renderAttendanceResult(result);
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    state.isScanning = false;
    if (btn) { btn.disabled = false; btn.innerHTML = `<span>📸</span> Mark Attendance`; }
  }
}

function renderAttendanceResult(result) {
  const box = document.getElementById("recognitionStatusBox");
  const icon = document.getElementById("recognitionIcon");
  const title = document.getElementById("recognitionTitle");
  const detail = document.getElementById("recognitionDetail");
  if (!box) return;

  box.style.display = "flex";
  const canvas = document.getElementById("cameraCanvasOverlay");

  const configs = {
    marked_present: {
      emoji: "🎉", color: "var(--success)", sound: "success",
      titleFn: r => `Present: ${r.student_name} (${r.student_id})`,
      detailFn: r => `${r.similarity_percentage}% match · Marked at ${r.attendance_record?.time}`,
      labelFn: r => `${r.student_name} ✓`,
    },
    already_marked: {
      emoji: "⚠️", color: "var(--warning)", sound: "warning",
      titleFn: r => `Already Marked: ${r.student_name}`,
      detailFn: r => r.message,
      labelFn: r => `${r.student_name} (done)`,
    },
    unknown_face: {
      emoji: "🛑", color: "var(--danger)", sound: "error",
      titleFn: () => "Unknown Face — Access Denied",
      detailFn: () => "Face not registered. Ask admin to register you first.",
      labelFn: () => "Unknown",
    },
    no_face_detected: {
      emoji: "🔍", color: "var(--border-color)", sound: null,
      titleFn: () => "No Face Detected",
      detailFn: () => "Position your face directly in the camera frame.",
      labelFn: () => null,
    },
    model_not_trained: {
      emoji: "🧠", color: "var(--warning)", sound: null,
      titleFn: () => "Model Not Trained",
      detailFn: () => "Register students and train the model first (Model & Training tab).",
      labelFn: () => null,
    },
  };

  const cfg = configs[result.status] || {
    emoji: "ℹ️", color: "var(--primary)", sound: null,
    titleFn: () => "Notice", detailFn: r => r.message, labelFn: () => null
  };

  icon.textContent = cfg.emoji;
  title.textContent = cfg.titleFn(result);
  detail.textContent = cfg.detailFn(result);
  box.style.borderColor = cfg.color;

  if (cfg.sound) AttendanceCam.beep(cfg.sound);
  if (result.bounding_box && cfg.labelFn(result)) {
    AttendanceCam.drawBox(canvas, result.bounding_box, result.status, cfg.labelFn(result));
  }

  if (result.status === "marked_present") {
    showToast(`Attendance marked: ${result.student_name}`, "success");
    loadDashboardStats();
    loadAttendanceFeed();
  } else if (result.status === "already_marked") {
    showToast(`${result.student_name} already marked today!`, "warning");
  } else if (result.status === "unknown_face") {
    showToast("Unknown face — not registered.", "error");
  } else if (result.status === "model_not_trained") {
    showToast("Train the model first!", "warning");
  }
}

function toggleAutoScan(enabled) {
  if (enabled) {
    state.autoScanInterval = setInterval(() => {
      if (!state.isScanning && state.activeTab === "attendance") markAttendanceCurrentFrame();
    }, 3000);
    showToast("Auto-scan ON (every 3 seconds)", "info");
  } else {
    stopAutoScan();
  }
}

function stopAutoScan() {
  if (state.autoScanInterval) { clearInterval(state.autoScanInterval); state.autoScanInterval = null; }
  const cb = document.getElementById("autoScanToggle");
  if (cb) cb.checked = false;
}

async function handleAttendanceFileUpload(file) {
  if (!file) return;
  const session = document.getElementById("sessionSelector")?.value || "Daily";
  const fd = new FormData();
  fd.append("file", file);
  fd.append("session_name", session);
  showToast("Processing uploaded image...", "info");
  try {
    const result = await apiCall("/api/attendance/upload", { method: "POST", body: fd });
    renderAttendanceResult(result);
  } catch (err) {
    showToast(`Upload error: ${err.message}`, "error");
  }
}

// ─── 2. REGISTRATION ──────────────────────────────────────────────────────────
async function startRegistrationCamera() {
  const v = document.getElementById("regCameraVideo");
  if (!v) return;
  const success = await RegCam.start(v);
  const pill = document.getElementById("regCamStatusPill");
  if (pill) {
    pill.innerHTML = success
      ? `<div class="status-dot"></div><span>Camera Ready</span>`
      : `<div class="status-dot offline"></div><span>Camera Off — Upload images below</span>`;
  }
}

async function handleStudentRegistration(e) {
  e.preventDefault();
  const studentId = document.getElementById("regStudentId").value.trim();
  const name = document.getElementById("regStudentName").value.trim();
  const department = document.getElementById("regDepartment").value.trim() || "General";
  const email = document.getElementById("regEmail").value.trim() || null;

  if (!studentId || !name) { showToast("Student ID and Name are required.", "warning"); return; }

  const btn = e.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Registering..."; }

  try {
    const student = await apiCall("/api/students", {
      method: "POST",
      body: JSON.stringify({ student_id: studentId, name, department, email })
    });

    state.activeStudentId = student.student_id;
    state.activeStudentName = student.name;

    // Show capture step
    document.getElementById("regFormContainer").style.display = "none";
    document.getElementById("regCaptureSection").style.display = "block";
    document.getElementById("activeStudentBadge").textContent = `${student.name} (${student.student_id})`;
    state.registrationSamples = [];
    updateRegProgress(0, 0);
    showToast(`Profile created for ${name}. Now capture face samples!`, "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Proceed to Face Capture ➡️"; }
  }
}

async function startBurstCapture() {
  if (!state.activeStudentId) return;

  const v = document.getElementById("regCameraVideo");
  if (!RegCam.isActive()) {
    showToast("Camera not available. Please upload images instead.", "warning");
    return;
  }

  const btn = document.getElementById("btnStartBurst");
  if (btn) btn.disabled = true;
  state.registrationSamples = [];

  const count = state.targetSampleCount;
  showToast(`Capturing ${count} face samples — move your head slightly between captures...`, "info");

  for (let i = 0; i < count; i++) {
    try {
      const b64 = RegCam.capture(v, 0.88);
      state.registrationSamples.push(b64);
      updateRegProgress(i + 1, count);
      AttendanceCam.beep("warning");
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.warn("Frame capture error:", err);
    }
  }

  await uploadAndFinishRegistration();
  if (btn) btn.disabled = false;
}

async function handleRegImageUpload(files) {
  if (!files || files.length === 0) return;
  if (!state.activeStudentId) {
    showToast("Please complete the student profile form first.", "warning");
    return;
  }

  const btn = document.getElementById("btnUploadRegImages");
  if (btn) btn.disabled = true;
  showToast(`Reading ${files.length} uploaded images...`, "info");

  state.registrationSamples = [];

  for (const file of files) {
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    state.registrationSamples.push(b64);
    updateRegProgress(state.registrationSamples.length, Math.max(files.length, state.targetSampleCount));
  }

  await uploadAndFinishRegistration();
  if (btn) btn.disabled = false;
}

async function uploadAndFinishRegistration() {
  if (state.registrationSamples.length === 0) {
    showToast("No samples to upload.", "error");
    return;
  }

  showToast(`Uploading ${state.registrationSamples.length} face images to server...`, "info");

  try {
    const res = await apiCall(`/api/students/${state.activeStudentId}/samples`, {
      method: "POST",
      body: JSON.stringify({ images: state.registrationSamples })
    });

    const saved = res.total_samples;
    showToast(`${saved} face samples saved! Auto-training model now...`, "success");
    updateRegProgress(state.registrationSamples.length, state.registrationSamples.length);

    // ── AUTO-TRAIN immediately after face upload ──────────────────────────────
    await autoTrainAfterRegistration(saved);

  } catch (err) {
    showToast(`Upload failed: ${err.message}`, "error");
  }
}

async function autoTrainAfterRegistration(sampleCount) {
  // Show training progress inline
  const trainProg = document.getElementById("regTrainingProgress");
  if (trainProg) {
    trainProg.style.display = "block";
    trainProg.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:1rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:12px;margin-top:1rem">
        <div class="spinner"></div>
        <div>
          <div style="font-weight:600;color:var(--primary)">Training LBPH Model...</div>
          <div style="font-size:0.82rem;color:var(--text-muted)">Processing ${sampleCount} face samples for ${state.activeStudentName}</div>
        </div>
      </div>`;
  }

  try {
    const result = await apiCall("/api/train", { method: "POST" });

    if (trainProg) {
      trainProg.innerHTML = `
        <div style="padding:1rem;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:12px;margin-top:1rem">
          <div style="font-weight:700;color:var(--success);margin-bottom:4px">✅ Model Trained & Ready!</div>
          <div style="font-size:0.85rem;color:var(--text-muted)">${result.total_students} students · ${result.total_samples} samples · ${result.duration_seconds}s</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">You can now mark attendance using your face on the Live Attendance tab.</div>
        </div>`;
    }

    showToast(`Model trained! ${result.total_students} students enrolled.`, "success");
    loadDashboardStats();

    // Show "Go to Attendance" button
    const gotoBtn = document.getElementById("btnGotoAttendance");
    if (gotoBtn) gotoBtn.style.display = "block";

  } catch (err) {
    if (trainProg) {
      trainProg.innerHTML = `
        <div style="padding:1rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;margin-top:1rem">
          <div style="font-weight:600;color:var(--danger)">⚠️ Auto-training failed</div>
          <div style="font-size:0.82rem;color:var(--text-muted)">${err.message}</div>
          <button class="btn btn-primary" onclick="triggerModelTraining()" style="margin-top:0.75rem;font-size:0.85rem;padding:8px 16px">Retry Training</button>
        </div>`;
    }
    showToast(`Training error: ${err.message}`, "error");
  }
}

function updateRegProgress(current, total) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const fill = document.getElementById("regProgressFill");
  const text = document.getElementById("regProgressText");
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `${current} / ${total} samples (${pct}%)`;
}

function resetRegistrationFlow() {
  document.getElementById("studentRegForm")?.reset();
  document.getElementById("regFormContainer").style.display = "block";
  document.getElementById("regCaptureSection").style.display = "none";
  const tp = document.getElementById("regTrainingProgress");
  if (tp) { tp.style.display = "none"; tp.innerHTML = ""; }
  const gb = document.getElementById("btnGotoAttendance");
  if (gb) gb.style.display = "none";
  state.activeStudentId = null;
  state.activeStudentName = null;
  state.registrationSamples = [];
  updateRegProgress(0, 0);
}

// ─── 3. MODEL TRAINING ────────────────────────────────────────────────────────
async function triggerModelTraining() {
  const btn = document.getElementById("btnTrainModel");
  if (btn) { btn.disabled = true; btn.textContent = "Training..."; }
  showToast("Training LBPH model...", "info");
  try {
    const res = await apiCall("/api/train", { method: "POST" });
    showToast(res.message, "success");
    loadTrainingStatus();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<span>⚡</span> Train / Retrain Model`; }
  }
}

async function loadTrainingStatus() {
  try {
    const data = await apiCall("/api/train/status");
    const badge = document.getElementById("trainingStatusBadge");
    if (badge) {
      badge.textContent = data.model_trained ? "Trained & Active" : "Not Trained";
      badge.className = data.model_trained ? "badge-pill badge-present" : "badge-pill badge-duplicate";
    }
    const details = document.getElementById("trainingStatusDetails");
    if (details) details.innerHTML = `
      <p><strong>Students in model:</strong> ${data.total_registered_classes}</p>
      <p><strong>Last trained:</strong> ${data.last_trained_at || "Never"}</p>
      <p><strong>Status:</strong> ${data.last_training_status}</p>
      <p style="margin-top:8px;font-size:0.82rem;color:var(--text-muted)">${data.last_training_message || ""}</p>`;
  } catch (err) { console.error(err); }
}

async function runModelEvaluation() {
  const el = document.getElementById("evaluationResults");
  if (el) el.innerHTML = `<p style="color:var(--text-muted)">Running evaluation on all dataset samples...</p>`;
  try {
    const m = await apiCall("/api/train/evaluate");
    if (m.error) { showToast(m.error, "warning"); if (el) el.innerHTML = `<p style="color:var(--warning)">${m.error}</p>`; return; }
    if (el) el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
        <div style="background:rgba(0,0,0,0.3);padding:1.25rem;border-radius:12px;text-align:center">
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px">ACCURACY</div>
          <div style="font-size:2rem;font-weight:700;color:var(--success)">${m.accuracy_percentage}%</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);padding:1.25rem;border-radius:12px;text-align:center">
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px">CORRECT / TOTAL</div>
          <div style="font-size:2rem;font-weight:700;color:var(--primary)">${m.correct_predictions}/${m.total_samples_evaluated}</div>
        </div>
      </div>`;
    showToast(`Accuracy: ${m.accuracy_percentage}%`, "success");
  } catch (err) { showToast(err.message, "error"); }
}

// ─── 4. REPORTS ───────────────────────────────────────────────────────────────
async function loadReportsAnalytics() {
  const tbody = document.getElementById("analyticsTableBody");
  if (!tbody) return;
  try {
    const rows = await apiCall("/api/reports/analytics");
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No student data yet.</td></tr>`; return; }
    tbody.innerHTML = rows.map(s => `
      <tr>
        <td><strong>${s.student_id}</strong></td>
        <td>${s.name}</td>
        <td>${s.department}</td>
        <td>${s.total_days_present} / ${s.total_sessions_active}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden">
              <div style="width:${s.attendance_rate}%;height:100%;background:${s.attendance_rate>=75?'#10b981':s.attendance_rate>=50?'#f59e0b':'#ef4444'};border-radius:99px"></div>
            </div>
            <span style="font-size:0.8rem;font-weight:600;min-width:38px">${s.attendance_rate}%</span>
          </div>
        </td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${s.last_attended}</td>
      </tr>`).join("");
  } catch (err) { console.error(err); }
}

async function loadDateAttendanceReport() {
  const date = document.getElementById("reportDatePicker")?.value || new Date().toISOString().slice(0,10);
  const tbody = document.getElementById("dailyReportTableBody");
  if (!tbody) return;
  try {
    const rows = await apiCall(`/api/attendance?date=${date}`);
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No records for ${date}.</td></tr>`; return; }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${r.student_id}</strong></td>
        <td>${r.student_name}</td>
        <td>${r.time}</td>
        <td><span class="badge-pill badge-present">${r.status}</span></td>
        <td>${r.similarity_percentage ? r.similarity_percentage + "%" : "N/A"}</td>
        <td style="font-size:0.8rem;text-transform:uppercase">${r.verification_method}</td>
      </tr>`).join("");
  } catch (err) { console.error(err); }
}

function exportCsvReport() {
  const date = document.getElementById("reportDatePicker")?.value || "";
  const url = `${API_CONFIG.getBaseUrl()}/api/reports/export/csv${date ? "?date=" + date : ""}`;
  showToast("Downloading CSV...", "info");
  window.open(url, "_blank");
}

// ─── 5. DASHBOARD KPIs ───────────────────────────────────────────────────────
async function loadDashboardStats() {
  try {
    const s = await apiCall("/api/attendance/stats");
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("kpiTotalRegistered", s.total_registered_students);
    set("kpiTodayCount", s.today_attendance_count);
    set("kpiAttendanceRate", s.today_attendance_rate + "%");
    set("kpiModelStatus", s.model_trained ? "Active" : "Not Trained");
  } catch (err) { console.warn("Stats error:", err.message); }
}

async function loadAttendanceFeed() {
  const feed = document.getElementById("liveAttendanceFeed");
  if (!feed) return;
  try {
    const rows = await apiCall("/api/attendance?limit=20");
    if (!rows.length) {
      feed.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)">No records yet. Face the camera and click Mark Attendance.</div>`;
      return;
    }
    feed.innerHTML = rows.map(r => `
      <div class="feed-item">
        <div class="feed-item-student">
          <div class="student-avatar">${r.student_name.slice(0,2).toUpperCase()}</div>
          <div class="student-meta">
            <h5>${r.student_name}</h5>
            <span>${r.student_id}${r.similarity_percentage ? " · " + r.similarity_percentage + "% match" : ""}</span>
          </div>
        </div>
        <div class="feed-time-badge">
          <span class="badge-pill badge-present">${r.status}</span>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:2px">${r.date} ${r.time}</div>
        </div>
      </div>`).join("");
  } catch (err) { console.warn("Feed error:", err.message); }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function initSettings() {
  const el = document.getElementById("settingsApiUrl");
  if (el) el.value = API_CONFIG.getBaseUrl();
}

async function testConnection() {
  const url = document.getElementById("settingsApiUrl")?.value.trim().replace(/\/+$/,"");
  if (!url) return;
  API_CONFIG.setBaseUrl(url);
  showToast(`Testing ${url}...`, "info");
  try {
    const res = await apiCall("/api/health");
    showToast(`Connected: ${res.service} v${res.version}`, "success");
    loadDashboardStats();
  } catch (err) { showToast(`Failed: ${err.message}`, "error"); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // Nav
  document.querySelectorAll(".nav-item").forEach(el =>
    el.addEventListener("click", () => switchTab(el.dataset.tab))
  );

  // Reports date picker
  const dp = document.getElementById("reportDatePicker");
  if (dp) {
    dp.value = new Date().toISOString().slice(0, 10);
    dp.addEventListener("change", loadDateAttendanceReport);
  }

  // Attendance
  document.getElementById("btnCaptureAttendance")?.addEventListener("click", markAttendanceCurrentFrame);
  document.getElementById("autoScanToggle")?.addEventListener("change", e => toggleAutoScan(e.target.checked));
  document.getElementById("attendanceFileUpload")?.addEventListener("change", e => {
    if (e.target.files[0]) handleAttendanceFileUpload(e.target.files[0]);
  });

  // Registration
  document.getElementById("studentRegForm")?.addEventListener("submit", handleStudentRegistration);
  document.getElementById("btnStartBurst")?.addEventListener("click", startBurstCapture);
  document.getElementById("btnResetReg")?.addEventListener("click", resetRegistrationFlow);
  document.getElementById("btnGotoAttendance")?.addEventListener("click", () => switchTab("attendance"));

  // Registration image upload
  document.getElementById("regImageUpload")?.addEventListener("change", e => {
    if (e.target.files.length > 0) handleRegImageUpload(Array.from(e.target.files));
  });

  // Training
  document.getElementById("btnTrainModel")?.addEventListener("click", triggerModelTraining);
  document.getElementById("btnRunEvaluation")?.addEventListener("click", runModelEvaluation);

  // Reports
  document.getElementById("btnExportCsv")?.addEventListener("click", exportCsvReport);

  // Settings
  initSettings();
  document.getElementById("btnSaveSettings")?.addEventListener("click", testConnection);

  // Boot on attendance tab
  switchTab("attendance");
});
