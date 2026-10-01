// 模块：模板服务端存储
// 作用：大纲模板正文经酒馆 /api/files 存到服务端 user/files/ 目录，列表索引存酒馆
//       extensionSettings（settings.json）。服务端不可用时自动降级 IndexedDB，再兜底
//       localStorage（旧行为）。对外提供同步读（内存缓存）+ 异步写。
// 依赖的都是酒馆公开接口：SillyTavern.getContext().getRequestHeaders / extensionSettings /
//       saveSettingsDebounced（public/scripts/st-context.js 导出），不碰故事神谕本体。
import { LOG_PREFIX, STORAGE_KEY, TEMPLATE_SERVER_FILE_PREFIX, TEMPLATE_SERVER_INDEX_FILE, TEMPLATE_SERVER_INDEX_KEY } from './constants.js';

// 存储层级标识：server = 服务端文件 + settings 索引；idb = IndexedDB；local = localStorage。
export const STORAGE_TIER = { SERVER: 'server', IDB: 'idb', LOCAL: 'local' };

// 内存缓存：模板数组（[{id, name, content}]）+ 数据只存在当前层级。getTemplates() 同步读这里。
let cache = null;
let tier = STORAGE_TIER.LOCAL;
// 初始化完成标记：完成前 getTemplates() 会先读 localStorage 快照（旧行为），保证同步可用。
let initialized = false;
// 降级提示每会话只弹一次。
let downgradeToasted = false;

function getStContext() {
  try {
    if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
      return window.SillyTavern.getContext();
    }
  } catch (e) { /* 酒馆未就绪时静默 */ }
  return null;
}

// ---------- 层 1：服务端文件（/api/files）+ settings 索引 ----------

function stRequestHeaders() {
  const ctx = getStContext();
  if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
  return null;
}

function readSettingsIndex() {
  const ctx = getStContext();
  const index = ctx && ctx.extensionSettings && ctx.extensionSettings[TEMPLATE_SERVER_INDEX_KEY];
  return Array.isArray(index) ? index : null;
}

// 索引读取：优先 user/files/ 下的索引文件（只有本插件会写，不怕其他酒馆标签页整写
// settings.json 时把副本冲掉）；文件不可用时退回 settings.json 副本。
// 无论哪个来源都按 id 去重（历史脏数据 / 多端合并可能产生重复条目）。
async function loadServerIndex() {
  let index = null;
  try {
    const headers = stRequestHeaders();
    const res = await fetch('/user/files/' + TEMPLATE_SERVER_INDEX_FILE + '?t=' + Date.now(), {
      method: 'GET',
      headers: headers || undefined,
    });
    if (res.ok) {
      const body = await res.json();
      if (body && Array.isArray(body.templates)) index = body.templates;
    }
  } catch (e) { /* 走 settings 副本兜底 */ }
  if (!index) index = readSettingsIndex();
  if (!Array.isArray(index)) return [];
  const seen = new Set();
  return index.filter((m) => {
    if (!m || !m.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

async function saveServerIndex(index) {
  const ctx = getStContext();
  if (!ctx || !ctx.extensionSettings) return;
  ctx.extensionSettings[TEMPLATE_SERVER_INDEX_KEY] = index;
  if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
  try {
    await uploadTemplateFile(TEMPLATE_SERVER_INDEX_FILE, JSON.stringify({ templates: index }));
  } catch (e) {
    console.warn(LOG_PREFIX + '索引文件写入失败（settings 副本已更新）:', e);
  }
}

async function uploadTemplateFile(fileName, content) {
  const headers = stRequestHeaders();
  if (!headers) throw new Error('酒馆上下文不可用');
  const base64 = btoa(unescape(encodeURIComponent(content)));
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: fileName, data: base64 }),
  });
  if (!res.ok) throw new Error('上传失败 HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const body = await res.json();
  return body.path;
}

async function downloadTemplateFile(url) {
  const headers = stRequestHeaders();
  const res = await fetch(url, { method: 'GET', headers: headers || undefined });
  if (!res.ok) throw new Error('读取失败 HTTP ' + res.status);
  return res.text();
}

async function deleteTemplateFile(url) {
  const headers = stRequestHeaders();
  if (!headers) throw new Error('酒馆上下文不可用');
  const res = await fetch('/api/files/delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: url }),
  });
  if (!res.ok) throw new Error('删除失败 HTTP ' + res.status);
}

