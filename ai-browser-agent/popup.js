// Popup - AI Browser Agent v2

const el = {
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  task: document.getElementById('task'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusBadge: document.getElementById('statusBadge'),
  log: document.getElementById('log'),
};

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

function setStatus(running) {
  el.statusBadge.textContent = running ? 'running' : 'idle';
  el.statusBadge.classList.toggle('running', running);
  el.startBtn.style.display = running ? 'none' : 'block';
  el.stopBtn.style.display = running ? 'block' : 'none';
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- restore current state when reopening popup ----
chrome.runtime.sendMessage({ action: 'getState' }, (st) => {
  if (!st || st.error) return;
  if (st.isRunning) {
    setStatus(true);
    addLog('thought', `Agent is running task: <b>${escapeHtml(st.task)}</b>`);
    (st.history || []).forEach(h => {
      addLog('action', `#${h.step} <b>${escapeHtml(h.intent)}</b> → ${escapeHtml(h.result)}`);
    });
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

el.stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopAgent' });
  setStatus(false);
  addLog('error', '⏹ Stopped by user.');
});
