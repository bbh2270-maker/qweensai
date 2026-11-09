// Background Service Worker - AI Browser Agent (v2)
// Claude-for-Chrome / browser-use style loop:
//   observe page -> LLM decides next action -> execute -> repeat until "done"

const state = {
  isRunning: false,
  task: null,
  tabId: null,
  apiConfig: null,
  history: [],      // [{ step, thought, action, result }]
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
      } else if (request.action === 'getState') {
        sendResponse({ ...state, history: state.history.slice(-30) });
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

async function startAgent(task, apiConfig) {
  if (!task || !apiConfig?.apiKey) throw new Error('Task and API key are required');
  stopAgentState();
  state.isRunning = true;
  state.task = task;
  state.apiConfig = apiConfig;
  state.history = [];

  const tab = await chrome.tabs.create({ url: 'https://www.google.com', active: true });
  state.tabId = tab.id;
  notify('started', { task, tabId: tab.id });

  runLoop().catch(err => {
    notify('error', { message: String(err.message || err) });
  }).finally(() => {
    state.isRunning = false;
    notify('finished', {});
  });
}

function stopAgent() {
  state.isRunning = false;
  notify('stopped', {});
}
function stopAgentState() {
  state.isRunning = false;
  state.history = [];
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
  return res?.[0]?.result || 'NO SNAPSHOT';
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

// ---- The agent loop ----
async function runLoop() {
  for (let step = 1; step <= state.maxSteps && state.isRunning; step++) {
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
    const decision = await askLLM(snapshot, step);

    notify('step', { step, thought: decision.thought, action: decision.action || { intent: decision.intent, url: decision.url } });

    if (decision.intent === 'done') {
      record(step, 'done', {}, decision.answer || 'Task complete');
      notify('answer', { answer: decision.answer || 'Task complete.' });
      return;
    }

    let result;
    if (decision.intent === 'navigate') {
      await chrome.tabs.update(tabId, { url: decision.url });
      await waitTabComplete(tabId);
      result = { ok: true, detail: 'Navigated to ' + decision.url };
    } else {
      result = await execAction(tabId, decision.action);
      // give SPA / navigation a moment
      await sleep(800);
      await waitTabComplete(tabId, 8000);
    }

    record(step, decision.intent, decision.action || { url: decision.url }, result.detail || JSON.stringify(result).slice(0, 200), decision.thought);
    notify('action_result', { step, result });
  }
  notify('answer', { answer: 'Stopped: reached max steps without completing the task.' });
}

function record(step, intent, action, result, thought = '') {
  state.history.push({ step, intent, action, result, thought });
}

// ---- LLM providers ----
function buildSystemPrompt() {
  return `You are an autonomous web-browsing agent operating a real Chrome tab, similar to "Claude for Chrome".
Current user task: "${state.task}"

You receive a page snapshot: URL, TITLE, visible text, and numbered interactive elements like [12] <button> "Sign in".
On each turn, reply with ONLY a JSON object (no markdown fences, no extra text) of one of these shapes:

{"thought":"brief reasoning","intent":"click","index":12}
{"thought":"...","intent":"type","index":5,"text":"query here","enter":true}
{"thought":"...","intent":"select","index":7,"option":"Option label"}
{"thought":"...","intent":"scroll","direction":"down","pixels":600}
{"thought":"...","intent":"extract","selector":".product-title"}
{"thought":"...","intent":"navigate","url":"https://example.com"}
{"thought":"...","intent":"done","answer":"final answer for the user"}

Rules:
- Use EXACTLY ONE action per turn. Prefer searching via Google when the task involves finding information.
- Element indexes refer to the latest snapshot only.
- If the task is finished or impossible, use "done" with a helpful answer.
- Never access chrome:// or web store pages.`;
}

function buildUserPrompt(snapshot, step) {
  const recent = state.history.slice(-6).map(h =>
    `step ${h.step}: ${h.intent} -> ${h.result}`).join('\n');
  return `Step ${step}. Recent actions:\n${recent || '(none)'}\n\nCURRENT PAGE SNAPSHOT:\n${snapshot}\n\nRespond with one JSON action.`;
}

async function askLLM(snapshot, step) {
  const cfg = state.apiConfig;
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(snapshot, step) },
  ];
  const raw = await callProvider(cfg, messages);
  return parseAction(raw);
}

async function callProvider(cfg, messages) {
  const sys = messages[0].content, user = messages[1].content;

  if (cfg.provider === 'gemini') {
    const model = cfg.model || 'gemini-2.0-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: sys + '\n\n' + user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || throwErr(j);
  }

  if (cfg.provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model || 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system: sys,
        messages: [{ role: 'user', content: user }],
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
    const r = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model || defaultModel, messages, temperature: 0.2, max_tokens: 700 }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || throwErr(j);
  }

  throw new Error('Unknown provider: ' + cfg.provider);
}

function throwErr(j) {
  throw new Error('API error: ' + JSON.stringify(j).slice(0, 300));
}

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
  if (['click', 'type', 'select', 'scroll', 'extract'].includes(intent)) {
    return { intent, thought: obj.thought, action: obj };
  }
  return { intent: 'scroll', thought: 'unknown intent: ' + intent, action: { intent: 'scroll', direction: 'down' } };
}
