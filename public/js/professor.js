let currentProfSession = null;
let countdownTimerInterval = null;
let currentSessionStudents = [];
let resultsPollInterval = null;

window.initProfessorDashboard = async function() {
  await loadCourses();
  await checkActiveSession();
  updateOverviewStats();
};

async function loadCourses() {
  try {
    const data = await apiRequest('/api/courses');
    const selectEl = document.getElementById('prof-course-select');
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Select a Course --</option>';

    if (!data.courses || data.courses.length === 0) {
      selectEl.innerHTML = '<option value="">-- No courses found. Click "+ Create Course" --</option>';
    } else {
      data.courses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.course_code}: ${c.name} (${c.enrolled_students_count} Enrolled)`;
        selectEl.appendChild(opt);
      });
    }

    const statCourses = document.getElementById('prof-stat-courses');
    if (statCourses) {
      statCourses.textContent = data.courses ? data.courses.length : 0;
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function checkActiveSession() {
  try {
    const data = await apiRequest('/api/attendance/session/active');
    if (data.session) {
      currentProfSession = data.session;
      renderActiveSessionCard(data.session);
    } else {
      currentProfSession = null;
      const activePanel = document.getElementById('prof-active-session-panel');
      const startPanel = document.getElementById('prof-start-session-panel');
      if (activePanel) activePanel.classList.add('hidden');
      if (startPanel) startPanel.classList.remove('hidden');
      if (countdownTimerInterval) clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
      // Stop results polling when no session
      if (resultsPollInterval) {
        clearInterval(resultsPollInterval);
        resultsPollInterval = null;
      }
    }
    updateOverviewStats();
  } catch (err) {
    console.error('Error checking active session:', err);
  }
}

function updateOverviewStats() {
  const statSession = document.getElementById('prof-stat-session');
  if (statSession) {
    if (currentProfSession) {
      statSession.textContent = 'ACTIVE';
      statSession.style.color = 'var(--accent-1)';
    } else {
      statSession.textContent = 'IDLE';
      statSession.style.color = 'var(--text-muted)';
    }
  }
}

function renderActiveSessionCard(session) {
  const startPanel = document.getElementById('prof-start-session-panel');
  const activePanel = document.getElementById('prof-active-session-panel');
  if (startPanel) startPanel.classList.add('hidden');
  if (activePanel) activePanel.classList.remove('hidden');

  const courseTitle = document.getElementById('active-course-title');
  const stageIndicator = document.getElementById('active-stage-indicator');
  const countDisplay = document.getElementById('active-attendees-count');

  if (courseTitle) courseTitle.textContent = `${session.course_code} - ${session.course_name}`;
  if (stageIndicator) stageIndicator.textContent = `Stage ${session.current_stage} of 3`;
  if (countDisplay) countDisplay.textContent = session.completed_count || 0;

  updateNextStageButtons(session.current_stage);
  // Use per-stage expiry if available, else fall back to session expiry
  startSessionCountdown(session.qr_stage_expires_at || session.expiry_time, session.current_stage);
  loadSessionResults(session.id);
  startResultsPolling(session.id);
  updateOverviewStats();
}

function updateNextStageButtons(currentStage) {
  const btnNext = document.getElementById('btn-next-stage');
  const btnProjNext = document.getElementById('btn-proj-next-stage');
  const isFinal = currentStage >= 3;

  [btnNext, btnProjNext].forEach(btn => {
    if (!btn) return;
    if (isFinal) {
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.textContent = '✅ Final Stage Reached';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.classList.remove('disabled');
      btn.textContent = `➡️ Advance to Stage ${currentStage + 1}`;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  });
}

function startSessionCountdown(qrStageExpiresAt, currentStage, totalStages = 3) {
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  countdownTimerInterval = null;
  let expiredMessageShown = false; // guard against repeated messages

  function update() {
    const remaining = Math.max(0, Math.floor((new Date(qrStageExpiresAt) - new Date()) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const projTimer = document.getElementById('projector-timer-display');
    if (projTimer) projTimer.textContent = `Time Remaining: ${formatted}`;
    const activeTimer = document.getElementById('active-session-timer');
    if (activeTimer) activeTimer.textContent = formatted;

    if (remaining <= 0) {
      clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
      if (!expiredMessageShown) {
        expiredMessageShown = true;
        if (currentStage < totalStages) {
          showToast('QR code expired. Activating the next QR...', 'info');
        } else {
          showToast('Attendance session completed', 'info');
        }
        // Do NOT call checkActiveSession() here — wait for socket events
      }
    }
  }
  update();
  countdownTimerInterval = setInterval(update, 1000);
}

function startResultsPolling(sessionId) {
  if (resultsPollInterval) clearInterval(resultsPollInterval);
  resultsPollInterval = setInterval(() => {
    if (!currentProfSession) {
      clearInterval(resultsPollInterval);
      resultsPollInterval = null;
      return;
    }
    loadSessionResults(sessionId);
  }, 5000);
}

async function loadSessionResults(sessionId) {
  try {
    const data = await apiRequest(`/api/attendance/session/results/${sessionId}`);
    currentSessionStudents = data.students || [];
    renderFilteredAttendees();

    const presentCount = currentSessionStudents.filter(s => s.attendance_status === 'PRESENT').length;
    const countDisplay = document.getElementById('active-attendees-count');
    if (countDisplay) countDisplay.textContent = presentCount;

    const statAttendees = document.getElementById('prof-stat-attendees');
    if (statAttendees) {
      statAttendees.textContent = `${presentCount} / ${currentSessionStudents.length}`;
    }

    const projAttendees = document.getElementById('projector-attendees-count');
    if (projAttendees) projAttendees.textContent = presentCount;

  } catch (err) {
    console.error('loadSessionResults error:', err);
  }
}

function renderFilteredAttendees() {
  const searchInput = document.getElementById('prof-search-input');
  const statusFilter = document.getElementById('prof-status-filter');
  const tableBody = document.getElementById('attendees-table-body');
  if (!tableBody) return;

  const searchTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const filterVal = statusFilter ? statusFilter.value : 'ALL';

  const filtered = currentSessionStudents.filter(s => {
    const matchesSearch = !searchTerm ||
      (s.name && s.name.toLowerCase().includes(searchTerm)) ||
      (s.email && s.email.toLowerCase().includes(searchTerm));
    const matchesStatus = filterVal === 'ALL' || s.attendance_status === filterVal;
    return matchesSearch && matchesStatus;
  });

  tableBody.innerHTML = '';

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          No student records found matching current filters.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((s, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${s.name}</strong></td>
      <td>${s.email}</td>
      <td>
        <span class="status-tag ${s.attendance_status === 'PRESENT' ? 'present' : 'absent'}">
          ${s.attendance_status}
        </span>
      </td>
      <td>${s.marked_at ? new Date(s.marked_at).toLocaleTimeString() : '-'}</td>
    `;
    tableBody.appendChild(tr);
  });
}

