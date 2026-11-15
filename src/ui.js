// 模块：大纲模式设置栏 UI
// 作用：管理模板选择、编辑草稿与导入导出；生成模板和编辑目标各自独立。
import { addTemplate, deleteTemplate, getTemplates, saveSelectedTemplate, selectedTemplateId, updateTemplate } from './templates.js';
import { exportTemplateAsFile, importTemplatesFromFiles } from './template-io.js';
import { getTemplateStorageStatus } from './storage.js';
import { handleTagFix } from './message-actions.js';
import { LOG_PREFIX, OUTLINE_INCLUDE_ALL_CHAT_KEY, OUTLINE_INCLUDE_PLOT_GUIDES_KEY } from './constants.js';
import { notifyOutlineHistoryChanged } from './mode-compat.js';
import { showToast } from './toast.js';

const formStates = new WeakMap();
let templatesChangedBound = false;

function addOption(select, id, name, disabled = false) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = name;
  option.disabled = disabled;
  select.appendChild(option);
}

function storageLabel(status) {
  if (!status.ready) return '模板初始化中，最长等待15秒；暂不可编辑';
  if (status.busy) return '正在保存模板…';
  if (status.lastResult?.ok === false) return '未保存：' + (status.lastResult.error || '请保留草稿后重试');
  const location = status.tier === 'server' ? '后端' : '本浏览器（' + (status.tier === 'idb' ? 'IndexedDB' : 'localStorage') + '，尚未同步后端）';
  return (status.lastResult?.ok ? '已保存到' : '当前模板读取来源: ') + location + (status.loadErrors.length ? '；部分模板未加载，暂不可编辑' : '');
}

function populateTemplateSelector(select) {
  if (!select) return;
  // 必须在清空 select 前取得选择，不能让浏览器自动选中的首项替代用户意图。
  const selected = selectedTemplateId();
  const status = getTemplateStorageStatus();
  const templates = getTemplates();
  select.innerHTML = '';
  templates.forEach((template) => addOption(select, template.id, template.name));
  status.loadErrors.forEach((item) => addOption(select, item.id, item.name + '（未加载）', true));
  const available = templates.some((item) => item.id === selected);
  const next = available ? selected : (templates.find((item) => item.id === 'default') || templates[0])?.id;
  if (next) {
    select.value = next;
    if (status.ready && selected !== next) {
      saveSelectedTemplate(next);
      showToast('原选模板不可用，已选择可用模板，请确认后发送', 'warning');
    }
  } else {
    addOption(select, '', '没有可用模板', true);
    select.value = '';
  }
  select.disabled = !status.ready || !next;
  if (!select.dataset.listenerAdded) {
    select.addEventListener('change', () => saveSelectedTemplate(select.value));
    select.dataset.listenerAdded = 'true';
  }
}

function sameBase(template, base) {
  return !!template && !!base && template.name === base.name && template.content === base.content;
}

function updateDraft(form) {
  const state = formStates.get(form);
  if (!state) return;
  state.draftName = form.querySelector('#so-template-edit-name').value;
  state.draftContent = form.querySelector('#so-template-edit-content').value;
  state.dirty = !sameBase({ name: state.draftName, content: state.draftContent }, state.base);
}

