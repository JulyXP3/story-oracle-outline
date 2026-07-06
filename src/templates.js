// 模块：大纲模板存储
// 作用：管理大纲模板的 localStorage 持久化、默认模板补齐和当前模板选择。
// 保留旧 key，确保从补丁版迁移过来的用户模板不丢失。
import { DEFAULT_TEMPLATE, LOG_PREFIX, SELECTED_TEMPLATE_KEY, STORAGE_KEY } from './constants.js';

export function getTemplates() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const templates = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(templates)) return [DEFAULT_TEMPLATE];
    if (!templates.find((t) => t && t.id === 'default')) templates.unshift(DEFAULT_TEMPLATE);
    return templates;
  } catch (e) {
    console.error(LOG_PREFIX + '模板加载失败:', e);
    return [DEFAULT_TEMPLATE];
  }
}

export function saveTemplates(templates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch (e) {
    console.error(LOG_PREFIX + '模板保存失败:', e);
    return false;
  }
}

export function addTemplate(name, content) {
  const templates = getTemplates();
  const newTemplate = {
    id: 'template_' + Date.now(),
    name: name || '新模板',
    content: content || '',
  };
  templates.push(newTemplate);
  saveTemplates(templates);
  return newTemplate;
}

export function updateTemplate(id, updates) {
  const templates = getTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index === -1) return false;
  templates[index] = Object.assign({}, templates[index], updates);
  return saveTemplates(templates);
}

export function deleteTemplate(id) {
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
