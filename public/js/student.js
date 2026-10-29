let currentStudentSession = null;
let currentStudentAttempt = null;
let html5QrScanner = null;
let html5QrCodeFileDecoder = null;
let studentTimerInterval = null;
let studentHistoryRecords = [];
let heartbeatInterval = null;

// Scan debounce state
let lastScannedToken = null;
let scanCooldownActive = false;

// Absence reporting state
let absenceReported = false;
let trackedSessionId = null;

window.initStudentDashboard = async function () {
  await loadAvailableCourses();
  await checkActiveStudentSession();
  await loadAttendanceHistory();
  setupVisibilityListener();

  // Initialize face recognition module (loads models + checks enrollment status)
  if (typeof window.initFaceModule === 'function') {
    await window.initFaceModule();
  }
};

async function loadAvailableCourses() {
  try {
    const data = await apiRequest('/api/courses');
    const listEl = document.getElementById('student-courses-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!data.courses || data.courses.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem;">No courses available at this time.</div>';
      return;
    }

    data.courses.forEach(c => {
      const card = document.createElement('div');
      card.style.cssText = 'padding:1.1rem 1.4rem; background:var(--surf-2); border:1px solid var(--edge-1); border-radius:var(--radius-md); margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;';
      card.innerHTML = `
        <div>
          <strong style="color:var(--text-main); font-size:1.05rem; font-family:'Syne', sans-serif;">${c.course_code}: ${c.name}</strong>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Professor: ${c.professor_name || 'Dr. Alan Turing'}</div>
        </div>
        <div>
          ${c.is_enrolled ?
          '<span class="status-tag present">Enrolled</span>' :
          `<button class="btn btn-secondary btn-sm" onclick="enrollInCourse(${c.id})">Enroll in Course</button>`
        }
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.enrollInCourse = async function (courseId) {
  try {
    await apiRequest('/api/courses/enroll', 'POST', { course_id: courseId });
    showToast('Enrolled in course successfully!', 'success');
    await loadAvailableCourses();
    await checkActiveStudentSession();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function checkActiveStudentSession() {
  try {
    const data = await apiRequest('/api/attendance/session/active');
    const panel = document.getElementById('student-active-session-card');
    if (!panel) return;

    if (data.session) {
      // Detect session change — reset scan/absence state when a new session starts
      if (trackedSessionId !== data.session.id) {
        trackedSessionId = data.session.id;
        absenceReported = false;
        lastScannedToken = null;
        scanCooldownActive = false;
      }

      currentStudentSession = data.session;
      currentStudentAttempt = data.session.student_attempt;
      panel.classList.remove('hidden');

      const titleEl = document.getElementById('student-session-course-title');
      if (titleEl) {
        titleEl.textContent = `${data.session.course_code} - ${data.session.course_name}`;
      }

      const statusEl = document.getElementById('student-session-status');
      const startBtn = document.getElementById('btn-start-attempt');
      const scannerArea = document.getElementById('student-scanner-area');

      if (data.session.is_absent || (data.session.student_record && data.session.student_record.status === 'ABSENT')) {
        if (statusEl) {
          statusEl.innerHTML =
            '<div style="color:var(--accent-2); font-weight:700; font-size:1.05rem; padding:1.2rem; background:rgba(255,100,100,0.12); border:1px solid var(--accent-2); border-radius:var(--radius-md); text-align:center;">❌ You have been marked absent because you left the attendance page.</div>';
        }
        if (startBtn) startBtn.classList.add('hidden');
        if (scannerArea) scannerArea.classList.add('hidden');
        stopCameraScanner();
        stopHeartbeat();
      } else if (data.session.is_marked) {
        if (statusEl) {
          statusEl.innerHTML =
            '<div style="color:var(--accent-1); font-weight:700; font-size:1.1rem; padding:1.2rem; background:rgba(208,255,0,0.12); border:1px solid var(--edge-1); border-radius:var(--radius-md); text-align:center;">✅ Attendance Successfully Verified & Recorded</div>';
        }
        if (startBtn) startBtn.classList.add('hidden');
        if (scannerArea) scannerArea.classList.add('hidden');
        stopCameraScanner();
        stopHeartbeat();
      } else if (currentStudentAttempt && currentStudentAttempt.status === 'IN_PROGRESS') {
        if (startBtn) startBtn.classList.add('hidden');
        if (scannerArea) scannerArea.classList.remove('hidden');
        updateStepTracker(currentStudentAttempt.current_stage);
        startAttemptTimer(currentStudentAttempt.expires_at);
        initCameraScanner();
        startHeartbeat(data.session.id);
      } else {
        if (startBtn) startBtn.classList.remove('hidden');
        if (scannerArea) scannerArea.classList.add('hidden');
        stopCameraScanner();
        stopHeartbeat();
      }
    } else {
      currentStudentSession = null;
      currentStudentAttempt = null;
      trackedSessionId = null;
      panel.classList.add('hidden');
      stopCameraScanner();
      stopHeartbeat();
    }
  } catch (err) {
    console.error('checkActiveStudentSession error:', err);
  }
}

async function startStudentAttempt() {
  if (!currentStudentSession) return;

  // Check if face is enrolled first
  if (typeof window.isFaceEnrolled === 'function') {
    const enrolled = window.isFaceEnrolled();
    if (!enrolled) {
      showToast('⚠️ Biometric Face Enrollment required! Click "Enroll My Face" above before starting.', 'warning');
      return;
    }
  }

  // Require face verification token before starting
  const faceToken = typeof window.getFaceToken === 'function' ? window.getFaceToken() : null;
  if (!faceToken) {
    showToast('⚠️ Step 1 Required: Please verify your face first using the camera verification panel.', 'warning');
    // Scroll to face verification panel
    const verifyPanel = document.getElementById('face-verify-panel');
    if (verifyPanel) verifyPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const startBtn = document.getElementById('btn-start-attempt');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = 'Initializing Attendance Attempt...';
  }

  try {
    const data = await apiRequest('/api/attendance/attempt/start', 'POST', {
      session_id: currentStudentSession.id,
      face_token: faceToken
    });

    currentStudentAttempt = data.attempt;
    showToast('Attendance attempt started! Scan QR Code Stage 1 on screen.', 'info');

    if (startBtn) startBtn.classList.add('hidden');
    const scannerArea = document.getElementById('student-scanner-area');
    if (scannerArea) scannerArea.classList.remove('hidden');

    updateStepTracker(0);
    startAttemptTimer(data.attempt.expires_at);
    initCameraScanner();
    startHeartbeat(currentStudentSession.id);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = '📷 Start Attendance Attempt';
    }
  }
}

function updateStepTracker(stage) {
  const steps = [1, 2, 3];
  steps.forEach(s => {
    const el = document.getElementById(`step-indicator-${s}`);
    if (!el) return;
    el.classList.remove('active', 'completed');
    if (s <= stage) {
      el.classList.add('completed');
    } else if (s === stage + 1) {
      el.classList.add('active');
    }
  });

  const nextNeeded = Math.min(3, stage + 1);
  const infoEl = document.getElementById('current-step-instructions');
  if (infoEl) {
    if (stage >= 3) {
      infoEl.textContent = '🎉 All 3 QR codes successfully verified!';
    } else {
      infoEl.textContent = `Target: Scan QR Code Stage ${nextNeeded} of 3`;
    }
  }
}

function startAttemptTimer(expiryIso) {
  if (studentTimerInterval) clearInterval(studentTimerInterval);

  function update() {
    const remaining = Math.max(0, Math.floor((new Date(expiryIso) - new Date()) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timerEl = document.getElementById('attempt-timer-display');
    if (timerEl) {
      timerEl.textContent = `Attempt Expires In: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    if (remaining <= 0) {
      clearInterval(studentTimerInterval);
      showToast('Attendance attempt expired! Please restart attempt.', 'error');
      invalidateAttemptClientSide();
    }
  }
  update();
  studentTimerInterval = setInterval(update, 1000);
}

// Heartbeat functions
function startHeartbeat(sessionId) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    if (!currentStudentAttempt || currentStudentAttempt.status !== 'IN_PROGRESS') {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      return;
    }
    try {
      await apiRequest('/api/attendance/heartbeat', 'POST', { session_id: sessionId });
    } catch (e) { /* silent */ }
  }, 20000); // every 20 seconds
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

