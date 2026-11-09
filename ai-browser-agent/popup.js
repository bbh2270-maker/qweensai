// Popup - AI Browser Agent v2

const el = {
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  keyProviderLabel: document.getElementById('keyProviderLabel'),
  task: document.getElementById('task'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  statusBadge: document.getElementById('statusBadge'),
  log: document.getElementById('log'),
  keys: {
    claude: document.getElementById('key_claude'),
    gemini: document.getElementById('key_gemini'),
    groq: document.getElementById('key_groq'),
    openrouter: document.getElementById('key_openrouter'),
  },
};

const defaultModels = {
  gemini: 'gemini-2.0-flash',
  claude: 'claude-sonnet-4-20250514',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'anthropic/claude-3.5-sonnet',
};

const providerNames = { claude: 'Claude', gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter' };

// ---- load / save settings ----
chrome.storage.local.get(['settings', 'providerKeys'], (res) => {
  const s = res.settings || {};
  const pk = res.providerKeys || {};
  if (s.provider) el.provider.value = s.provider;
  // Main key field mirrors the selected provider's saved key
  el.apiKey.value = pk[s.provider] || s.apiKey || '';
  el.model.value = s.model || defaultModels[el.provider.value];
  for (const p of Object.keys(el.keys)) {
    if (pk[p]) el.keys[p].value = pk[p];
  }
  updateKeyLabel();
});

function updateKeyLabel() {
  if (el.keyProviderLabel) el.keyProviderLabel.textContent = providerNames[el.provider.value] || el.provider.value;
}

el.provider.addEventListener('change', () => {
  el.model.value = defaultModels[el.provider.value] || '';
  // swap main key input to the saved key of the newly selected provider
  chrome.storage.local.get(['providerKeys'], (res) => {
    const pk = res.providerKeys || {};
    el.apiKey.value = pk[el.provider.value] || '';
    updateKeyLabel();
  });
});

function saveSettings() {
  // Collect every provider key so background can build the fallback chain:
  // Claude first if present, otherwise Gemini leads, then Groq, then OpenRouter.
  const providerKeys = {};
  for (const p of Object.keys(el.keys)) {
    const v = el.keys[p].value.trim();
    if (v) providerKeys[p] = v;
  }
  // The main input always belongs to the currently selected provider
  const mainKey = el.apiKey.value.trim();
  if (mainKey) providerKeys[el.provider.value] = mainKey;
  chrome.storage.local.set({
    providerKeys,
    settings: { provider: el.provider.value, apiKey: mainKey, model: el.model.value },
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
    case 'provider':
      addLog('thought', `🧠 Brain: <b>${escapeHtml(providerNames[msg.provider] || msg.provider)}</b> (${escapeHtml(msg.model)})${msg.switched ? ' — auto-switched' : ''}${(msg.fallbacks && msg.fallbacks.length) ? ` · fallbacks: ${escapeHtml(msg.fallbacks.join(', '))}` : ''}`);
      break;
    case 'provider_error':
      addLog('error', `⚠️ ${escapeHtml(providerNames[msg.provider] || msg.provider)} failed: ${escapeHtml(msg.error)}${msg.fallback ? ` → switching to ${escapeHtml(providerNames[msg.fallback] || msg.fallback)}` : ''}`);
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
  if (!task) { addLog('error', 'Please enter a task.'); return; }
  saveSettings();
  el.log.innerHTML = '';
  setStatus(true);
  // Do NOT require the single apiKey field here: background builds the
  // provider chain from all saved keys (Claude first, else Gemini, Groq, OpenRouter).
  chrome.runtime.sendMessage(
    { action: 'startAgent', task, apiConfig: { provider: el.provider.value, apiKey: el.apiKey.value.trim(), model: el.model.value.trim() } },
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