// Projector View Display Toggle
function openProjectorMode() {
  if (!currentProfSession) {
    showToast('No active session. Please start a session first.', 'warning');
    return;
  }
  const projModal = document.getElementById('projector-modal');
  if (projModal) {
    projModal.classList.remove('hidden');
    updateProjectorDisplay();
  }
}

function updateProjectorDisplay() {
  if (!currentProfSession) return;
  const courseCodeEl = document.getElementById('projector-course-code');
  const stageTitleEl = document.getElementById('projector-stage-title');
  const qrImgEl = document.getElementById('projector-qr-img');
  const attendeesCountEl = document.getElementById('projector-attendees-count');

  if (courseCodeEl) courseCodeEl.textContent = currentProfSession.course_code || 'SDTT101';
  if (stageTitleEl) stageTitleEl.textContent = `STAGE ${currentProfSession.current_stage || 1} OF 3`;

  if (qrImgEl && currentProfSession.qr && currentProfSession.qr.qrDataUrl) {
    qrImgEl.src = currentProfSession.qr.qrDataUrl;
    qrImgEl.style.display = 'block';
  }

  if (attendeesCountEl) {
    attendeesCountEl.textContent = currentProfSession.completed_count || 0;
  }
}

function closeProjectorMode() {
  const projModal = document.getElementById('projector-modal');
  if (projModal) projModal.classList.add('hidden');
}

