// PageAgent-style DOM automation engine (inspired by browser-use / Claude for Chrome)
// Runs in the page context. Builds a numbered interactive-element tree from the
// ACCESSIBILITY semantics of each element (role + accessible name), supports smart
// element finding, and executes actions: click, type, select, form_fill, drag_drop,
// scroll, extract.

(function (global) {
  'use strict';

  const INTERACTIVE_SELECTORS = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[role="checkbox"]', '[role="radio"]', '[role="menuitem"]', '[role="tab"]',
    '[role="searchbox"]', '[role="switch"]', '[role="slider"]',
    '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
    'label', 'summary', '[draggable="true"]'
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

  // ---- Accessibility-tree style description ----
  const ROLE_MAP = {
    a: 'link', button: 'button', input: (t) => ({
      text: 'textbox', search: 'searchbox', email: 'textbox', password: 'textbox',
      number: 'spinbutton', checkbox: 'checkbox', radio: 'radio', range: 'slider',
      submit: 'button', file: 'button', date: 'textbox', tel: 'textbox', url: 'textbox',
    }[t] || 'textbox'), textarea: 'textbox', select: 'combobox', summary: 'button', label: 'LabelText',
  };

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const r = ROLE_MAP[tag];
    if (typeof r === 'function') return r((el.getAttribute('type') || 'text').toLowerCase());
    if (r) return r;
    if (el.isContentEditable) return 'textbox';
    return tag;
  }

  function getAccessibleName(el) {
    return (
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] ? el.labels[0].innerText : '') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      (el.innerText || '').trim() ||
      el.value ||
      el.name ||
      ''
    ).trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function describe(el) {
    const role = getRole(el);
    const name = getAccessibleName(el);
    const type = el.getAttribute('type') || '';
    const href = el.tagName === 'A' ? el.href : '';
    const value = (role === 'textbox' || role === 'combobox') ? String(el.value || '').slice(0, 40) : '';
    return { role, name, type, href, value, tag: el.tagName.toLowerCase() };
  }

  // Collect + number all interactive elements on the page
  function collectElements() {
    registry = [];
    const seen = new Set();
    const els = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS))
      .filter(el => isVisible(el) && !seen.has(el) && seen.add(el));
    els.forEach((el, i) => {
      el.setAttribute('data-ai-index', String(i));
      registry.push(el);
    });
    return registry;
  }

  // Build a compact "accessibility snapshot" text for the LLM prompt
  function getPageSnapshot(maxChars = 15000) {
    collectElements();
    const lines = [];
    lines.push(`URL: ${location.href}`);
    lines.push(`TITLE: ${document.title}`);
    lines.push('--- Visible text (truncated) ---');
    lines.push((document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, Math.floor(maxChars * 0.35)));
    lines.push('--- Interactive elements ([index] role "name") ---');
    registry.forEach((el, i) => {
      const d = describe(el);
      let line = `[${i}] ${d.role}`;
      if (d.type && d.tag === 'input') line += `(${d.type})`;
      if (d.name) line += ` "${d.name}"`;
      if (d.value) line += ` value="${d.value}"`;
      if (d.href) line += ` -> ${d.href.slice(0, 100)}`;
      if (el.getAttribute('draggable') === 'true') line += ` [draggable]`;
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

  // Smart element finding: fuzzy match by name/role/selector when index is missing
  function findElement(query, roleHint) {
    if (query == null) return null;
    const q = String(query).toLowerCase();
    let best = null, bestScore = 0;
    registry.forEach((el, i) => {
      const d = describe(el);
      if (roleHint && d.role !== roleHint) return;
      const name = d.name.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.includes(q)) score = 60;
      else if (q.includes(name) && name.length > 2) score = 40;
      else {
        const words = q.split(/\s+/);
        score = words.filter(w => w.length > 2 && name.includes(w)).length * 15;
      }
      if (score > bestScore) { bestScore = score; best = { el, i }; }
    });
    return bestScore >= 15 ? best : null;
  }

  function resolveTarget(action, roleHint) {
    if (action.index != null) return { el: elFromIndex(action.index), i: Number(action.index) };
    const found = findElement(action.target ?? action.text_hint, roleHint);
    if (!found) throw new Error('Could not find element matching "' + (action.target ?? action.text_hint) + '"');
    return found;
  }

  // On-screen box for CDP real-mouse operations
  function getBox(index) {
    const el = elFromIndex(index);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }

  function humanType(el, text, options = {}) {
    el.focus();
    if (options.clear !== false) setNativeValue(el, '');
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

  // HTML5 drag & drop event simulation fallback (CDP path preferred)
  function doDragDrop(fromEl, toEl) {
    const dt = new DataTransfer();
    const fire = (el, type, init) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...init }));
    fromEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fire(fromEl, 'dragstart');
    fire(toEl, 'dragenter');
    fire(toEl, 'dragover');
    fire(toEl, 'drop');
    fire(fromEl, 'dragend');
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
    switch (action.intent) {
      case 'click': {
        const t = resolveTarget(action);
        flashHighlight(t.el);
        doClick(t.el);
        return { ok: true, detail: `Clicked [${t.i}] ${describe(t.el).role} "${describe(t.el).name}"` };
      }
      case 'type': {
        const t = resolveTarget(action, 'textbox');
        flashHighlight(t.el);
        humanType(t.el, action.text || '', { enter: !!action.enter });
        return { ok: true, detail: `Typed "${(action.text || '').slice(0, 60)}" into [${t.i}]` };
      }
      case 'select': {
        const t = resolveTarget(action, 'combobox');
        doSelect(t.el, action.option);
        return { ok: true, detail: `Selected "${action.option}" in [${t.i}]` };
      }
      case 'form_fill': {
        const filled = [];
        for (const f of (action.fields || [])) {
          try {
            const t = resolveTarget(f, 'textbox');
            humanType(t.el, f.text || '');
            flashHighlight(t.el);
            filled.push(`[${t.i}]="${String(f.text).slice(0, 30)}"`);
          } catch (e) { filled.push('skip:' + e.message); }
        }
        if (action.submit_index != null) {
          try { doClick(elFromIndex(action.submit_index)); filled.push('submitted'); } catch (e) {}
        }
        return { ok: true, detail: 'Form filled: ' + filled.join(', ') };
      }
      case 'drag_drop': {
        const from = action.from_index != null ? elFromIndex(action.from_index) : resolveTarget({ target: action.from_target }).el;
        const to = action.to_index != null ? elFromIndex(action.to_index) : resolveTarget({ target: action.to_target }).el;
        flashHighlight(from); flashHighlight(to);
        doDragDrop(from, to);
        return { ok: true, detail: `Dragged [${action.from_index}] onto [${action.to_index}] (HTML5 events)` };
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

  global.__AI_PAGE_AGENT__ = { getPageSnapshot, executeAction, collectElements, getBox, findElement };
})(window);
