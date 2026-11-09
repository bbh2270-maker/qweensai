// Background Service Worker - AI Browser Agent (v3)
// Claude-for-Chrome / browser-use style loop:
//   observe page -> LLM decides next action -> human approval (optional) -> execute -> repeat
// v3 features: CDP visual control + real mouse movement, accessibility-tree snapshots,
// smart element finding, multi-tab control, form automation, drag & drop, browser
// navigation, agent-thinking log, activity timeline, stop/resume, auto tab grouping.

const state = {
  isRunning: false,
  paused: false,        // resume via Start button
  awaitingApproval: null, // pending approval request object
  task: null,
  tabId: null,
  groupId: null,
  apiConfig: null,
  history: [],          // [{ step, thought, action, result }]
  maxSteps: 25,
};

const BLOCKED_HOSTS = ['chrome.google.com', 'chromewebstore.google.com', 'chrome://', 'edge://', 'about:'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === 'startAgent') {
        await startAgent(request.task, request.apiConfig);
        sendResponse({ ok: true });
      } else if (request.action === 'stopAgent') {
        stopAgent();
        sendResponse({ ok: true });
      } else if (request.action === 'resumeAgent') {
        state.paused = false;
        notify('resumed', {});
        sendResponse({ ok: true });
      } else if (request.action === 'approval') {
        // popup answered a pending human-approval request
        const pending = state.awaitingApproval;
        state.awaitingApproval = null;
        if (pending) pending.resolve({ approved: !!request.approved, note: request.note || '' });
        sendResponse({ ok: true });
      } else if (request.action === 'getState') {
        sendResponse({
          isRunning: state.isRunning, paused: state.paused, task: state.task,
          approvalPending: state.awaitingApproval ? state.awaitingApproval.info : null,
          history: state.history.slice(-40),
        });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async
});

// Broadcast progress so popup can render live log
function notify(type, payload = {}) {
  chrome.runtime.sendMessage({ action: 'event', type, ...payload }).catch(() => {});
}

// ---- Provider registry & fallback chain ----
// Priority: claude > gemini > groq > openrouter.
// The agent automatically uses the FIRST provider that has a saved API key.
// So if Claude is not configured, Gemini becomes the main driver (then Groq, then OpenRouter).
const PROVIDER_DEFAULT_MODEL = {
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'anthropic/claude-3.5-sonnet',
};
const PROVIDER_PRIORITY = ['claude', 'gemini', 'groq', 'openrouter'];

// Build the list of usable providers from all saved keys, in priority order.
async function resolveProviderChain(cfg) {
  const stored = await chrome.storage.local.get(['providerKeys']);
  const keys = stored.providerKeys || {};
  const chain = [];
  const seen = new Set();
  // Explicitly chosen provider always goes first
  if (cfg?.provider && cfg?.apiKey && PROVIDER_PRIORITY.includes(cfg.provider)) {
    chain.push({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model || PROVIDER_DEFAULT_MODEL[cfg.provider] });
    seen.add(cfg.provider);
  }
  for (const p of PROVIDER_PRIORITY) {
    if (seen.has(p)) continue;
    if (keys[p]) {
      chain.push({ provider: p, apiKey: keys[p], model: PROVIDER_DEFAULT_MODEL[p] });
      seen.add(p);
    }
  }
  return chain;
}

