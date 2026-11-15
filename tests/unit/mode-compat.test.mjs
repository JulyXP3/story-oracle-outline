import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { modeEnvironment } from '../helpers/mode-dom.mjs';

async function setup() {
  const env = modeEnvironment();
  const warnings = [];
  const loaded = await loadPlugin('src/mode-compat.js', { document: env.document, window: {}, MutationObserver: env.MutationObserver, console: { log() {}, warn() {} } }, {
    'src/toast.js': { showToast: (message, type) => warnings.push({ message, type }) },
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return { namespace: {} };
  });
  assert.equal(typeof loaded.namespace.createOutlineModeCompat, 'function', '缺少大纲菜单生命周期适配');
  const compat = loaded.namespace.createOutlineModeCompat();
  return { ...env, ...loaded.namespace, compat, warnings };
}

async function enter(s, room = 'outline') {
  const ready = s.compat.beforeEnter();
  s.compat.enter(room, ready);
  await s.flush();
}

test('只在已进入大纲时设置展示作用域，退出清理本地模式状态', async () => {
  const s = await setup();
  assert.equal(s.getOutlineModeState().active, false);
  await enter(s);
  assert.equal(s.root.dataset.soOutlineMenu, 'true');
  assert.equal(s.getOutlineModeState().active, true);
  assert.equal(s.getOutlineModeState().roomReady, true);
  const generation = s.getOutlineModeState().generation;
  s.root.classList.remove('so-outline-on');
  s.compat.exit();
  await s.flush();
  assert.equal(s.root.dataset.soOutlineMenu, undefined);
  assert.equal(s.getOutlineModeState().active, false);
  assert.ok(s.getOutlineModeState().generation > generation);
  assert.equal(s.observers.size, 0);
});

test('沿用原生楼层菜单事件，第三方条目不受处理', async () => {
  const s = await setup();
  await enter(s);
  await s.document.getElementById('so-floors-btn').click();
  await s.document.getElementById('third-menu').click();
  assert.deepEqual(s.native, ['floors', 'third']);
  assert.equal(s.document.getElementById('third-menu').getAttribute('aria-disabled'), null);
});

test('房间未确认时div菜单也真正阻止原生楼层动作，退出恢复', async () => {
  const s = await setup();
  await enter(s, 'main');
  const button = s.document.getElementById('so-floors-btn');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  await button.click();
  assert.deepEqual(s.native, []);
  assert.equal(s.getOutlineModeState().roomReady, false);
  assert.ok(s.warnings.length);
  s.root.classList.remove('so-outline-on');
  s.compat.exit();
  assert.equal(button.getAttribute('aria-disabled'), null);
  assert.equal(button.getAttribute('title'), '原浏览器');
  await button.click();
  assert.deepEqual(s.native, ['floors']);
});

test('原菜单的disabled属性不被适配器强行启用', async () => {
  const s = await setup();
  const button = s.document.getElementById('so-floors-btn');
  button.setAttribute('aria-disabled', 'true');
  await enter(s, 'main');
  s.compat.exit();
  assert.equal(button.getAttribute('aria-disabled'), 'true');
});

test('仅outline楼层框改为大纲标题，并显示历史总开关的真实说明', async () => {
  const s = await setup();
  await enter(s);
  const dialog = s.dialog();
  await s.flush();
  assert.equal(dialog.querySelector('.so-local-title').textContent, '楼层浏览器 · 大纲');
  assert.match(dialog.querySelector('.so-outline-floor-note').textContent, /未附带大纲对话历史/);
  assert.equal(dialog.dataset.room, 'outline');
  assert.equal(dialog.querySelector('.so-floor-keep-n').value, '7');
  s.checkbox.checked = true;
  s.notifyOutlineHistoryChanged();
  assert.match(dialog.querySelector('.so-outline-floor-note').textContent, /只针对大纲对话历史/);
  assert.doesNotMatch(dialog.querySelector('.so-outline-floor-note').textContent, /未附带/);
  s.compat.exit();
});

test('本体重绘标题和切换页签后局部恢复，不无限触发观察器', async () => {
  const s = await setup();
  await enter(s);
  const dialog = s.dialog();
  await s.flush();
  dialog.querySelector('[data-tab="browse"]').setAttribute('aria-selected', 'false');
  dialog.querySelector('[data-tab="keep"]').setAttribute('aria-selected', 'true');
  dialog.querySelector('.so-local-title').textContent = '保留最近楼层 · 普通聊天';
  await s.flush();
  assert.equal(dialog.querySelector('.so-local-title').textContent, '保留最近楼层 · 大纲');
  assert.equal(dialog.querySelectorAll('.so-outline-floor-note').length, 1);
  s.compat.exit();
});

test('进入前原生关闭其他房间遗留框，不保存未提交N', async () => {
  const s = await setup();
  const old = s.dialog('main');
  const ready = s.compat.beforeEnter();
  assert.equal(ready, true);
  assert.equal(old.isConnected, false);
  assert.deepEqual(s.native, ['close:main']);
  s.compat.enter('outline', ready);
  s.compat.exit();
});

