import { loadPlugin } from './load-plugin.mjs';
import { createFormDocument } from './form-dom.mjs';

export const BOOK = '合成角色-剧情指导';
export const CONTENT = '<plot_outline>合成新大纲</plot_outline>';
export const copy = (value) => structuredClone(value);

export function plot(uid = 7, comment = '剧情指导', enabled = true) {
  return { uid, comment, content: '<plot_outline>合成旧大纲</plot_outline>', enabled, keys: ['保留关键词'], order: 41, custom: { keep: '合成扩展字段' } };
}

// 仅模拟已核验的 Helper 边界：updater 是全量替换，setter 是 UID patch；所有数据仅存于内存。
export function createLorebookHelper({ entries = [], updater = false, newUid = 0, missing = false, bindingStyle = 'modern' } = {}) {
  const books = new Map(missing ? [] : [[BOOK, copy(entries)]]);
  const calls = [];
  const hooks = {};
  const state = {
    binding: { primary: '合成主书', additional: ['合成附加书'], custom: { keep: true } },
    bindingResult: undefined,
    applyBinding: true,
    createBookResult: true,
    createResult: undefined,
  };
  let nextUid = newUid;
  const count = (method) => calls.filter((call) => call.method === method).length;
  const get = (name) => {
    if (!books.has(name)) throw new Error('未能找到世界书 ' + name);
    return books.get(name);
  };
  const assign = (items, previous) => {
    const used = new Set(previous.map((item) => item.uid));
    return copy(items).map((item) => {
      if (item.uid !== undefined) return item;
      while (used.has(nextUid)) nextUid++;
      const result = { ...item, uid: nextUid++ };
      used.add(result.uid);
      return result;
    });
  };
  const helper = {
    async getLorebookEntries(name) {
      calls.push({ method: 'get', name });
      const index = count('get');
      await hooks.beforeRead?.(name, index);
      const result = copy(get(name));
      await hooks.afterRead?.(name, index);
      return result;
    },
    async createLorebook(name) {
      calls.push({ method: 'createBook', name });
      await hooks.beforeCreateBook?.(name);
      if (state.createBookResult === true) books.set(name, []);
      return state.createBookResult;
    },
  };
  if (updater) {
    helper.updateLorebookEntriesWith = async function (name, update) {
      calls.push({ method: 'update', name });
      await hooks.beforeUpdate?.(name);
      const previous = await helper.getLorebookEntries(name);
      const next = await update(previous);
      if (!Array.isArray(next)) throw new Error('模拟 Helper：updater 必须返回完整条目数组');
      calls.push({ method: 'updatePayload', name, entries: copy(next) });
      books.set(name, assign(next, previous));
      await hooks.afterUpdateSave?.(name);
      return helper.getLorebookEntries(name);
    };
  } else {
    helper.createLorebookEntries = async function (name, items) {
      calls.push({ method: 'create', name, entries: copy(items) });
      await hooks.beforeCreate?.(name, items);
      const previous = get(name);
      const added = assign(items, previous);
      books.set(name, previous.concat(added));
      await hooks.afterCreateSave?.(name, added);
      if (state.createResult !== undefined) return state.createResult;
      return { entries: await helper.getLorebookEntries(name), new_uids: added.map((item) => item.uid) };
    };
    helper.setLorebookEntries = async function (name, patches) {
      calls.push({ method: 'set', name, patches: copy(patches) });
      const index = count('set');
      await hooks.beforeSet?.(name, patches, index);
      const next = copy(get(name));
      for (const patch of patches) {
        const entry = next.find((item) => item.uid === patch.uid);
        if (!entry) throw new Error('模拟 Helper：UID 不存在');
        Object.assign(entry, copy(patch));
      }
      books.set(name, next);
      await hooks.afterSetSave?.(name, patches, index);
      return helper.getLorebookEntries(name);
    };
  }
  function readBinding(...args) {
    calls.push({ method: 'getBinding', args });
    hooks.beforeGetBinding?.();
    return copy(state.binding);
  }
  function writeBinding(binding, args) {
    calls.push({ method: 'bind', args: copy(args), binding: copy(binding) });
    hooks.beforeBind?.();
    if (state.applyBinding) state.binding = copy(binding);
    return state.bindingResult;
  }
  if (bindingStyle === 'modern') {
    helper.getCharWorldbookNames = readBinding;
    helper.rebindCharWorldbooks = function (target, binding) { return writeBinding(binding, [target, binding]); };
  } else if (bindingStyle === 'legacy') {
    helper.getCharLorebooks = readBinding;
    helper.setCurrentCharLorebooks = function (binding) { return writeBinding(binding, [binding]); };
  }
  return { helper, books, calls, hooks, state, count };
}

