// Application State & Helper Utilities
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user')) || null,
  socket: null,
  activeSession: null
};

// API Client Helper
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const config = {
    method,
    headers
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(endpoint, config);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'API Request Failed');
    }
    return data;
  } catch (error) {
    throw error;
  }
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize Socket.io Connection
function initSocket() {
  if (state.socket) return;
  state.socket = io();

  state.socket.on('connect', () => {
    console.log('[WebSocket] Real-time session link established.');
  });

  state.socket.on('session_updated', (data) => {
    if (window.onSessionUpdated) window.onSessionUpdated(data);
  });

  state.socket.on('stage_changed', (data) => {
    if (window.onStageChanged) window.onStageChanged(data);
  });

  state.socket.on('session_ended', (data) => {
    if (window.onSessionEnded) window.onSessionEnded(data);
  });

  state.socket.on('attendance_recorded', (data) => {
    if (window.onAttendanceRecorded) window.onAttendanceRecorded(data);
  });

  state.socket.on('attendance_updated', (data) => {
    if (window.onAttendanceUpdated) window.onAttendanceUpdated(data);
  });
}

// Auth State Handlers
function setAuthState(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  updateUI();
  initSocket();
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  // Stop any active camera streams
  if (typeof window.stopFaceStreams === 'function') {
    window.stopFaceStreams();
  }
  if (typeof window.stopStudentCameraScanner === 'function') {
    window.stopStudentCameraScanner();
  }

  updateUI();
  showToast('Logged out successfully.', 'info');
}

// Tab Switcher for Auth View
window.switchAuthTab = function(tabName) {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authCard = document.getElementById('auth-view');

  if (tabName === 'login') {
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
    if (loginForm) loginForm.classList.remove('hidden');
    if (registerForm) registerForm.classList.add('hidden');
  } else {
    if (tabRegister) tabRegister.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    if (registerForm) registerForm.classList.remove('hidden');
    if (loginForm) loginForm.classList.add('hidden');
  }

  if (authCard) {
    authCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

// 1-Click Quick Demo Login Helper
window.quickLogin = async function(email, password) {
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  if (emailInput) emailInput.value = email;
  if (passwordInput) passwordInput.value = password;

  window.switchAuthTab('login');

  try {
    const data = await apiRequest('/api/auth/login', 'POST', { email, password });
    setAuthState(data.token, data.user);
    showToast(`Logged in as ${data.user.name} (${data.user.role})`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Global UI View & Navigation Switcher
function updateUI() {
  const authView = document.getElementById('auth-view');
  const profView = document.getElementById('professor-view');
  const studentView = document.getElementById('student-view');

  const navGuest = document.getElementById('nav-guest-links');
  const navProf = document.getElementById('nav-prof-links');
  const navStudent = document.getElementById('nav-student-links');

  const userInfoNav = document.getElementById('user-info-nav');
  const userNameEl = document.getElementById('user-name-display');
  const userRoleEl = document.getElementById('user-role-display');

  if (!state.token || !state.user) {
    if (authView) authView.classList.remove('hidden');
    if (profView) profView.classList.add('hidden');
    if (studentView) studentView.classList.add('hidden');

    if (navGuest) navGuest.classList.remove('hidden');
    if (navProf) navProf.classList.add('hidden');
    if (navStudent) navStudent.classList.add('hidden');
    if (userInfoNav) userInfoNav.classList.add('hidden');
    return;
  }

  if (userInfoNav) userInfoNav.classList.remove('hidden');
  if (userNameEl) userNameEl.textContent = state.user.name;
  if (userRoleEl) {
    userRoleEl.textContent = state.user.role;
    userRoleEl.className = `user-role-badge ${state.user.role.toLowerCase()}`;
  }

  if (authView) authView.classList.add('hidden');
  if (navGuest) navGuest.classList.add('hidden');

  if (state.user.role === 'PROFESSOR') {
    if (profView) profView.classList.remove('hidden');
    if (studentView) studentView.classList.add('hidden');
    if (navProf) navProf.classList.remove('hidden');
    if (navStudent) navStudent.classList.add('hidden');
    if (window.initProfessorDashboard) window.initProfessorDashboard();
  } else {
    if (studentView) studentView.classList.remove('hidden');
    if (profView) profView.classList.add('hidden');
    if (navStudent) navStudent.classList.remove('hidden');
    if (navProf) navProf.classList.add('hidden');
    if (window.initStudentDashboard) window.initStudentDashboard();
  }
}

// Event Listeners on Load
document.addEventListener('DOMContentLoaded', () => {
  if (state.token) {
    initSocket();
  }
  updateUI();

  // Auth Form Switches
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (tabLogin) tabLogin.addEventListener('click', () => window.switchAuthTab('login'));
  if (tabRegister) tabRegister.addEventListener('click', () => window.switchAuthTab('register'));

  // Login Submit
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email')?.value.trim();
      const password = document.getElementById('login-password')?.value;

      if (!email || !password) {
        showToast('Please enter both email and password.', 'warning');
        return;
      }

      const submitBtn = loginForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Authenticating...';
      }

      try {
        const data = await apiRequest('/api/auth/login', 'POST', { email, password });
        setAuthState(data.token, data.user);
        showToast(`Welcome back, ${data.user.name}!`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Authenticate Access →';
        }
      }
    });
  }

  // Register Submit
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name')?.value.trim();
      const email = document.getElementById('reg-email')?.value.trim();
      const password = document.getElementById('reg-password')?.value;
      const role = document.getElementById('reg-role')?.value;

      if (!name || !email || !password || !role) {
        showToast('Please fill out all registration fields.', 'warning');
        return;
      }

      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Account...';
      }

      try {
        const data = await apiRequest('/api/auth/register', 'POST', { name, email, password, role });
        setAuthState(data.token, data.user);
        showToast('Registration successful! Account created.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Account →';
        }
      }
    });
  }

  // Logout Click
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', logout);
  }
});