// Camera QR Scanner Initializer using Html5QrcodeScanner
function initCameraScanner() {
  stopCameraScanner();

  if (typeof Html5QrcodeScanner === 'undefined') {
    console.warn('Html5QrcodeScanner library not loaded.');
    return;
  }

  try {
    html5QrScanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true },
      /* verbose= */ false
    );
    html5QrScanner.render(onScanSuccess, onScanFailure);
  } catch (err) {
    console.warn('Live camera video stream failed or restricted:', err);
    showToast('Live camera scanner unavailable in current browser. Use file upload or manual input below.', 'info');
  }
}

function stopCameraScanner() {
  if (html5QrScanner) {
    try {
      html5QrScanner.clear();
    } catch (e) { }
    html5QrScanner = null;
  }
}

window.stopStudentCameraScanner = stopCameraScanner;

async function onScanSuccess(decodedText) {
  if (!currentStudentSession) return;
  const trimmed = (decodedText || '').trim();
  if (!trimmed) return;

  // Debounce: skip if same token scanned within cooldown
  if (scanCooldownActive || trimmed === lastScannedToken) return;

  scanCooldownActive = true;
  lastScannedToken = trimmed;

  try {
    // Submit both scanned_data and token fallback so raw tokens or JSON payloads both work
    const data = await apiRequest('/api/attendance/scan', 'POST', {
      scanned_data: trimmed,
      token: trimmed,
      session_id: currentStudentSession.id
    });

    if (data.completed) {
      showToast('Scan successful', 'success');
      if (currentStudentAttempt) currentStudentAttempt.status = 'COMPLETED';
      stopCameraScanner();
      stopHeartbeat();
      const scannerArea = document.getElementById('student-scanner-area');
      if (scannerArea) scannerArea.classList.add('hidden');
      await checkActiveStudentSession();
      await loadAttendanceHistory();
    } else {
      showToast('Scan successful', 'success');
      if (currentStudentAttempt) currentStudentAttempt.current_stage = data.current_stage;
      updateStepTracker(data.current_stage);
      // Reset cooldown after 3 seconds so student can scan next QR
      setTimeout(() => {
        scanCooldownActive = false;
        lastScannedToken = null;
      }, 3000);
    }
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('already')) {
      showToast('Attendance already recorded', 'info');
    } else if (err.message && err.message.toLowerCase().includes('expired')) {
      showToast('This QR code has expired', 'error');
    } else if (err.message && err.message.toLowerCase().includes('absent')) {
      showToast('You have been marked absent because you left the attendance page', 'error');
      await checkActiveStudentSession();
    } else {
      showToast('⚠️ ' + err.message, 'error');
    }
    // On error, reset cooldown faster so they can retry
    setTimeout(() => {
      scanCooldownActive = false;
      // Don't reset lastScannedToken on error so they can't spam same bad token
    }, 2000);
  }
}