// Export Attendance CSV (Real Download)
async function exportAttendanceCSV() {
  if (!currentProfSession) {
    showToast('No active session available to export.', 'warning');
    return;
  }
  try {
    const data = await apiRequest(`/api/attendance/session/results/${currentProfSession.id}`);
    const students = data.students || [];

    if (students.length === 0) {
      showToast('No student records found to export.', 'warning');
      return;
    }

    const csvRows = [
      ['Index', 'Student Name', 'Email', 'Attendance Status', 'Marked At Time']
    ];

    students.forEach((s, i) => {
      csvRows.push([
        i + 1,
        `"${(s.name || '').replace(/"/g, '""')}"`,
        `"${(s.email || '').replace(/"/g, '""')}"`,
        `"${s.attendance_status || 'ABSENT'}"`,
        `"${s.marked_at ? new Date(s.marked_at).toLocaleString() : 'N/A'}"`
      ]);
    });

    const csvContent = csvRows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentProfSession.course_code}_Attendance_Session_${currentProfSession.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('✅ Attendance report exported successfully!', 'success');
  } catch (err) {
    showToast('CSV Export failed: ' + err.message, 'error');
  }
}

// Course Creation Modal Lifecycle
function openCourseModal() {
  const modal = document.getElementById('course-create-modal');
  if (modal) {
    modal.classList.remove('hidden');
    const codeInput = document.getElementById('new-course-code');
    if (codeInput) codeInput.focus();
  }
}

function closeCourseModal() {
  const modal = document.getElementById('course-create-modal');
  if (modal) {
    modal.classList.add('hidden');
    const form = document.getElementById('course-create-form');
    if (form) form.reset();
  }
}

// Global WebSocket Callbacks for Professor
window.onAttendanceRecorded = function(data) {
  if (currentProfSession && data.session_id === currentProfSession.id) {
    showToast(`🎯 Student ${data.student_name} marked present!`, 'success');
    loadSessionResults(currentProfSession.id);
  }
};

window.onAttendanceUpdated = function(data) {
  if (currentProfSession && data.session_id === currentProfSession.id) {
    loadSessionResults(currentProfSession.id);
  }
};

window.onStageChanged = function(data) {
  if (currentProfSession && data.id === currentProfSession.id) {
    currentProfSession.current_stage = data.current_stage;
    currentProfSession.qr = data.qr;
    currentProfSession.qr_stage_expires_at = data.qr_stage_expires_at;

    const stageIndicator = document.getElementById('active-stage-indicator');
    if (stageIndicator) stageIndicator.textContent = `Stage ${data.current_stage} of 3`;
    updateNextStageButtons(data.current_stage);
    updateProjectorDisplay();
    showToast(`QR ${data.current_stage} of 3 active`, 'info');

    // Restart countdown for new stage
    startSessionCountdown(data.qr_stage_expires_at, data.current_stage);
  }
};

window.onSessionEnded = function(data) {
  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  countdownTimerInterval = null;
  if (resultsPollInterval) clearInterval(resultsPollInterval);
  resultsPollInterval = null;
  showToast('Attendance session completed', 'info');
  currentProfSession = null;
  closeProjectorMode();
  checkActiveSession();
  updateOverviewStats();
};

