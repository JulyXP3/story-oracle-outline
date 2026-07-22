// 模块：大纲模式设置栏 UI
// 作用：填充 registerMode 提供的 buildBar 容器，渲染模板选择、模板管理、补全预设开关和标签补充按钮。
import { addTemplate, deleteTemplate, getTemplates, saveSelectedTemplate, selectedTemplateId, updateTemplate } from './templates.js';
import { handleTagFix } from './message-actions.js';
import { OUTLINE_INCLUDE_ALL_CHAT_KEY } from './constants.js';

function refreshTemplateSelector() {
  const select = document.getElementById('so-outline-template-select');
  if (!select) return;
  const currentValue = select.value;
  const templates = getTemplates();
  select.innerHTML = '';
  templates.forEach((template) => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    select.appendChild(option);
  });
  const saved = selectedTemplateId();
  if (saved && templates.find((t) => t.id === saved)) select.value = saved;
  else if (templates.find((t) => t.id === currentValue)) select.value = currentValue;
  else if (templates[0]) select.value = templates[0].id;

  if (!select.dataset.listenerAdded) {
    select.addEventListener('change', (e) => saveSelectedTemplate(e.target.value));
    select.dataset.listenerAdded = 'true';
  }
}

function populateTemplateSelect(selectEl, templates, selectedId) {
  selectEl.innerHTML = '';
  templates.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name + (t.id === 'default' ? '（默认）' : '');
    selectEl.appendChild(opt);
  });
  if (selectedId && templates.find((t) => t.id === selectedId)) selectEl.value = selectedId;
}

function renderTemplateForm() {
  const form = document.getElementById('so-outline-template-form');
  if (!form) return;
  form._templates = getTemplates();
  const templates = form._templates;

  if (!form.dataset.rendered) {
    form.innerHTML =
      '<label class="so-field"><span>选择模板</span><select id="so-template-edit-select"></select></label>' +
      '<label class="so-field"><span>模板名称</span><input type="text" id="so-template-edit-name" placeholder="模板名称"></label>' +
      '<label class="so-field"><span>模板内容</span><textarea id="so-template-edit-content" rows="8" placeholder="模板内容"></textarea></label>' +
      '<div class="so-outline-template-actions">' +
      '<button type="button" class="so-fix-run-btn" id="so-template-edit-new"><i class="fa-solid fa-plus"></i> 新建</button>' +
      '<button type="button" class="so-fix-run-btn" id="so-template-edit-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>' +
      '<button type="button" class="so-fix-run-btn so-btn-danger" id="so-template-edit-delete"><i class="fa-solid fa-trash"></i> 删除</button>' +
      '</div>';
    form.dataset.rendered = 'true';

    const selectEl = form.querySelector('#so-template-edit-select');
    const nameEl = form.querySelector('#so-template-edit-name');
    const contentEl = form.querySelector('#so-template-edit-content');

    selectEl.addEventListener('change', () => {
      const arr = form._templates || [];
      const t = arr.find((item) => item.id === selectEl.value);
      if (!t) return;
      nameEl.value = t.name;
      contentEl.value = t.content;
      form.querySelector('#so-template-edit-delete').disabled = t.id === 'default';
    });

    form.querySelector('#so-template-edit-new').addEventListener('click', () => {
      const arr = form._templates || [];
      const newTpl = addTemplate('新模板', '');
      arr.push(newTpl);
      populateTemplateSelect(selectEl, arr, newTpl.id);
      nameEl.value = newTpl.name;
      contentEl.value = newTpl.content;
      form.querySelector('#so-template-edit-delete').disabled = newTpl.id === 'default';
      refreshTemplateSelector();
    });

    form.querySelector('#so-template-edit-save').addEventListener('click', () => {
      const id = selectEl.value;
      const name = nameEl.value.trim();
      const content = contentEl.value;
      if (!name) {
        alert('请输入模板名称');
        return;
      }
      updateTemplate(id, { name, content });
      const arr = form._templates || [];
      const t = arr.find((item) => item.id === id);
      if (t) {
        t.name = name;
        t.content = content;
      }
      populateTemplateSelect(selectEl, arr, id);
      form.querySelector('#so-template-edit-delete').disabled = id === 'default';
      refreshTemplateSelector();
    });

    form.querySelector('#so-template-edit-delete').addEventListener('click', () => {
      const id = selectEl.value;
      if (id === 'default') return;
      if (!confirm('确定要删除这个模板吗？')) return;
      deleteTemplate(id);
      const arr = form._templates || [];
      const idx = arr.findIndex((t) => t.id === id);
      if (idx !== -1) arr.splice(idx, 1);
      const nextId = arr[0] && arr[0].id;
      populateTemplateSelect(selectEl, arr, nextId);
      const t = arr.find((item) => item.id === nextId);
      if (t) {
        nameEl.value = t.name;
        contentEl.value = t.content;
      }
      form.querySelector('#so-template-edit-delete').disabled = nextId === 'default';
      refreshTemplateSelector();
    });
  }

  const selectEl = form.querySelector('#so-template-edit-select');
  const currentSelected = selectedTemplateId();
  const targetId = templates.find((t) => t.id === currentSelected) ? currentSelected : ((templates[0] && templates[0].id) || 'default');
  populateTemplateSelect(selectEl, templates, targetId);
  const t = templates.find((item) => item.id === targetId);
  if (t) {
    form.querySelector('#so-template-edit-name').value = t.name;
    form.querySelector('#so-template-edit-content').value = t.content;
    form.querySelector('#so-template-edit-delete').disabled = t.id === 'default';
  }
}