function onScanFailure(error) {
  // Silent frame scan failure
}

// Mobile Snap Photo File Decoder Handler
async function handleQRFileSelected(file) {
  if (!file) return;

  if (typeof Html5Qrcode === 'undefined') {
    showToast('QR decoder library not ready.', 'error');
    return;
  }

  try {
    const html5QrCode = new Html5Qrcode("qr-reader");
    const decodedText = await html5QrCode.scanFile(file, /* showImage= */ true);
    await onScanSuccess(decodedText);
  } catch (err) {
    showToast('Could not detect a valid QR code in the photo. Please try again.', 'error');
  }
}

// App Backgrounding & Lifecycle Invalidation
function setupVisibilityListener() {
  const reportAbsence = (method) => {
    if (!currentStudentSession) return;
    if (!currentStudentAttempt || currentStudentAttempt.status !== 'IN_PROGRESS') return;
    if (absenceReported) return;
    absenceReported = true;

    const sessionId = currentStudentSession.id;
    const token = state.token;
    const url = '/api/attendance/attempt/invalidate';
    const payload = JSON.stringify({ session_id: sessionId });

    try {
      if (method === 'beacon' && navigator.sendBeacon) {
        // sendBeacon can't set auth headers — use keepalive fetch instead
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: payload,
          keepalive: true
        }).catch(() => {});
      } else {
        apiRequest(url, 'POST', { session_id: sessionId }).catch(() => {});
      }
    } catch(e) {}

    invalidateAttemptClientSide();
    showToast('You have been marked absent because you left the attendance page', 'warning');
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      reportAbsence('fetch');
    } else {
      // Returned to page — if already marked absent, remind the student
      if (absenceReported) {
        showToast('You have been marked absent because you left the attendance page', 'error');
      }
    }
  });

  window.addEventListener('pagehide', () => reportAbsence('beacon'));
  window.addEventListener('beforeunload', () => reportAbsence('beacon'));
}

