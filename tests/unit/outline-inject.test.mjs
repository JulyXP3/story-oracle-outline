import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOK, CONTENT, copy, plot, createLorebookHelper, outlineEnv, panelFor, choose, settle, turn } from '../helpers/outline-env.mjs';

const writes = (fixture) => fixture.calls.filter((call) => ['create', 'set', 'update', 'bind', 'createBook'].includes(call.method));
const messages = (fixture) => fixture.toasts.map((toast) => toast.message).join('\n');
const entry = (fixture, uid) => fixture.books.get(BOOK).find((item) => item.uid === uid);
async function runChoice(fixture, label = '新建条目') {
  const pending = fixture.start();
  await choose(await panelFor(fixture), label);
  return settle(pending);
}
function assertNoSuccess(fixture) { assert.equal(fixture.toasts.some((toast) => toast.level === 'success'), false); }
function assertLoggedFailure(fixture) {
  assert.ok(fixture.logs.some((log) => /\[故事神谕·大纲版\].*[\u4e00-\u9fff]/.test(log.args[0]) && ['error', 'warn'].includes(log.level)));
  assertNoSuccess(fixture);
}

test('内容为空只给中文 warning，不因日志方法错误落入异常分支', async () => {
  const fixture = await outlineEnv();
  assert.equal(await fixture.inject('  ', fixture.anchor()), false);
  assert.deepEqual(writes(fixture), []);
  assert.deepEqual(fixture.toasts, [{ level: 'warning', message: '内容为空' }]);
  assert.ok(fixture.logs.some((log) => log.level === 'warn' && /^\[故事神谕·大纲版\] 内容为空/.test(log.args[0])));
});

test('重复点击保留待决操作且明确给待处理警告，不报程序异常', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  const first = fixture.start();
  const panel = await panelFor(fixture);
  assert.equal(await settle(fixture.start()), false);
  assert.ok(fixture.toasts.some((toast) => toast.level === 'warning' && /待处理/.test(toast.message)));
  assert.equal(fixture.logs.some((log) => log.level === 'error'), false);
  await choose(panel, '取消');
  assert.equal(await settle(first), false);
});

// 捕捉“先禁旧再创建”的顺序错误，以及 Helper 可能在完成写入后的回读阶段抛错。
test('fallback 创建抛错不能先禁用旧大纲', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.beforeCreate = () => { throw new Error('合成创建失败'); };
  assert.equal(await runChoice(fixture), false);
  assert.equal(entry(fixture, 7).enabled, true);
  assert.equal(fixture.count('set'), 0);
  assertLoggedFailure(fixture);
});

test('fallback 接受 UID 0，先确认新条目再用 enabled 最小 patch 禁旧', async () => {
  const old = plot();
  const disabled = plot(20, '剧情指导2', false);
  const fixture = await outlineEnv({ entries: [old, disabled], newUid: 0 });
  assert.equal(await runChoice(fixture), true);
  assert.equal(entry(fixture, 0).comment, '剧情指导3');
  assert.equal(entry(fixture, 0).content, CONTENT);
  assert.deepEqual(entry(fixture, 7), { ...old, enabled: false });
  assert.deepEqual(entry(fixture, 20), disabled);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'set').map((call) => call.patches), [[{ uid: 7, enabled: false }]]);
  assert.ok(fixture.calls.findIndex((call) => call.method === 'create') < fixture.calls.findIndex((call) => call.method === 'set'));
  const created = fixture.calls.find((call) => call.method === 'create').entries[0];
  assert.deepEqual(created, { comment: '剧情指导3', content: CONTENT, keys: [], enabled: true, type: 'constant', position: 'at_depth_as_system', order: 9999, depth: 4, prevent_recursion: true });
});

test('禁用抛错即使已生效也尝试恢复旧 enabled，并禁用已确认的新 UID 0', async () => {
  const old = plot();
  const fixture = await outlineEnv({ entries: [old] });
  fixture.hooks.afterSetSave = (name, patches, index) => { if (index === 1) throw new Error('合成禁用后回读失败'); };
  assert.equal(await runChoice(fixture), false);
  assert.deepEqual(entry(fixture, 7), old);
  assert.equal(entry(fixture, 0).enabled, false);
  assert.ok(fixture.calls.some((call) => call.method === 'set' && call.patches.some((patch) => patch.uid === 7 && patch.enabled === true)));
  assert.ok(fixture.calls.some((call) => call.method === 'set' && call.patches.some((patch) => patch.uid === 0 && patch.enabled === false)));
  assert.doesNotMatch(messages(fixture), /原子回滚|完全回滚|永久落盘/);
  assertLoggedFailure(fixture);
});

