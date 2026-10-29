/**
 * face.js — Face Recognition Module
 * 
 * Uses face-api.js (TinyFaceDetector + FaceRecognitionNet) running in-browser.
 * 
 * Flow:
 *   1. loadFaceModels()          — called once at student dashboard init
 *   2. checkFaceStatus()         — shows enrollment banner or verification panel
 *   3. openEnrollModal()         — camera capture → POST /api/face/enroll (one-time)
 *   4. openVerifyPanel()         — live camera → POST /api/face/verify → stores face_token
 *   5. window.getFaceToken()     — called by student.js before startStudentAttempt
 */

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let faceModelsLoaded = false;
let currentFaceToken = null;
let isEnrolledState = false;

// Pre-defined test descriptor for camera-less testing environments
const MOCK_DESCRIPTOR = new Array(128).fill(0).map((_, i) => Math.sin(i + 1) * 0.1);

// ─────────────────────────────────────────────────────────────────────────────
// Model Loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadFaceModels() {
    if (faceModelsLoaded) return;
    if (typeof faceapi === 'undefined') {
        console.warn('[Face] face-api.js library not loaded.');
        return;
    }
    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        faceModelsLoaded = true;
        console.log('[Face] Models loaded successfully.');
    } catch (err) {
        console.warn('[Face] CDN models failed to load or network restricted:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Descriptor extraction from a video or canvas element
// ─────────────────────────────────────────────────────────────────────────────

async function extractDescriptor(videoEl) {
    if (typeof faceapi === 'undefined' || !faceModelsLoaded) return null;
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const detection = await faceapi
        .detectSingleFace(videoEl, options)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

    if (!detection) return null;
    return Array.from(detection.descriptor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Check
// ─────────────────────────────────────────────────────────────────────────────

async function checkFaceStatus() {
    try {
        const data = await apiRequest('/api/face/status');
        isEnrolledState = Boolean(data.enrolled);
        renderFaceStatusBanner(data.enrolled, data.enrolled_at);
        return isEnrolledState;
    } catch (err) {
        console.error('[Face] checkFaceStatus error:', err);
        return false;
    }
}

function renderFaceStatusBanner(enrolled, enrolledAt) {
    const banner = document.getElementById('face-status-banner');
    const enrollBtn = document.getElementById('btn-open-enroll-modal');
    const verifyPanel = document.getElementById('face-verify-panel');

    if (!banner) return;

    if (enrolled) {
        banner.innerHTML = `<span class="face-status-badge enrolled">✅ Face Enrolled</span>
      <span style="font-size:0.8rem; color:var(--text-muted);">Biometric vector stored on ${new Date(enrolledAt).toLocaleDateString()}</span>`;
        if (enrollBtn) enrollBtn.classList.add('hidden');
        if (verifyPanel) verifyPanel.classList.remove('hidden');
    } else {
        banner.innerHTML = `<span class="face-status-badge not-enrolled">⚠️ Face Not Enrolled</span>
      <span style="font-size:0.8rem; color:var(--text-muted);">One-time facial biometric enrollment is required before attendance verification.</span>`;
        if (enrollBtn) enrollBtn.classList.remove('hidden');
        if (verifyPanel) verifyPanel.classList.add('hidden');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrollment Modal
// ─────────────────────────────────────────────────────────────────────────────

let enrollStream = null;

async function openEnrollModal() {
    const modal = document.getElementById('face-enroll-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (!faceModelsLoaded) {
        await loadFaceModels();
    }

    const video = document.getElementById('enroll-video');
    if (!video) return;

    try {
        enrollStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = enrollStream;
        await video.play();
    } catch (err) {
        console.warn('Live camera video stream unavailable:', err);
        showToast('Camera access restricted. You may use the "🧪 Test Biometrics" button below to enroll.', 'info');
    }
}

function closeEnrollModal() {
    const modal = document.getElementById('face-enroll-modal');
    if (modal) modal.classList.add('hidden');
    if (enrollStream) {
        enrollStream.getTracks().forEach(t => t.stop());
        enrollStream = null;
    }
}

async function captureAndEnroll() {
    const video = document.getElementById('enroll-video');
    const btn = document.getElementById('btn-capture-enroll');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⏳ Detecting face…';

    try {
        let descriptor = null;
        if (video && video.srcObject) {
            descriptor = await extractDescriptor(video);
        }

        if (!descriptor) {
            showToast('No face detected. Align your face directly in camera frame, or use test biometrics.', 'error');
            btn.disabled = false;
            btn.textContent = '📸 Capture & Enroll Face';
            return;
        }

        btn.textContent = '⏳ Enrolling…';
        await apiRequest('/api/face/enroll', 'POST', { descriptor });

        showToast('Face enrolled successfully! You can now verify your face for attendance.', 'success');
        closeEnrollModal();
        await checkFaceStatus();
    } catch (err) {
        showToast(err.message || 'Enrollment failed. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = '📸 Capture & Enroll Face';
    }
}

// Simulated Test Biometrics Enrollment (for environments without physical camera)
async function simulateTestEnroll() {
    try {
        await apiRequest('/api/face/enroll', 'POST', { descriptor: MOCK_DESCRIPTOR });
        showToast('✅ Test face biometrics enrolled successfully!', 'success');
        closeEnrollModal();
        await checkFaceStatus();
    } catch (err) {
        showToast(err.message || 'Enrollment failed.', 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification Panel
// ─────────────────────────────────────────────────────────────────────────────

let verifyStream = null;

async function startVerifyCamera() {
    if (!faceModelsLoaded) {
        await loadFaceModels();
    }

    const video = document.getElementById('verify-video');
    const startBtn = document.getElementById('btn-start-verify-camera');
    const verifyBtn = document.getElementById('btn-verify-face');
    if (!video) return;

    try {
        verifyStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = verifyStream;
        await video.play();
        video.classList.remove('hidden');
        if (startBtn) startBtn.classList.add('hidden');
        if (verifyBtn) verifyBtn.classList.remove('hidden');
    } catch (err) {
        console.warn('Verify camera restricted:', err);
        showToast('Camera access restricted. Use "🧪 Test Biometrics" button below to verify.', 'info');
    }
}

function stopVerifyCamera() {
    if (verifyStream) {
        verifyStream.getTracks().forEach(t => t.stop());
        verifyStream = null;
    }
    const video = document.getElementById('verify-video');
    if (video) video.classList.add('hidden');
    const startBtn = document.getElementById('btn-start-verify-camera');
    const verifyBtn = document.getElementById('btn-verify-face');
    if (startBtn) startBtn.classList.remove('hidden');
    if (verifyBtn) verifyBtn.classList.add('hidden');
}

async function doVerifyFace() {
    const video = document.getElementById('verify-video');
    const btn = document.getElementById('btn-verify-face');
    const statusEl = document.getElementById('face-verify-status');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⏳ Scanning face…';

    try {
        let descriptor = null;
        if (video && video.srcObject) {
            descriptor = await extractDescriptor(video);
        }

        if (!descriptor) {
            showToast('No face detected. Look directly at camera, or use test biometrics.', 'error');
            btn.disabled = false;
            btn.textContent = '🔍 Verify My Face';
            return;
        }

        btn.textContent = '⏳ Verifying…';
        const data = await apiRequest('/api/face/verify', 'POST', { descriptor });
        currentFaceToken = data.face_token;

        showToast('✅ Face verified! You may now start your attendance attempt.', 'success');
        if (statusEl) {
            statusEl.innerHTML = '<span class="face-status-badge enrolled">✅ Face Verified — Ready for Attendance</span>';
        }
        stopVerifyCamera();

        const startBtn = document.getElementById('btn-start-attempt');
        if (startBtn) startBtn.disabled = false;

    } catch (err) {
        showToast(err.message || 'Face verification failed.', 'error');
        if (statusEl) {
            statusEl.innerHTML = '<span class="face-status-badge not-enrolled">❌ Verification Failed — Try Again</span>';
        }
        currentFaceToken = null;
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Verify My Face';
    }
}

// Simulated Test Biometrics Verification (for environments without physical camera)
async function simulateTestVerify() {
    const statusEl = document.getElementById('face-verify-status');
    try {
        const data = await apiRequest('/api/face/verify', 'POST', { descriptor: MOCK_DESCRIPTOR });
        currentFaceToken = data.face_token;
        showToast('✅ Test face biometrics verified successfully!', 'success');
        if (statusEl) {
            statusEl.innerHTML = '<span class="face-status-badge enrolled">✅ Face Verified — Ready for Attendance</span>';
        }
        stopVerifyCamera();
        const startBtn = document.getElementById('btn-start-attempt');
        if (startBtn) startBtn.disabled = false;
    } catch (err) {
        showToast(err.message || 'Face verification failed.', 'error');
    }
}

// Public API
window.getFaceToken = function () {
    const token = currentFaceToken;
    currentFaceToken = null;
    return token;
};

window.isFaceEnrolled = function () {
    return isEnrolledState;
};

window.stopFaceStreams = function () {
    closeEnrollModal();
    stopVerifyCamera();
};

document.addEventListener('DOMContentLoaded', () => {
    const openEnrollBtn = document.getElementById('btn-open-enroll-modal');
    const closeEnrollBtn = document.getElementById('btn-close-enroll-modal');
    const captureBtn = document.getElementById('btn-capture-enroll');
    const testEnrollBtn = document.getElementById('btn-test-biometrics-enroll');

    if (openEnrollBtn) openEnrollBtn.addEventListener('click', openEnrollModal);
    if (closeEnrollBtn) closeEnrollBtn.addEventListener('click', closeEnrollModal);
    if (captureBtn) captureBtn.addEventListener('click', captureAndEnroll);
    if (testEnrollBtn) testEnrollBtn.addEventListener('click', simulateTestEnroll);

    const startVerifyBtn = document.getElementById('btn-start-verify-camera');
    const verifyBtn = document.getElementById('btn-verify-face');
    const testVerifyBtn = document.getElementById('btn-test-biometrics-verify');

    if (startVerifyBtn) startVerifyBtn.addEventListener('click', startVerifyCamera);
    if (verifyBtn) verifyBtn.addEventListener('click', doVerifyFace);
    if (testVerifyBtn) testVerifyBtn.addEventListener('click', simulateTestVerify);

    // Escape closes enrollment modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeEnrollModal();
    });
});

window.initFaceModule = async function () {
    await loadFaceModels();
    await checkFaceStatus();
};
