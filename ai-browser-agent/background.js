// Background Service Worker - AI Browser Agent

let agentState = {
  isRunning: false,
  currentTask: null,
  tabId: null,
  history: []
};

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAgent') {
    startAgent(request.task, request.apiConfig);
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopAgent') {
    stopAgent();
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'getAgentState') {
    sendResponse(agentState);
  } else if (request.action === 'pageContentExtracted') {
    handlePageContent(request.content, request.url);
  }
  return true;
});

async function startAgent(task, apiConfig) {
  agentState.isRunning = true;
  agentState.currentTask = task;
  agentState.history = [];
  
  // Open a new tab
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  agentState.tabId = tab.id;
  
  // Start the agent loop
  await executeAgentStep(task, apiConfig);
}

function stopAgent() {
  agentState.isRunning = false;
  agentState.currentTask = null;
  if (agentState.tabId) {
    chrome.tabs.remove(agentState.tabId).catch(() => {});
    agentState.tabId = null;
  }
}

async function executeAgentStep(task, apiConfig) {
  if (!agentState.isRunning) return;
  
  try {
    // Get current page content
    const pageContent = await getPageContent();
    
    // Build prompt for AI
    const prompt = buildPrompt(task, pageContent, agentState.history);
    
    // Call AI API
    const aiResponse = await callAIAPI(prompt, apiConfig);
    
    // Parse AI response and execute action
    const action = parseAIAction(aiResponse);
    
    agentState.history.push({
      step: agentState.history.length + 1,
      action: action,
      reasoning: aiResponse
    });
    
    // Execute the action
    await executeAction(action);
    
    // Check if task is complete
    if (action.type !== 'complete') {
      // Wait a bit then continue
      setTimeout(() => executeAgentStep(task, apiConfig), 2000);
    } else {
      agentState.isRunning = false;
    }
    
  } catch (error) {
    console.error('Agent error:', error);
    agentState.isRunning = false;
  }
}

async function getPageContent() {
  if (!agentState.tabId) return '';
  
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: agentState.tabId },
      func: () => {
        return {
          title: document.title,
          url: window.location.href,
          content: document.body.innerText.substring(0, 5000),
          links: Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
            text: a.innerText.trim(),
            href: a.href
          })),
          buttons: Array.from(document.querySelectorAll('button, input[type="submit"]')).slice(0, 30).map(b => ({
            text: b.innerText || b.value,
            id: b.id,
            className: b.className
          }))
        };
      }
    });
    return results[0].result;
  } catch (error) {
    console.error('Error getting page content:', error);
    return { title: '', url: '', content: 'Unable to access page', links: [], buttons: [] };
  }
}

function buildPrompt(task, pageContent, history) {
  const historyStr = history.slice(-5).map(h => 
    `Step ${h.step}: ${h.action.type} - ${h.action.reason || ''}`
  ).join('\n');
  
  return `You are an AI browser agent tasked with completing this goal: "${task}"

Current page information:
- Title: ${pageContent.title}
- URL: ${pageContent.url}
- Content preview: ${pageContent.content.substring(0, 1000)}
- Available links: ${JSON.stringify(pageContent.links.slice(0, 20))}
- Available buttons: ${JSON.stringify(pageContent.buttons.slice(0, 15))}

Action history:
${historyStr}

Based on the current state, decide what action to take next. Respond ONLY with a JSON object in this format:
{
  "type": "click|type|navigate|scroll|wait|complete",
  "target": "description of element or URL",
  "value": "text to type (if applicable)",
  "reason": "brief explanation"
}

Choose the most logical next step to accomplish the goal.`;
}

async function callAIAPI(prompt, apiConfig) {
  const { provider, apiKey, model } = apiConfig;
  
  let url, headers, body;
  
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });
  } else if (provider === 'claude') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };
    body = JSON.stringify({
      model: model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
  } else if (provider === 'groq' || provider === 'openrouter') {
    const baseUrl = provider === 'groq' 
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    url = baseUrl;
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    body = JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }]
    });
  }
  
  const response = await fetch(url, { method: 'POST', headers, body });
  const data = await response.json();
  
  // Extract text based on provider
  if (provider === 'gemini') {
    return data.candidates[0].content.parts[0].text;
  } else if (provider === 'claude') {
    return data.content[0].text;
  } else {
    return data.choices[0].message.content;
  }
}

function parseAIAction(response) {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse action:', e);
  }
  return { type: 'wait', reason: 'Could not parse action' };
}

async function executeAction(action) {
  if (!agentState.tabId) return;
  
  switch (action.type) {
    case 'navigate':
      await chrome.tabs.update(agentState.tabId, { url: action.target });
      break;
      
    case 'click':
      await chrome.scripting.executeScript({
        target: { tabId: agentState.tabId },
        func: (selector) => {
          const elements = document.querySelectorAll('a, button');
          for (let el of elements) {
            if (el.innerText.includes(selector) || el.textContent.includes(selector)) {
              el.click();
              return true;
            }
          }
          return false;
        },
        args: [action.target]
      });
      break;
      
    case 'type':
      await chrome.scripting.executeScript({
        target: { tabId: agentState.tabId },
        func: (targetText, value) => {
          const inputs = document.querySelectorAll('input, textarea');
          for (let input of inputs) {
            const label = input.previousElementSibling?.innerText || 
                         input.placeholder || 
                         input.name || '';
            if (label.includes(targetText) || input.id.includes(targetText)) {
              input.value = value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
          return false;
        },
        args: [action.target, action.value]
      });
      break;
      
    case 'scroll':
      await chrome.scripting.executeScript({
        target: { tabId: agentState.tabId },
        func: () => window.scrollBy(0, window.innerHeight)
      });
      break;
      
    case 'wait':
      await new Promise(resolve => setTimeout(resolve, 3000));
      break;
      
    case 'complete':
      console.log('Task completed:', action.reason);
      break;
  }
}
