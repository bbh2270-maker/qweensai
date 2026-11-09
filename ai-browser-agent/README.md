# AI Browser Agent - Chrome Extension

একটি autonomous AI browser agent যেটা Chrome extension হিসেবে install করে browser এ automatically tasks complete করতে পারবে। Gemini, Claude, Groq, এবং OpenRouter API support করে।

## Features

- 🤖 **Autonomous Browsing**: AI agent নিজে নিজে browser navigate করে, clicks করে, type করে
- 🔌 **Multi-Provider Support**: Gemini, Claude, Groq, OpenRouter - যেকোনো একটা ব্যবহার করুন
- 🎯 **Task-Based**: শুধু task লিখুন, agent বাকি সব করবে
- 📊 **Real-time Monitoring**: Live status এবং action history দেখুন
- 💾 **Settings Persistence**: API keys এবং settings save থাকে
- 🔄 **Smart Actions**: Click, type, navigate, scroll, wait - সব automatically

## Installation

1. Download বা clone করুন এই folder টা
2. Chrome browser open করুন
3. `chrome://extensions/` এ যান
4. Top-right এ "Developer mode" toggle ON করুন
5. "Load unpacked" button এ click করুন
6. `ai-browser-agent` folder টা select করুন
7. Extension install হয়ে যাবে! ✅

## Usage

### 1. API Key Setup

Extension icon এ click করুন, তারপর:

**Provider select করুন:**
- Google Gemini (recommended for testing)
- Anthropic Claude
- Groq
- OpenRouter

**API Key দিন:**
- Gemini: https://aistudio.google.com/app/apikey থেকে free key নিন
- Claude: https://console.anthropic.com/settings/keys
- Groq: https://console.groq.com/keys
- OpenRouter: https://openrouter.ai/settings/keys

**Model Name:**
- Default models auto-fill হবে, বা custom model use করুন

### 2. Task Description

Task box এ যা করতে চান লিখুন। Examples:

```
Search Google for "latest AI news" and summarize the top 3 articles
```

```
Go to GitHub and find repositories about "machine learning" with most stars
```

```
Search Amazon for wireless headphones under $50 and tell me the cheapest option
```

```
Find Python documentation about async functions and list the main methods
```

### 3. Start Agent

"Start Agent" button এ click করুন। Agent:
- New tab খুলবে
- Automatically browse করবে
- Tasks complete করবে
- Real-time actions show করবে

## Architecture

```
ai-browser-agent/
├── manifest.json       # Extension configuration
├── background.js       # Service worker - agent logic & API calls
├── content.js          # Content script - page interaction
├── popup.html          # UI interface
├── popup.js            # Popup logic
└── icons/              # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **User Input**: Task description + API config from popup
2. **Background Script**: 
   - Opens new tab
   - Gets page content via scripting API
   - Builds prompt with current state
   - Calls AI API (Gemini/Claude/Groq/OpenRouter)
   - Parses JSON response
   - Executes action (click/type/navigate)
   - Loops until task complete
3. **Content Script**: Enhanced DOM interaction helpers
4. **Popup**: Real-time status updates and history

## AI Decision Loop

প্রতি step এ agent:
1. Current page extract করে (title, URL, content, links, buttons)
2. History সহ prompt তৈরি করে
3. AI থেকে next action JSON পায়
4. Action execute করে
5. Wait করে page load হওয়ার জন্য
6. Repeat until "complete" action

## Supported Actions

- `navigate`: URL change করে
- `click`: Element text দিয়ে click করে
- `type`: Input field এ text type করে  
- `scroll`: Page scroll করে
- `wait`: কিছুক্ষণ wait করে
- `complete`: Task শেষ হয়

## Example Response Format

AI এর output JSON format এ হয়:

```json
{
  "type": "click",
  "target": "Sign In",
  "reason": "Need to login to access dashboard"
}
```

## Troubleshooting

**Agent doesn't start:**
- Check API key is correct
- Verify you have credits/quota
- Look at console errors (F12 → Console)

**Actions not working:**
- Some sites block automation
- Try different provider/model
- Complex SPAs may need more steps

**Rate limits:**
- Increase delay between steps in background.js (line 80)
- Use cheaper/faster models like Gemini Flash

## Security Notes

⚠️ **Important:**
- API keys local storage এ save হয় (chrome.storage.local)
- Keys কখনো external server এ যায় না
- শুধু AI API calls এর জন্য ব্যবহার হয়
- Public repo এ keys commit করবেন না

## Customization

**Change step delay:**
```javascript
// background.js line 80
setTimeout(() => executeAgentStep(task, apiConfig), 2000); // 2 seconds
```

**Add new provider:**
```javascript
// background.js callAIAPI() function
else if (provider === 'custom') {
  url = 'https://api.custom.com/v1/chat';
  // ... add implementation
}
```

**Modify max history:**
```javascript
// background.js buildPrompt()
const historyStr = history.slice(-10) // Keep last 10 steps
```

## Performance Tips

- **Gemini Flash**: Fastest and cheapest for testing
- **Claude 3.5 Sonnet**: Best reasoning quality
- **Groq Llama**: Very fast inference
- **OpenRouter**: Access to many models

## License

MIT License - Free to use and modify

## Credits

Built with modern web APIs:
- Chrome Extension Manifest V3
- Fetch API for AI providers
- chrome.scripting for DOM manipulation
- chrome.tabs for navigation control

---

**Enjoy your autonomous AI browser agent! 🚀**