async function startAgent(task, apiConfig) {
  if (!task) throw new Error('Task is required');
  const chain = await resolveProviderChain(apiConfig || {});
  if (!chain.length) throw new Error('No API key found — add at least one provider key (Claude / Gemini / Groq / OpenRouter) in Settings.');
  stopAgentState();
  state.isRunning = true;
  state.paused = false;
  state.task = task;
  state.apiConfig = apiConfig || {};
  state.providerChain = chain;
  state.providerIndex = 0;
  state.apiConfig.provider = chain[0].provider;
  state.apiConfig.apiKey = chain[0].apiKey;
  state.apiConfig.model = chain[0].model;
  state.history = [];
  notify('provider', { provider: chain[0].provider, model: chain[0].model, fallbacks: chain.slice(1).map(c => c.provider) });

  const tab = await chrome.tabs.create({ url: 'https://www.google.com', active: true });
  state.tabId = tab.id;

  // Automatic tab grouping: all agent tabs live in one visible group
  try {
    state.groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(state.groupId, {
      title: '\uD83E\uDD16 AI Agent', color: 'orange', collapsed: false,
    });
  } catch (e) { /* grouping unsupported -> ignore */ }

  notify('started', { task, tabId: tab.id });

  runLoop().catch(err => {
    notify('error', { message: String(err.message || err) });
  }).finally(() => {
    state.isRunning = false;
    state.paused = false;
    resolvePendingApproval({ approved: false, note: 'agent stopped' });
    notify('finished', {});
  });
}

function stopAgent() {
  state.isRunning = false;
  state.paused = false;
  resolvePendingApproval({ approved: false, note: 'agent stopped' });
  notify('stopped', {});
}
function stopAgentState() {
  state.isRunning = false;
  state.paused = false;
  state.history = [];
}

function resolvePendingApproval(answer) {
  if (state.awaitingApproval) {
    const p = state.awaitingApproval;
    state.awaitingApproval = null;
    p.resolve(answer);
  }
}

// Ask the user to approve a risky action (Human Approval feature).
function requestApproval(info) {
  return new Promise((resolve) => {
    state.awaitingApproval = { info, resolve };
    notify('approval_request', info);
  });
}

async function pauseGate() {
  // loop keeps calling this while paused; Stop breaks it via isRunning=false
  while (state.paused && state.isRunning) await sleep(400);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isBlockedUrl(url = '') {
  return BLOCKED_HOSTS.some(b => url.startsWith(b) || url.includes(b + '/'));
}

// Ensure content script + page_agent are available in the tab
async function ensureInjected(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__AI_PAGE_AGENT__ !== 'undefined',
    });
    if (res?.[0]?.result) return;
  } catch (e) { /* not injected yet */ }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['page_agent.js'] });
}

async function getSnapshot(tabId) {
  await ensureInjected(tabId);
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__AI_PAGE_AGENT__.getPageSnapshot(14000),
  });
  let snap = res?.[0]?.result || 'NO SNAPSHOT';

  // Multi-tab awareness: append the open-tabs list so the LLM can switch/close tabs
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const list = tabs
      .filter(t => !t.url.startsWith('chrome://newtab') || tabs.length < 3)
      .map((t, i) => `[${i}] ${String(t.title || t.url || '').slice(0, 60)} (${String(t.url || '').slice(0, 70)})`)
      .join('\n');
    snap += `\n--- Open tabs (use switch_tab / close_tab with tab_index) ---\n${list}`;
  } catch (e) { /* ignore */ }
  return snap;
}

async function execAction(tabId, action) {
  await ensureInjected(tabId);
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (a) => {
      try { return await window.__AI_PAGE_AGENT__.executeAction(a); }
      catch (e) { return { ok: false, detail: String(e.message || e) }; }
    },
    args: [action],
  });
  return res?.[0]?.result || { ok: false, detail: 'execution failed' };
}

async function waitTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === 'complete') return true;
    await sleep(400);
  }
  return true;
}

// ================= CDP: Visual control + real mouse movement =================
// Uses the Chrome DevTools Protocol (debugger permission) for:
//  - Page.captureScreenshot (visual browser control / agent "eyes")
//  - Input.dispatchMouseEvent with interpolated moves (real human-like cursor path)

const cdpAttached = new Set();

