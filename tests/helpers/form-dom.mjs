// 最小表单 DOM 替身：真实执行 UI 事件，模拟 select 清空/首项自动选中与父子关系。
export function createFormDocument() {
  const listeners = new Map();
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.handlers = new Map();
      this.disabled = false;
      this.hidden = false;
      this._value = '';
      this._text = '';
      this.id = '';
      this.className = '';
    }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get options() { return this.children.filter((child) => child.tagName === 'OPTION'); }
    get classList() {
      return {
        contains: (value) => this.className.split(' ').includes(value),
        add: (value) => { if (!this.classList.contains(value)) this.className += ' ' + value; },
        remove: (value) => { this.className = this.className.split(' ').filter((item) => item !== value).join(' '); },
        toggle: (value, force) => { const enabled = force ?? !this.classList.contains(value); if (enabled) this.classList.add(value); else this.classList.remove(value); return enabled; },
      };
    }
    set innerHTML(html) {
      this.children = [];
      this._text = '';
      this._value = '';
      const stack = [this];
      for (const token of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
        const text = token[0];
        if (!text.startsWith('<')) { stack.at(-1)._text += text; continue; }
        if (text.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        const tag = /^<([a-z0-9-]+)/i.exec(text)[1];
        const element = new Element(tag);
        for (const attr of text.matchAll(/([\w-]+)="([^"]*)"/g)) {
          const [,, value] = attr;
          const key = attr[1];
          if (key === 'class') element.className = value;
          else if (key === 'style') {
            for (const part of value.split(';')) { const [name, val] = part.split(':'); if (name) element.style[name] = val; }
          } else element[key] = value;
        }
        stack.at(-1).appendChild(element);
        if (!['input', 'br', 'hr', 'img'].includes(tag.toLowerCase())) stack.push(element);
      }
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (this.tagName === 'SELECT' && this.options.length === 1) this.value = child.value;
      return child;
    }
    append(...children) { for (const child of children) this.appendChild(child); }
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      if (index < 0) return this.appendChild(child);
      child.parentNode = this;
      this.children.splice(index, 0, child);
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this[name] = value; }
    getAttribute(name) { return this[name]; }
    addEventListener(type, fn) {
      const list = this.handlers.get(type) || [];
      list.push(fn);
      this.handlers.set(type, list);
    }
    async fire(type) { for (const fn of this.handlers.get(type) || []) await fn({ target: this, preventDefault() {} }); }
    async click() { if (!this.disabled) await this.fire('click'); }
    focus() { this.focused = true; }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map((value) => value.trim());
      const matches = (element, pattern) => {
        if (pattern.startsWith('#')) return element.id === pattern.slice(1);
        if (pattern.startsWith('.')) return element.classList.contains(pattern.slice(1));
        return element.tagName === pattern.toUpperCase();
      };
      const result = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (selectors.some((pattern) => matches(child, pattern))) result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Element('body');
  const document = {
    body,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => body.querySelector('#' + id),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
  };
  return document;
}