function refreshForm(form) {
  const state = formStates.get(form);
  if (!state) return;
  const templates = getTemplates();
  const select = form.querySelector('#so-template-edit-select');
  select.innerHTML = '';
  templates.forEach((item) => addOption(select, item.id, item.name + (item.id === 'default' ? '（默认）' : '')));
  const status = getTemplateStorageStatus();
  status.loadErrors.forEach((item) => addOption(select, item.id, item.name + '（未加载）', true));
  const target = templates.find((item) => item.id === state.editingId);
  if (state.editingId && !target && !status.loadErrors.some((item) => item.id === state.editingId)) {
    addOption(select, state.editingId, state.draftName + '（目标不存在，草稿保留）', true);
  }
  select.value = state.editingId || '';
  const changed = state.base && !sameBase(target, state.base);
  const message = changed ? '目标已变化或不存在，草稿已保留；请重新选择核对，或复制内容另存。' : (state.dirty ? '有未保存的修改' : '当前编辑已保存版本');
  form.querySelector('#so-template-edit-status').textContent = state.error || message;
  const busy = state.busy || state.choosing || status.busy || !status.ready;
  for (const id of ['so-template-edit-select', 'so-template-edit-new', 'so-template-import']) form.querySelector('#' + id).disabled = busy;
  for (const id of ['so-template-edit-name', 'so-template-edit-content', 'so-template-edit-save']) form.querySelector('#' + id).disabled = busy || !state.editingId;
  form.querySelector('#so-template-edit-delete').disabled = busy || !target || state.editingId === 'default';
  form.querySelector('#so-template-export').disabled = busy || !target;
}

function selectEditingTemplate(form, id) {
  const state = formStates.get(form);
  const template = getTemplates().find((item) => item.id === id);
  if (!template) return false;
  state.editingId = template.id;
  state.base = { name: template.name, content: template.content };
  state.draftName = template.name;
  state.draftContent = template.content;
  state.dirty = false;
  state.error = '';
  form.querySelector('#so-template-edit-name').value = template.name;
  form.querySelector('#so-template-edit-content').value = template.content;
  refreshForm(form);
  return true;
}

async function saveForm(form) {
  const state = formStates.get(form);
  if (!state || state.busy || !getTemplateStorageStatus().ready) return false;
  updateDraft(form);
  const name = state.draftName.trim();
  if (!name) { state.error = '请输入模板名称'; refreshForm(form); return false; }
  const draft = { name, content: state.draftContent };
  const id = state.editingId;
  state.busy = true;
  state.error = '';
  refreshForm(form);
  try {
    const ok = await updateTemplate(id, draft, { base: { ...state.base } });
    if (!ok) {
      state.error = getTemplateStorageStatus().lastResult?.error || '保存失败，草稿已保留，请重试';
      return false;
    }
    state.base = { ...draft };
    state.draftName = draft.name;
    form.querySelector('#so-template-edit-name').value = draft.name;
    updateDraft(form);
    refreshOutlineBarTemplates();
    return true;
  } catch (e) {
    state.error = '保存失败，草稿已保留';
    console.warn(LOG_PREFIX + '模板表单保存失败:', e);
    return false;
  } finally { state.busy = false; refreshForm(form); }
}