// 文件名合法性与服务端一致（validateAssetFileName 只收 ASCII）；不合法则回退用 id 命名。
// 一律拼上 id 尾巴：名称可读但可能撞名/重名，id 是唯一主键，保证服务端文件互不覆盖。
function serverFileName(id, name) {
  const safe = String(name || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-.]/g, '');
  const base = (safe ? safe + '_' : '') + id;
  return TEMPLATE_SERVER_FILE_PREFIX + base + '.txt';
}

async function readServerAll() {
  const index = await loadServerIndex();
  const templates = [];
  for (const meta of index) {
    // 空内容的模板没有服务端文件（上传时跳过），直接按空内容还原。
    if (!meta.url) {
      templates.push({ id: meta.id, name: meta.name, content: '' });
      continue;
    }
    try {
      const content = await downloadTemplateFile(meta.url);
      templates.push({ id: meta.id, name: meta.name, content });
    } catch (e) {
      console.warn(LOG_PREFIX + '服务端模板读取失败（跳过）:', meta.name, e);
    }
  }
  return templates;
}

// ---------- 层 2：IndexedDB ----------

const IDB_NAME = 'story_oracle_outline';
const IDB_STORE = 'templates';
const IDB_KEY = 'all';

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB 被占用'));
  });
}

async function idbWriteAll(templates) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(JSON.parse(JSON.stringify(templates)), IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbReadAll() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : null);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 旧 localStorage 兜底（迁移源 + 最终兜底层） ----------

function readLocalAll() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const arr = stored ? JSON.parse(stored) : null;
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

function writeLocalAll(templates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch (e) {
    console.warn(LOG_PREFIX + 'localStorage 模板兜底写入失败（可能超 5MB 限制）:', e);
    return false;
  }
}

// ---------- 对外接口 ----------

// 把数组同步进内存缓存与当前层级的持久化。失败时返回 false（调用方决定提示口径）。
export async function persistTemplates(templates) {
  cache = templates;
  // localStorage 兜底始终尽力写一份小模板（超限时静默跳过），保证 IndexedDB/服务端全挂时还有可用快照。
  writeLocalAll(templates);
  if (tier === STORAGE_TIER.SERVER) {
    try {
      // 对照旧索引：被删除的模板、以及重命名导致文件名变化的旧文件，都在保存后清理，
      // 避免 user/files/ 下残留孤儿 .txt。
      const prevIndex = await loadServerIndex();
      const prevById = new Map(prevIndex.map((m) => [m.id, m]));
      const nextIds = new Set(templates.map((t) => t.id));
      // 旧索引里已删除、且确实上传过文件的条目 → 待删孤儿文件（空 url 跳过）。
      const orphanUrls = prevIndex.filter((m) => !nextIds.has(m.id) && m.url).map((m) => m.url);
      const index = [];
      for (const t of templates) {
        const prev = prevById.get(t.id);
        // 服务端对空 data 返回 400（新建模板内容可为空）：空内容不上传，只记索引条目；
        // 若之前上传过文件（内容被清空），旧文件列入孤儿清理。
        if (!t.content) {
          if (prev && prev.url) orphanUrls.push(prev.url);
          index.push({ id: t.id, name: t.name, url: '' });
          continue;
        }
        const url = await uploadTemplateFile(serverFileName(t.id, t.name), t.content);
        if (prev && prev.url && prev.url !== url) orphanUrls.push(prev.url);
        index.push({ id: t.id, name: t.name, url });
      }
      await saveServerIndex(index);
      for (const url of orphanUrls) {
        try {
          await deleteTemplateFile(url);
        } catch (e) {
          console.warn(LOG_PREFIX + '清理服务端旧模板文件失败（不影响保存）:', url, e);
        }
      }
      return true;
    } catch (e) {
      console.warn(LOG_PREFIX + '服务端保存失败，降级 IndexedDB:', e);
      tier = STORAGE_TIER.IDB;
      notifyDowngrade();
    }
  }
  if (tier === STORAGE_TIER.IDB) {
    try {
      await idbWriteAll(templates);
      return true;
    } catch (e) {
      console.warn(LOG_PREFIX + 'IndexedDB 写入失败，降级 localStorage:', e);
      tier = STORAGE_TIER.LOCAL;
      notifyDowngrade();
    }
  }
  return writeLocalAll(templates);
}

