import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { createFormDocument } from '../helpers/form-dom.mjs';
import { plain } from '../helpers/storage-env.mjs';

async function setup({ ready = true, saveOk = true, detached = false, local = new Map(), localFails = false } = {}) {
  const document = createFormDocument();
  const bar = document.createElement('div');
  if (!detached) document.body.appendChild(bar);
  let templates = [{ id: 'default', name: '默认', content: '默认内容' }, { id: 'a', name: '甲', content: '甲内容' }, { id: 'b', name: '乙', content: '乙内容' }];
  let selected = 'a';
  const status = { ready, busy: false, tier: 'server', loadErrors: [], lastResult: null };
  const updates = [];
  const alerts = [];
  const confirms = [];
  let historyNotices = 0;
  const templateApi = {
    getTemplates: () => templates.map((item) => ({ ...item })),
    selectedTemplateId: () => selected,
    saveSelectedTemplate: (value) => { selected = value; },
    updateTemplate: async (...args) => {
      updates.push(plain(args));
      if (saveOk) templates = templates.map((item) => item.id === args[0] ? { ...item, ...args[1] } : item);
      else status.lastResult = { ok: false, code: 'conflict', error: '目标已变化' };
      return saveOk;
    },
    addTemplate: async () => null,
    deleteTemplate: async () => false,
  };
  const { namespace: ui } = await loadPlugin('src/ui.js', {
    document,
    localStorage: { getItem: (key) => local.get(key) || null, setItem: (key, value) => { if (localFails) throw new Error('无法写入'); local.set(key, String(value)); } },
    alert: (text) => alerts.push(text),
    confirm: () => confirms.shift() ?? false,
  }, {
    'src/templates.js': templateApi,
    'src/storage.js': { getTemplateStorageStatus: () => plain(status), initTemplateStorage: async () => {} },
    'src/template-io.js': { importTemplatesFromFiles: async () => 0, exportTemplateAsFile() {} },
    'src/message-actions.js': { handleTagFix() {} },
    'src/toast.js': { showToast: (text) => alerts.push(text) },
    'src/mode-compat.js': { notifyOutlineHistoryChanged: () => { historyNotices++; } },
  });
  ui.buildOutlineBar(bar, {});
  const el = (id) => bar.querySelector('#' + id);
  async function editB() {
    await el('so-outline-template-manage').click();
    el('so-template-edit-select').value = 'b';
    await el('so-template-edit-select').fire('change');
    el('so-template-edit-content').value = '乙的草稿';
    await el('so-template-edit-content').fire('input');
  }
  return { document, bar, el, ui, updates, status, alerts, confirms, editB, local, historyNotices: () => historyNotices, refresh: () => document.dispatchEvent({ type: 'so-outline-templates-changed' }), changeTemplates: (value) => { templates = value; } };
}

test('刷新列表不得把乙草稿绑定到生成用甲模板', async () => {
  const s = await setup();
  await s.editB();
  s.refresh();
  assert.equal(s.el('so-template-edit-select').value, 'b');
  assert.equal(s.el('so-template-edit-content').value, '乙的草稿');
  await s.el('so-template-edit-save').click();
  assert.equal(s.updates[0][0], 'b');
  assert.deepEqual(s.updates[0][2], { base: { name: '乙', content: '乙内容' } });
});

test('切模板时脏草稿取消后目标和内容不变', async () => {
  const s = await setup();
  await s.editB();
  s.el('so-template-edit-select').value = 'a';
  const switching = s.el('so-template-edit-select').fire('change');
  const cancel = s.el('so-template-leave-cancel');
  assert.ok(cancel, '应显示保存/放弃/取消三选项');
  await cancel.click();
  await switching;
  assert.equal(s.el('so-template-edit-select').value, 'b');
  assert.equal(s.el('so-template-edit-content').value, '乙的草稿');
});

test('关闭前选择保存但失败时不关闭且保留草稿', async () => {
  const s = await setup({ saveOk: false });
  await s.editB();
  const closing = s.el('so-outline-template-manage').click();
  const save = s.el('so-template-leave-save');
  assert.ok(save, '应有保存后离开的入口');
  await save.click();
  await closing;
  assert.equal(s.el('so-outline-template-form').style.display, 'flex');
  assert.equal(s.el('so-template-edit-content').value, '乙的草稿');
});

test('尚未初始化时禁用写入，未挂载容器也能绑定管理按钮', async () => {
  const loading = await setup({ ready: false });
  assert.ok(loading.el('so-outline-template-manage').disabled);
  assert.match(loading.el('so-outline-storage-status').textContent, /初始化/);
  const detached = await setup({ detached: true });
  detached.document.body.appendChild(detached.bar);
  await detached.el('so-outline-template-manage').click();
  assert.equal(detached.el('so-outline-template-form').style.display, 'flex');
  assert.ok(detached.el('so-template-edit-save'));
});

test('双开关名称清楚，历史旧值保留而世界书默认关闭', async () => {
  const s = await setup({ local: new Map([['so_outline_include_all_chat', 'true']]) });
  assert.match(s.bar.textContent, /附带大纲对话历史/);
  assert.doesNotMatch(s.bar.textContent, /发送全量大纲聊天记录/);
  assert.match(s.bar.textContent, /附带已启用的世界书大纲/);
  assert.equal(s.el('so-outline-include-all-chat').checked, true);
  assert.equal(s.el('so-outline-include-plot-guides').checked, false);
});

test('两个开关分别保存，重建栏恢复；历史变化会通知楼层说明', async () => {
  const s = await setup();
  const history = s.el('so-outline-include-all-chat');
  const guides = s.el('so-outline-include-plot-guides');
  assert.ok(guides, '应有世界书独立开关');
  guides.checked = true;
  await guides.fire('change');
  assert.equal(history.checked, false);
  assert.equal(s.local.get('so_outline_include_enabled_plot_guides'), 'true');
  history.checked = true;
  await history.fire('change');
  assert.equal(s.historyNotices(), 1);
  assert.equal(s.local.get('so_outline_include_all_chat'), 'true');
  const next = await setup({ local: s.local });
  assert.equal(next.el('so-outline-include-all-chat').checked, true);
  assert.equal(next.el('so-outline-include-plot-guides').checked, true);
});

test('选项保存失败仍保留本页勾选并明确提示不保证刷新保留', async () => {
  const s = await setup({ localFails: true });
  const history = s.el('so-outline-include-all-chat');
  history.checked = true;
  await history.fire('change');
  assert.equal(history.checked, true);
  assert.ok(s.alerts.some((message) => /本页.*刷新/.test(message)));
});

test('远端刷新目标不存在时保留原编辑目标，不将草稿写向其他模板', async () => {
  const s = await setup();
  await s.editB();
  s.changeTemplates([{ id: 'default', name: '默认', content: '默认内容' }, { id: 'a', name: '甲', content: '甲内容' }]);
  s.refresh();
  assert.equal(s.el('so-template-edit-select').value, 'b');
  assert.equal(s.el('so-template-edit-content').value, '乙的草稿');
  assert.match(s.el('so-template-edit-status').textContent, /变化|不存在|冲突/);
});