async function cdpSend(tabId, method, params = {}) {
  if (!cdpAttached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    cdpAttached.add(tabId);
    chrome.debugger.onDetach.addListener((d) => {
      if (d.tabId === tabId) cdpAttached.delete(tabId);
    });
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function captureScreenshot(tabId) {
  try {
    const shot = await cdpSend(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 60 });
    return shot.data; // base64
  } catch (e) {
    return null;
  }
}

// Real mouse movement: interpolate from previous cursor position to target,
// dispatching mouseMoved events along a smooth path, then click at destination.
let lastCursor = { x: 80, y: 80 };
async function realMouseMoveAndClick(tabId, x, y, button = 'left') {
  const steps = 12;
  const dx = (x - lastCursor.x) / steps, dy = (y - lastCursor.y) / steps;
  for (let i = 1; i <= steps; i++) {
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: lastCursor.x + dx * i, y: lastCursor.y + dy * i,
    }).catch(() => {});
    await sleep(16);
  }
  lastCursor = { x, y };
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
}

async function realMouseDrag(tabId, from, to) {
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  const steps = 15;
  const dx = (to.x - from.x) / steps, dy = (to.y - from.y) / steps;
  for (let i = 1; i <= steps; i++) {
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + dx * i, y: from.y + dy * i, buttons: 1 });
    await sleep(20);
  }
  await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
}

async function realKeyPress(tabId, key) {
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: key === 'Enter' ? '\r' : key });
  await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', text: key === 'Enter' ? '\r' : key });
}

// Get on-screen coordinates of an indexed element (for CDP mouse ops)
async function getElementBox(tabId, index) {
  await ensureInjected(tabId);
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: (i) => window.__AI_PAGE_AGENT__.getBox(i),
    args: [index],
  });
  return res?.[0]?.result || null;
}

// ---- The agent loop ----
async function runLoop() {
  // v4: task decomposition. Complex tasks are broken into subtasks; independent
  // read-only subtasks run in PARALLEL across multiple tabs simultaneously.
  const plan = await buildPlan(state.task);
  const parallelizable = plan.parallel.length >= 2 && state.apiConfig.parallel !== false;

  if (!parallelizable) {
    await sequentialLoop(plan.instructions);
    return;
  }

  notify('plan', {
    summary: `Task split into ${plan.subtasks.length} subtasks — ${plan.parallel.length} running in parallel tabs, ${plan.serial.length} sequential.`,
    subtasks: plan.subtasks.map(s => s.instruction),
  });

  // ---- Phase 1: parallel fan-out (independent research/read subtasks) ----
  const workers = plan.parallel.map((st, i) => spawnWorker(st, i));
  let results = await Promise.allSettled(workers);

  // ---- Phase 2: merge findings + finish remaining serial steps ----
  const findings = results.map((r, i) => ({
    subtask: plan.parallel[i].instruction,
    outcome: r.status === 'fulfilled' ? r.value : ('FAILED: ' + String(r.reason?.message || r.reason)),
  }));
  state.findings = findings;

  for (const st of plan.serial) {
    if (!state.isRunning) break;
    await sequentialLoop(st.instruction);
  }

  if (!state.isRunning) return;
  const finalAnswer = await synthesizeFinal(plan.task, findings);
  notify('answer', { answer: finalAnswer });
}

// Run one worker subtask in its own tab, concurrently with other workers.
async function spawnWorker(subtask, index) {
  const t = await chrome.tabs.create({ url: 'https://www.google.com', active: false });
  if (state.groupId != null) { try { await chrome.tabs.group({ tabIds: [t.id], groupId: state.groupId }); } catch (e) {} }
  const w = {
    id: 'w' + index + '-' + Date.now(),
    instruction: subtask.instruction,
    goal: state.task,           // keep the overall goal visible to the model
    tabId: t.id,
    history: [],
    stepsLeft: Math.min(10, state.maxSteps),
  };
  notify('worker_start', { worker: w.id, instruction: w.instruction, tabId: t.id });
  try {
    const outcome = await runWorker(w);
    notify('worker_done', { worker: w.id, outcome: String(outcome).slice(0, 300) });
    return outcome;
  } finally {
    // free resources; close the worker tab unless it's the main tab
    if (w.tabId !== state.tabId) chrome.tabs.remove(w.tabId).catch(() => {});
  }
}