test('恢复也失败时明确提示状态未确认，不声称已恢复或操作成功', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.afterSetSave = (name, patches, index) => { if (index === 1) throw new Error('合成禁用后回读失败'); };
  fixture.hooks.beforeSet = (name, patches, index) => { if (index > 1) throw new Error('合成恢复失败'); };
  assert.equal(await runChoice(fixture), false);
  assert.ok(fixture.count('set') >= 2, '必须尝试恢复');
  assert.match(messages(fixture), /状态未确认/);
  assert.doesNotMatch(messages(fixture), /已回滚|已恢复/);
  assertLoggedFailure(fixture);
});

test('create 已写入后抛错也不禁旧，不把异常说成完全未写入', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.afterCreateSave = () => { throw new Error('合成创建后的回读失败'); };
  assert.equal(await runChoice(fixture), false);
  assert.equal(entry(fixture, 7).enabled, true);
  assert.equal(fixture.count('set'), 0);
  assert.ok(entry(fixture, 0));
  assert.match(messages(fixture), /可能已写入|状态未确认/);
  assertLoggedFailure(fixture);
});

test('未知 create 返回通过回读唯一标题内容且排除旧 UID 确认新条目', async () => {
  const fixture = await outlineEnv({ entries: [plot()], newUid: 0 });
  fixture.state.createResult = true;
  assert.equal(await runChoice(fixture), true);
  assert.equal(entry(fixture, 0).content, CONTENT);
  assert.equal(entry(fixture, 7).enabled, false);
  const createAt = fixture.calls.findIndex((call) => call.method === 'create');
  const setAt = fixture.calls.findIndex((call) => call.method === 'set');
  assert.ok(fixture.calls.slice(createAt + 1, setAt).some((call) => call.method === 'get'));
});

test('未知 create 返回且回读新标题内容不唯一时绝不禁旧', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.state.createResult = true;
  fixture.hooks.afterCreateSave = (name, added) => { fixture.books.get(name).push({ ...copy(added[0]), uid: 900 }); };
  assert.equal(await runChoice(fixture), false);
  assert.equal(entry(fixture, 7).enabled, true);
  assert.equal(fixture.count('set'), 0);
  assert.match(messages(fixture), /唯一|状态未确认/);
  assertLoggedFailure(fixture);
});

test('未知 create 返回且未新增 UID 时不能把已有同内容条目当成本次新增', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.helper.createLorebookEntries = async (name, items) => {
    fixture.calls.push({ method: 'create', name, entries: copy(items) });
    Object.assign(fixture.books.get(name)[0], { comment: items[0].comment, content: items[0].content });
    return undefined;
  };
  assert.equal(await runChoice(fixture), false);
  assert.equal(entry(fixture, 7).enabled, true);
  assert.equal(fixture.count('set'), 0);
  assertLoggedFailure(fixture);
});

for (const bindingStyle of ['modern', 'legacy']) {
  test(`${bindingStyle} 绑定显式 false 必须返回 false 并提示已写入但关联未完成`, async () => {
    const fixture = await outlineEnv({ bindingStyle });
    fixture.state.bindingResult = false;
    assert.equal(await settle(fixture.start()), false);
    assert.equal(entry(fixture, 0).content, CONTENT);
    assert.match(messages(fixture), /已写入.*关联未完成/);
    assertLoggedFailure(fixture);
  });
  test(`${bindingStyle} 绑定 setter 可返回 void，但需回读确认且保留原有关联`, async () => {
    const fixture = await outlineEnv({ bindingStyle });
    assert.equal(await settle(fixture.start()), true);
    assert.equal(fixture.state.binding.primary, '合成主书');
    assert.deepEqual(fixture.state.binding.additional, ['合成附加书', BOOK]);
    if (bindingStyle === 'legacy') assert.deepEqual(fixture.state.binding.custom, { keep: true });
    const call = fixture.calls.find((item) => item.method === 'bind');
    assert.equal(call.args.length, bindingStyle === 'modern' ? 2 : 1);
    assert.ok(fixture.count('getBinding') >= 2);
  });
  test(`${bindingStyle} 绑定 void 但回读不含目标书不能宣称成功`, async () => {
    const fixture = await outlineEnv({ bindingStyle });
    fixture.state.applyBinding = false;
    assert.equal(await settle(fixture.start()), false);
    assert.match(messages(fixture), /已写入.*关联未完成/);
    assertLoggedFailure(fixture);
  });
}

