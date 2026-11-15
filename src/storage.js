// 模块：模板服务端存储
// 作用：正文与权威索引走酒馆 /api/files；失败时降级 IndexedDB / localStorage。
// 同页写操作串行，只有持久化成功才发布缓存；不由旧列表缺项推断删除。
import { DEFAULT_TEMPLATE, LOG_PREFIX, STORAGE_KEY, TEMPLATE_SERVER_FILE_PREFIX, TEMPLATE_SERVER_INDEX_FILE, TEMPLATE_SERVER_INDEX_KEY } from './constants.js';

export const STORAGE_TIER = { SERVER: 'server', IDB: 'idb', LOCAL: 'local' };
const STORAGE_TIMEOUT_MS = 15000;
const IDB_NAME = 'story_oracle_outline';
const IDB_STORE = 'templates';
const IDB_KEY = 'all';
let cache = null;
let tier = STORAGE_TIER.LOCAL;
let initialized = false;
let initPromise = null;
let writeTail = Promise.resolve();
let pendingWrites = 0;
let loadErrors = [];
let knownIndex = [];
let lastResult = null;
let downgradeToasted = false;
let localBackup = [];
let mirrorController = null;
const cleanupCandidates = new Set();

function copyTemplates(templates) {
  return (templates || []).map(({ id, name, content }) => ({ id, name, content }));
}

// 同 ID 优先第一份，另一层独有 ID 仍保留；这里只合并本地备份，不推断跨端删除。
function mergeBackups(preferred, other) {
  const ids = new Set(preferred.map((item) => item.id));
  return copyTemplates([...preferred, ...other.filter((item) => !ids.has(item.id))]);
}

// 操作记录只允许标量字段，逐层取值，不能跨异步等待保留调用方对象。
function copyOperations(operations) {
  if (!Array.isArray(operations)) throw storageError('invalid', '模板操作必须为数组', true);
  const scalar = (value) => typeof value === 'string' ? value : undefined;
  const template = (value) => value ? { id: scalar(value.id), name: scalar(value.name), content: scalar(value.content) } : null;
  return operations.map((op) => ({
    kind: scalar(op?.kind), id: scalar(op?.id),
    template: template(op?.template), base: template(op?.base), next: template(op?.next),
  }));
}

function storageError(code, message, noFallback = false) {
  return Object.assign(new Error(message), { code, noFallback });
}

function checkActive(signal) {
  if (signal && signal.aborted) throw storageError('unavailable', '模板操作超时或已取消');
}

