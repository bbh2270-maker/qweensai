// Popup Script - AI Browser Agent

const elements = {
  provider: document.getElementById('provider'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  task: document.getElementById('task'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
  history: document.getElementById('history')
};

// Default models for each provider
const defaultModels = {
  gemini: 'gemini-2.0-flash-exp',
  claude: 'claude-3-5-sonnet-20241022',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'anthropic/claude-3.5-sonnet'
};

// Load saved settings
chrome.storage.local.get(['apiSettings'], (result) => {
  if (result.apiSettings) {
    elements.provider.value = result.apiSettings.provider || 'gemini';
    elements.apiKey.value = result.apiSettings.apiKey || '';
    elements.model.value = result.apiSettings.model || defaultModels[result.apiSettings.provider];
  }
});

// Update model when provider changes
elements.provider.addEventListener('change', () => {
  const provider = elements.provider.value;
  elements.model.value = defaultModels[provider] || '';
});

// Start agent
elements.startBtn.addEventListener('click', async () => {
  const apiConfig = {
    provider: elements.provider.value,
    apiKey: elements.apiKey.value.trim(),
    model: elements.model.value.trim()
  };
  
  const task = elements.task.value.trim();
  
  if (!apiConfig.apiKey) {
    alert('Please enter your API key');
    return;
  }
  
  if (!apiConfig.model) {
    alert('Please enter a model name');
    return;
  }
  
  if (!task) {
    alert('Please describe what you want the agent to do');
    return;
  }
  
  // Save settings
  chrome.storage.local.set({ apiSettings: apiConfig });
  
  // Start the agent
  chrome.runtime.sendMessage({
    action: 'startAgent',
    task: task,
    apiConfig: apiConfig
  });
  
  updateUI(true);
});

// Stop agent
elements.stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopAgent' });
  updateUI(false);
});

function updateUI(isRunning) {
  if (isRunning) {
    elements.startBtn.disabled = true;
    elements.stopBtn.style.display = 'block';
    elements.status.innerHTML = '<span class="status-active">🔄 Agent is running...</span>';
    elements.status.classList.add('running');
  } else {
    elements.startBtn.disabled = false;
    elements.stopBtn.style.display = 'none';
    elements.status.innerHTML = '<span class="status-idle">Agent is idle</span>';
    elements.status.classList.remove('running');
  }
}

// Poll for agent state updates
setInterval(() => {
  chrome.runtime.sendMessage({ action: 'getAgentState' }, (response) => {
    if (response) {
      updateUI(response.isRunning);
      
      if (response.history && response.history.length > 0) {
        renderHistory(response.history);
      }
    }
  });
}, 1000);

function renderHistory(history) {
  const recentHistory = history.slice(-10).reverse();
  
  elements.history.innerHTML = recentHistory.map(item => `
    <div class="history-item">
      <span class="history-step">Step ${item.step}:</span> 
      ${item.action.type.toUpperCase()} - ${item.action.reason || 'No reason provided'}
    </div>
  `).join('');
}