test('目标书已经是主书时不重复追加到附加关联', async () => {
  const fixture = await outlineEnv();
  fixture.state.binding.primary = BOOK;
  assert.equal(await settle(fixture.start()), true);
  assert.equal(fixture.count('bind'), 0);
  assert.deepEqual(fixture.state.binding.additional, ['合成附加书']);
});

for (const key of ['name2', 'characterId', 'avatar', 'chatId']) {
  test(`确认期间 ${key} 变化时不写入也不绑定`, async () => {
    const fixture = await outlineEnv({ entries: [plot()] });
    const pending = fixture.start();
    const panel = await panelFor(fixture);
    fixture.current[key] = key === 'characterId' ? 5 : '合成已切换';
    await choose(panel);
    assert.equal(await settle(pending), false);
    assert.deepEqual(writes(fixture), []);
    assert.match(messages(fixture), /角色|聊天/);
    assertLoggedFailure(fixture);
  });
}

test('确认后回读期间切换聊天，也必须在实际写入前停止', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.afterRead = (name, index) => { if (index === 2) fixture.current.chatId = '合成聊天B'; };
  assert.equal(await runChoice(fixture, '覆盖最新'), false);
  assert.deepEqual(writes(fixture), []);
  assertLoggedFailure(fixture);
});

test('fallback 创建后切角色不继续禁旧或绑定', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.afterCreateSave = () => { fixture.current.characterId = 8; };
  assert.equal(await runChoice(fixture), false);
  assert.equal(entry(fixture, 7).enabled, true);
  assert.equal(fixture.count('set'), 0);
  assert.equal(fixture.count('bind'), 0);
  assertLoggedFailure(fixture);
});

test('绑定读取期间切换聊天不调用绑定 setter', async () => {
  const fixture = await outlineEnv();
  fixture.hooks.beforeGetBinding = () => { fixture.current.chatId = '合成聊天B'; };
  assert.equal(await settle(fixture.start()), false);
  assert.equal(fixture.count('bind'), 0);
  assert.match(messages(fixture), /已写入.*关联未完成/);
  assertLoggedFailure(fixture);
});

test('新建编号用最大现有编号加一，不填补删除后留下的编号空洞', async () => {
  const fixture = await outlineEnv({ entries: [plot(30, '剧情指导8'), plot(7), plot(21, '剧情指导3')] });
  assert.equal(await runChoice(fixture), true);
  assert.equal(entry(fixture, 0).comment, '剧情指导9');
});

test('同目标书重复点击从首次读取到确认及更新都持锁，finally 释放后可重试', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  let releaseRead;
  const readGate = new Promise((resolve) => { releaseRead = resolve; });
  fixture.hooks.beforeRead = (name, index) => index === 1 ? readGate : undefined;
  const first = fixture.start();
  const duplicateDuringRead = fixture.start();
  assert.equal(await settle(duplicateDuringRead), false);
  assert.equal(fixture.count('get'), 1);
  releaseRead();
  const panel = await panelFor(fixture);
  const duplicateDuringChoice = fixture.start();
  assert.equal(await settle(duplicateDuringChoice), false);
  assert.equal(fixture.document.querySelectorAll('.so-inline-choice-panel').length, 1);
  let releaseCreate;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  fixture.hooks.beforeCreate = () => createGate;
  await choose(panel);
  await turn();
  assert.equal(await settle(fixture.start()), false);
  assert.equal(fixture.count('create'), 1);
  releaseCreate();
  assert.equal(await settle(first), true);
  fixture.hooks.beforeCreate = undefined;
  const retry = fixture.start();
  await choose(await panelFor(fixture), '取消');
  assert.equal(await settle(retry), false);
});

