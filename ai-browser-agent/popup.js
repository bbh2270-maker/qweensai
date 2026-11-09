// Popup - AI Browser Agent v3
// Renders the agent-thinking stream as an activity timeline, and exposes
// Stop / Pause-Resume controls plus Human Approval prompts.

const el = {
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  task: document.getElementById('task'),
  startBtn: document.getElementById('startBtn'),
  controlRow: document.getElementById('controlRow'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusBadge: document.getElementById('statusBadge'),
  log: document.getElementById('log'),
};

let agentRunning = false;
let agentPaused = false;

const defaultModels = {
  gemini: 'gemini-2.0-flash',
  claude: 'claude-sonnet-4-20250514',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'anthropic/claude-3.5-sonnet',
};

// ---- load / save settings ----
chrome.storage.local.get(['settings'], (res) => {
  const s = res.settings || {};
  if (s.provider) el.provider.value = s.provider;
  if (s.apiKey) el.apiKey.value = s.apiKey;
  el.model.value = s.model || defaultModels[el.provider.value];
});

el.provider.addEventListener('change', () => {
  el.model.value = defaultModels[el.provider.value] || '';
});

function saveSettings() {
  chrome.storage.local.set({
    settings: { provider: el.provider.value, apiKey: el.apiKey.value, model: el.model.value },
  });
}

// ---- logging helpers ----
function addLog(cls, html) {
  const div = document.createElement('div');
  div.className = 'entry ' + cls;
  div.innerHTML = html;
  el.log.appendChild(div);
  el.log.scrollTop = el.log.scrollHeight;
}

function setStatus(running, paused = false) {
  agentRunning = running;
  agentPaused = paused;
  el.statusBadge.textContent = running ? (paused ? 'paused' : 'running') : 'idle';
  el.statusBadge.classList.toggle('running', running && !paused);
  el.startBtn.style.display = running ? 'none' : 'block';
  el.controlRow.style.display = running ? 'flex' : 'none';
  if (running) el.pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

// ---- events from background ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'event') return;
  switch (msg.type) {
    case 'started':
      setStatus(true);
      addLog('thought', `🚀 Started task: <b>${escapeHtml(msg.task)}</b>`);
      break;
    case 'step':
      if (msg.thought) addLog('thought', `💭 ${escapeHtml(msg.thought)}`);
      addLog('action', `🎯 <b>${escapeHtml(msg.action?.intent || '?')}</b> ${escapeHtml(JSON.stringify(msg.action || {})).slice(0, 120)}`);
      break;
    case 'action_result':
      addLog('', `✅ Step ${msg.step}: ${escapeHtml(String(msg.result?.detail || msg.result?.data || '')) .slice(0, 200)}`);
      break;
    case 'approval_request':
      // Human Approval: pause the loop in background until user answers
      renderApprovalPrompt(msg);
      break;
    case 'approval_result':
      addLog('', `${msg.approved ? '👍' : '👎'} Step ${msg.step} ${msg.approved ? 'approved' : 'rejected'}${msg.note ? ': ' + escapeHtml(msg.note) : ''}`);
      break;
    case 'paused':
      setStatus(true, true);
      addLog('thought', '⏸ Paused by user.');
      break;
    case 'resumed':
      setStatus(true, false);
      addLog('thought', '▶ Resumed.');
      break;
    case 'answer':
      addLog('answer', `🏁 <b>Final answer:</b><br>${escapeHtml(msg.answer)}`);
      setStatus(false);
      break;
    case 'error':
      addLog('error', `⚠️ ${escapeHtml(msg.message)}`);
      setStatus(false);
      break;
    case 'stopped':
    case 'finished':
      setStatus(false);
      break;
  }
});

// Build an inline Approve / Reject bar for a pending human-approval request
function renderApprovalPrompt(info) {
  const div = document.createElement('div');
  div.className = 'entry action';
  div.innerHTML =
    `⚠️ <b>Approval needed</b> (step ${info.step}): ${escapeHtml(info.actionDesc || '')}` +
    `<div class="row" style="margin-top:6px">` +
    `<button class="primary" style="margin:0;background:#1f7a35" id="apYes">✔ Approve</button>` +
    `<button class="danger" style="margin:0" id="apNo">✘ Reject</button>` +
    `</div>`;
  el.log.appendChild(div);
  el.log.scrollTop = el.log.scrollHeight;
  div.querySelector('#apYes').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'approval', approved: true });
    div.remove();
  });
  div.querySelector('#apNo').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'approval', approved: false });
    div.remove();
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- restore current state when reopening popup ----
chrome.runtime.sendMessage({ action: 'getState' }, (st) => {
  if (!st || st.error) return;
  if (st.isRunning) {
    setStatus(true, !!st.paused);
    addLog('thought', `Agent is running task: <b>${escapeHtml(st.task)}</b>`);
    (st.history || []).forEach(h => {
      addLog('action', `#${h.step} <b>${escapeHtml(h.intent)}</b> → ${escapeHtml(h.result)}`);
    });
    // Re-attach a pending approval prompt if the loop is waiting on the user
    if (st.approvalPending) renderApprovalPrompt(st.approvalPending);
  }
});

// ---- buttons ----
el.startBtn.addEventListener('click', () => {
  const task = el.task.value.trim();
  const apiKey = el.apiKey.value.trim();
  if (!task) { addLog('error', 'Please enter a task.'); return; }
  if (!apiKey) { addLog('error', 'Please enter an API key.'); return; }
  saveSettings();
  el.log.innerHTML = '';
  setStatus(true);
  chrome.runtime.sendMessage(
    { action: 'startAgent', task, apiConfig: { provider: el.provider.value, apiKey, model: el.model.value.trim() } },
    (res) => {
      if (res && res.ok === false) {
        addLog('error', escapeHtml(res.error));
        setStatus(false);
      }
    }
  );
});

// Stop / Resume toggle: pause the loop at the next step boundary, resume on demand
el.pauseBtn.addEventListener('click', () => {
  if (agentPaused) {
    chrome.runtime.sendMessage({ action: 'resumeAgent' });
  } else {
    chrome.runtime.sendMessage({ action: 'pauseAgent' });
  }
});

el.stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopAgent' });
  setStatus(false);
  addLog('error', '⏹ Stopped by user.');
});
