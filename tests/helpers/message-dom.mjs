// 只实现消息动作实际使用的 DOM 行为，不解析 HTML、不连接浏览器。
class MessageElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.parentNode = null;
    this.children = [];
    this.className = '';
    this.id = '';
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }

  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name) => names().includes(name),
      add: (...added) => { this.className = [...new Set([...names(), ...added])].join(' '); },
      remove: (...removed) => { this.className = names().filter((name) => !removed.includes(name)).join(' '); },
    };
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }

  append(...elements) {
    for (const element of elements) this.insertBefore(element, null);
  }

  appendChild(element) {
    return this.insertBefore(element, null);
  }

  insertBefore(element, reference) {
    if (reference !== null && !this.children.includes(reference)) throw new Error('参照节点不属于当前父节点');
    if (element === reference) return element;
    element.remove();
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    this.children.splice(index, 0, element);
    element.parentNode = this;
    return element;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  click() {
    for (const listener of this.listeners.get('click') || []) listener({ type: 'click', target: this });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const matches = (element, part) => {
      if (part.startsWith('#')) return element.id === part.slice(1);
      if (part.startsWith('.')) return part.slice(1).split('.').every((name) => element.classList.contains(name));
      return element.tagName.toLowerCase() === part.toLowerCase();
    };
    const selected = [];
    const visit = (element) => {
      if (matches(element, parts[parts.length - 1])) {
        let ancestor = element.parentNode;
        let index = parts.length - 2;
        while (ancestor && index >= 0) {
          if (matches(ancestor, parts[index])) index--;
          ancestor = ancestor.parentNode;
        }
        if (index < 0) selected.push(element);
      }
      for (const child of element.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return selected;
  }
}

export function createMessageDom() {
  const document = { activeElement: null };
  document.createElement = (tagName) => new MessageElement(tagName, document);
  document.body = document.createElement('body');
  document.querySelector = (selector) => document.body.querySelector(selector);
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  const windowEl = document.createElement('div');
  windowEl.id = 'so-window';
  const panel = document.createElement('div');
  panel.id = 'so-messages';
  panel.clientHeight = 600;
  windowEl.append(panel);
  document.body.append(windowEl);

  function addMessage(rawText, { streaming = false, assistant = true } = {}) {
    const message = document.createElement('div');
    message.className = 'so-msg ' + (assistant ? 'so-assistant' : 'so-user');
    if (streaming) message.classList.add('so-streaming');
    const content = document.createElement('div');
    content.className = 'so-content';
    content.dataset.soRaw = rawText;
    content.textContent = rawText;
    content.style.display = '';
    message.append(content);
    panel.append(message);
    return { message, content };
  }

  return { document, panel, addMessage };
}