test('不同目标书的选择面板互不移除，旧 promise 可正常取消结束', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  const first = fixture.start();
  const firstPanel = await panelFor(fixture);
  fixture.current.name2 = '合成角色B';
  fixture.current.characterId = 2;
  fixture.books.set('合成角色B-剧情指导', [plot(8)]);
  const second = fixture.start();
  await turn();
  assert.equal(fixture.document.querySelectorAll('.so-inline-choice-panel').length, 2);
  const secondPanel = fixture.document.querySelectorAll('.so-inline-choice-panel').find((panel) => panel !== firstPanel);
  await choose(firstPanel, '取消');
  await choose(secondPanel, '取消');
  assert.equal(await settle(first), false);
  assert.equal(await settle(second), false);
  assert.deepEqual(writes(fixture), []);
});

for (const removed of ['面板', '锚点', '聊天容器']) {
  test(`${removed}被移除后取消待决选择并释放同书锁，移除按钮监听和观察器`, async () => {
    const fixture = await outlineEnv({ entries: [plot()] });
    const container = fixture.document.createElement('section');
    fixture.document.body.appendChild(container);
    const anchor = fixture.document.createElement('div');
    container.appendChild(anchor);
    const pending = fixture.start(anchor);
    const panel = await panelFor(fixture);
    const buttons = panel.querySelectorAll('button');
    fixture.current.chatId = '合成聊天B';
    ({ 面板: panel, 锚点: anchor, 聊天容器: container })[removed].remove();
    assert.equal(await settle(pending), false);
    assert.equal(fixture.activeObservers(), 0);
    assert.ok(buttons.every((button) => (button.handlers.get('click') || []).length === 0));
    assert.equal(fixture.document.querySelectorAll('.so-inline-choice-panel').length, 0);
    for (const button of buttons) await button.click();
    assert.deepEqual(writes(fixture), []);
    fixture.current.chatId = '合成聊天A';
    assert.equal(await runChoice(fixture, '覆盖最新'), true);
    assert.equal(entry(fixture, 7).content, CONTENT);
    assert.equal(fixture.activeObservers(), 0);
  });
}

test('正常选择结束同样清理面板观察器和所有按钮监听', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  const pending = fixture.start();
  const panel = await panelFor(fixture);
  const buttons = panel.querySelectorAll('button');
  await choose(panel, '取消');
  assert.equal(await settle(pending), false);
  assert.equal(fixture.activeObservers(), 0);
  assert.ok(buttons.every((button) => (button.handlers.get('click') || []).length === 0));
  assert.deepEqual(writes(fixture), []);
});

test('读取期间锚所在容器已断开，不创建不可访问的待决面板或留锁', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  const container = fixture.document.createElement('section');
  const anchor = fixture.document.createElement('div');
  fixture.document.body.appendChild(container);
  container.appendChild(anchor);
  fixture.hooks.afterRead = (name, index) => { if (index === 1) container.remove(); };
  assert.equal(await settle(fixture.start(anchor)), false);
  assert.equal(container.querySelector('.so-inline-choice-panel'), null);
  assert.equal(fixture.activeObservers(), 0);
  assert.deepEqual(writes(fixture), []);
  fixture.hooks.afterRead = undefined;
  assert.equal(await runChoice(fixture, '覆盖最新'), true);
});

test('创建失败后 finally 释放书锁，下一次同目标操作能重新创建', async () => {
  const fixture = await outlineEnv();
  fixture.hooks.beforeCreate = () => { throw new Error('合成首次失败'); };
  assert.equal(await settle(fixture.start()), false);
  fixture.hooks.beforeCreate = undefined;
  assert.equal(await settle(fixture.start()), true);
  assert.equal(fixture.count('create'), 2);
});

// 全量 updater 如果仅返回大纲条目会删除无关条目，此处刻意模拟该真实契约。
test('优先 updater 一次全量 save 保留全部旧条目及顺序，新条目末尾省略 UID', async () => {
  const unrelated = { uid: 91, comment: '合成人物设定', content: '不能丢失', enabled: true, other: { preserve: 42 } };
  const old = plot(7);
  const disabled = plot(19, '剧情指导4', false);
  const fixture = await outlineEnv({ updater: true, entries: [unrelated, old, disabled], newUid: 0 });
  assert.equal(await runChoice(fixture), true);
  assert.deepEqual(fixture.books.get(BOOK).slice(0, 3), [unrelated, { ...old, enabled: false }, disabled]);
  assert.equal(fixture.books.get(BOOK).at(-1).uid, 0);
  assert.equal(fixture.books.get(BOOK).at(-1).comment, '剧情指导5');
  const payload = fixture.calls.find((call) => call.method === 'updatePayload').entries;
  assert.equal(Object.hasOwn(payload.at(-1), 'uid'), false);
  assert.equal(Object.hasOwn(payload[1], 'disable'), false);
  assert.equal(fixture.count('update'), 1);
  assert.equal(fixture.count('set'), 0);
  assert.equal(fixture.count('create'), 0);
});

