import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import vm from 'node:vm';
import { modeEnvironment } from '../helpers/mode-dom.mjs';

test('不兼容本体不能设置模块API引用或启动模板初始化', async () => {
  const calls = [];
  const { namespace: plugin } = await loadPlugin('src/plugin.js', { console: { warn() {}, log() {} } }, {
    'src/prompt.js': { buildOutlineSend() {} },
    'src/ui.js': { buildOutlineBar() {}, refreshOutlineBarTemplates() {} },
    'src/message-actions.js': { registerMessageActions() {} },
    'src/outline-inject.js': { setStoryOracleApi: () => calls.push('setApi') },
    'src/migrate-final-mode.js': { migrateFinalModeState: () => calls.push('migrate') },
    'src/storage.js': { initTemplateStorage: async () => calls.push('init') },
  });
  plugin.registerOutlinePlugin({ isCompatible: () => false, version: 0 });
  assert.deepEqual(calls, []);
});

async function mounted({ startup = false, syncFails = false } = {}) {
  const env = modeEnvironment();
  if (!startup) env.root.classList.remove('so-outline-on');
  const order = [];
  const core = vm.createContext({
    SYSPROMPT_MODES: [], defaults: {}, document: env.document,
    win: { querySelector: () => null },
    convoStreamKey: 'main',
    mode: startup ? 'outline' : 'chat',
    convoStreamKeyForMode: () => 'main',
    syncConvoStream: () => {
      order.push('sync');
      if (syncFails) throw new Error('同步失败');
      core.convoStreamKey = core.convoStreamKeyForMode(core.mode);
    },
  });
  let spec;
  const api = { isCompatible: () => true, version: 1, registerMode: (value) => { spec = value; return true; }, unsafe: { eval: (code) => vm.runInContext(code, core) } };
  const { namespace } = await loadPlugin('src/plugin.js', { document: env.document, window: {}, MutationObserver: env.MutationObserver, console: { log() {}, warn() {} } }, {
    'src/prompt.js': { buildOutlineSend() {} },
    'src/ui.js': { buildOutlineBar() {}, refreshOutlineBarTemplates() { order.push('refresh'); } },
    'src/message-actions.js': { registerMessageActions() {} },
    'src/outline-inject.js': { setStoryOracleApi() {} },
    'src/migrate-final-mode.js': { migrateFinalModeState() {} },
    'src/storage.js': { initTemplateStorage: async () => {} },
    'src/toast.js': { showToast() {} },
  });
  namespace.registerOutlinePlugin(api);
  return { ...env, api, spec, core, order };
}

test('真实注册回调进入先关闭旧框再同步并确认outline，退出恢复工具', async () => {
  const s = await mounted();
  assert.equal(typeof s.spec.onExit, 'function', '应注册真实onExit生命周期');
  const previous = s.dialog('main');
  previous.querySelector('.so-local-x').addEventListener('click', () => s.order.push('close'));
  s.root.classList.add('so-outline-on');
  s.core.mode = 'outline';
  s.spec.onEnter(s.api);
  await s.flush();
  assert.equal(s.core.convoStreamKey, 'outline');
  assert.ok(s.order.indexOf('close') < s.order.indexOf('sync'));
  assert.equal(s.root.dataset.soOutlineFloors, 'ready');
  const own = s.dialog();
  await s.flush();
  assert.match(own.querySelector('.so-local-title').textContent, /大纲/);
  s.root.classList.remove('so-outline-on');
  s.spec.onExit(s.api);
  assert.equal(own.isConnected, false);
  assert.equal(s.root.dataset.soOutlineMenu, undefined);
});

test('冷启动恢复大纲时补丁就绪后主动同步，不等待再次点模式', async () => {
  const s = await mounted({ startup: true });
  assert.equal(s.core.convoStreamKey, 'outline');
  assert.equal(s.root.dataset.soOutlineFloors, 'ready');
  s.spec.onExit(s.api);
});

test('同步抛错不能误报outline房间准备好', async () => {
  const s = await mounted({ startup: true, syncFails: true });
  assert.equal(s.root.dataset.soOutlineFloors, 'blocked');
  assert.equal(s.document.getElementById('so-floors-btn').getAttribute('aria-disabled'), 'true');
  s.spec.onExit(s.api);
});