async function runWorker(w) {
  while (w.stepsLeft > 0 && state.isRunning) {
    await pauseGate();
    if (!state.isRunning) break;
    w.stepsLeft--;

    const tab = await chrome.tabs.get(w.tabId).catch(() => null);
    if (!tab) throw new Error('worker tab was closed');
    if (isBlockedUrl(tab.url)) {
      await chrome.tabs.update(w.tabId, { url: 'https://www.google.com' });
      await waitTabComplete(w.tabId);
      continue;
    }

    await waitTabComplete(w.tabId);
    const snapshot = await getSnapshot(w.tabId);
    const screenshotB64 = state.apiConfig.vision ? await captureScreenshot(w.tabId) : null;
    const decision = await askLLM(snapshot, w.history.length + 1, screenshotB64, w);

    notify('worker_step', {
      worker: w.id, step: w.history.length + 1,
      thought: decision.thought,
      action: decision.action || { intent: decision.intent, url: decision.url, tab_index: decision.tab_index },
    });

    if (decision.intent === 'done') {
      w.history.push({ step: w.history.length + 1, intent: 'done', result: decision.answer || 'complete' });
      return decision.answer || 'Subtask finished.';
    }

    let result;
    if (decision.intent === 'navigate') {
      await chrome.tabs.update(w.tabId, { url: decision.url });
      await waitTabComplete(w.tabId);
      result = { ok: true, detail: 'Navigated to ' + decision.url };
    } else if (['back', 'forward', 'reload'].includes(decision.intent)) {
      result = await handleNavHistory(w.tabId, decision.intent);
    } else {
      result = await execAction(w.tabId, decision.action || { intent: decision.intent, ...decision });
      await sleep(800);
      await waitTabComplete(w.tabId, 8000);
    }
    w.history.push({ step: w.history.length + 1, intent: decision.intent, result: result.detail || JSON.stringify(result).slice(0, 200) });
    notify('worker_result', { worker: w.id, result });
  }
  return 'Stopped before finishing (max worker steps reached or agent stopped).';
}