// Event Attachments
document.addEventListener('DOMContentLoaded', () => {
  // Start Session Button
  const btnStartSession = document.getElementById('btn-start-session');
  if (btnStartSession) {
    btnStartSession.addEventListener('click', async () => {
      const courseId = document.getElementById('prof-course-select')?.value;
      const timeout = document.getElementById('prof-timeout-select')?.value;

      if (!courseId) {
        showToast('Please select a course first.', 'warning');
        return;
      }

      btnStartSession.disabled = true;
      btnStartSession.textContent = 'Starting...';

      try {
        const data = await apiRequest('/api/attendance/session/start', 'POST', {
          course_id: Number(courseId),
          timeout_seconds: Number(timeout)
        });
        currentProfSession = data.session; // already has qr_stage_expires_at from backend
        renderActiveSessionCard(data.session);
        showToast('Attendance session started', 'success');
        showToast('QR 1 of 3 active', 'info');
        openProjectorMode();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnStartSession.disabled = false;
        btnStartSession.textContent = '🚀 Start Session';
      }
    });
  }

  // Next Stage Handlers
  const advanceHandler = async () => {
    if (!currentProfSession) return;
    if (currentProfSession.current_stage >= 3) {
      showToast('Already at final Stage 3.', 'warning');
      return;
    }

    try {
      const nextStage = currentProfSession.current_stage + 1;
      const data = await apiRequest('/api/attendance/session/advance', 'POST', {
        session_id: currentProfSession.id,
        target_stage: nextStage
      });
      currentProfSession = data.session;
      currentProfSession.qr_stage_expires_at = data.session.qr_stage_expires_at;
      updateNextStageButtons(currentProfSession.current_stage);
      updateProjectorDisplay();
      startSessionCountdown(data.session.qr_stage_expires_at, data.session.current_stage);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnNextStage = document.getElementById('btn-next-stage');
  const btnProjNextStage = document.getElementById('btn-proj-next-stage');
  if (btnNextStage) btnNextStage.addEventListener('click', advanceHandler);
  if (btnProjNextStage) btnProjNextStage.addEventListener('click', advanceHandler);

  // End Session Handlers
  const endHandler = async () => {
    if (!currentProfSession) return;
    if (!confirm('Are you sure you want to end this attendance session?')) return;

    try {
      await apiRequest('/api/attendance/session/end', 'POST', {
        session_id: currentProfSession.id
      });
      showToast('Attendance session cancelled', 'info');
      if (countdownTimerInterval) clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
      if (resultsPollInterval) clearInterval(resultsPollInterval);
      resultsPollInterval = null;
      currentProfSession = null;
      closeProjectorMode();
      checkActiveSession();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const btnEndSession = document.getElementById('btn-end-session');
  const btnProjEndSession = document.getElementById('btn-proj-end-session');
  if (btnEndSession) btnEndSession.addEventListener('click', endHandler);
  if (btnProjEndSession) btnProjEndSession.addEventListener('click', endHandler);

  // Projector Toggles
  const btnOpenProjector = document.getElementById('btn-open-projector');
  const btnCloseProjector = document.getElementById('btn-close-projector');
  const btnNavProjector = document.getElementById('btn-nav-projector');

  if (btnOpenProjector) btnOpenProjector.addEventListener('click', openProjectorMode);
  if (btnCloseProjector) btnCloseProjector.addEventListener('click', closeProjectorMode);
  if (btnNavProjector) btnNavProjector.addEventListener('click', openProjectorMode);

  // Export CSV Handler
  const btnExport = document.getElementById('btn-export-csv');
  if (btnExport) btnExport.addEventListener('click', exportAttendanceCSV);

  // Course Creation Modal Triggers
  const btnCreateCourse = document.getElementById('btn-create-course');
  const btnCloseCourseModal = document.getElementById('btn-close-course-modal');
  const btnCancelCourseModal = document.getElementById('btn-cancel-course-modal');
  const courseCreateForm = document.getElementById('course-create-form');

  if (btnCreateCourse) btnCreateCourse.addEventListener('click', openCourseModal);
  if (btnCloseCourseModal) btnCloseCourseModal.addEventListener('click', closeCourseModal);
  if (btnCancelCourseModal) btnCancelCourseModal.addEventListener('click', closeCourseModal);

  if (courseCreateForm) {
    courseCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('new-course-code')?.value.trim();
      const name = document.getElementById('new-course-name')?.value.trim();

      if (!code || !name) {
        showToast('Please enter both course code and name.', 'warning');
        return;
      }

      const submitBtn = document.getElementById('btn-submit-course');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
      }

      try {
        await apiRequest('/api/courses/create', 'POST', { course_code: code, name });
        showToast(`Course ${code} created successfully!`, 'success');
        closeCourseModal();
        await loadCourses();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Course';
        }
      }
    });
  }

  // Attendee Search and Status Filter Listeners
  const searchInput = document.getElementById('prof-search-input');
  const statusFilter = document.getElementById('prof-status-filter');

  if (searchInput) searchInput.addEventListener('input', renderFilteredAttendees);
  if (statusFilter) statusFilter.addEventListener('change', renderFilteredAttendees);

  // Keyboard shortcut: Escape closes projector or course modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProjectorMode();
      closeCourseModal();
    }
  });
});
