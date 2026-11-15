import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { deferred, fakeClock, flush, plain } from '../helpers/storage-env.mjs';

const context = () => ({ name2: '测试角色', characterId: 0, groupId: null });
const entry = (uid, overrides = {}) => ({ uid, comment: uid === 0 ? '剧情指导' : '剧情指导' + (uid + 1), enabled: true, content: '<任意标签>大纲' + uid + '</任意标签>', ...overrides });

async function setup(window = {}) {
  const clock = fakeClock();
  const logs = [];
  const loaded = await loadPlugin('src/plot-guide-context.js', {
    ...clock, window, console: { warn: (...args) => logs.push(args), log() {} },
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return { namespace: {} };
  });
  assert.equal(typeof loaded.namespace.loadEnabledPlotGuides, 'function', '缺少世界书只读参考模块');
  return { ...loaded.namespace, clock, logs };
}

test('只读当前专用书的全部启用大纲，UID零与任意模板标签有效', async () => {
  const source = [entry(7, { comment: '剧情指导8' }), entry(0), entry(2, { enabled: false }), entry(4, { comment: '其他设定' })];
  const before = plain(source);
  const calls = [];
  const s = await setup({ TavernHelper: { getLorebookEntries: async (name) => { calls.push(name); return source; } } });
  const result = await s.loadEnabledPlotGuides(context());
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, ['测试角色-剧情指导']);
  assert.deepEqual(plain(result.entries).map((item) => item.uid), [0, 7]);
  assert.equal(result.entries[0].content, '<任意标签>大纲0</任意标签>');
  assert.deepEqual(source, before);
  result.entries[0].content = '只改结果';
  assert.equal(source[1].content, '<任意标签>大纲0</任意标签>');
  assert.equal(s.clock.pending(), 0);
});

test('官方只读getter优先，不要求写入或绑定能力，也不混合ACU结果', async () => {
  let acuReads = 0;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => [entry(0)] }, TavernHelper_API_ACU: { getLorebookEntries: async () => { acuReads++; return [entry(1)]; } } });
  assert.deepEqual(plain((await s.loadEnabledPlotGuides(context())).entries).map((item) => item.uid), [0]);
  assert.equal(acuReads, 0);
});

test('官方缺少getter时可选只读ACU，parent和当前window均能探测', async () => {
  const s = await setup({ parent: {}, TavernHelper: {}, TavernHelper_API_ACU: { getLorebookEntries: async () => [entry(0)] } });
  assert.equal((await s.loadEnabledPlotGuides(context())).status, 'ok');
});

test('选定getter报错不切换另一份世界书快照，不输出异常原文', async () => {
  let acuReads = 0;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => { throw new Error('私密世界书正文'); } }, TavernHelper_API_ACU: { getLorebookEntries: async () => { acuReads++; return [entry(0)]; } } });
  const result = await s.loadEnabledPlotGuides(context());
  assert.equal(result.status, 'error');
  assert.equal(result.entries.length, 0);
  assert.doesNotMatch(result.warning + JSON.stringify(s.logs), /私密世界书正文/);
  assert.equal(acuReads, 0);
});

test('无Helper或唯一角色时给出未附带结果，不创建任何书', async () => {
  const s = await setup();
  assert.equal((await s.loadEnabledPlotGuides(context())).status, 'unavailable');
  assert.equal((await s.loadEnabledPlotGuides({ name2: '' })).status, 'unavailable');
});

test('群聊没有明确的当前角色目标时不按群名读取', async () => {
  let reads = 0;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => { reads++; return []; } } });
  assert.equal((await s.loadEnabledPlotGuides({ name2: '群聊', groupId: 1, characterId: null })).status, 'unavailable');
  assert.equal(reads, 0);
});

test('群聊公开上下文明确当前单一角色时不遍历其它成员', async () => {
  const calls = [];
  const s = await setup({ TavernHelper: { getLorebookEntries: async (name) => { calls.push(name); return [entry(0)]; } } });
  assert.equal((await s.loadEnabledPlotGuides({ name2: '角色甲', groupId: 1, characterId: 0, characters: [{ name: '角色甲' }, { name: '角色乙' }] })).status, 'ok');
  assert.deepEqual(calls, ['角色甲-剧情指导']);
});

test('合法空集和只有停用或空正文条目时明确为empty', async () => {
  for (const entries of [[], [entry(0, { enabled: false })], [entry(0, { content: '  ' })], [entry(0, { comment: '背景' })]]) {
    const s = await setup({ TavernHelper: { getLorebookEntries: async () => entries } });
    const result = await s.loadEnabledPlotGuides(context());
    assert.equal(result.status, 'empty');
    assert.match(result.warning, /没有.*已启用/);
  }
});