// 即使 HTTP 包装器忽略 abort，等待也必须结束；迟到结果由 signal 检查隔离。
async function waitForRequest(work, signal) {
  checkActive(signal);
  if (!signal) return work();
  let abort;
  const cancelled = new Promise((resolve, reject) => {
    abort = () => reject(storageError('unavailable', '模板请求超时或已取消'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([work(), cancelled]);
    checkActive(signal);
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}

function getStContext() {
  try { return window.SillyTavern?.getContext?.() || null; } catch (e) { return null; }
}

function headers() {
  const value = getStContext()?.getRequestHeaders?.();
  if (!value) throw storageError('unavailable', '酒馆上下文不可用');
  return value;
}

function emitChanged() {
  try { document.dispatchEvent(new CustomEvent('so-outline-templates-changed')); } catch (e) { /* 未挂载界面时忽略 */ }
}

function normalizeTemplates(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  return value.filter((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || typeof item.content !== 'string' || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map(({ id, name, content }) => ({ id, name, content }));
}

function withDefault(templates, errors = []) {
  const result = copyTemplates(templates);
  if (!result.some((item) => item.id === 'default') && !errors.some((item) => item.id === 'default')) result.unshift({ ...DEFAULT_TEMPLATE });
  return result;
}

function readLocalAll() {
  try { return normalizeTemplates(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { return null; }
}

function writeLocalAll(templates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch (e) {
    console.warn(LOG_PREFIX + 'localStorage 模板写入失败:', e);
    return false;
  }
}

// 只访问本插件的用户文件，防止损坏的索引把认证请求引向其他地址。
function templateUrl(value) {
  if (!value) return '';
  const path = String(value).replace(/^\//, '');
  if (!/^user\/files\/so-outline-tpl-[a-zA-Z0-9_.-]+$/.test(path)) throw storageError('unavailable', '模板索引包含无效文件路径');
  return '/' + path;
}

function validateIndex(index) {
  if (!Array.isArray(index)) throw storageError('unavailable', '模板索引格式错误');
  const seen = new Set();
  const result = [];
  for (const item of index) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || typeof item.url !== 'string') throw storageError('unavailable', '模板索引条目损坏');
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({ id: item.id, name: item.name, url: templateUrl(item.url) });
  }
  return result;
}

async function loadServerIndex(signal) {
  checkActive(signal);
  const res = await waitForRequest(() => fetch('/user/files/' + TEMPLATE_SERVER_INDEX_FILE + '?t=' + Date.now(), { method: 'GET', headers: headers(), signal, cache: 'no-store' }), signal);
  checkActive(signal);
  if (res.status === 404) {
    const mirror = getStContext()?.extensionSettings?.[TEMPLATE_SERVER_INDEX_KEY];
    return { state: 'absent', index: mirror ? validateIndex(mirror) : [] };
  }
  if (!res.ok) throw storageError('unavailable', '读取模板索引失败 HTTP ' + res.status);
  const body = await waitForRequest(() => res.json(), signal);
  checkActive(signal);
  return { state: 'ok', index: validateIndex(body && body.templates) };
}

async function downloadTemplateFile(url, signal) {
  if (!url) return '';
  checkActive(signal);
  const res = await waitForRequest(() => fetch(templateUrl(url), { method: 'GET', headers: headers(), signal, cache: 'no-store' }), signal);
  if (!res.ok) throw storageError('unavailable', '读取模板正文失败 HTTP ' + res.status);
  const content = await waitForRequest(() => res.text(), signal);
  checkActive(signal);
  return content;
}

async function uploadTemplateFile(fileName, content, signal) {
  checkActive(signal);
  const data = btoa(unescape(encodeURIComponent(content)));
  const res = await waitForRequest(() => fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name: fileName, data }), signal }), signal);
  if (!res.ok) throw storageError('unavailable', '上传模板失败 HTTP ' + res.status);
  const body = await waitForRequest(() => res.json(), signal);
  checkActive(signal);
  if (!body || !body.path) throw storageError('unavailable', '上传模板未返回文件路径');
  return templateUrl(body.path);
}

function mirrorSettings(index) {
  try {
    const ctx = getStContext();
    if (!ctx?.extensionSettings) return;
    ctx.extensionSettings[TEMPLATE_SERVER_INDEX_KEY] = index.map((item) => ({ ...item }));
    ctx.saveSettingsDebounced?.();
  } catch (e) { console.warn(LOG_PREFIX + '模板索引镜像更新失败（权威索引已保存）:', e); }
}

function serverFileName(id, name) {
  const safe = (String(name) + '_' + String(id)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 130);
  const revision = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  return TEMPLATE_SERVER_FILE_PREFIX + safe + '_' + revision + '.txt';
}

async function readServerAll(index, signal, reuse = null) {
  const templates = [];
  const errors = [];
  for (const meta of index) {
    checkActive(signal);
    const previous = reuse?.index.find((item) => item.id === meta.id && item.name === meta.name && item.url === meta.url);
    const cached = previous && reuse.templates.find((item) => item.id === meta.id);
    try {
      const content = cached ? cached.content : await downloadTemplateFile(meta.url, signal);
      templates.push({ id: meta.id, name: meta.name, content });
    } catch (e) {
      checkActive(signal);
      errors.push({ ...meta, message: '正文未读取，暂不可编辑' });
      console.warn(LOG_PREFIX + '模板正文未读取（保留索引）:', meta.id, e);
    }
  }
  return { templates, errors };
}

// 数据库连接、事务与等待均可结束；事务完成才算成功，不把 put 请求成功当落盘。
function idbAccess(mode, templates, signal) {
  return new Promise((resolve, reject) => {
    let db;
    let tx;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      db?.close();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => {
      try { tx?.abort(); } catch (e) { /* 事务可能已完成 */ }
      finish(storageError('unavailable', 'IndexedDB 操作超时或被占用'));
    };
    const timer = setTimeout(abort, STORAGE_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    try {
      if (!window.indexedDB) throw new Error('浏览器不支持 IndexedDB');
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onerror = () => finish(req.error || new Error('IndexedDB 打开失败'));
      req.onblocked = () => finish(new Error('IndexedDB 被占用'));
      req.onsuccess = () => {
        db = req.result;
        if (settled) { db.close(); return; }
        try {
          tx = db.transaction(IDB_STORE, mode);
          let value;
          tx.onerror = tx.onabort = () => finish(tx.error || new Error('IndexedDB 事务失败'));
          tx.oncomplete = () => finish(null, value);
          const store = tx.objectStore(IDB_STORE);
          if (mode === 'readwrite') store.put(copyTemplates(templates), IDB_KEY);
          else {
            const read = store.get(IDB_KEY);
            read.onsuccess = () => { value = normalizeTemplates(read.result); };
            read.onerror = () => finish(read.error || new Error('IndexedDB 读取失败'));
          }
        } catch (e) { finish(e); }
      };
    } catch (e) { finish(e); }
  });
}

async function waitForStContext(signal) {
  const start = Date.now();
  while (!getStContext()?.getRequestHeaders) {
    checkActive(signal);
    if (Date.now() - start >= 5000) return false;
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 300);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  return true;
}

function sameTemplate(a, b) {
  return !!a && !!b && a.name === b.name && a.content === b.content;
}

function applyOperations(templates, ops, errors) {
  const map = new Map(copyTemplates(templates).map((item) => [item.id, item]));
  const seen = new Set();
  for (const op of ops) {
    const id = op.kind === 'add' ? op.template?.id : op.id;
    if (!id || seen.has(id)) throw storageError('invalid', '模板操作重复或缺少 ID', true);
    seen.add(id);
    if (errors.some((item) => item.id === id)) throw storageError('unavailable', '目标模板未成功读取，请刷新后重试', true);
    if (op.kind === 'add') {
      const value = normalizeTemplates([op.template]);
      if (!value?.length || map.has(id)) throw storageError('conflict', '新增模板 ID 已存在或数据无效', true);
      map.set(id, value[0]);
    } else {
      const current = map.get(id);
      if (!sameTemplate(current, op.base)) throw storageError('conflict', '模板已变化，草稿已保留，请刷新或另存', true);
      if (op.kind === 'delete' && id !== 'default') map.delete(id);
      else if (op.kind === 'update' && typeof op.next?.name === 'string' && typeof op.next?.content === 'string') map.set(id, { id, name: op.next.name, content: op.next.content });
      else throw storageError('invalid', '不支持的模板操作', true);
    }
  }
  return [...map.values()];
}

function indexMatches(a, b) {
  return a.length === b.length && a.every((item) => b.some((other) => other.id === item.id && other.name === item.name && other.url === item.url));
}

async function commitServer(ops, candidate, signal, sourceIndex = knownIndex) {
  const current = (await loadServerIndex(signal)).index;
  const next = new Map(current.map((item) => [item.id, { ...item }]));
  // 先核验所有目标，再开始上传；读取失败不能当作空正文或普通网络降级。
  for (const op of ops) {
    const id = op.kind === 'add' ? op.template.id : op.id;
    const meta = next.get(id);
    if (op.kind === 'add') {
      if (meta) throw storageError('conflict', '另一端已有相同 ID 的模板', true);
    } else {
      if (!meta) throw storageError('conflict', '目标模板已被另一端删除', true);
      let content;
      try { content = await downloadTemplateFile(meta.url, signal); } catch (e) { throw storageError('unavailable', '无法核对目标正文，草稿已保留', true); }
      if (!sameTemplate({ name: meta.name, content }, op.base)) throw storageError('conflict', '另一端已修改目标模板，草稿已保留', true);
    }
  }
  for (const op of ops) {
    const id = op.kind === 'add' ? op.template.id : op.id;
    const old = next.get(id);
    if (op.kind === 'delete') next.delete(id);
    else {
      const template = candidate.find((item) => item.id === id);
      const url = template.content ? await uploadTemplateFile(serverFileName(id, template.name), template.content, signal) : '';
      if (url) cleanupCandidates.add(url);
      next.set(id, { id, name: template.name, url });
    }
    if (old?.url) cleanupCandidates.add(old.url);
  }
  const index = [...next.values()];
  await uploadTemplateFile(TEMPLATE_SERVER_INDEX_FILE, JSON.stringify({ templates: index }), signal);
  const verified = await loadServerIndex(signal);
  if (verified.state !== 'ok' || !indexMatches(index, verified.index)) throw storageError('conflict', '索引写后检查发现竞争，请保留草稿并刷新', true);
  // 权威提交已核验：只同步组装已知正文，不再等待未触及项目或本地镜像。
  const touched = new Set(ops.map((op) => op.template?.id || op.id));
  const templates = [];
  const errors = [];
  for (const meta of index) {
    const reusable = touched.has(meta.id) || sourceIndex.some((item) => item.id === meta.id && item.name === meta.name && item.url === meta.url);
    const cached = reusable && candidate.find((item) => item.id === meta.id);
    if (cached || !meta.url) templates.push({ id: meta.id, name: meta.name, content: cached ? cached.content : '' });
    else errors.push({ ...meta, message: '正文未读取，暂不可编辑' });
    cleanupCandidates.delete(meta.url);
  }
  mirrorSettings(index);
  return { index, templates, errors };
}

function backupFor(candidate) {
  const unreadIds = new Set(loadErrors.map((item) => item.id));
  const preserved = mergeBackups(localBackup, readLocalAll() || []).filter((item) => unreadIds.has(item.id));
  return mergeBackups(candidate, preserved);
}

async function saveLocal(candidate) {
  const backup = backupFor(candidate);
  // HTTP/前一层超时不能取消下一层兜底；已处于 local 时不再等待已知不可用的 IDB。
  if (tier !== STORAGE_TIER.LOCAL) {
    try {
      await idbAccess('readwrite', backup);
      localBackup = copyTemplates(backup);
      writeLocalAll(backup);
      return STORAGE_TIER.IDB;
    } catch (e) { console.warn(LOG_PREFIX + 'IndexedDB 模板保存不可用:', e); }
  }
  if (writeLocalAll(backup)) {
    localBackup = copyTemplates(backup);
    return STORAGE_TIER.LOCAL;
  }
  throw storageError('quota', '所有模板存储层均保存失败，草稿未保存');
}

function startLocalMirror(templates) {
  const backup = copyTemplates(templates);
  if (writeLocalAll(backup)) localBackup = copyTemplates(backup);
  const controller = new AbortController();
  mirrorController = controller;
  // 不阻塞已提交结果；下一笔写入前取消旧镜像，禁止迟到事务倒写。
  void idbAccess('readwrite', backup, controller.signal).then(() => {
    if (!controller.signal.aborted) localBackup = copyTemplates(backup);
  }).catch(() => {}).finally(() => {
    if (mirrorController === controller) mirrorController = null;
  });
}

function notifyDowngrade() {
  if (downgradeToasted) return;
  downgradeToasted = true;
  const label = tier === STORAGE_TIER.IDB ? 'IndexedDB' : 'localStorage';
  import('./toast.js').then(({ showToast }) => {
    showToast('模板仅保存到本浏览器（' + label + '），尚未同步服务端。', 'warning');
  }).catch(() => {});
}

export function initTemplateStorage() {
  if (initPromise) return initPromise;
  const controller = new AbortController();
  let fallback = readLocalAll() || [];
  let fallbackTier = STORAGE_TIER.LOCAL;
  initPromise = (async () => {
    let timeout;
    // 总期限先于各层计时器建立，避免某层恰好在15秒拒绝后又继续初始化。
    const deadline = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(storageError('unavailable', '模板初始化超过15秒，使用本地快照'));
      }, STORAGE_TIMEOUT_MS);
    });
    const work = (async () => {
      try {
        const local = await idbAccess('readonly', null, controller.signal);
        if (local) { fallback = mergeBackups(local, fallback); fallbackTier = STORAGE_TIER.IDB; }
      } catch (e) { checkActive(controller.signal); }
      if (!(await waitForStContext(controller.signal))) throw storageError('unavailable', '酒馆上下文尚未就绪');
      const state = await loadServerIndex(controller.signal);
      const snapshot = await readServerAll(state.index, controller.signal);
      const ids = new Set(state.index.map((item) => item.id));
      // 仅按明确新增提交旧版迁移项；不回写整表或清理未读取的条目。
      const additions = fallback.filter((item) => !ids.has(item.id));
      if (!ids.has('default') && !additions.some((item) => item.id === 'default')) additions.unshift({ ...DEFAULT_TEMPLATE });
      const templates = [...snapshot.templates, ...additions];
      if (additions.length || state.state === 'absent') {
        const result = await commitServer(additions.map((template) => ({ kind: 'add', template })), templates, controller.signal, state.index);
        return { tier: STORAGE_TIER.SERVER, ...result };
      }
      mirrorSettings(state.index);
      return { tier: STORAGE_TIER.SERVER, index: state.index, ...snapshot };
    })();
    try {
      const result = await Promise.race([work, deadline]);
      cache = copyTemplates(result.templates);
      knownIndex = result.index;
      loadErrors = result.errors;
      tier = result.tier;
    } catch (e) {
      controller.abort();
      cache = withDefault(fallback);
      tier = fallbackTier;
      console.warn(LOG_PREFIX + '模板初始化降级，保留本地快照:', e);
    } finally {
      clearTimeout(timeout);
      localBackup = copyTemplates(fallback);
      initialized = true;
      emitChanged();
    }
  })();
  return initPromise;
}

