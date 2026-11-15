export const plain = (value) => JSON.parse(JSON.stringify(value));
export const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

export function fakeClock() {
  let now = 0;
  let nextId = 0;
  const jobs = new Map();
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay = 0) { const id = ++nextId; jobs.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pending() { return jobs.size; },
  };
}

export async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

// 仅替代浏览器持久化和 HTTP，索引及正文仍按生产协议读写。
export function storageEnvironment(options = {}) {
  const defaultTemplate = { id: 'default', name: '默认', content: '自定义默认内容' };
  const templates = options.templates || [defaultTemplate];
  const files = new Map();
  const indexUrl = '/user/files/so-outline-tpl-index.json';
  const index = templates.map((template) => {
    const url = '/user/files/so-outline-tpl-' + template.id + '.txt';
    files.set(url, template.content);
    return { id: template.id, name: template.name, url };
  });
  if (!options.absent) files.set(indexUrl, JSON.stringify({ templates: index }));
  const local = new Map();
  if (options.local) local.set('so_outline_templates', JSON.stringify(options.local));
  let idbData = options.idbData ? plain(options.idbData) : null;
  const calls = [];
  const events = [];
  const warnings = [];
  const settings = {};
  let failLocal = !!options.failLocal;
  let failIdb = !!options.failIdb;
  let handler;
  const ctx = {
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    extensionSettings: settings,
    saveSettingsDebounced: () => {},
  };
  function response(status, value) {
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(value), text: async () => value };
  }
  async function fetch(url, init = {}) {
    calls.push({ url, ...init });
    const override = handler && await handler(url, init);
    if (override) return override;
    const path = url.split('?')[0];
    if (init.signal?.aborted) throw new Error('aborted');
    if (path === '/api/files/upload') {
      const body = JSON.parse(init.body);
      const fileUrl = '/user/files/' + body.name;
      files.set(fileUrl, Buffer.from(body.data, 'base64').toString('utf8'));
      return response(200, JSON.stringify({ path: fileUrl }));
    }
    if (path === '/api/files/delete') {
      files.delete(JSON.parse(init.body).path);
      return response(200, '{}');
    }
    return files.has(path) ? response(200, files.get(path)) : response(404, 'missing');
  }
  const indexedDB = options.idb ? {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          close() {},
          transaction(store, mode) {
            let pending;
            let stopped = false;
            const tx = {
              error: new Error('IDB 写入失败'),
              abort() { stopped = true; queueMicrotask(() => tx.onabort?.()); },
              objectStore: () => ({
                put(value) {
                  pending = plain(value);
                  queueMicrotask(() => {
                    if (stopped) return;
                    if (failIdb) tx.onerror?.();
                    else { idbData = pending; tx.oncomplete?.(); }
                  });
                },
                get() {
                  const read = {};
                  queueMicrotask(() => {
                    if (stopped) return;
                    read.result = idbData && plain(idbData);
                    read.onsuccess?.();
                    tx.oncomplete?.();
                  });
                  return read;
                },
              }),
            };
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  } : undefined;
  const window = { SillyTavern: { getContext: () => ctx }, indexedDB };
  const globals = {
    window,
    fetch,
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    localStorage: {
      getItem: (key) => local.get(key) ?? null,
      setItem(key, value) { if (failLocal) throw new Error('quota'); local.set(key, String(value)); },
    },
    document: { dispatchEvent(event) { events.push(event.type); options.onEvent?.(event); } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    console: { log() {}, warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
  };
  return {
    globals, templates, files, calls, events, warnings, settings, local, indexUrl,
    response,
    setHandler(fn) { handler = fn; },
    failLocal(value) { failLocal = value; },
    failIdb(value) { failIdb = value; },
    idbData: () => idbData,
    index: () => JSON.parse(files.get(indexUrl)).templates,
    uploadCalls: () => calls.filter((call) => call.url === '/api/files/upload').map((call) => JSON.parse(call.body)),
  };
}