// 同步读：初始化完成前读 localStorage（旧行为），完成后读内存缓存。
// 返回浅拷贝：调用方（templates.js / ui.js）会直接 push/splice 这个数组，
// 不能让它们改到缓存本体（否则 addTemplate 内部 push 一次 + UI 再 push 一次会出现重复项）。
export function getCachedTemplates() {
  if (!initialized) {
    const local = readLocalAll();
    return local && local.length ? local.slice() : null;
  }
  return cache ? cache.slice() : null;
}

export function currentTier() {
  return tier;
}

function notifyDowngrade() {
  if (downgradeToasted) return;
  downgradeToasted = true;
  import('./toast.js').then(({ showToast }) => {
    showToast('模板服务端存储暂不可用，已降级保存到本浏览器（IndexedDB），下次会话将尝试自动恢复同步。', 'warning');
  }).catch(() => {});
}

// 等酒馆上下文就绪（插件挂载早于酒馆设置加载完成时 getRequestHeaders 可能还不可用），最多 5 秒。
async function waitForStContext(timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const ctx = getStContext();
    if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx;
    if (Date.now() - start >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

// 启动初始化：localStorage → IndexedDB → 服务端 三级探测，选定层级后补齐内存缓存。
// 顺序：有服务端索引则服务端为准（多端一致性）；无则用 IndexedDB/localStorage 快照，
// 并把其独有的模板补传服务端。旧 localStorage key 保留不删（兜底备份）。
export async function initTemplateStorage() {
  if (initialized) return;
  try {
    const local = readLocalAll() || [];
    let idbTemplates = null;
    try {
      idbTemplates = await idbReadAll();
    } catch (e) {
      console.warn(LOG_PREFIX + 'IndexedDB 不可用:', e);
    }

    let serverOk = false;
    let serverIndex = [];
    try {
      serverOk = !!(await waitForStContext());
      if (serverOk) serverIndex = await loadServerIndex();
    } catch (e) {
      serverOk = false;
    }

    if (serverOk) {
      tier = STORAGE_TIER.SERVER;
      let serverTemplates = null;
      if (serverIndex.length > 0) {
        serverTemplates = await readServerAll();
      }
      // 合并：服务端为准，本地快照里服务端没有的（id 不在索引）补传上去。
      const serverIds = new Set(serverIndex.map((m) => m.id));
      // 本地快照 + IndexedDB 里服务端没有的模板 → 补传。按 id 去重（降级会话可能两层都写了同一条）。
      const orphanSeen = new Set();
      const orphans = local.concat(idbTemplates || []).filter((t) => {
        if (!t || !t.id || serverIds.has(t.id) || templatesHas(serverTemplates, t.id)) return false;
        if (orphanSeen.has(t.id)) return false;
        orphanSeen.add(t.id);
        return true;
      });
      const merged = (serverTemplates || []).concat(orphans);
      const defaultMissing = !merged.some((t) => t && t.id === 'default');
      // 自愈：settings 副本被其他标签页覆盖丢失、但索引文件还在时，把副本恢复回去。
      if (serverIndex.length > 0 && !readSettingsIndex()) {
        await saveServerIndex(serverIndex);
      }
      if (orphans.length > 0 || (serverIndex.length === 0 && local.length > 0) || defaultMissing) {
        const base = merged.length ? merged : local;
        if (base.length) await persistTemplates(base);
      }
      cache = merged.length ? merged : local;
    } else if (idbTemplates && idbTemplates.length) {
      tier = STORAGE_TIER.IDB;
      cache = idbTemplates;
    } else {
      tier = STORAGE_TIER.LOCAL;
      cache = local;
    }

    if (!cache.some((t) => t && t.id === 'default')) {
      const { DEFAULT_TEMPLATE } = await import('./constants.js');
      cache = [DEFAULT_TEMPLATE].concat(cache);
      await persistTemplates(cache);
    }
    console.log(LOG_PREFIX + '模板存储已就绪，层级: ' + tier + '，模板数: ' + cache.length);
    // 通知 UI：异步初始化（服务端拉取 / 迁移）完成后主下拉与已展开的管理表单需要刷新。
    try { document.dispatchEvent(new CustomEvent('so-outline-templates-changed')); } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn(LOG_PREFIX + '模板存储初始化失败，维持 localStorage 行为:', e);
    tier = STORAGE_TIER.LOCAL;
    cache = readLocalAll() || [];
  } finally {
    initialized = true;
  }
}

function templatesHas(templates, id) {
  return Array.isArray(templates) && templates.some((t) => t && t.id === id);
}
