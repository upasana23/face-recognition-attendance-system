/**
 * SmartFace Attendance System - Frontend Core Application Controller
 */

// API Configuration
const API_CONFIG = {
  // Use localStorage or auto-detect origin if hosted together; default to localhost:8000
  getBaseUrl() {
    const saved = localStorage.getItem("SMARTFACE_API_URL");
    if (saved) return saved.replace(/\/+$/, "");
    if (window.location.port === "8000" || window.location.hostname === "localhost") {
      return window.location.origin;
    }
    return "http://localhost:8000";
  },
  setBaseUrl(url) {
    localStorage.setItem("SMARTFACE_API_URL", url.replace(/\/+$/, ""));
  }
};

// Application State
const state = {
  activeTab: 'attendance',
  autoScanInterval: null,
  isScanning: false,
  registrationSamples: [],
  targetSampleCount: 15,
  isRegisteringCameraActive: false
};

// UI Elements Cache
const dom = {};

// Helper: Toast Notifications
function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "ℹ️";
  if (type === "success") icon = "✅";
  if (type === "error") icon = "❌";
  if (type === "warning") icon = "⚠️";

  toast.innerHTML = `<span>${icon}</span><span style="flex: 1;">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// API Helper wrapper
async function apiCall(endpoint, options = {}) {
  const baseUrl = API_CONFIG.getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const defaultHeaders = {};
  if (!(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers }
    });

    const isJson = res.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const errDetail = typeof data === "object" && data.detail ? data.detail : res.statusText;
      throw new Error(errDetail || "API request failed");
    }
    return data;
  } catch (err) {
    console.error(`[API Error] ${endpoint}:`, err);
    throw err;
  }
}

// ==========================================
// Tab Navigation
// ==========================================
function switchTab(tabId) {
  state.activeTab = tabId;

  // Update navigation styles
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tab === tabId);
  });

  // Switch tab content views
  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("active", content.id === `tab-${tabId}`);
  });

  // Camera management per tab
  if (tabId === "attendance") {
    startAttendanceCamera();
    loadDashboardStats();
    loadAttendanceFeed();
  } else {
    stopAutoScan();
    // Stop registration camera if active
    if (tabId !== "registration") {
      window.webcamController.stopCamera();
    }
  }

  if (tabId === "training") {
    loadTrainingStatus();
  }

  if (tabId === "reports") {
    loadReportsAnalytics();
    loadDateAttendanceReport();
  }
}

// ==========================================
// 1. Live Attendance Flow
// ==========================================
async function startAttendanceCamera() {
  const videoEl = document.getElementById("cameraVideo");
  const canvasEl = document.getElementById("cameraCanvasOverlay");
  try {
    await window.webcamController.startCamera(videoEl, canvasEl);
    document.getElementById("cameraStatusPill").innerHTML = `
      <div class="status-dot"></div><span>Webcam Active (640x480)</span>
    `;
  } catch (err) {
    document.getElementById("cameraStatusPill").innerHTML = `
      <div class="status-dot offline"></div><span>Camera Inactive</span>
    `;
    showToast(err.message, "warning");
  }
}

async function markAttendanceCurrentFrame() {
  if (state.isScanning) return;
  state.isScanning = true;

  const btn = document.getElementById("btnCaptureAttendance");
  if (btn) btn.disabled = true;

  try {
    const videoEl = document.getElementById("cameraVideo");
    const base64 = window.webcamController.captureBase64(videoEl);
    const sessionName = document.getElementById("sessionSelector").value || "Daily";

    const result = await apiCall("/api/attendance/mark", {
      method: "POST",
      body: JSON.stringify({
        image: base64,
        session_name: sessionName
      })
    });

    handleAttendanceResult(result);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    state.isScanning = false;
    if (btn) btn.disabled = false;
  }
}

function handleAttendanceResult(result) {
  const statusBox = document.getElementById("recognitionStatusBox");
  const icon = document.getElementById("recognitionIcon");
  const title = document.getElementById("recognitionTitle");
  const detail = document.getElementById("recognitionDetail");

  if (!statusBox) return;

  statusBox.style.display = "flex";

  if (result.status === "marked_present") {
    icon.textContent = "🎉";
    title.textContent = `Present: ${result.student_name} (${result.student_id})`;
    detail.textContent = `Match Confidence: ${result.similarity_percentage}% - Marked at ${result.attendance_record.time}`;
    statusBox.style.borderColor = "var(--success)";
    
    window.webcamController.playAudioFeedback("success");
    if (result.bounding_box) {
      window.webcamController.drawBoundingBox(result.bounding_box, "marked_present", `${result.student_name} (${result.similarity_percentage}%)`);
    }
    showToast(`Marked present: ${result.student_name}`, "success");
    loadDashboardStats();
    loadAttendanceFeed();
  } else if (result.status === "already_marked") {
    icon.textContent = "⚠️";
    title.textContent = `Already Marked: ${result.student_name} (${result.student_id})`;
    detail.textContent = result.message;
    statusBox.style.borderColor = "var(--warning)";
    
    window.webcamController.playAudioFeedback("warning");
    if (result.bounding_box) {
      window.webcamController.drawBoundingBox(result.bounding_box, "already_marked", `${result.student_name} (Already Marked)`);
    }
    showToast(`Duplicate: ${result.student_name} already marked today!`, "warning");
  } else if (result.status === "unknown_face") {
    icon.textContent = "🛑";
    title.textContent = "Unknown Face - Access Denied";
    detail.textContent = "Confidence below threshold. Face not registered in the system.";
    statusBox.style.borderColor = "var(--danger)";
    
    window.webcamController.playAudioFeedback("error");
    if (result.bounding_box) {
      window.webcamController.drawBoundingBox(result.bounding_box, "unknown_face", "Unknown");
    }
    showToast("Unknown face rejected.", "error");
  } else if (result.status === "no_face_detected") {
    icon.textContent = "🔍";
    title.textContent = "No Face Detected";
    detail.textContent = "Please face the camera directly in adequate lighting.";
    statusBox.style.borderColor = "var(--border-color)";
  } else {
    icon.textContent = "ℹ️";
    title.textContent = "Notice";
    detail.textContent = result.message;
  }
}

// Auto-scan feature
function toggleAutoScan(enabled) {
  if (enabled) {
    if (state.autoScanInterval) clearInterval(state.autoScanInterval);
    state.autoScanInterval = setInterval(() => {
      if (!state.isScanning && state.activeTab === "attendance") {
        markAttendanceCurrentFrame();
      }
    }, 2800);
    showToast("Auto-scan enabled (every 2.8s)", "info");
  } else {
    stopAutoScan();
    showToast("Auto-scan paused", "info");
  }
}

function stopAutoScan() {
  if (state.autoScanInterval) {
    clearInterval(state.autoScanInterval);
    state.autoScanInterval = null;
    const checkbox = document.getElementById("autoScanToggle");
    if (checkbox) checkbox.checked = false;
  }
}

// Fallback image file upload for attendance
async function handleAttendanceFileUpload(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("session_name", document.getElementById("sessionSelector").value || "Daily");

  showToast("Processing uploaded image...", "info");
  try {
    const result = await apiCall("/api/attendance/upload", {
      method: "POST",
      body: formData
    });
    handleAttendanceResult(result);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ==========================================
// 2. Student Registration Flow
// ==========================================
async function handleStudentRegistration(e) {
  e.preventDefault();
  const studentId = document.getElementById("regStudentId").value.trim();
  const name = document.getElementById("regStudentName").value.trim();
  const department = document.getElementById("regDepartment").value.trim() || "General";
  const email = document.getElementById("regEmail").value.trim() || null;

  if (!studentId || !name) {
    showToast("Student ID and Name are required.", "warning");
    return;
  }

  try {
    showToast(`Registering student profile for ${name}...`, "info");
    const student = await apiCall("/api/students", {
      method: "POST",
      body: JSON.stringify({
        student_id: studentId,
        name: name,
        department: department,
        email: email
      })
    });

    showToast(`Student ${name} (${studentId}) registered! Now capture face samples.`, "success");
    document.getElementById("regFormContainer").style.display = "none";
    document.getElementById("regCaptureSection").style.display = "block";
    document.getElementById("activeStudentDisplay").textContent = `${student.name} (${student.student_id})`;
    document.getElementById("activeStudentDisplay").dataset.studentId = student.student_id;
    
    // Start registration camera
    const regVideo = document.getElementById("regCameraVideo");
    await window.webcamController.startCamera(regVideo, null);
    state.registrationSamples = [];
    updateRegistrationProgress();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function startBurstCapture() {
  const studentId = document.getElementById("activeStudentDisplay").dataset.studentId;
  if (!studentId) return;

  const btnBurst = document.getElementById("btnStartBurst");
  btnBurst.disabled = true;
  state.registrationSamples = [];

  const videoEl = document.getElementById("regCameraVideo");
  const countNeeded = state.targetSampleCount;

  showToast(`Capturing ${countNeeded} face samples. Please slowly move your head slightly...`, "info");

  for (let i = 1; i <= countNeeded; i++) {
    try {
      const b64 = window.webcamController.captureBase64(videoEl, 0.9);
      state.registrationSamples.push(b64);
      updateRegistrationProgress();
      window.webcamController.playAudioFeedback("warning");
      // Delay 300ms between frames for varied angles
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      console.warn("Capture frame error:", err);
    }
  }

  showToast(`Uploading ${state.registrationSamples.length} samples for processing...`, "info");
  try {
    const uploadRes = await apiCall(`/api/students/${studentId}/samples`, {
      method: "POST",
      body: JSON.stringify({ images: state.registrationSamples })
    });

    showToast(uploadRes.message, "success");
    document.getElementById("regCompleteSection").style.display = "block";
    btnBurst.disabled = false;
  } catch (err) {
    showToast(err.message, "error");
    btnBurst.disabled = false;
  }
}

function updateRegistrationProgress() {
  const count = state.registrationSamples.length;
  const target = state.targetSampleCount;
  const pct = Math.min(100, Math.round((count / target) * 100));

  const fillEl = document.getElementById("regProgressFill");
  const textEl = document.getElementById("regProgressText");

  if (fillEl) fillEl.style.width = `${pct}%`;
  if (textEl) textEl.textContent = `${count} / ${target} samples captured (${pct}%)`;
}

function resetRegistrationFlow() {
  document.getElementById("studentRegForm").reset();
  document.getElementById("regFormContainer").style.display = "block";
  document.getElementById("regCaptureSection").style.display = "none";
  document.getElementById("regCompleteSection").style.display = "none";
  state.registrationSamples = [];
  window.webcamController.stopCamera();
}

// ==========================================
// 3. Model Training & Evaluation
// ==========================================
async function triggerModelTraining() {
  const btn = document.getElementById("btnTrainModel");
  if (btn) btn.disabled = true;

  showToast("Training LBPH Face Recognizer... This may take a few seconds.", "info");
  try {
    const result = await apiCall("/api/train", { method: "POST" });
    showToast(result.message, "success");
    loadTrainingStatus();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadTrainingStatus() {
  try {
    const data = await apiCall("/api/train/status");
    const statusText = document.getElementById("trainingStatusBadge");
    if (statusText) {
      statusText.textContent = data.model_trained ? "Trained & Active" : "Not Trained";
      statusText.className = data.model_trained ? "badge-pill badge-present" : "badge-pill badge-duplicate";
    }
    const details = document.getElementById("trainingStatusDetails");
    if (details) {
      details.innerHTML = `
        <p><strong>Classes Registered:</strong> ${data.total_registered_classes} students</p>
        <p><strong>Last Trained:</strong> ${data.last_trained_at || "Never"}</p>
        <p><strong>Last Status:</strong> ${data.last_training_status}</p>
      `;
    }
  } catch (err) {
    console.error("Failed to load training status:", err);
  }
}

async function runModelEvaluation() {
  const evalContainer = document.getElementById("evaluationResults");
  if (evalContainer) evalContainer.innerHTML = "<p>Evaluating dataset samples...</p>";

  try {
    const metrics = await apiCall("/api/train/evaluate");
    if (metrics.error) {
      showToast(metrics.error, "warning");
      if (evalContainer) evalContainer.innerHTML = `<p style="color: var(--warning);">${metrics.error}</p>`;
      return;
    }

    if (evalContainer) {
      evalContainer.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
          <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: var(--radius-md);">
            <div style="font-size: 0.8rem; color: var(--text-muted);">ACCURACY RATE</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: var(--success);">${metrics.accuracy_percentage}%</div>
          </div>
          <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: var(--radius-md);">
            <div style="font-size: 0.8rem; color: var(--text-muted);">SAMPLES EVALUATED</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: var(--primary);">${metrics.correct_predictions} / ${metrics.total_samples_evaluated}</div>
          </div>
        </div>
      `;
    }
    showToast(`Evaluation complete: ${metrics.accuracy_percentage}% accuracy.`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ==========================================
// 4. Reports & Analytics
// ==========================================
async function loadReportsAnalytics() {
  try {
    const analytics = await apiCall("/api/reports/analytics");
    const tbody = document.getElementById("analyticsTableBody");
    if (!tbody) return;

    if (!analytics.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No student records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = analytics.map(s => `
      <tr>
        <td><strong>${s.student_id}</strong></td>
        <td>${s.name}</td>
        <td>${s.department}</td>
        <td>${s.total_days_present} / ${s.total_sessions_active}</td>
        <td>${window.ChartRenderer ? window.ChartRenderer.renderProgressBar(s.attendance_rate) : s.attendance_rate + '%'}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${s.last_attended}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Failed to load reports analytics:", err);
  }
}

async function loadDateAttendanceReport() {
  const dateInput = document.getElementById("reportDatePicker");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);

  try {
    const records = await apiCall(`/api/attendance?date=${dateStr}`);
    const tbody = document.getElementById("dailyReportTableBody");
    if (!tbody) return;

    if (!records.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No attendance records for ${dateStr}.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td><strong>${r.student_id}</strong></td>
        <td>${r.student_name}</td>
        <td>${r.time}</td>
        <td><span class="badge-pill badge-present">${r.status}</span></td>
        <td>${r.similarity_percentage ? r.similarity_percentage + '%' : 'N/A'}</td>
        <td><span style="font-size: 0.8rem; text-transform: uppercase;">${r.verification_method}</span></td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Failed to load date report:", err);
  }
}

function exportCsvReport() {
  const dateInput = document.getElementById("reportDatePicker");
  const dateStr = dateInput ? dateInput.value : "";
  const baseUrl = API_CONFIG.getBaseUrl();
  const exportUrl = `${baseUrl}/api/reports/export/csv${dateStr ? '?date=' + dateStr : ''}`;
  
  showToast("Downloading CSV report...", "info");
  window.open(exportUrl, "_blank");
}

// ==========================================
// 5. Dashboard Header KPI & Feed
// ==========================================
async function loadDashboardStats() {
  try {
    const stats = await apiCall("/api/attendance/stats");
    const regEl = document.getElementById("kpiTotalRegistered");
    const todayEl = document.getElementById("kpiTodayCount");
    const rateEl = document.getElementById("kpiAttendanceRate");
    const trainedEl = document.getElementById("kpiModelStatus");

    if (regEl) regEl.textContent = stats.total_registered_students;
    if (todayEl) todayEl.textContent = stats.today_attendance_count;
    if (rateEl) rateEl.textContent = `${stats.today_attendance_rate}%`;
    if (trainedEl) trainedEl.textContent = stats.model_trained ? "Active" : "Not Trained";

    if (window.ChartRenderer && document.getElementById("todayRateGauge")) {
      window.ChartRenderer.renderCircularGauge("todayRateGauge", stats.today_attendance_rate, "Today");
    }
  } catch (err) {
    console.warn("Could not fetch dashboard stats:", err.message);
  }
}

async function loadAttendanceFeed() {
  try {
    const records = await apiCall("/api/attendance?limit=15");
    const feed = document.getElementById("liveAttendanceFeed");
    if (!feed) return;

    if (!records.length) {
      feed.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.9rem;">
          No attendance records yet today.<br>Face the camera to check in.
        </div>
      `;
      return;
    }

    feed.innerHTML = records.map(r => `
      <div class="feed-item">
        <div class="feed-item-student">
          <div class="student-avatar">${r.student_name.slice(0, 2).toUpperCase()}</div>
          <div class="student-meta">
            <h5>${r.student_name}</h5>
            <span>${r.student_id} • ${r.similarity_percentage ? r.similarity_percentage + '% match' : ''}</span>
          </div>
        </div>
        <div class="feed-time-badge">
          <span class="badge-pill badge-present">${r.status}</span>
          <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 2px;">${r.time}</div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Could not fetch attendance feed:", err.message);
  }
}

// ==========================================
// Settings & Backend Connection
// ==========================================
function initSettingsTab() {
  const inputUrl = document.getElementById("settingsApiUrl");
  if (inputUrl) {
    inputUrl.value = API_CONFIG.getBaseUrl();
  }
}

async function testBackendConnection() {
  const inputUrl = document.getElementById("settingsApiUrl");
  const testUrl = inputUrl.value.trim().replace(/\/+$/, "");
  API_CONFIG.setBaseUrl(testUrl);

  showToast(`Testing connection to ${testUrl}...`, "info");
  try {
    const res = await apiCall("/api/health");
    showToast(`Connected successfully! Server: ${res.service} (v${res.version})`, "success");
    loadDashboardStats();
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, "error");
  }
}

// ==========================================
// Initialization
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // Navigation tabs
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });

  // Today's date default
  const todayStr = new Date().toISOString().slice(0, 10);
  const datePicker = document.getElementById("reportDatePicker");
  if (datePicker) {
    datePicker.value = todayStr;
    datePicker.addEventListener("change", loadDateAttendanceReport);
  }

  // Attendance controls
  const btnCapture = document.getElementById("btnCaptureAttendance");
  if (btnCapture) btnCapture.addEventListener("click", markAttendanceCurrentFrame);

  const autoScanCheck = document.getElementById("autoScanToggle");
  if (autoScanCheck) {
    autoScanCheck.addEventListener("change", (e) => toggleAutoScan(e.target.checked));
  }

  const uploadInput = document.getElementById("attendanceFileUpload");
  if (uploadInput) {
    uploadInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        handleAttendanceFileUpload(e.target.files[0]);
      }
    });
  }

  // Student registration form
  const regForm = document.getElementById("studentRegForm");
  if (regForm) regForm.addEventListener("submit", handleStudentRegistration);

  const btnBurst = document.getElementById("btnStartBurst");
  if (btnBurst) btnBurst.addEventListener("click", startBurstCapture);

  const btnResetReg = document.getElementById("btnResetReg");
  if (btnResetReg) btnResetReg.addEventListener("click", resetRegistrationFlow);

  // Model Training buttons
  const btnTrain = document.getElementById("btnTrainModel");
  if (btnTrain) btnTrain.addEventListener("click", triggerModelTraining);

  const btnTrainFromReg = document.getElementById("btnTrainFromReg");
  if (btnTrainFromReg) {
    btnTrainFromReg.addEventListener("click", () => {
      switchTab("training");
      triggerModelTraining();
    });
  }

  const btnEval = document.getElementById("btnRunEvaluation");
  if (btnEval) btnEval.addEventListener("click", runModelEvaluation);

  // Export CSV
  const btnExport = document.getElementById("btnExportCsv");
  if (btnExport) btnExport.addEventListener("click", exportCsvReport);

  // Settings
  initSettingsTab();
  const btnSaveSettings = document.getElementById("btnSaveSettings");
  if (btnSaveSettings) btnSaveSettings.addEventListener("click", testBackendConnection);

  // Initial tab load
  switchTab("attendance");
});
