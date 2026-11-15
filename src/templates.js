// 模块：大纲模板存储
// 作用：模板 CRUD 按明确操作串行提交；生成选择独立于 DOM，保留旧存储 key。
import { DEFAULT_TEMPLATE, LOG_PREFIX, SELECTED_TEMPLATE_KEY } from './constants.js';
import { commitTemplateOperations, getCachedTemplates, getTemplateStorageStatus, persistTemplates } from './storage.js';

let selectedId = null;

export function getTemplates() {
  const templates = getCachedTemplates() || [];
  const missingDefault = getTemplateStorageStatus().loadErrors.some((item) => item.id === 'default');
  if (!templates.some((item) => item.id === 'default') && !missingDefault) templates.unshift({ ...DEFAULT_TEMPLATE });
  return templates;
}

// 旧全表入口只合并新增/修改，缺项不能代替显式删除。
export async function saveTemplates(templates) {
  try { return await persistTemplates(templates); }
  catch (e) { console.error(LOG_PREFIX + '模板保存失败:', e); return false; }
}

export async function addTemplates(candidates) {
  let created = [];
  const result = await commitTemplateOperations((current) => {
    const names = new Set(current.map((item) => item.name));
    created = candidates.map((candidate) => {
      const base = candidate.name || '新模板';
      let name = base;
      let suffix = 2;
      while (names.has(name)) name = base + '（' + suffix++ + '）';
      names.add(name);
      return {
        id: 'template_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12),
        name,
        content: candidate.content || '',
      };
    });
    return created.map((template) => ({ kind: 'add', template }));
  });
  return result.ok ? created : null;
}

export async function addTemplate(name, content) {
  const created = await addTemplates([{ name, content }]);
  return created ? created[0] : null;
}

export async function updateTemplate(id, updates, options = {}) {
  const base = options.base ? { name: options.base.name, content: options.base.content } : null;
  const change = { ...updates };
  const result = await commitTemplateOperations((current) => {
    const previous = current.find((item) => item.id === id);
    return [{ kind: 'update', id, base: base || previous, next: { name: change.name ?? previous?.name, content: change.content ?? previous?.content } }];
  });
  return result.ok;
}

export async function deleteTemplate(id, options = {}) {
  if (id === 'default') return false;
  const base = options.base ? { name: options.base.name, content: options.base.content } : null;
  const result = await commitTemplateOperations((current) => [{ kind: 'delete', id, base: base || current.find((item) => item.id === id) }]);
  return result.ok;
}

export function getTemplate(id) {
  if (getTemplateStorageStatus().loadErrors.some((item) => item.id === id)) return null;
  const templates = getTemplates();
  return templates.find((item) => item.id === id) || templates[0] || null;
}

export function selectedTemplateId() {
  if (selectedId) return selectedId;
  try { selectedId = localStorage.getItem(SELECTED_TEMPLATE_KEY) || 'default'; }
  catch (e) { selectedId = 'default'; }
  return selectedId;
}

export function saveSelectedTemplate(id) {
  selectedId = id || 'default';
  try { localStorage.setItem(SELECTED_TEMPLATE_KEY, selectedId); }
  catch (e) { console.warn(LOG_PREFIX + '模板选择仅本页生效:', e); }
}
