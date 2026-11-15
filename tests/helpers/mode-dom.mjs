import { createFormDocument } from './form-dom.mjs';
import { flush } from './storage-env.mjs';

// 仅替代 DOM/事件/MutationObserver；菜单与弹窗状态由真实适配模块维护。
export function modeEnvironment() {
  const document = createFormDocument();
  const prototype = Object.getPrototypeOf(document.body);
  const observers = new Set();
  let queued = false;
  const records = [];
  function contains(root, node) { for (let at = node; at; at = at.parentNode) if (at === root) return true; return false; }
  function notify(target, type = 'childList') {
    records.push({ target, type });
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const batch = records.splice(0);
      for (const observer of [...observers]) {
        const matches = batch.filter((record) => observer.targets.some(({ node, options }) =>
          (record.target === node || (options.subtree && contains(node, record.target))) && options[record.type]));
        if (matches.length) observer.callback(matches);
      }
    });
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; }
    observe(node, options) { this.targets.push({ node, options }); observers.add(this); }
    disconnect() { this.targets = []; observers.delete(this); }
  }
  const text = Object.getOwnPropertyDescriptor(prototype, 'textContent');
  Object.defineProperty(prototype, 'textContent', {
    get: text.get,
    set(value) { for (const child of this.children) child.parentNode = null; text.set.call(this, value); notify(this); },
  });
  const append = prototype.appendChild;
  prototype.appendChild = function (child) { if (child.parentNode) child.remove(); const result = append.call(this, child); notify(this); return result; };
  const remove = prototype.remove;
  prototype.remove = function () { const parent = this.parentNode; remove.call(this); if (parent) notify(parent); };
  const insert = prototype.insertBefore;
  prototype.insertBefore = function (child, ref) { const result = insert.call(this, child, ref); notify(this); return result; };
  Object.defineProperty(prototype, 'isConnected', { get() { return contains(document.body, this); } });
  prototype.contains = function (node) { return contains(this, node); };
  const dataKey = (name) => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  prototype.setAttribute = function (name, value) {
    if (name === 'class') this.className = String(value);
    else if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    else this[name] = String(value);
    notify(this, 'attributes');
  };
  prototype.getAttribute = function (name) {
    if (name === 'class') return this.className;
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? this[name] ?? null;
    return this[name] ?? null;
  };
  prototype.removeAttribute = function (name) {
    if (name.startsWith('data-')) delete this.dataset[dataKey(name)];
    delete this[name];
    notify(this, 'attributes');
  };
  function simpleMatch(node, pattern) {
    const attributes = [...pattern.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
    const base = pattern.replace(/\[[^\]]*\]/g, '');
    const tag = base.match(/^[\w-]+/)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if ([...base.matchAll(/#([\w-]+)/g)].some((match) => node.id !== match[1])) return false;
    if ([...base.matchAll(/\.([\w-]+)/g)].some((match) => !node.classList.contains(match[1]))) return false;
    return attributes.every((match) => match[2] === undefined ? node.getAttribute(match[1]) !== null : node.getAttribute(match[1]) === match[2]);
  }
  prototype.matches = function (selector) {
    return selector.split(',').some((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!simpleMatch(this, parts.pop())) return false;
      let at = this.parentNode;
      while (parts.length) {
        const part = parts.pop();
        while (at && !simpleMatch(at, part)) at = at.parentNode;
        if (!at) return false;
        at = at.parentNode;
      }
      return true;
    });
  };
  prototype.querySelectorAll = function (selector) {
    const result = [];
    const walk = (root) => { for (const child of root.children) { if (child.matches(selector)) result.push(child); walk(child); } };
    walk(this);
    return result;
  };
  prototype.closest = function (selector) { for (let at = this; at; at = at.parentNode) if (at.matches(selector)) return at; return null; };
  prototype.addEventListener = function (type, callback, options = {}) {
    const list = this.handlers.get(type) || [];
    list.push({ callback, capture: options === true || !!options.capture });
    this.handlers.set(type, list);
  };
  prototype.removeEventListener = function (type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter((item) => item.callback !== callback)); };
  prototype.fire = async function (type, extra = {}) {
    const route = [];
    for (let at = this; at; at = at.parentNode) route.push(at);
    let stopped = false;
    const event = { type, target: this, defaultPrevented: false, ...extra,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; },
    };
    for (const [nodes, capture] of [[route.slice().reverse(), true], [route, false]]) {
      for (const node of nodes) {
        for (const item of node.handlers.get(type) || []) {
          if (item.capture === capture) {
            const returned = item.callback(event);
            if (returned && typeof returned.then === 'function') await returned;
          }
          if (stopped) return event;
        }
      }
    }
    return event;
  };
  prototype.click = async function () { if (this.tagName === 'BUTTON' && this.disabled) return; return this.fire('click'); };
  const root = document.createElement('div');
  root.id = 'so-window';
  root.className = 'so-outline-on';
  document.body.appendChild(root);
  root.innerHTML = '<div id="so-chat-menu"><div id="so-keepfloors-btn" class="so-tools-item" data-so-chat-menu="keepfloors" title="原最近楼层">最近楼层</div><div id="so-floors-btn" class="so-tools-item" data-so-chat-menu="floors" title="原浏览器">浏览器</div><div id="so-kb-btn" class="so-tools-item" data-so-chat-menu="kb">知识库</div><div class="so-tools-item" data-so-chat-menu="regex">正则</div><div id="so-bigsum-btn" class="so-tools-item" data-so-chat-menu="bigsum">大总结</div><div id="third-menu" class="so-tools-item" data-so-chat-menu="third">第三方</div></div><input id="so-outline-include-all-chat">';
  const native = [];
  root.querySelector('#so-chat-menu').addEventListener('click', (event) => { const item = event.target.closest('.so-tools-item'); if (item) native.push(item.getAttribute('data-so-chat-menu')); });
  function dialog(room = 'outline', tab = 'browse') {
    const element = document.createElement('dialog');
    element.className = 'so-local-dialog so-owned-dialog so-local-browser';
    element.dataset.room = room;
    element.innerHTML = '<div class="so-local-box"><div class="so-local-head"><span class="so-local-title">楼层浏览器 · 普通聊天</span><button class="so-local-x">关闭</button></div><div class="so-local-tabs"><button class="so-local-tab" data-tab="keep" aria-selected="false">保留最近楼层</button><button class="so-local-tab" data-tab="browse" aria-selected="false">楼层浏览器</button></div><input class="so-floor-keep-n" value="7"><button class="so-floor-keep-save">保存</button><div class="so-floor-list"></div></div>';
    element.querySelector('[data-tab="' + tab + '"]').setAttribute('aria-selected', 'true');
    element.querySelector('.so-local-x').addEventListener('click', () => { native.push('close:' + room); element.remove(); });
    element.querySelector('.so-floor-keep-save').addEventListener('click', () => native.push('save:' + room));
    document.body.appendChild(element);
    return element;
  }
  return { document, root, MutationObserver, observers, native, dialog, flush, checkbox: root.querySelector('#so-outline-include-all-chat') };
}