for (const [name, value] of [
  ['返回非数组', { entries: [entry(0)] }],
  ['数组含空项', [null]],
  ['缺少启用字段', [entry(0, { enabled: undefined })]],
  ['启用字段为字符串', [entry(0, { enabled: 'true' })]],
  ['缺少正文', [entry(0, { content: undefined })]],
  ['负UID', [entry(-1)]],
  ['字符串UID', [entry('0')]],
  ['重复UID', [entry(0), entry(0, { comment: '剧情指导2' })]],
  ['与其它条目重复UID', [entry(0), entry(0, { comment: '背景' })]],
]) {
  test('畸形结果不能假装成功空集：' + name, async () => {
    const s = await setup({ TavernHelper: { getLorebookEntries: async () => value } });
    const result = await s.loadEnabledPlotGuides(context());
    assert.equal(result.status, 'invalid');
    assert.equal(result.entries.length, 0);
  });
}

test('读取总等待五秒，超时后迟到结果不改变已返回结果', async () => {
  const pending = deferred();
  const s = await setup({ TavernHelper: { getLorebookEntries: () => pending.promise } });
  let done = false;
  const reading = s.loadEnabledPlotGuides(context()).then((value) => { done = true; return value; });
  await flush();
  await s.clock.advance(4999);
  assert.equal(done, false);
  await s.clock.advance(1);
  const result = await reading;
  assert.equal(result.status, 'timeout');
  pending.resolve([entry(0)]);
  await flush();
  assert.equal(result.entries.length, 0);
  assert.equal(s.clock.pending(), 0);
});

test('每次读取新快照，不跨次缓存条目启用状态', async () => {
  let enabled = true;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => [entry(0, { enabled })] } });
  assert.equal((await s.loadEnabledPlotGuides(context())).status, 'ok');
  enabled = false;
  assert.equal((await s.loadEnabledPlotGuides(context())).status, 'empty');
});

test('读取前身份已变化不启动getter，返回后变化丢弃旧条目', async () => {
  const pending = deferred();
  let reads = 0;
  let current = false;
  const s = await setup({ TavernHelper: { getLorebookEntries: () => { reads++; return pending.promise; } } });
  assert.equal((await s.loadEnabledPlotGuides(context(), { isCurrent: () => current })).status, 'changed');
  assert.equal(reads, 0);
  current = true;
  const reading = s.loadEnabledPlotGuides(context(), { isCurrent: () => current });
  await flush();
  current = false;
  pending.resolve([entry(0)]);
  const result = await reading;
  assert.equal(result.status, 'changed');
  assert.equal(result.entries.length, 0);
});

test('只读参考段保留原正文，不按相同内容合并不同UID', async () => {
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => [entry(2, { content: '\n<框>相同</框>\n' }), entry(0, { content: '\n<框>相同</框>\n' })] } });
  const { entries } = await s.loadEnabledPlotGuides(context());
  const section = s.buildPlotGuideSection(entries);
  assert.match(section, /已启用的世界书大纲.*只读参考/);
  assert.match(section, /本次.*模板/);
  assert.equal(section.split('<框>相同</框>').length - 1, 2);
  assert.ok(section.indexOf('【剧情指导】') < section.indexOf('【剧情指导3】'));
  assert.ok(section.includes('\n<框>相同</框>\n'));
  assert.equal(s.buildPlotGuideSection([]), '');
});

test('默认正文兜底剔除保留原loadWorldInfo和停用过滤语义', async () => {
  const s = await setup();
  const ctx = { ...context(), loadWorldInfo: async () => ({ entries: { 0: { comment: '剧情指导', disable: false, content: '旧大纲' }, 1: { comment: '剧情指导2', disable: true, content: '停用内容' } } }) };
  assert.equal(await s.stripPlotGuide('设定\n旧大纲\n旧大纲\n停用内容', ctx), '设定\n\n停用内容');
});

test('默认loadWorldInfo失败时Helper兜底仍生效', async () => {
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => [entry(0, { content: '旧大纲' })] } });
  assert.equal(await s.stripPlotGuide('设定\n旧大纲', { ...context(), loadWorldInfo: async () => { throw new Error('无此公开能力'); } }), '设定');
});

test('主动读取已失败时兜底不重复等Helper，仍保留独立loadWorldInfo剔除', async () => {
  let reads = 0;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => { reads++; return [entry(0, { content: '旧大纲' })]; } } });
  assert.equal(await s.stripPlotGuide('背景\n旧大纲', { ...context(), loadWorldInfo: async () => ({ entries: { 0: { comment: '剧情指导', content: '旧大纲', disable: false } } }) }, undefined, { skipHelpers: true }), '背景');
  assert.equal(reads, 0);
  assert.equal(await s.stripPlotGuide('背景', context(), undefined, { skipHelpers: true }), '背景');
  assert.equal(reads, 0);
});

test('已有合法快照用于精确剔除时不再次读取或扩大删除范围', async () => {
  let reads = 0;
  const s = await setup({ TavernHelper: { getLorebookEntries: async () => { reads++; return [entry(1, { content: '其它段' })]; } } });
  assert.equal(await s.stripPlotGuide('设定\n旧大纲\n其它段', context(), [entry(0, { content: '旧大纲' })]), '设定\n\n其它段');
  assert.equal(reads, 0);
  assert.equal(await s.stripPlotGuide('保留正文', context(), []), '保留正文');
  assert.equal(reads, 0);
});