// Merge worker findings + execute the final single-threaded phase.
async function sequentialLoop(instruction) {
  const savedTask = state.task;
  state.task = instruction;
  try {
    for (let step = 1; step <= state.maxSteps && state.isRunning; step++) {
      await pauseGate();
      if (!state.isRunning) return;

      const tabId = state.tabId;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) { notify('error', { message: 'Agent tab was closed' }); return; }
      if (isBlockedUrl(tab.url)) {
        record(step, 'blocked', { intent: 'navigate', url: 'https://www.google.com' }, 'Cannot operate on browser-protected pages');
        await chrome.tabs.update(tabId, { url: 'https://www.google.com' });
        await waitTabComplete(tabId);
        continue;
      }

      await waitTabComplete(tabId);
      const snapshot = await getSnapshot(tabId);
      const screenshotB64 = state.apiConfig.vision ? await captureScreenshot(tabId) : null;
      const decision = await askLLM(snapshot, step, screenshotB64);

      notify('step', { step, thought: decision.thought, action: decision.action || { intent: decision.intent, url: decision.url, tab_index: decision.tab_index } });

      if (decision.intent === 'done') {
        record(step, 'done', {}, decision.answer || 'Task complete');
        notify('answer', { answer: decision.answer || 'Task complete.' });
        return;
      }

      // Human approval gate (optional per-setting, forced for risky intents)
      const risky = ['form_fill', 'drag_drop'].includes(decision.intent) ||
                    (decision.intent === 'click' && /pay|submit|delete|send|purchase/i.test(JSON.stringify(decision.action)));
      if (state.apiConfig.approvalMode === 'all' || (state.apiConfig.approvalMode === 'risky' && risky)) {
        const answer = await requestApproval({
          step, thought: decision.thought,
          actionDesc: describeDecision(decision, snapshot),
        });
        if (!state.isRunning) return;
        notify('approval_result', { step, approved: answer.approved, note: answer.note });
        if (!answer.approved) {
          record(step, 'skipped', decision.action || {}, 'User rejected this action' + (answer.note ? ': ' + answer.note : ''));
          continue;
        }
      }

      let result;
      if (decision.intent === 'navigate') {
        await chrome.tabs.update(tabId, { url: decision.url });
        await waitTabComplete(tabId);
        result = { ok: true, detail: 'Navigated to ' + decision.url };
      } else if (['back', 'forward', 'reload'].includes(decision.intent)) {
        result = await handleNavHistory(tabId, decision.intent);
      } else if (decision.intent === 'new_tab') {
        result = await handleNewTab(decision);
      } else if (decision.intent === 'switch_tab') {
        result = await handleSwitchTab(decision);
      } else if (decision.intent === 'close_tab') {
        result = await handleCloseTab(decision);
      } else if (decision.intent === 'drag_drop' && state.apiConfig.useCdp !== false) {
        result = await handleDragDrop(tabId, decision.action);
      } else if (decision.intent === 'click' && state.apiConfig.useCdp !== false) {
        // Visual path: real human-like cursor movement via CDP, then click
        result = await handleRealClick(tabId, decision.action);
      } else {
        result = await execAction(tabId, decision.action || { intent: decision.intent, ...decision });
        await sleep(800);
        await waitTabComplete(tabId, 8000);
      }

      record(step, decision.intent, decision.action || { url: decision.url, tab_index: decision.tab_index },
        result.detail || JSON.stringify(result).slice(0, 200), decision.thought);
      notify('action_result', { step, result });
    }
    notify('answer', { answer: 'Stopped: reached max steps without completing the task.' });
  } finally {
    state.task = savedTask;
  }
}

async function handleRealClick(tabId, action) {
  const box = await getElementBox(tabId, action.index);
  let result;
  if (box) {
    try {
      await realMouseMoveAndClick(tabId, box.x + box.w / 2, box.y + box.h / 2);
      result = { ok: true, detail: 'Real-mouse clicked element [' + action.index + ']' };
    } catch (e) {
      result = await execAction(tabId, action); // fallback synthetic click
    }
  } else {
    result = await execAction(tabId, action);
  }
  await sleep(800);
  await waitTabComplete(state.tabId, 8000);
  return result;
}

async function handleDragDrop(tabId, action) {
  const from = await getElementBox(tabId, action.from_index);
  const to = await getElementBox(tabId, action.to_index);
  if (!from || !to) return { ok: false, detail: 'Drag endpoints not found' };
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  try {
    await realMouseDrag(tabId, fc, tc);
    return { ok: true, detail: `Dragged [${action.from_index}] -> [${action.to_index}] with real mouse` };
  } catch (e) {
    // fallback: HTML5 drag events in page context
    const r = await execAction(tabId, { intent: 'drag_drop', from_index: action.from_index, to_index: action.to_index });
    return r;
  }
}

async function handleNewTab(decision) {
  const t = await chrome.tabs.create({ url: decision.url || 'about:blank', active: true });
  if (state.groupId != null) { try { await chrome.tabs.group({ tabIds: [t.id], groupId: state.groupId }); } catch (e) {} }
  state.tabId = t.id;
  await waitTabComplete(t.id);
  return { ok: true, detail: 'Opened new tab: ' + (decision.url || 'about:blank') };
}

async function handleSwitchTab(decision) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs[Number(decision.tab_index)];
  if (!target) return { ok: false, detail: 'No tab at index ' + decision.tab_index };
  state.tabId = target.id;
  await chrome.tabs.update(target.id, { active: true });
  await waitTabComplete(target.id, 8000);
  return { ok: true, detail: 'Switched to tab "' + (target.title || target.url || '').slice(0, 60) + '"' };
}