function invalidateAttemptClientSide() {
  if (currentStudentAttempt) {
    currentStudentAttempt.status = 'INVALIDATED';
  }
  stopHeartbeat();
  stopCameraScanner();
  if (studentTimerInterval) clearInterval(studentTimerInterval);
  const scannerArea = document.getElementById('student-scanner-area');
  const startBtn = document.getElementById('btn-start-attempt');
  if (scannerArea) scannerArea.classList.add('hidden');
  if (startBtn) startBtn.classList.remove('hidden');
}

async function loadAttendanceHistory() {
  try {
    const data = await apiRequest('/api/attendance/my-history');
    studentHistoryRecords = data.history || [];
    renderFilteredStudentHistory();
  } catch (err) {
    console.error('loadAttendanceHistory error:', err);
  }
}

function renderFilteredStudentHistory() {
  const tableBody = document.getElementById('student-history-body');
  const searchInput = document.getElementById('student-history-search');
  const statusFilter = document.getElementById('student-history-status-filter');
  if (!tableBody) return;

  const searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const filterVal = statusFilter ? statusFilter.value : 'ALL';

  const filtered = studentHistoryRecords.filter(h => {
    const matchesSearch = !searchTerm ||
      (h.course_code && h.course_code.toLowerCase().includes(searchTerm)) ||
      (h.course_name && h.course_name.toLowerCase().includes(searchTerm));
    const matchesStatus = filterVal === 'ALL' || h.status === filterVal;
    return matchesSearch && matchesStatus;
  });

  tableBody.innerHTML = '';

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No attendance records found matching current filters.</td></tr>';
    return;
  }

  filtered.forEach((h, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${h.course_code}</strong> - ${h.course_name}</td>
      <td>${new Date(h.marked_at).toLocaleString()}</td>
      <td><span class="status-tag present">${h.status}</span></td>
    `;
    tableBody.appendChild(tr);
  });
}

// Global WebSocket Callbacks for Student
window.onSessionUpdated = function (session) {
  // Don't re-render on every update - only if session ID changed or status changed
  checkActiveStudentSession();
};

window.onSessionEnded = function () {
  showToast('Attendance session has ended', 'info');
  stopCameraScanner();
  stopHeartbeat();
  if (studentTimerInterval) clearInterval(studentTimerInterval);
  currentStudentSession = null;
  currentStudentAttempt = null;
  trackedSessionId = null;
  const panel = document.getElementById('student-active-session-card');
  if (panel) panel.classList.add('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
  const btnStartAttempt = document.getElementById('btn-start-attempt');
  if (btnStartAttempt) {
    btnStartAttempt.addEventListener('click', startStudentAttempt);
  }

  // Snap Photo Button & File Picker
  const fileInput = document.getElementById('qr-file-input');
  const snapBtn = document.getElementById('btn-snap-photo');

  if (snapBtn && fileInput) {
    snapBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleQRFileSelected(e.target.files[0]);
      }
    });
  }

  // Manual Scan Input Submission
  const btnManualSubmit = document.getElementById('btn-manual-scan-submit');
  if (btnManualSubmit) {
    btnManualSubmit.addEventListener('click', async () => {
      const manualInput = document.getElementById('manual-qr-input');
      const scannedText = manualInput ? manualInput.value : '';
      if (!scannedText) {
        showToast('Please paste or type the QR code text or token.', 'warning');
        return;
      }
      await onScanSuccess(scannedText);
      if (manualInput) manualInput.value = '';
    });
  }

  // Quick Testing Auto-Fill QR Token Button (convenience for demo/testing on same machine)
  const btnQuickTestScan = document.getElementById('btn-quick-test-scan');
  if (btnQuickTestScan) {
    btnQuickTestScan.addEventListener('click', async () => {
      if (!currentStudentSession) {
        showToast('No active session.', 'warning');
        return;
      }
      try {
        const sessionData = await apiRequest('/api/attendance/session/active');
        if (sessionData.session && sessionData.session.qr_token) {
          const manualInput = document.getElementById('manual-qr-input');
          if (manualInput) manualInput.value = sessionData.session.qr_token;
          showToast(`Loaded active Stage ${sessionData.session.current_stage} token. Click 'Submit Scan' to process.`, 'info');
        } else {
          showToast('Could not find active token for session.', 'warning');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Student Attendance History Filter Listeners
  const histSearch = document.getElementById('student-history-search');
  const histFilter = document.getElementById('student-history-status-filter');

  if (histSearch) histSearch.addEventListener('input', renderFilteredStudentHistory);
  if (histFilter) histFilter.addEventListener('change', renderFilteredStudentHistory);
});
