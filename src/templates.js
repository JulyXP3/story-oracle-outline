// 模块：大纲模板存储
// 作用：管理大纲模板的持久化、默认模板补齐和当前模板选择。
// 持久化走 storage.js 三层存储（服务端文件 / IndexedDB / localStorage），
// 对外保持同步读接口（内存缓存），写操作异步落盘。
// 保留旧 localStorage key，确保从旧版迁移过来的用户模板不丢失。
import { DEFAULT_TEMPLATE, LOG_PREFIX, SELECTED_TEMPLATE_KEY } from './constants.js';
import { getCachedTemplates, persistTemplates } from './storage.js';

export function getTemplates() {
  const templates = getCachedTemplates();
  if (!templates || !templates.length) return [DEFAULT_TEMPLATE];
  if (!templates.find((t) => t && t.id === 'default')) templates.unshift(DEFAULT_TEMPLATE);
  return templates;
}

// 把内存里的模板数组落盘。返回 Promise<boolean>，UI 层可 await 后提示成功/失败。
export async function saveTemplates(templates) {
  try {
    return await persistTemplates(templates);
  } catch (e) {
    console.error(LOG_PREFIX + '模板保存失败:', e);
    return false;
  }
}

export async function addTemplate(name, content) {
  const templates = getTemplates();
  const newTemplate = {
    // 加随机尾巴：Date.now() 在快速连点时可能同毫秒撞车，而 id 是跨存储层的同步主键，必须唯一。
    id: 'template_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: name || '新模板',
    content: content || '',
  };
  templates.push(newTemplate);
  const ok = await saveTemplates(templates);
  return ok ? newTemplate : null;
}

export async function updateTemplate(id, updates) {
  const templates = getTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return false;
  templates[index] = Object.assign({}, templates[index], updates);
  return saveTemplates(templates);
}

export async function deleteTemplate(id) {
  if (id === 'default') return false;
  const templates = getTemplates();
  return saveTemplates(templates.filter((t) => t.id !== id));
}

export function getTemplate(id) {
  const templates = getTemplates();
  return templates.find((t) => t.id === id) || templates[0] || DEFAULT_TEMPLATE;
}

export function selectedTemplateId() {
  const select = document.getElementById('so-outline-template-select');
  if (select && select.value) return select.value;
  return localStorage.getItem(SELECTED_TEMPLATE_KEY) || 'default';
}

export function saveSelectedTemplate(id) {
  localStorage.setItem(SELECTED_TEMPLATE_KEY, id);
}