async function handleCloseTab(decision) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs[Number(decision.tab_index)];
  if (!target) return { ok: false, detail: 'No tab at index ' + decision.tab_index };
  const ids = tabs.map(t => t.id);
  await chrome.tabs.remove(target.id);
  if (target.id === state.tabId) {
    // move focus to a sensible remaining tab
    const rest = tabs.filter(t => t.id !== target.id);
    const next = rest[Math.min(ids.indexOf(target.id), rest.length - 1)] || rest[0];
    state.tabId = next ? next.id : null;
    if (next) await chrome.tabs.update(next.id, { active: true });
  }
  return { ok: true, detail: 'Closed tab ' + decision.tab_index };
}

async function handleNavHistory(tabId, intent) {
  try {
    const history = await chrome.tabs.get(tabId);
    if (intent === 'back' && history.pending === false) { await goHistory(tabId, -1); return { ok: true, detail: 'Went back' }; }
    if (intent === 'forward') { await goHistory(tabId, 1); return { ok: true, detail: 'Went forward' }; }
    if (intent === 'reload') { await chrome.tabs.reload(tabId); await waitTabComplete(tabId); return { ok: true, detail: 'Reloaded page' }; }
    return { ok: false, detail: 'Nothing to ' + intent };
  } catch (e) {
    return { ok: false, detail: String(e.message || e) };
  }
}
async function goHistory(tabId, delta) {
  // chrome.tabs doesn't expose history directly; use scripting
  await chrome.scripting.executeScript({ target: { tabId }, func: (d) => history.go(d), args: [delta] });
  await sleep(700);
  await waitTabComplete(tabId, 8000);
}

function describeDecision(decision, snapshot) {
  const a = decision.action || {};
  const labelOf = (i) => {
    const m = String(snapshot).match(new RegExp('\\[' + i + '\\][^\\n]*'));
    return m ? m[0].slice(0, 90) : '#' + i;
  };
  switch (decision.intent) {
    case 'click': return `Click ${labelOf(a.index)}`;
    case 'type': return `Type "${a.text}" into ${labelOf(a.index)}${a.enter ? ' + Enter' : ''}`;
    case 'select': return `Select option "${a.option}" in ${labelOf(a.index)}`;
    case 'form_fill': return `Fill multiple form fields (${(a.fields || []).length} values)`;
    case 'drag_drop': return `Drag ${labelOf(a.from_index)} \u2192 ${labelOf(a.to_index)}`;
    case 'navigate': return `Navigate to ${decision.url}`;
    default: return `${decision.intent} ${JSON.stringify(a).slice(0, 120)}`;
  }
}

function record(step, intent, action, result, thought = '') {
  state.history.push({ step, intent, action, result, thought });
}

// ---- LLM providers ----
function buildSystemPrompt(worker = null) {
  const taskLine = worker
    ? `Overall user goal: "${worker.goal}"\nYOUR assigned subtask (work ONLY on this): "${worker.instruction}"\nYou are one of several parallel workers running in separate tabs. Other agents handle other parts. When your subtask is answered, use "done" with a concise factual summary of what you found.`
    : `Current user task: "${state.task}"`;
  return `You are an autonomous web-browsing agent operating a real Chrome browser, similar to "Claude for Chrome".
${taskLine}

You receive a page snapshot: URL, TITLE, visible text, open-tab list, and numbered interactive elements like [12] <button> "Sign in" (built from the accessibility tree: role + accessible name).
On each turn, reply with ONLY a JSON object (no markdown fences, no extra text) of one of these shapes:

{"thought":"brief reasoning","intent":"click","index":12}
{"thought":"...","intent":"type","index":5,"text":"query here","enter":true}
{"thought":"...","intent":"select","index":7,"option":"Option label"}
{"thought":"...","intent":"form_fill","fields":[{"index":3,"text":"John"},{"index":4,"text":"john@example.com"}],"submit_index":9}
{"thought":"...","intent":"drag_drop","from_index":8,"to_index":15}
{"thought":"...","intent":"scroll","direction":"down","pixels":600}
{"thought":"...","intent":"extract","selector":".product-title"}
{"thought":"...","intent":"navigate","url":"https://example.com"}
{"thought":"...","intent":"back"} | {"thought":"...","intent":"forward"} | {"thought":"...","intent":"reload"}
${worker ? '' : `{"thought":"...","intent":"new_tab","url":"https://example.com"}
{"thought":"...","intent":"switch_tab","tab_index":2}
{"thought":"...","intent":"close_tab","tab_index":3}
`}{"thought":"...","intent":"done","answer":"final answer for the user"}

Rules:
- Use EXACTLY ONE action per turn. Prefer searching via Google when the task involves finding information.${worker ? '\n- You are a PARALLEL WORKER: only read-only actions (navigate, type/search, click links, scroll, extract). Never fill forms, never buy/submit/delete anything, never switch or close tabs.' : ''}
- Element indexes refer to the latest snapshot only. Tab indexes refer to the OPEN TABS list in the snapshot.
- For multi-field forms use form_fill instead of many separate type actions.
- If the task is finished or impossible, use "done" with a helpful answer.
- Never access chrome:// or web store pages.`;
}

