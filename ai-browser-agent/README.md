# AI Browser Agent (Chrome Extension)

Autonomous AI browsing agent — inspired by **Claude for Chrome** and **browser-use**.
Give it a task, and it opens its own tab, reads the page, clicks, types, navigates, and reports back the answer.

## ✨ Features

- 🤖 **4 LLM providers**: Google Gemini, Anthropic Claude, Groq, OpenRouter (bring your own API key)
- 🌐 **Autonomous loop**: observe page → LLM decides action → execute → repeat (max 25 steps)
- 🖱️ **Actions**: click, type (+Enter), select dropdown, scroll, extract text, navigate, done
- 🔢 **Numbered element snapshots** (browser-use style): the model sees `[12] <button> "Sign in"` and acts by index
- 🎯 Live highlight of elements being clicked so you can watch the agent work
- 📜 Real-time activity log (thoughts + actions + results) in the popup
- ⏹ Stop button anytime; settings (provider/key/model) saved locally via `chrome.storage`

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
3. Press **▶ Start Agent** — a new tab opens and the agent drives it.
4. Watch the log; final answer appears with 🏁.

### API keys (কোন কোন site এর key লাগবে)

> **Apatoto regular free trial diyei cholbe — kono paid plan lagbe na.** Niche kon provider er free limit koto, ta likhe dilam:
>
> | Provider | Free limit (trial/tier) | Koto din cholbe |
> |---|---|---|
> | **Gemini** ⭐ recommended | Gemini 2.0 Flash: **15 requests/min, ~1500 requests/day FREE**, card lagbe na | Anonto kal (renewable daily) |
> | **Groq** | Llama-3.3-70B: **~8000 tokens/min, free daily quota (~hajar hajar request)** | Daily reset hoy, onek din cholbe |
> | **OpenRouter** | $1 free credits (onek free model o ache: `meta-llama/llama-3.3-70b-instruct:free`) | Jotokhon credit thakbe |
> | **Claude** (console.anthropic.com) | Free tier nei — demo/key holeo pay-as-you-go; Playground e free try kora jay | Paid only |
> | Tavily (optional) | 1000 credits/month free | Monthly reset |
> | Serper (optional) | 2500 credits ekbar | Ekbare sesh |
>
> **Sobcheye bhalo free combo:** Gemini (aistudio.google.com/apikey) main brain + Groq backup. Duitai free, daily quota roroe, ar extension settings theke provider change kora jay. Claude key tele paise lagbe — apatoto free-te Gemini/Groq-i enough.

**Abosshok (একটিই বেছে নিন — agent er "brain"):**
| Provider | Where to get key | Default model |
|---|---|---|
| Claude (best, Claude-er moto perfect kajer jonno) | https://console.anthropic.com/settings/keys | `claude-sonnet-4-20250514` |
| Gemini | https://aistudio.google.com/apikey | `gemini-2.0-flash` |
| Groq (fast + free tier) | https://console.groq.com/keys | `llama-3.3-70b-versatile` |
| OpenRouter (ek jaygaya shob model) | https://openrouter.ai/keys | `anthropic/claude-3.5-sonnet` |

**Optional (onko nirvul/perfect korar jonno):**
| Service | Site / Key link | Ki korbe |
|---|---|---|
| Tavily (AI search) | https://app.tavily.com (free 1000 credits/mo) | Google bot-blocking evade kore reliable web search |
| Serper.dev | https://serper.dev (free 2500 credits) | Real-time Google search results |
| Firecrawl | https://firecrawl.dev (free tier) | Je-kono page clean markdown e pora (scraping) |
| Browserless | https://browserless.io | Hosted headless browser (backup rendering) |
| ElevenLabs | https://elevenlabs.io | Voice output (optional) |
| Replicate | https://replicate.com | Image generation/editing (optional) |

Note: LLM key chara ar kichu-i mandatory na — extension ta setup hisebe **1-ti LLM key** niyei cholbe. Baki tool key gulo input pathiyete reliability baray.

## 🗂 Files

- `manifest.json` — MV3 manifest (permissions: tabs, scripting, storage, `<all_urls>`)
- `background.js` — service worker: agent loop + provider adapters (Gemini/Claude/Groq/OpenRouter)
- `page_agent.js` — injected DOM automation engine (snapshot builder + action executor)
- `popup.html` / `popup.js` — UI: settings, task input, live log

## ⚠️ Notes & Limitations

- Cannot operate on `chrome://`, Web Store, or other protected pages (agent auto-avoids them).
- Claude's API blocks browser CORS calls only from web pages — from an extension service worker it works because `host_permissions` grants cross-origin fetch. If your Claude key setup rejects extension traffic, use OpenRouter's `anthropic/...` models instead.
- Keep API keys private; they are stored in `chrome.storage.local` on your machine only.
- For sensitive sites (banking, email), stop the agent before it acts — it will do whatever the model decides.

## 🔮 Ideas for v3

- Screenshot + vision models (Gemini vision / Claude) for true visual grounding
- Multi-tab support & history memory between steps
- Site allow/deny lists and per-action confirmation mode