export function getCachedTemplates() {
  return copyTemplates(initialized ? cache : readLocalAll());
}

export function currentTier() { return tier; }

export function getTemplateStorageStatus() {
  return {
    ready: initialized,
    busy: pendingWrites > 0,
    tier,
    loadErrors: loadErrors.map((item) => ({ ...item })),
    lastResult: lastResult ? { ...lastResult } : null,
  };
}

function enqueueWrite(job) {
  pendingWrites++;
  emitChanged();
  const next = writeTail.then(job, job);
  writeTail = next.catch(() => {});
  return next.finally(() => { pendingWrites--; emitChanged(); });
}

export function commitTemplateOperations(operations) {
  let queuedOperations;
  let inputError;
  try { if (typeof operations !== 'function') queuedOperations = copyOperations(operations); }
  catch (e) { inputError = e; }
  return enqueueWrite(async () => {
    await initTemplateStorage();
    mirrorController?.abort();
    mirrorController = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
    try {
      if (inputError) throw inputError;
      const ops = typeof operations === 'function' ? copyOperations(operations(getCachedTemplates())) : queuedOperations;
      const candidate = applyOperations(cache, ops, loadErrors);
      let savedTier = tier;
      let snapshot = null;
      if (ops.length) {
        if (tier === STORAGE_TIER.SERVER) {
          try { snapshot = await commitServer(ops, candidate, controller.signal); }
          catch (e) {
            if (e.noFallback || e.code === 'conflict') throw e;
            console.warn(LOG_PREFIX + '服务端提交失败，尝试本地保存:', e);
          }
        }
        // HTTP 等待到此为止。已核验提交和独立本地兜底不再受该计时器影响。
        clearTimeout(timeout);
        if (!snapshot) savedTier = await saveLocal(candidate);
        cache = snapshot ? snapshot.templates : candidate;
        if (snapshot) { knownIndex = snapshot.index; loadErrors = snapshot.errors; }
        tier = savedTier;
        // 部分读取也镜像已确认操作；仅补回仍未读项的备份，不保留已删除项。
        if (snapshot) startLocalMirror(backupFor(cache));
        if (tier !== STORAGE_TIER.SERVER) notifyDowngrade();
      }
      lastResult = { ok: true, tier, code: 'saved' };
      return { ...lastResult, templates: getCachedTemplates() };
    } catch (e) {
      lastResult = { ok: false, tier, code: e.code || 'unavailable', error: e.message || '模板保存失败' };
      console.warn(LOG_PREFIX + '模板操作未保存:', e);
      return { ...lastResult, templates: getCachedTemplates() };
    } finally { clearTimeout(timeout); }
  });
}

// 兼容旧调用，但数组缺项不是删除；公开 CRUD 改走明确操作与编辑基准。
export async function persistTemplates(templates) {
  const desired = normalizeTemplates(templates);
  if (!desired || desired.length !== templates.length) return false;
  const before = getCachedTemplates();
  const result = await commitTemplateOperations((current) => desired.flatMap((next) => {
    const base = before.find((item) => item.id === next.id) || current.find((item) => item.id === next.id);
    if (!base) return [{ kind: 'add', template: next }];
    return sameTemplate(base, next) ? [] : [{ kind: 'update', id: next.id, base, next }];
  }));
  return result.ok;
}