function buildUserPrompt(snapshot, step, worker = null) {
  const recent = (worker ? worker.history : state.history).slice(-6).map(h =>
    `step ${h.step}: ${h.intent} -> ${h.result}`).join('\n');
  return `Step ${step}. Recent actions:\n${recent || '(none)'}\n\nCURRENT PAGE SNAPSHOT:\n${snapshot}\n\nRespond with one JSON action.`;
}

// ---- Planner: decompose the task into parallel-safe + sequential subtasks ----
async function buildPlan(task) {
  const fallback = { task, instructions: task, subtasks: [], parallel: [], serial: [] };
  if (state.apiConfig.parallel === false) return fallback;
  // Cheap heuristic first: don't waste an LLM call on obviously simple tasks.
  if (!/\b(and|compare|versus|vs\.?|also|plus|both)\b|[;,]/i.test(task) || task.length < 60) {
    return fallback;
  }
  try {
    const raw = await callProvider(chainHead(), [{
      role: 'system',
      content: 'You are a task planner for a browser agent. Split the user task into at most 3 SUBTASKS. Reply ONLY with JSON: {"subtasks":[{"instruction":"...","parallel":true}]}. parallel=true means the subtask is independent read-only research that can run simultaneously in its own tab; false means it depends on other steps or changes state (buying, filling forms, posting). Simple single-goal tasks get exactly one subtask with parallel=false.',
    }, { role: 'user', content: 'Task: ' + task }]);
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const obj = JSON.parse(m[0]);
    const subtasks = (obj.subtasks || []).filter(s => s && s.instruction);
    if (subtasks.length < 2) return fallback;
    const capped = subtasks.slice(0, 3);
    return {
      task,
      instructions: task,
      subtasks: capped,
      parallel: capped.filter(s => s.parallel === true),
      serial: capped.filter(s => s.parallel !== true),
    };
  } catch (e) {
    return fallback; // planning failure must never block the actual task
  }
}

function chainHead() {
  return (state.providerChain && state.providerChain[state.providerIndex]) || state.apiConfig;
}