// 留在表单内询问，避免切换/关闭先发生而后再发现保存失败。
async function mayLeaveForm(form) {
  const state = formStates.get(form);
  if (!state) return true;
  if (state.busy || state.choosing || getTemplateStorageStatus().busy) return false;
  updateDraft(form);
  if (!state.dirty) return true;
  state.choosing = true;
  const panel = document.createElement('div');
  panel.className = 'so-outline-leave-guard';
  const hint = document.createElement('span');
  hint.textContent = '当前模板有未保存的修改：';
  panel.appendChild(hint);
  const choice = await new Promise((resolve) => {
    for (const [value, label] of [['save', '保存后继续'], ['discard', '放弃修改'], ['cancel', '取消']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'so-outline-mini-btn';
      button.id = 'so-template-leave-' + value;
      button.textContent = label;
      button.addEventListener('click', () => { panel.remove(); resolve(value); });
      panel.appendChild(button);
    }
    form.appendChild(panel);
    refreshForm(form);
  });
  state.choosing = false;
  refreshForm(form);
  if (choice === 'save') return saveForm(form);
  return choice === 'discard';
}

async function runFormAction(form, action) {
  const state = formStates.get(form);
  if (state.busy || !getTemplateStorageStatus().ready) return;
  state.busy = true;
  state.error = '';
  refreshForm(form);
  try { await action(state); }
  catch (e) { state.error = '操作失败，编辑内容已保留'; console.warn(LOG_PREFIX + '模板管理操作失败:', e); }
  finally { state.busy = false; refreshForm(form); refreshOutlineBarTemplates(); }
}

function buildTemplateForm(form) {
  if (formStates.has(form)) return;
  form.innerHTML =
    '<label class="so-field"><span>选择模板</span><select id="so-template-edit-select"></select></label>' +
    '<label class="so-field"><span>模板名称</span><input type="text" id="so-template-edit-name" placeholder="模板名称"></label>' +
    '<label class="so-field"><span>模板内容</span><textarea id="so-template-edit-content" rows="8" placeholder="模板内容"></textarea></label>' +
    '<div id="so-template-edit-status" class="so-outline-storage-status" role="status"></div>' +
    '<div class="so-outline-template-actions">' +
    '<button type="button" class="so-outline-mini-btn" id="so-template-edit-new"><i class="fa-solid fa-plus"></i> 新建</button>' +
    '<button type="button" class="so-outline-mini-btn" id="so-template-edit-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>' +
    '<button type="button" class="so-outline-mini-btn" id="so-template-edit-delete"><i class="fa-solid fa-trash"></i> 删除</button>' +
    '<button type="button" class="so-outline-mini-btn" id="so-template-import"><i class="fa-solid fa-file-import"></i> 导入模板</button>' +
    '<button type="button" class="so-outline-mini-btn" id="so-template-export" title="导出已保存版本"><i class="fa-solid fa-file-export"></i> 导出已保存模板</button>' +
    '</div><input type="file" id="so-template-import-file" accept=".txt" multiple style="display:none">';
  formStates.set(form, { editingId: null, base: null, draftName: '', draftContent: '', dirty: false, busy: false, choosing: false, error: '' });
  for (const id of ['so-template-edit-name', 'so-template-edit-content']) {
    form.querySelector('#' + id).addEventListener('input', () => { updateDraft(form); refreshForm(form); });
  }
  const select = form.querySelector('#so-template-edit-select');
  select.addEventListener('change', async () => {
    const next = select.value;
    select.value = formStates.get(form).editingId || '';
    if (await mayLeaveForm(form)) selectEditingTemplate(form, next);
  });
  form.querySelector('#so-template-edit-save').addEventListener('click', () => saveForm(form));
  form.querySelector('#so-template-edit-new').addEventListener('click', async () => {
    if (!(await mayLeaveForm(form))) return;
    await runFormAction(form, async (state) => {
      const created = await addTemplate('新模板', '');
      if (created) selectEditingTemplate(form, created.id);
      else state.error = '新建模板未保存，原草稿已保留';
    });
  });
  form.querySelector('#so-template-edit-delete').addEventListener('click', async () => {
    if (!(await mayLeaveForm(form)) || !confirm('确定要删除这个模板吗？旧正文文件暂留，列表中将移除此项。')) return;
    await runFormAction(form, async (state) => {
      const ok = await deleteTemplate(state.editingId, { base: { ...state.base } });
      if (ok) selectEditingTemplate(form, getTemplates()[0]?.id);
      else state.error = getTemplateStorageStatus().lastResult?.error || '删除未完成，原草稿已保留';
    });
  });
  const fileInput = form.querySelector('#so-template-import-file');
  form.querySelector('#so-template-import').addEventListener('click', async () => {
    if (!(await mayLeaveForm(form))) return;
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length || !(await mayLeaveForm(form))) return;
    await runFormAction(form, async (state) => {
      const count = await importTemplatesFromFiles(files);
      if (count) selectEditingTemplate(form, getTemplates().at(-1)?.id);
      else state.error = '未导入任何模板，原草稿已保留';
    });
  });
  form.querySelector('#so-template-export').addEventListener('click', () => {
    updateDraft(form);
    const state = formStates.get(form);
    if (state.dirty && !confirm('当前有未保存修改。导出只包含已保存版本，是否继续？')) return;
    exportTemplateAsFile(state.editingId);
  });
  selectEditingTemplate(form, selectedTemplateId()) || selectEditingTemplate(form, getTemplates()[0]?.id);
}

