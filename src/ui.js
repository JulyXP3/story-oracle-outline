// 模块：大纲模式设置栏 UI
// 作用：填充 registerMode 提供的 buildBar 容器，渲染模板选择、模板管理（含导入/导出）、
//       补全预设开关和标签补充按钮。
import { addTemplate, deleteTemplate, getTemplates, saveSelectedTemplate, selectedTemplateId, updateTemplate } from './templates.js';
import { exportTemplateAsFile, importTemplatesFromFiles } from './template-io.js';
import { handleTagFix } from './message-actions.js';
import { OUTLINE_INCLUDE_ALL_CHAT_KEY } from './constants.js';

function refreshTemplateSelector() {
  const select = document.getElementById('so-outline-template-select');
  if (!select) return;
  populateTemplateSelector(select);
}

// 用内存缓存填充指定的模板下拉。bar 刚创建、还没挂到文档时 getElementById 找不到元素，
// 所以 buildOutlineBar / onEnter 里直接传元素引用进来，不依赖全局查找。
function populateTemplateSelector(select) {
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

// 供 plugin.js 在 onEnter（进入大纲模式、bar 已挂载可见）时调用，兜底刷新下拉。
export function refreshOutlineBarTemplates() {
  refreshTemplateSelector();
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

// 把模板数组同步进管理表单的本地副本（表单编辑期间缓存，避免每次读写存储）。
function syncFormTemplates(form, templates) {
  form._templates = templates;
}

function renderTemplateForm() {
  const form = document.getElementById('so-outline-template-form');
  if (!form) return;
  syncFormTemplates(form, getTemplates());
  const templates = form._templates;

  if (!form.dataset.rendered) {
    form.innerHTML =
      '<label class="so-field"><span>选择模板</span><select id="so-template-edit-select"></select></label>' +
      '<label class="so-field"><span>模板名称</span><input type="text" id="so-template-edit-name" placeholder="模板名称"></label>' +
      '<label class="so-field"><span>模板内容</span><textarea id="so-template-edit-content" rows="8" placeholder="模板内容"></textarea></label>' +
      '<div class="so-outline-template-actions">' +
      '<button type="button" class="so-outline-mini-btn" id="so-template-edit-new"><i class="fa-solid fa-plus"></i> 新建</button>' +
      '<button type="button" class="so-outline-mini-btn" id="so-template-edit-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>' +
      '<button type="button" class="so-outline-mini-btn" id="so-template-edit-delete"><i class="fa-solid fa-trash"></i> 删除</button>' +
      '<button type="button" class="so-outline-mini-btn" id="so-template-import"><i class="fa-solid fa-file-import"></i> 导入模板</button>' +
      '<button type="button" class="so-outline-mini-btn" id="so-template-export"><i class="fa-solid fa-file-export"></i> 导出模板</button>' +
      '</div>' +
      '<input type="file" id="so-template-import-file" accept=".txt" multiple style="display:none">';
    form.dataset.rendered = 'true';

    const selectEl = form.querySelector('#so-template-edit-select');
    const nameEl = form.querySelector('#so-template-edit-name');
    const contentEl = form.querySelector('#so-template-edit-content');
    const fileInput = form.querySelector('#so-template-import-file');

    selectEl.addEventListener('change', () => {
      const arr = form._templates || [];
      const t = arr.find((item) => item.id === selectEl.value);
      if (!t) return;
      nameEl.value = t.name;
      contentEl.value = t.content;
      form.querySelector('#so-template-edit-delete').disabled = t.id === 'default';
    });

    form.querySelector('#so-template-edit-new').addEventListener('click', async () => {
      const arr = form._templates || [];
      const newTpl = await addTemplate('新模板', '');
      if (!newTpl) {
        alert('新建模板保存失败，请重试');
        return;
      }
      arr.push(newTpl);
      syncFormTemplates(form, arr);
      populateTemplateSelect(selectEl, arr, newTpl.id);
      nameEl.value = newTpl.name;
      contentEl.value = newTpl.content;
      form.querySelector('#so-template-edit-delete').disabled = newTpl.id === 'default';
      refreshTemplateSelector();
    });

    form.querySelector('#so-template-edit-save').addEventListener('click', async () => {
      const id = selectEl.value;
      const name = nameEl.value.trim();
      const content = contentEl.value;
      if (!name) {
        alert('请输入模板名称');
        return;
      }
      const ok = await updateTemplate(id, { name, content });
      if (!ok) {
        alert('保存失败：模板过大或存储暂不可用');
        return;
      }
      const arr = form._templates || [];
      const t = arr.find((item) => item.id === id);
      if (t) {
        t.name = name;
        t.content = content;
      }
      syncFormTemplates(form, arr);
      populateTemplateSelect(selectEl, arr, id);
      form.querySelector('#so-template-edit-delete').disabled = id === 'default';
      refreshTemplateSelector();
    });

    form.querySelector('#so-template-edit-delete').addEventListener('click', async () => {
      const id = selectEl.value;
      if (id === 'default') return;
      if (!confirm('确定要删除这个模板吗？')) return;
      const ok = await deleteTemplate(id);
      if (!ok) {
        alert('删除失败，请重试');
        return;
      }
      const arr = form._templates || [];
      const idx = arr.findIndex((t) => t.id === id);
      if (idx !== -1) arr.splice(idx, 1);
      syncFormTemplates(form, arr);
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

    // 导入：触发隐藏 file input，多选 .txt。
    form.querySelector('#so-template-import').addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || !fileInput.files.length) return;
      await importTemplatesFromFiles(fileInput.files);
      const arr = getTemplates();
      syncFormTemplates(form, arr);
      const last = arr[arr.length - 1];
      populateTemplateSelect(selectEl, arr, last ? last.id : undefined);
      const t = arr.find((item) => item.id === (last && last.id));
      if (t) {
        nameEl.value = t.name;
        contentEl.value = t.content;
      }
      form.querySelector('#so-template-edit-delete').disabled = t && t.id === 'default';
      refreshTemplateSelector();
    });

    // 导出：导出表单当前选中的模板。
    form.querySelector('#so-template-export').addEventListener('click', () => {
      exportTemplateAsFile(selectEl.value);
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

// 存储层异步初始化（服务端拉取 / 旧数据迁移）完成后广播此事件：
// 刷新主下拉；若管理表单已展开，同步刷新表单下拉（不动正在编辑的名称/内容框）。
let templatesChangedBound = false;
function bindTemplatesChangedListener() {
  if (templatesChangedBound) return;
  templatesChangedBound = true;
  document.addEventListener('so-outline-templates-changed', () => {
    refreshTemplateSelector();
    const form = document.getElementById('so-outline-template-form');
    if (form && form.dataset.rendered && form.style.display === 'flex') {
      const arr = getTemplates();
      syncFormTemplates(form, arr);
      populateTemplateSelect(form.querySelector('#so-template-edit-select'), arr, selectedTemplateId());
    }
  });
}

export function buildOutlineBar(barEl, api) {
  bindTemplatesChangedListener();
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
  // bar 可能在未挂载的子树里构建（getElementById 找不到），用刚创建的元素直接填充。
  populateTemplateSelector(barEl.querySelector('#so-outline-template-select'));
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
