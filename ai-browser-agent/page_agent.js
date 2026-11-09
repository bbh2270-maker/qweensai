// PageAgent-style DOM automation engine (inspired by browser-use / Claude for Chrome)
// Runs in the page context, builds a numbered interactive-element tree,
// and executes high-level actions: click, type, select, scroll, extract.

(function (global) {
  'use strict';

  const INTERACTIVE_SELECTORS = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
    'label', 'summary', '[type="submit"]'
  ].join(',');

  let registry = []; // map index -> element

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.value || el.getAttribute('placeholder') ||
      el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 120);
    const type = el.getAttribute('type') || '';
    const href = tag === 'a' ? el.href : '';
    return { tag, type, text, href };
  }

  // Collect + number all interactive elements on the page
  function collectElements() {
    registry = [];
    const els = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS))
      .filter(isVisible);
    els.forEach((el, i) => {
      el.setAttribute('data-ai-index', String(i));
      registry.push(el);
    });
    return registry;
  }

  // Build a compact "browser view tree" text for the LLM prompt
  function getPageSnapshot(maxChars = 15000) {
    collectElements();
    const lines = [];
    lines.push(`URL: ${location.href}`);
    lines.push(`TITLE: ${document.title}`);
    lines.push('--- Visible text (truncated) ---');
    lines.push((document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, Math.floor(maxChars / 2)));
    lines.push('--- Interactive elements ([index] tag: label) ---');
    registry.forEach((el, i) => {
      const d = describe(el);
      let line = `[${i}] <${d.tag}${d.type ? ' type=' + d.type : ''}>`;
      if (d.text) line += ` "${d.text}"`;
      if (d.href) line += ` -> ${d.href.slice(0, 100)}`;
      lines.push(line);
    });
    const out = lines.join('\n');
    return out.length > maxChars ? out.slice(0, maxChars) + '\n[...truncated]' : out;
  }

  function elFromIndex(index) {
    const el = registry[Number(index)];
    if (!el || !document.contains(el)) throw new Error('Element ' + index + ' no longer exists');
    return el;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }

  function humanType(el, text, options = {}) {
    el.focus();
    if (options.clear !== false) {
      setNativeValue(el, '');
    }
    setNativeValue(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (options.enter) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      if (el.form && typeof el.form.requestSubmit === 'function') {
        try { el.form.requestSubmit(); } catch (e) { /* ignore */ }
      }
    }
    return true;
  }

  function doClick(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    // Fallback for plain anchors handled by default click
    if (el.tagName === 'A' && el.target === '_blank') {
      // background script will handle new tabs via tabs.onCreated if needed
    }
    return true;
  }

  function doSelect(el, optionText) {
    const target = String(optionText).toLowerCase();
    const opt = Array.from(el.options).find(o => o.text.toLowerCase().includes(target)) ||
                Array.from(el.options).find(o => o.value.toLowerCase().includes(target));
    if (!opt) throw new Error('Option not found: ' + optionText);
    setNativeValue(el, opt.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Highlight an element briefly so the user sees what the agent is doing
  function flashHighlight(el) {
    try {
      const prev = el.style.outline;
      el.style.outline = '3px solid #ff5c00';
      setTimeout(() => { el.style.outline = prev; }, 800);
    } catch (e) { /* ignore */ }
  }

  async function executeAction(action) {
    // action: { intent, index?, text?, enter?, option?, direction?, pixels?, selector? }
    switch (action.intent) {
      case 'click': {
        const el = elFromIndex(action.index);
        flashHighlight(el);
        doClick(el);
        return { ok: true, detail: 'Clicked ' + describe(el).tag + ' "' + describe(el).text + '"' };
      }
      case 'type': {
        const el = elFromIndex(action.index);
        flashHighlight(el);
        humanType(el, action.text || '', { enter: !!action.enter });
        return { ok: true, detail: 'Typed "' + (action.text || '') + '" into ' + describe(el).tag };
      }
      case 'select': {
        const el = elFromIndex(action.index);
        doSelect(el, action.option);
        return { ok: true, detail: 'Selected ' + action.option };
      }
      case 'scroll': {
        const y = action.direction === 'up' ? -(action.pixels || 600) : (action.pixels || 600);
        window.scrollBy({ top: y, behavior: 'instant' });
        return { ok: true, detail: 'Scrolled ' + (action.direction || 'down') };
      }
      case 'extract': {
        const q = action.selector;
        const nodes = q ? Array.from(document.querySelectorAll(q)) : [];
        return { ok: true, data: nodes.map(n => (n.innerText || n.textContent || '').trim()).filter(Boolean).slice(0, 50) };
      }
      case 'screenshot_page_info': {
        return { ok: true, data: getPageSnapshot() };
      }
      default:
        throw new Error('Unknown intent: ' + action.intent);
    }
  }

  global.__AI_PAGE_AGENT__ = { getPageSnapshot, executeAction, collectElements };
})(window);