// ---- Synthesizer: merge parallel worker findings into one final answer ----
async function synthesizeFinal(task, findings) {
  try {
    const raw = await callProvider(chainHead(), [{
      role: 'system',
      content: 'You merge the findings of several parallel browser research workers into ONE clear, complete answer for the user. Be faithful to the findings; note anything that failed.',
    }, { role: 'user', content: `User task: ${task}\n\nWorker findings:\n${JSON.stringify(findings, null, 2).slice(0, 6000)}\n\nWrite the final answer.` }]);
    return String(raw).replace(/^```.*$/g, '').trim();
  } catch (e) {
    return 'Parallel results:\n' + findings.map(f => `- ${f.subtask}\n  → ${f.outcome}`).join('\n');
  }
}

async function askLLM(snapshot, step, screenshotB64, worker = null) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(worker) },
    { role: 'user', content: buildUserPrompt(snapshot, step, worker), image: screenshotB64 || null },
  ];
  // Try each configured provider in priority order (claude > gemini > groq > openrouter).
  // If the current one errors out (bad key, rate limit, quota), fall back to the next.
  const chain = state.providerChain && state.providerChain.length
    ? state.providerChain
    : [state.apiConfig];
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i];
    try {
      const raw = await callProvider(cfg, messages);
      if (i !== state.providerIndex) {
        state.providerIndex = i;
        notify('provider', { provider: cfg.provider, model: cfg.model, switched: true });
      }
      return parseAction(raw);
    } catch (e) {
      lastErr = e;
      notify('provider_error', { provider: cfg.provider, error: String(e && e.message || e), fallback: chain[i + 1]?.provider || null });
    }
  }
  throw new Error('All providers failed. Last error: ' + (lastErr && lastErr.message || 'unknown'));
}

async function callProvider(cfg, messages) {
  const sys = messages[0].content, userMsg = messages[1];

  if (cfg.provider === 'gemini') {
    const model = cfg.model || 'gemini-2.0-flash';
    const parts = [{ text: sys + '\n\n' + userMsg.content }];
    if (userMsg.image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: userMsg.image } });
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || throwErr(j);
  }

  if (cfg.provider === 'claude') {
    const content = [];
    if (userMsg.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: userMsg.image } });
    content.push({ type: 'text', text: userMsg.content });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model || 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system: sys,
        messages: [{ role: 'user', content }],
      }),
    });
    const j = await r.json();
    return j?.content?.[0]?.text || throwErr(j);
  }

  if (cfg.provider === 'groq' || cfg.provider === 'openrouter') {
    const base = cfg.provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const defaultModel = cfg.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'anthropic/claude-3.5-sonnet';
    const openMessages = [
      { role: 'system', content: sys },
      { role: 'user', content: userMsg.image
        ? [{ type: 'text', text: userMsg.content },
           { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + userMsg.image } }]
        : userMsg.content },
    ];
    const r = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model || defaultModel, messages: openMessages, temperature: 0.2, max_tokens: 700 }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || throwErr(j);
  }

  throw new Error('Unknown provider: ' + cfg.provider);
}

function throwErr(j) {
  throw new Error('API error: ' + JSON.stringify(j).slice(0, 300));
}

const KNOWN_INTENTS = ['click', 'type', 'select', 'scroll', 'extract', 'form_fill', 'drag_drop'];

function parseAction(raw) {
  // extract first JSON object from the model output
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return { intent: 'scroll', thought: 'unparseable output, scrolling', action: { intent: 'scroll', direction: 'down' } };
  let obj;
  try { obj = JSON.parse(m[0]); } catch (e) {
    return { intent: 'scroll', thought: 'bad json, scrolling', action: { intent: 'scroll', direction: 'down' } };
  }
  const intent = obj.intent;
  if (intent === 'done') return { intent: 'done', thought: obj.thought, answer: obj.answer };
  if (intent === 'navigate') return { intent: 'navigate', thought: obj.thought, url: obj.url };
  if (['back', 'forward', 'reload'].includes(intent)) return { intent, thought: obj.thought, action: obj };
  if (['new_tab'].includes(intent)) return { intent, thought: obj.thought, url: obj.url, action: obj };
  if (['switch_tab', 'close_tab'].includes(intent)) return { intent, thought: obj.thought, tab_index: obj.tab_index, action: obj };
  if (KNOWN_INTENTS.includes(intent)) {
    return { intent, thought: obj.thought, action: obj };
  }
  return { intent: 'scroll', thought: 'unknown intent: ' + intent, action: { intent: 'scroll', direction: 'down' } };
}
