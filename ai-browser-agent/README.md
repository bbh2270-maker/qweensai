# AI Browser Agent (Chrome Extension)

Autonomous AI browsing agent — inspired by **Claude for Chrome** and **browser-use**.
Give it a task, and it opens its own tab, reads the page, clicks, types, navigates, and reports back the answer.

## ✨ Features (v3)

- 🖥️ **Visual browser control** — CDP `Page.captureScreenshot` gives the agent real "eyes"; optional vision mode sends screenshots to the model
- 🖱️ **Real mouse movement** — clicks are performed via CDP `Input.dispatchMouseEvent` with an interpolated, human-like cursor path (not synthetic `.click()`)
- ♿ **Accessibility tree snapshots** — every interactive element is described by role + accessible name (`[12] <button> "Sign in"`)
- 🔎 **Smart element finding** — resolve elements by index, selector, text, label or placeholder, even if the DOM changes between steps
- 🗂 **Multi-tab control** — `new_tab`, `switch_tab`, `close_tab`; the open-tabs list is part of every snapshot
- 📝 **Form automation** — one `form_fill` action fills many fields (+ optional submit), plus type/select/click primitives
- ↔️ **Drag & drop** — real mouse drag via CDP with HTML5 drag-event fallback
- 🧭 **Browser navigation** — navigate, back, forward, reload
- 💭 **Agent thinking** — the model's reasoning is streamed into the UI on every step
- 📜 **Activity timeline** — timestamped log of thoughts, actions, results and approvals
- ✅ **Human approval** — risky actions (form fills, drags, pay/submit/delete/send clicks) pause until you Approve/Reject; also "approve all" mode
- ⏹ **Stop / Resume** — stop anytime, or pause the loop mid-task and resume later
- 🏷️ **Automatic tab grouping** — all agent tabs land in one orange "🤖 AI Agent" tab group
- 🤖 **4 LLM providers**: Google Gemini, Anthropic Claude, Groq, OpenRouter (bring your own API key); max 25 steps per task

## 🚀 Install (Developer Mode)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this `ai-browser-agent` folder
4. Pin the extension, open the popup

## 🧑‍💻 Usage

1. Pick provider → paste API key → (optionally change model)
2. Type a task, e.g.:
   - *"Search Google for 'latest Python version' and tell me what it is"*
   - *"Go to github.com/trending and list the top 3 repos today"*
3. Press **▶ Start Agent** — a new tab opens (inside the "🤖 AI Agent" tab group) and the agent drives it.
4. Watch the activity timeline (💭 thoughts, 🎯 actions, ✅ results); final answer appears with 🏁.
5. Use **⏸ Pause / ▶ Resume** to freeze the loop mid-task, **■ Stop** to abort, and approve/reject any action flagged by Human Approval.

### API keys
| Provider | Where to get key | Default model |
|---|---|---|
| Gemini | https://aistudio.google.com/apikey | `gemini-2.5-flash` |
| Claude | https://console.anthropic.com | `claude-sonnet-4-5-20250918` |
| Groq | https://console.groq.com/keys | `meta-llama/llama-4-scout-17b-16e-instruct` (vision) |
| OpenRouter | https://openrouter.ai/keys | `google/gemini-2.5-flash` |

Any model name can be typed manually — the Model field is free-form and each provider accepts all of its models (e.g. `gemini-2.5-pro`, `claude-opus-4-1-20250805`, `openai/gpt-4o` via OpenRouter). Vision-capable models receive screenshots; text-only models fall back to the accessibility-tree snapshot.

## 🗂 Files

- `manifest.json` — MV3 manifest (permissions: tabs, scripting, storage, debugger, tabGroups, `<all_urls>`)
- `background.js` — service worker: agent loop, CDP real-mouse/screenshot control, multi-tab handlers, approval gate, provider adapters (Gemini/Claude/Groq/OpenRouter)
- `page_agent.js` — injected DOM automation engine (accessibility snapshot builder, smart element finding, action executor incl. form_fill & drag_drop)
- `popup.html` / `popup.js` — UI: settings, task input, activity timeline, pause/resume + stop, human-approval prompts

## ⚠️ Notes & Limitations

- Cannot operate on `chrome://`, Web Store, or other protected pages (agent auto-avoids them).
- While the agent runs, Chrome shows the "extension is debugging this browser" infobar (required for CDP real mouse movement & screenshots). The agent falls back to in-page synthetic events if the debugger is unavailable.
- Claude's API blocks browser CORS calls only from web pages — from an extension service worker it works because `host_permissions` grants cross-origin fetch. If your Claude key setup rejects extension traffic, use OpenRouter's `anthropic/...` models instead.
- Keep API keys private; they are stored in `chrome.storage.local` on your machine only.
- For sensitive sites (banking, email), use Human Approval mode and/or Pause before the agent acts — otherwise it will do whatever the model decides.

## 🔮 Ideas for v4

- Site allow/deny lists and per-site approval policies
- Reusable task recipes / macros and long-term memory between sessions
- Overlay that draws the agent's cursor path live on the page