// 大纲专用 DOM 生命周期替身；不修改公共表单 helper。childList 通知按微任务交付。
function observeOutlineDocument(document) {
  const observers = new Set();
  const under = (node, root) => {
    for (let current = node; current; current = current.parentNode) if (current === root) return true;
    return false;
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe(root, options) { this.root = root; this.options = options; observers.add(this); }
    disconnect() { observers.delete(this); this.records = []; }
  }
  function notify(target) {
    if (!target) return;
    for (const observer of observers) {
      if (!observer.options.childList || !(observer.root === target || observer.options.subtree && under(target, observer.root))) continue;
      observer.records.push({ type: 'childList', target });
      if (observer.records.length > 1) continue;
      queueMicrotask(() => {
        const records = observer.records.splice(0);
        if (observers.has(observer) && records.length) observer.callback(records, observer);
      });
    }
  }
  function enhance(element) {
    Object.defineProperty(element, 'isConnected', { get: () => under(element, document.documentElement) });
    element.removeEventListener = (type, listener) => element.handlers.set(type, (element.handlers.get(type) || []).filter((handler) => handler !== listener));
    for (const method of ['appendChild', 'insertBefore', 'remove']) {
      const original = element[method];
      element[method] = function (...args) {
        const target = method === 'remove' ? this.parentNode : this;
        const result = original.apply(this, args);
        notify(target);
        return result;
      };
    }
    return element;
  }
  const createElement = document.createElement;
  document.createElement = (tag) => enhance(createElement(tag));
  enhance(document.body);
  document.documentElement = document.createElement('html');
  document.documentElement.appendChild(document.body);
  return { MutationObserver, activeObservers: () => observers.size };
}

export async function outlineEnv(options = {}) {
  const fixture = createLorebookHelper(options);
  const document = createFormDocument();
  const lifecycle = observeOutlineDocument(document);
  const current = { name2: '合成角色', characterId: 0, avatar: 'synthetic-a.png', chatId: '合成聊天A', getCurrentChatId() { return this.chatId; } };
  const logs = [];
  const toasts = [];
  const window = {
    TavernHelper: fixture.helper,
    SillyTavern: { getContext: () => current },
    toastr: Object.fromEntries(['success', 'warning', 'error'].map((level) => [level, (message) => toasts.push({ level, message })])),
  };
  window.parent = window;
  const { namespace } = await loadPlugin('src/outline-inject.js', {
    window,
    document,
    MutationObserver: lifecycle.MutationObserver,
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map((level) => [level, (...args) => logs.push({ level, args })])),
  }, {
    'src/templates.js': { getTemplate: () => ({ id: 'synthetic', content: '<plot_outline>合成模板</plot_outline>' }), selectedTemplateId: () => 'synthetic' },
  });
  namespace.setStoryOracleApi({ context: { getContext: () => current } });
  function anchor() {
    const message = document.createElement('div');
    document.body.appendChild(message);
    return message;
  }
  function start(message = anchor()) { return namespace.injectOutlineToWorldInfo(CONTENT, message); }
  return { ...fixture, document, current, logs, toasts, window, activeObservers: lifecycle.activeObservers, inject: namespace.injectOutlineToWorldInfo, start, anchor };
}

export async function turn() { await new Promise((resolve) => setImmediate(resolve)); }

export async function panelFor(fixture, index = 0) {
  for (let attempts = 0; attempts < 20; attempts++) {
    const panel = fixture.document.querySelectorAll('.so-inline-choice-panel')[index];
    if (panel) return panel;
    await turn();
  }
  throw new Error('合成测试未收到操作选择面板');
}

export async function choose(panel, label = '新建条目') {
  const button = panel.querySelectorAll('button').find((item) => item.textContent === label);
  if (!button) throw new Error('合成面板缺少操作：' + label);
  await button.click();
}

export async function settle(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve('未完成'), 500); })]);
  } finally {
    clearTimeout(timer);
  }
}
