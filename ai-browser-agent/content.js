// Content Script - AI Browser Agent
// This script runs on all web pages and provides enhanced interaction capabilities

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.aiAgentInjected) return;
  window.aiAgentInjected = true;
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageInfo') {
      sendResponse(getPageInfo());
    } else if (request.action === 'clickElement') {
      clickElement(request.selector);
      sendResponse({ success: true });
    } else if (request.action === 'typeInInput') {
      typeInInput(request.selector, request.text);
      sendResponse({ success: true });
    } else if (request.action === 'findElements') {
      const elements = findElements(request.criteria);
      sendResponse({ elements: elements });
    }
    return true;
  });
  
  function getPageInfo() {
    return {
      title: document.title,
      url: window.location.href,
      textContent: document.body.innerText.substring(0, 10000),
      htmlContent: document.documentElement.outerHTML.substring(0, 50000),
      forms: Array.from(document.querySelectorAll('form')).map(form => ({
        action: form.action,
        method: form.method,
        inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(input => ({
          name: input.name,
          type: input.type,
          placeholder: input.placeholder,
          value: input.value
        }))
      }))
    };
  }
  
  function clickElement(selector) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        element.click();
        return true;
      }
      
      // Try to find by text content
      const allElements = document.querySelectorAll('a, button, [role="button"], input[type="submit"]');
      for (let el of allElements) {
        const text = el.textContent || el.value || '';
        if (text.toLowerCase().includes(selector.toLowerCase())) {
          el.click();
          return true;
        }
      }
    } catch (error) {
      console.error('Error clicking element:', error);
    }
    return false;
  }
  
  function typeInInput(selector, text) {
    try {
      let input = document.querySelector(selector);
      
      // If selector not found, try to find by label or placeholder
      if (!input) {
        const inputs = document.querySelectorAll('input, textarea');
        for (let el of inputs) {
          const label = el.labels?.[0]?.textContent || 
                       el.placeholder || 
                       el.name || '';
          if (label.toLowerCase().includes(selector.toLowerCase())) {
            input = el;
            break;
          }
        }
      }
      
      if (input) {
        // Focus the input
        input.focus();
        
        // Clear existing value
        input.value = '';
        
        // Set new value
        input.value = text;
        
        // Trigger events
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        return true;
      }
    } catch (error) {
      console.error('Error typing in input:', error);
    }
    return false;
  }
  
  function findElements(criteria) {
    const results = [];
    
    // Find clickable elements
    const clickables = document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]');
    clickables.forEach(el => {
      const text = (el.textContent || el.value || '').trim();
      if (text && matchesCriteria(text, criteria)) {
        results.push({
          type: 'clickable',
          tag: el.tagName.toLowerCase(),
          text: text.substring(0, 100),
          href: el.href || null,
          selector: getUniqueSelector(el)
        });
      }
    });
    
    // Find input fields
    const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
    inputs.forEach(el => {
      const label = el.labels?.[0]?.textContent || el.placeholder || el.name || '';
      if (matchesCriteria(label, criteria)) {
        results.push({
          type: 'input',
          tag: el.tagName.toLowerCase(),
          inputType: el.type,
          label: label.substring(0, 100),
          name: el.name,
          selector: getUniqueSelector(el)
        });
      }
    });
    
    return results.slice(0, 20);
  }
  
  function matchesCriteria(text, criteria) {
    if (!criteria) return true;
    const lowerText = text.toLowerCase();
    const lowerCriteria = criteria.toLowerCase();
    return lowerText.includes(lowerCriteria) || lowerCriteria.includes(lowerText);
  }
  
  function getUniqueSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    
    const path = [];
    let current = element;
    
    while (current.parentElement && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.className) {
        const classes = current.className.split(' ')
          .filter(c => c.trim() && !c.includes('active') && !c.includes('hover'))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }
      
      const siblings = Array.from(current.parentElement.children)
        .filter(child => child.tagName === current.tagName);
      
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return path.join(' > ');
  }
  
})();