function refreshBar(root = document) {
  populateTemplateSelector(root.querySelector('#so-outline-template-select'));
  const status = getTemplateStorageStatus();
  const label = root.querySelector('#so-outline-storage-status');
  if (label) label.textContent = storageLabel(status);
  const manage = root.querySelector('#so-outline-template-manage');
  if (manage) manage.disabled = !status.ready || status.busy;
  const form = root.querySelector('#so-outline-template-form');
  if (form) refreshForm(form);
}

export function refreshOutlineBarTemplates() { refreshBar(); }

export function buildOutlineBar(barEl, api) {
  if (!templatesChangedBound) {
    templatesChangedBound = true;
    document.addEventListener('so-outline-templates-changed', () => refreshBar());
  }
  barEl.innerHTML =
    '<div class="so-outline-template-selector">' +
    '<label class="so-field"><span>大纲模板预设</span><select id="so-outline-template-select"></select></label>' +
    '<div id="so-outline-storage-status" class="so-outline-storage-status" role="status"></div>' +
    '<div class="so-outline-row so-outline-template-row">' +
    '<button type="button" class="so-outline-mini-btn" id="so-outline-template-manage"><i class="fa-solid fa-pen-to-square"></i> 管理模板</button>' +
    '</div><div id="so-outline-template-form" style="display:none"></div>' +
    '<div class="so-outline-row so-outline-action-row">' +
    '<div class="so-outline-context-options">' +
    '<div class="so-outline-context-option"><label class="so-checkbox-field"><input type="checkbox" id="so-outline-include-all-chat"><span>附带大纲对话历史</span></label></div>' +
    '<div class="so-outline-context-option"><label class="so-checkbox-field"><input type="checkbox" id="so-outline-include-plot-guides"><span>附带已启用的世界书大纲</span></label></div>' +
    '<div class="so-outline-context-option"><label class="so-checkbox-field"><input type="checkbox" id="so-outline-use-preset"><span>套用补全预设(跟参谋模式同理)</span></label></div></div>' +
    '<button type="button" class="so-outline-mini-btn" id="so-outline-fix-tags" title="为AI回复补充或修正标签"><i class="fa-solid fa-tags"></i> 标签补充(仅限最新一楼)</button>' +
    '</div></div>';
  const form = barEl.querySelector('#so-outline-template-form');
  barEl.querySelector('#so-outline-template-manage').addEventListener('click', async () => {
    if (form.style.display === 'flex') {
      if (await mayLeaveForm(form)) {
        form.style.display = 'none';
        // 明确放弃或已保存后，下次打开读取新的已保存版本。
        formStates.delete(form);
      }
    } else { buildTemplateForm(form); form.style.display = 'flex'; }
  });
  for (const [id, key] of [
    ['so-outline-include-all-chat', OUTLINE_INCLUDE_ALL_CHAT_KEY],
    ['so-outline-include-plot-guides', OUTLINE_INCLUDE_PLOT_GUIDES_KEY],
  ]) {
    const checkbox = barEl.querySelector('#' + id);
    checkbox.checked = false;
    try { checkbox.checked = localStorage.getItem(key) === 'true'; } catch (e) { /* 本页默认关闭 */ }
    checkbox.addEventListener('change', () => {
      try { localStorage.setItem(key, String(checkbox.checked)); } catch (e) {
        console.warn(LOG_PREFIX + '上下文选项未能保存到本浏览器。');
        showToast('选项在本页仍有效，但未能保存；刷新后可能不保留。', 'warning');
      }
      if (key === OUTLINE_INCLUDE_ALL_CHAT_KEY) notifyOutlineHistoryChanged();
    });
  }
  barEl.querySelector('#so-outline-fix-tags').addEventListener('click', () => handleTagFix(api));
  refreshBar(barEl);
}