test('updater 回调前聊天已切换时拒绝 save', async () => {
  const fixture = await outlineEnv({ updater: true, entries: [plot()] });
  fixture.hooks.beforeUpdate = () => { fixture.current.chatId = '合成聊天B'; };
  assert.equal(await runChoice(fixture), false);
  assert.equal(fixture.count('updatePayload'), 0);
  assert.equal(entry(fixture, 7).enabled, true);
  assertLoggedFailure(fixture);
});

test('updater 已 save 后抛错不重试新增，不虚称未写入或原子回滚', async () => {
  const fixture = await outlineEnv({ updater: true, entries: [plot()] });
  fixture.hooks.afterUpdateSave = () => { throw new Error('合成 updater 回读失败'); };
  assert.equal(await runChoice(fixture), false);
  assert.equal(fixture.count('update'), 1);
  assert.equal(fixture.books.get(BOOK).length, 2);
  assert.match(messages(fixture), /可能已写入|状态未确认/);
  assert.doesNotMatch(messages(fixture), /原子回滚|完全未写入/);
  assertLoggedFailure(fixture);
});

test('覆盖只提交 UID 和 content，保留确认期间无关字段的并发修改', async () => {
  const fixture = await outlineEnv({ entries: [plot(0)] });
  const pending = fixture.start();
  const panel = await panelFor(fixture);
  Object.assign(entry(fixture, 0), { keys: ['合成并发关键词'], order: 123, custom: { keep: '新值' } });
  await choose(panel, '覆盖最新');
  assert.equal(await settle(pending), true);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'set').map((call) => call.patches), [[{ uid: 0, content: CONTENT }]]);
  assert.deepEqual(entry(fixture, 0).keys, ['合成并发关键词']);
  assert.equal(entry(fixture, 0).order, 123);
  assert.deepEqual(entry(fixture, 0).custom, { keep: '新值' });
});

for (const mutation of ['content', 'uid', 'latest']) {
  test(`覆盖确认后 ${mutation} 变化必须回读发现并要求重试`, async () => {
    const fixture = await outlineEnv({ entries: [plot()] });
    const pending = fixture.start();
    const panel = await panelFor(fixture);
    if (mutation === 'content') entry(fixture, 7).content = '<plot_outline>合成并发修改</plot_outline>';
    if (mutation === 'uid') entry(fixture, 7).uid = 70;
    if (mutation === 'latest') fixture.books.get(BOOK).push(plot(33, '剧情指导8'));
    await choose(panel, '覆盖最新');
    assert.equal(await settle(pending), false);
    assert.deepEqual(writes(fixture), []);
    assert.match(messages(fixture), /变化|改变|重试|重新确认/);
    assertLoggedFailure(fixture);
  });
}

test('updater 覆盖同样保留无关条目并在回调重新核对目标内容', async () => {
  const unrelated = { uid: 50, comment: '合成无关设定', enabled: true, content: '保持原样' };
  const fixture = await outlineEnv({ updater: true, entries: [unrelated, plot(0)] });
  assert.equal(await runChoice(fixture, '覆盖最新'), true);
  assert.deepEqual(fixture.books.get(BOOK), [unrelated, { ...plot(0), content: CONTENT }]);
  const changed = await outlineEnv({ updater: true, entries: [plot()] });
  changed.hooks.beforeUpdate = () => { entry(changed, 7).content = '合成回调前变化'; };
  assert.equal(await runChoice(changed, '覆盖最新'), false);
  assert.equal(changed.count('updatePayload'), 0);
  assert.equal(entry(changed, 7).content, '合成回调前变化');
});

test('跳过只有读取能力的 ACU，使用同一能力完整的 Helper 完成写入和绑定', async () => {
  const fixture = await outlineEnv();
  const acuCalls = [];
  fixture.window.TavernHelper_API_ACU = { getLorebookEntries: () => { acuCalls.push('read'); return []; } };
  assert.equal(await settle(fixture.start()), true);
  assert.deepEqual(acuCalls, []);
  assert.equal(fixture.count('create'), 1);
  assert.equal(fixture.count('bind'), 1);
});