test('未认领的遗留outline框也先原生关闭，不能仅凭data-room复用旧列表', async () => {
  const s = await setup();
  const old = s.dialog('outline');
  old.querySelector('.so-floor-list').textContent = '可能由main重绘的旧列表';
  const ready = s.compat.beforeEnter();
  assert.equal(ready, true);
  assert.equal(old.isConnected, false);
  assert.deepEqual(s.native, ['close:outline']);
});

test('已经认领的outline框在正常重复进入时保留，不丢未提交输入', async () => {
  const s = await setup();
  await enter(s);
  const own = s.dialog();
  await s.flush();
  own.querySelector('.so-floor-keep-n').value = '13';
  assert.equal(s.compat.beforeEnter(), true);
  s.compat.enter('outline');
  assert.equal(own.isConnected, true);
  assert.equal(own.querySelector('.so-floor-keep-n').value, '13');
  assert.deepEqual(s.native, []);
  s.compat.exit();
});

test('退出只原生关闭已认领的当前实例，重复退出不点击缓存旧节点', async () => {
  const s = await setup();
  await enter(s);
  const old = s.dialog();
  await s.flush();
  old.remove();
  const current = s.dialog();
  await s.flush();
  s.root.classList.remove('so-outline-on');
  s.compat.exit();
  s.compat.exit();
  assert.equal(current.isConnected, false);
  assert.deepEqual(s.native, ['close:outline']);
  assert.equal(s.observers.size, 0);
});

test('重复进入幂等，不重复安装观察器和提示节点', async () => {
  const s = await setup();
  await enter(s);
  const dialog = s.dialog();
  await s.flush();
  const count = s.observers.size;
  const generation = s.getOutlineModeState().generation;
  s.compat.enter('outline');
  await s.flush();
  assert.equal(s.observers.size, count);
  assert.equal(s.getOutlineModeState().generation, generation);
  assert.equal(dialog.querySelectorAll('.so-outline-floor-note').length, 1);
  s.compat.exit();
});

test('未知弹窗结构或多实例不误改标题，不代点关闭', async () => {
  for (const multiple of [false, true]) {
    const s = await setup();
    const one = s.dialog('main');
    if (multiple) s.dialog('outline');
    else one.querySelector('.so-local-x').remove();
    await enter(s);
    assert.deepEqual(s.native, []);
    assert.equal(one.querySelector('.so-local-title').textContent, '楼层浏览器 · 普通聊天');
    await s.document.getElementById('so-floors-btn').click();
    assert.deepEqual(s.native, []);
    assert.ok(s.warnings.length);
    s.compat.exit();
  }
});

test('当前弹窗标记变为非outline时不继续误标或允许操作', async () => {
  const s = await setup();
  await enter(s);
  const dialog = s.dialog();
  await s.flush();
  dialog.dataset.room = 'main';
  dialog.querySelector('.so-local-title').textContent = '楼层浏览器 · 普通聊天';
  await s.flush();
  assert.equal(dialog.querySelector('.so-local-title').textContent, '楼层浏览器 · 普通聊天');
  await s.document.getElementById('so-floors-btn').click();
  assert.deepEqual(s.native, []);
  s.compat.exit();
  assert.deepEqual(s.native, []);
});

test('本体大纲class消失时即使exit未到也不向普通模式施加事件门禁', async () => {
  const s = await setup();
  await enter(s, 'main');
  s.root.classList.remove('so-outline-on');
  await s.document.getElementById('so-floors-btn').click();
  assert.deepEqual(s.native, ['floors']);
  s.compat.exit();
});

test('补丁就绪后重复确认房间可从未就绪恢复，不保留旧禁用', async () => {
  const s = await setup();
  await enter(s, 'main');
  const generation = s.getOutlineModeState().generation;
  s.compat.enter('outline');
  await s.flush();
  assert.equal(s.getOutlineModeState().roomReady, true);
  assert.ok(s.getOutlineModeState().generation > generation);
  assert.equal(s.document.getElementById('so-floors-btn').getAttribute('aria-disabled'), null);
  await s.document.getElementById('so-floors-btn').click();
  assert.deepEqual(s.native, ['floors']);
  s.compat.exit();
});

test('原生关闭后再次打开新弹窗能重新认领，退出后新框不再被修改', async () => {
  const s = await setup();
  await enter(s);
  const one = s.dialog();
  await s.flush();
  await one.querySelector('.so-local-x').click();
  await s.flush();
  const two = s.dialog('outline', 'keep');
  await s.flush();
  assert.equal(two.querySelector('.so-local-title').textContent, '保留最近楼层 · 大纲');
  s.compat.exit();
  const third = s.dialog();
  await s.flush();
  assert.equal(third.querySelector('.so-local-title').textContent, '楼层浏览器 · 普通聊天');
});