function initTemplateManager() {
  const manageBtn = document.getElementById('so-outline-template-manage');
  const form = document.getElementById('so-outline-template-form');
  if (!manageBtn || !form || manageBtn.dataset.bound === 'true') return;
  manageBtn.dataset.bound = 'true';
  manageBtn.addEventListener('click', () => {
    const open = form.style.display === 'flex';
    if (open) form.style.display = 'none';
    else {
      renderTemplateForm();
      form.style.display = 'flex';
    }
  });
  refreshTemplateSelector();
}

export function buildOutlineBar(barEl, api) {
  barEl.innerHTML =
    '<div class="so-outline-template-selector">' +
    '<label class="so-field"><span>大纲模板预设</span><select id="so-outline-template-select"><option value="default">默认模板</option></select></label>' +
    '<div class="so-outline-row so-outline-template-row">' +
    '<button type="button" class="so-outline-mini-btn" id="so-outline-template-manage"><i class="fa-solid fa-pen-to-square"></i> 管理模板</button>' +
    '<label class="so-checkbox-field so-outline-compact-check"><input type="checkbox" id="so-outline-include-all-chat"><span>发送全量大纲聊天记录</span></label>' +
    '</div>' +
    '<div id="so-outline-template-form" style="display:none"></div>' +
    '<div class="so-outline-row so-outline-action-row">' +
    '<label class="so-checkbox-field"><input type="checkbox" id="so-outline-use-preset"><span>套用补全预设(跟参谋模式同理)</span></label>' +
    '<button type="button" class="so-outline-mini-btn" id="so-outline-fix-tags" title="为AI回复补充或修正标签"><i class="fa-solid fa-tags"></i> 标签补充(仅限最新一楼)</button>' +
    '</div>' +
    '</div>';
  initTemplateManager();
  const includeAllCheckbox = barEl.querySelector('#so-outline-include-all-chat');
  if (includeAllCheckbox) {
    try { includeAllCheckbox.checked = localStorage.getItem(OUTLINE_INCLUDE_ALL_CHAT_KEY) === 'true'; } catch (e) { /* ignore */ }
    includeAllCheckbox.addEventListener('change', () => {
      try { localStorage.setItem(OUTLINE_INCLUDE_ALL_CHAT_KEY, includeAllCheckbox.checked); } catch (e) { /* ignore */ }
    });
  }
  const fixBtn = barEl.querySelector('#so-outline-fix-tags');
  if (fixBtn) fixBtn.addEventListener('click', () => handleTagFix(api));
}