for (const bindingStyle of ['modern', 'legacy']) {
  test(`ACU 仅有读写时优先同对象读写及 ${bindingStyle} 绑定能力齐全的标准 Helper`, async () => {
    const fixture = await outlineEnv({ bindingStyle });
    const acu = createLorebookHelper({ bindingStyle: 'none' });
    fixture.window.TavernHelper_API_ACU = acu.helper;
    assert.equal(await settle(fixture.start()), true);
    assert.deepEqual(acu.calls, []);
    assert.equal(fixture.count('create'), 1);
    assert.equal(fixture.count('bind'), 1);
    assert.equal(entry(fixture, 0).content, CONTENT);
    assert.equal(fixture.state.binding.additional.includes(BOOK), true);
  });
}

test('只剩无绑定读写对象时精确报告已写入但关联未完成，不能借用其他对象的绑定', async () => {
  const fixture = await outlineEnv();
  const acu = createLorebookHelper({ bindingStyle: 'none' });
  fixture.window.TavernHelper_API_ACU = acu.helper;
  fixture.window.TavernHelper = {
    getCharWorldbookNames: fixture.helper.getCharWorldbookNames,
    rebindCharWorldbooks: fixture.helper.rebindCharWorldbooks,
  };
  assert.equal(await settle(fixture.start()), false);
  assert.equal(acu.books.get(BOOK)[0].content, CONTENT);
  assert.equal(acu.count('create'), 1);
  assert.deepEqual(fixture.calls, []);
  assert.match(messages(fixture), /已写入.*关联未完成.*缺少完整/);
  assertLoggedFailure(fixture);
});

test('选中 ACU 时读写和 legacy 绑定必须全部来自该对象，不借用另一 Helper', async () => {
  const fixture = await outlineEnv();
  const acu = createLorebookHelper({ bindingStyle: 'legacy' });
  fixture.window.TavernHelper_API_ACU = acu.helper;
  fixture.window.TavernHelper = { getCharWorldbookNames: () => { throw new Error('不能跨对象绑定'); }, rebindCharWorldbooks: () => { throw new Error('不能跨对象绑定'); } };
  assert.equal(await settle(fixture.start()), true);
  assert.equal(acu.count('create'), 1);
  assert.equal(acu.count('bind'), 1);
  assert.deepEqual(acu.state.binding.custom, { keep: true });
  assert.deepEqual(fixture.calls, []);
});

test('仅有 create 而无 updater 或 set 的候选不能造成部分写入', async () => {
  const fixture = await outlineEnv();
  delete fixture.helper.setLorebookEntries;
  assert.equal(await settle(fixture.start()), false);
  assert.deepEqual(writes(fixture), []);
  assertLoggedFailure(fixture);
});

test('不存在书时 createLorebook 显式 false 必须停止，不添加条目或绑定', async () => {
  const fixture = await outlineEnv({ missing: true });
  fixture.state.createBookResult = false;
  assert.equal(await settle(fixture.start()), false);
  assert.equal(fixture.count('createBook'), 1);
  assert.equal(fixture.count('create'), 0);
  assert.equal(fixture.count('bind'), 0);
  assertLoggedFailure(fixture);
});

test('只有初次读书的不存在错误才可建书，后续写入错误不能触发重建', async () => {
  const fixture = await outlineEnv({ entries: [plot()] });
  fixture.hooks.beforeCreate = () => { throw new Error('未能找到世界书：合成后续异常'); };
  assert.equal(await runChoice(fixture), false);
  assert.equal(fixture.count('createBook'), 0);
  assert.equal(fixture.books.get(BOOK).length, 1);
  assert.equal(entry(fixture, 7).enabled, true);
});

test('新建不存在的世界书须确认 boolean true 后正常添加和关联', async () => {
  const fixture = await outlineEnv({ missing: true, updater: true });
  assert.equal(await settle(fixture.start()), true);
  assert.equal(fixture.count('createBook'), 1);
  assert.equal(entry(fixture, 0).comment, '剧情指导');
  assert.equal(fixture.state.binding.additional.includes(BOOK), true);
});
