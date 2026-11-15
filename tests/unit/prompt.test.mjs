import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { deferred, fakeClock, flush, plain } from '../helpers/storage-env.mjs';
import vm from 'node:vm';

async function setup(options = {}) {
  const clock = fakeClock();
  const window = { ...(options.window || {}) };
  const flags = { preset: !!options.preset, history: !!options.history, guides: !!options.guides };
  const context = { name2: '测试角色', characterId: 0, groupId: null, chatId: '测试聊天', substituteParams: (value) => value.replaceAll('{{user}}', '测试用户'), ...(options.context || {}) };
  const settings = { outlineSystemPrompt: '指令', chatIncludeStat: false, ...(options.settings || {}) };
  let template = '模板';
  let selectedId = options.selectedId || 'default';
  const calls = [];
  const warnings = [];
  const logs = [];
  const mode = { generation: 1, active: true, roomReady: true };
  const core = vm.createContext({
    convoStreamKey: options.room || 'outline',
    convo: options.convo || [{ role: 'user', content: '旧提问', soHide: false }, { role: 'assistant', content: '旧回答', soHide: false }, { role: 'user', content: '本轮提问', soHide: false }],
  });
  const api = {
    context: {
      getContext: () => context,
      getSettings: () => settings,
      buildCardSection: () => '卡片',
      buildWorldInfo: async (options) => { calls.push(options); return '世界'; },
      buildTranscript: () => '对话',
      ...(options.apiContext || {}),
    },
    unsafe: { eval: (code) => code.includes('ENABLE_BUILTIN') ? { on: true, core: '破限{{user}}', tail: '尾块' } : vm.runInContext(code, core) },
  };
  const { namespace: prompt } = await loadPlugin('src/prompt.js', {
    ...clock,
    window,
    document: { getElementById: (id) => ({ checked: id === 'so-outline-use-preset' ? flags.preset : id === 'so-outline-include-all-chat' ? flags.history : id === 'so-outline-include-plot-guides' ? flags.guides : false }) },
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  }, {
    'src/templates.js': { getTemplate: options.getTemplate || (() => template === null ? null : ({ id: selectedId, content: template })), selectedTemplateId: () => selectedId },
    'src/storage.js': { initTemplateStorage: options.init || (async () => {}), getTemplateStorageStatus: () => ({ ready: true, loadErrors: [] }) },
    'src/constants.js': { LOG_PREFIX: '[测试] ', OUTLINE_DEFAULT_SYSTEM_PROMPT: '默认指令', OUTLINE_PRESET_IDENTITY_HEADER: '身份头', SO_BUILTIN_JB_SENTINEL: '__so_builtin_jb__' },
    'src/mode-compat.js': { getOutlineModeState: () => ({ ...mode }) },
    ...(!options.realToast ? { 'src/toast.js': { showToast: (message, type) => warnings.push({ message, type }) } } : {}),
  });
  return { clock, window, settings, flags, calls, api, context, core, mode, warnings, logs, template: (value) => { template = value; }, select: (id) => { selectedId = id; }, send: () => prompt.buildOutlineSend('本轮提问', context, api) };
}

test('发送等待模板初始化完成，再读取最新模板', async () => {
  const ready = deferred();
  const s = await setup({ init: () => ready.promise });
  let completed = false;
  const sending = s.send().then((value) => { completed = true; return value; });
  await flush();
  assert.equal(completed, false);
  s.template('已就绪的新模板');
  ready.resolve();
  assert.match((await sending).system, /已就绪的新模板/);
});

test('等待初始化期间选择被ready回退，原发送必须拒绝而非改用默认', async () => {
  const ready = deferred();
  const s = await setup({ selectedId: 'chosen', init: () => ready.promise });
  const sending = s.send();
  const rejected = assert.rejects(sending, /模板.*重新选择/);
  await flush();
  // 模拟ready事件在初始化Promise续体前保存默认选择。
  s.select('default');
  s.template('不应发送的默认正文');
  ready.resolve();
  await rejected;
  assert.equal(s.calls.length, 0);
});

test('初始化后目标缺失时拒绝getTemplate返回的默认替代项', async () => {
  const ready = deferred();
  const s = await setup({ selectedId: 'missing', init: () => ready.promise, getTemplate: () => ({ id: 'default', content: '默认替代正文' }) });
  const sending = s.send();
  const rejected = assert.rejects(sending, /模板.*重新选择/);
  ready.resolve();
  await rejected;
  assert.equal(s.calls.length, 0);
});

test('未加载模板不能静默省略模板后发送', async () => {
  const s = await setup();
  s.template(null);
  await assert.rejects(s.send(), /模板/);
});

test('非MVU共享一次5秒探测，30秒退避不重复等待', async () => {
  let starts = 0;
  const s = await setup({ settings: { chatIncludeStat: true }, window: { TavernHelper: { waitGlobalInitialized: () => { starts++; return new Promise(() => {}); } } } });
  const one = s.send();
  const two = s.send();
  await flush();
  await s.clock.advance(5000);
  await Promise.all([one, two]);
  assert.equal(starts, 1);
  let done = false;
  const three = s.send().then(() => { done = true; });
  await flush();
  assert.equal(done, true);
  await three;
  assert.equal(starts, 1);
  assert.equal(s.clock.pending(), 0);
});

test('MVU早于超时就绪清理计时器，每轮读取最新变量', async () => {
  let value = 1;
  const Mvu = { getMvuData: () => ({ stat_data: { value } }) };
  const s = await setup({ settings: { chatIncludeStat: true }, window: { TavernHelper: { waitGlobalInitialized: async () => Mvu } } });
  assert.match((await s.send()).system, /"value": 1/);
  assert.equal(s.clock.pending(), 0);
  s.window.Mvu = Mvu;
  value = 2;
  assert.match((await s.send()).system, /"value": 2/);
  s.settings.chatIncludeStat = false;
  assert.doesNotMatch((await s.send()).system, /stat_data/);
});

test('退避期间MVU出现时立即读取，不永久缓存不存在', async () => {
  const s = await setup({ settings: { chatIncludeStat: true }, window: { TavernHelper: { waitGlobalInitialized: () => new Promise(() => {}) } } });
  const first = s.send();
  await flush();
  await s.clock.advance(5000);
  await first;
  s.window.Mvu = { getMvuData: () => ({ stat_data: { 当前: '新变量' } }) };
  assert.match((await s.send()).system, /新变量/);
});

test('纯路径卡片、世界书双保险与对话的文字顺序不变', async () => {
  const s = await setup({ settings: { includeCard: true }, context: { loadWorldInfo: async () => ({ entries: { 0: { comment: '剧情指导', content: '应剔除', disable: false } } }) }, apiContext: { buildWorldInfo: async (options) => { assert.deepEqual(plain(options), { excludeBooks: ['测试角色-剧情指导'] }); return '设定\n应剔除'; } } });
  assert.deepEqual(plain(await s.send()), {
    system: '指令\n\n模板\n\n卡片\n\n=== 世界书 / 设定 ===\n设定\n\n=== 故事对话记录（最新的在最后）===\n对话',
    messages: [{ role: 'user', content: '本轮提问' }],
  });
});

test('策展预设保role和chatHistory槽位，marker不进入消息', async () => {
  const s = await setup({ preset: true, settings: { sysPromptPresetName: '测试', curatedPresets: { 测试: { items: [
    { kind: 'text', role: 'user', content: '预设{{user}}' },
    { kind: 'marker', identifier: 'charDescription', content: '忽略' },
    { kind: 'marker', identifier: 'chatHistory' },
    { kind: 'text', role: 'assistant', content: '末块' },
    { kind: 'marker', identifier: 'chatHistory' },
  ] } } } });
  assert.deepEqual(plain(await s.send()), { system: '', messages: [
    { role: 'system', content: '身份头' },
    { role: 'user', content: '预设测试用户' },
    { role: 'system', content: '指令\n\n模板\n\n=== 世界书 / 设定 ===\n世界\n\n=== 故事对话记录（最新的在最后）===\n对话' },
    { role: 'user', content: '本轮提问' },
    { role: 'assistant', content: '末块' },
  ] });
});

test('内置破限仍按首尾消息包裹，全量历史不重复本轮输入', async () => {
  const s = await setup({ preset: true, history: true, settings: { sysPromptPresetName: '__so_builtin_jb__' } });
  const result = plain(await s.send());
  assert.equal(result.system, '');
  assert.deepEqual(result.messages.map((item) => item.role), ['system', 'system', 'user', 'assistant', 'user', 'system']);
  assert.equal(result.messages[0].content, '破限测试用户');
  assert.equal(result.messages[2].content, '旧提问');
  assert.equal(result.messages[3].content, '旧回答');
  assert.equal(result.messages[4].content, '本轮提问');
  assert.equal(result.messages[5].content, '尾块');
});

const guide = (uid = 0, extra = {}) => ({ uid, comment: uid ? '剧情指导' + (uid + 1) : '剧情指导', enabled: true, content: '<参考>世界书大纲标记' + uid + '</参考>', ...extra });
const allText = (result) => [result.system, ...result.messages.map((item) => item.content)].join('\n');

for (const path of ['纯', '策展', '内置']) {
  test(path + '路径只发送允许的大纲历史，当前输入一次且不改变role结构', async () => {
    const settings = path === '策展' ? { sysPromptPresetName: '预设', curatedPresets: { 预设: { items: [
      { kind: 'text', role: 'user', content: '预设前' }, { kind: 'marker', identifier: 'chatHistory' }, { kind: 'text', role: 'assistant', content: '预设后' },
    ] } } } : path === '内置' ? { sysPromptPresetName: '__so_builtin_jb__' } : {};
    const s = await setup({ preset: path !== '纯', settings, history: true, convo: [
      { role: 'user', content: '不应出现', soHide: true },
      { role: 'assistant', content: '允许的历史', soHide: false },
      { role: 'note', content: '不发送备注' },
      { role: 'user', content: '本轮提问', soHide: false },
    ] });
    const before = plain(s.core.convo);
    const result = await s.send();
    assert.doesNotMatch(allText(result), /不应出现|不发送备注/);
    assert.match(allText(result), /允许的历史/);
    assert.equal(result.messages.filter((item) => item.role === 'user' && item.content === '本轮提问').length, 1);
    assert.deepEqual(plain(s.core.convo), before);
    if (path === '策展') {
      assert.equal(result.messages[0].content, '身份头');
      assert.equal(result.messages.at(-1).content, '预设后');
    }
    if (path === '内置') {
      assert.equal(result.messages[0].content, '破限测试用户');
      assert.equal(result.messages.at(-1).content, '尾块');
    }
  });
}

test('最近一层仅当前输入，手动恢复的旧楼层仍可发送，不另行计算N', async () => {
  const s = await setup({ history: true, convo: [
    { role: 'user', content: '太旧', soHide: true },
    { role: 'assistant', content: '已隐藏', soHide: true },
    { role: 'user', content: '本轮提问', soHide: false },
  ] });
  assert.deepEqual(plain((await s.send()).messages), [{ role: 'user', content: '本轮提问' }]);
  s.core.convo[0].soHide = false;
  assert.deepEqual(plain((await s.send()).messages).map((item) => item.content), ['太旧', '本轮提问']);
});

test('先排除本轮尾项再筛隐藏，历史同文提问不被当成本轮删掉', async () => {
  const s = await setup({ history: true, convo: [
    { role: 'user', content: '本轮提问' }, { role: 'assistant', content: '旧回复', soHide: false },
    { role: 'user', content: '本轮提问', soHide: true },
  ] });
  assert.deepEqual(plain((await s.send()).messages).map((item) => item.content), ['本轮提问', '旧回复', '本轮提问']);
});

for (const [name, config] of [
  ['普通房间', { room: 'main' }],
  ['尾部不是本轮user', { convo: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧答案' }] }],
  ['尾部user正文不匹配', { convo: [{ role: 'user', content: '另一个输入' }] }],
]) {
  test('历史契约异常可见降级而非读取错误房间：' + name, async () => {
    const s = await setup({ history: true, ...config });
    const result = await s.send();
    assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
    assert.match(result.system, /指令\n\n模板/);
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0].message, /未附带.*历史/);
  });
}

test('缺少或抛错的历史读取不丢基础大纲，也不输出异常正文', async () => {
  for (const unsafe of [undefined, { eval: () => { throw new Error('秘密历史原文'); } }]) {
    const s = await setup({ history: true });
    s.api.unsafe = unsafe;
    const result = await s.send();
    assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
    assert.match(result.system, /指令\n\n模板/);
    assert.equal(s.warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(s.logs) + s.warnings[0].message, /秘密历史原文/);
  }
});

test('历史和预设开关固定在第一次等待前，源convo后续修改不污染本轮', async () => {
  const waiting = deferred();
  const s = await setup({ history: true, init: () => waiting.promise });
  const sending = s.send();
  s.flags.history = false;
  s.core.convo[0].content = '迟到改写';
  s.core.convo[1].soHide = true;
  waiting.resolve();
  const result = await sending;
  assert.deepEqual(plain(result.messages).map((item) => item.content), ['旧提问', '旧回答', '本轮提问']);
});

test('本轮关闭历史时等待期间再开启不应补读历史', async () => {
  const waiting = deferred();
  const s = await setup({ init: () => waiting.promise });
  const sending = s.send();
  s.flags.history = true;
  waiting.resolve();
  assert.deepEqual(plain((await sending).messages).map((item) => item.content), ['本轮提问']);
});

test('常规世界书off时新开关仍附带全部已启用大纲，历史关闭不受牵连', async () => {
  const calls = [];
  const s = await setup({ guides: true, settings: { worldInfoMode: 'off' }, window: { TavernHelper: { getLorebookEntries: async (book) => { calls.push(book); return [guide(2), guide(0), guide(1, { enabled: false })]; } } }, apiContext: { buildWorldInfo: async (options) => { assert.deepEqual(plain(options), { excludeBooks: ['测试角色-剧情指导'] }); return ''; } } });
  const result = await s.send();
  assert.deepEqual(calls, ['测试角色-剧情指导']);
  assert.match(result.system, /世界书大纲标记0/);
  assert.match(result.system, /世界书大纲标记2/);
  assert.doesNotMatch(result.system, /世界书大纲标记1/);
  assert.ok(result.system.indexOf('只读参考') < result.system.indexOf('故事对话记录'));
  assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
});

test('世界书新开关未开启不额外读取，旧排除参数照常存在', async () => {
  let reads = 0;
  const s = await setup({ guides: false, window: { TavernHelper: { getLorebookEntries: async () => { reads++; return [guide()]; } } }, apiContext: { buildWorldInfo: async (options) => { assert.deepEqual(plain(options), { excludeBooks: ['测试角色-剧情指导'] }); return ''; } } });
  const result = await s.send();
  assert.equal(reads, 0);
  assert.doesNotMatch(result.system, /只读参考|世界书大纲标记/);
});

test('世界书附带精确剔除普通上下文副本，只读一次合法快照', async () => {
  let reads = 0;
  const item = guide();
  const s = await setup({ guides: true, window: { TavernHelper: { getLorebookEntries: async () => { reads++; return [item]; } } }, apiContext: { buildWorldInfo: async () => '背景\n' + item.content } });
  const result = await s.send();
  assert.equal(reads, 1);
  assert.equal(result.system.split(item.content).length - 1, 1);
  assert.match(result.system, /=== 世界书 \/ 设定 ===\n背景/);
});

for (const path of ['策展', '内置']) {
  test(path + '使用同一份世界书参考且保留原首尾结构', async () => {
    const settings = path === '策展' ? { sysPromptPresetName: '预设', curatedPresets: { 预设: { items: [
      { kind: 'text', role: 'system', content: '槽前' }, { kind: 'marker', identifier: 'chatHistory' }, { kind: 'text', role: 'user', content: '槽后' },
    ] } } } : { sysPromptPresetName: '__so_builtin_jb__' };
    const s = await setup({ preset: true, guides: true, settings, window: { TavernHelper: { getLorebookEntries: async () => [guide()] } } });
    const result = await s.send();
    assert.equal(allText(result).split('世界书大纲标记0').length - 1, 1);
    assert.equal(result.messages[0].content, path === '策展' ? '身份头' : '破限测试用户');
    assert.equal(result.messages.at(-1).content, path === '策展' ? '槽后' : '尾块');
  });
}

for (const [name, entries] of [['合法空集', []], ['畸形条目', [{ uid: 0, comment: '剧情指导', content: '正文' }]]]) {
  test('世界书' + name + '不throw或伪报成功，基础大纲照常返回', async () => {
    const s = await setup({ guides: true, window: { TavernHelper: { getLorebookEntries: async () => entries } }, apiContext: { buildWorldInfo: async () => '' } });
    const result = await s.send();
    assert.match(result.system, /指令\n\n模板/);
    assert.doesNotMatch(result.system, /只读参考/);
    assert.equal(s.warnings.length, 1);
  });
}

test('历史与世界书同时读取失败只合并一次告警且不泄漏错误正文', async () => {
  const s = await setup({ history: true, guides: true, window: { TavernHelper: { getLorebookEntries: async () => { throw new Error('密钥和真实正文'); } } }, apiContext: { buildWorldInfo: async () => '' } });
  s.api.unsafe = undefined;
  const result = await s.send();
  assert.match(result.system, /指令\n\n模板/);
  assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0].message, /历史/);
  assert.match(s.warnings[0].message, /世界书/);
  assert.doesNotMatch(JSON.stringify(s.logs) + s.warnings[0].message, /密钥和真实正文/);
});

test('世界书五秒超时不会因兜底重复等同一个getter，迟到不改变请求', async () => {
  const waiting = deferred();
  let reads = 0;
  const s = await setup({ guides: true, window: { TavernHelper: { getLorebookEntries: () => { reads++; return waiting.promise; } } } });
  const sending = s.send();
  await flush();
  await s.clock.advance(5000);
  let completed = false;
  sending.then(() => { completed = true; });
  await flush();
  assert.equal(completed, true, '可选读取超时后不得重新进入无限等待的同源兜底');
  const result = await sending;
  assert.equal(reads, 1);
  assert.doesNotMatch(result.system, /只读参考/);
  assert.equal(s.warnings.length, 1);
  waiting.resolve([guide()]);
  await flush();
  assert.doesNotMatch(result.system, /世界书大纲标记/);
});

test('新增世界书选项同样固定在点击时，等待期间勾选只影响下次', async () => {
  const wait = deferred();
  let reads = 0;
  const s = await setup({ init: () => wait.promise, window: { TavernHelper: { getLorebookEntries: async () => { reads++; return [guide()]; } } }, apiContext: { buildWorldInfo: async () => '' } });
  const sending = s.send();
  s.flags.guides = true;
  wait.resolve();
  assert.doesNotMatch((await sending).system, /世界书大纲标记/);
  assert.equal(reads, 0);
  assert.match((await s.send()).system, /世界书大纲标记0/);
});

test('真实toast组件抛错不能把可选失败变成丢失基础提示词的reject', async () => {
  const s = await setup({ guides: true, realToast: true, window: { toastr: { warning: () => { throw new Error('外部提示组件损坏'); } } }, apiContext: { buildWorldInfo: async () => '' } });
  const result = await s.send();
  assert.match(result.system, /指令\n\n模板/);
  assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
  assert.doesNotMatch(JSON.stringify(s.logs), /外部提示组件损坏/);
  assert.match(JSON.stringify(s.logs), /未附带/);
});

test('公开上下文复核报错也只省略可选参考，不向本体抛错', async () => {
  const s = await setup({ history: true });
  s.api.context.getContext = () => { throw new Error('内部错误含私密内容'); };
  const result = await s.send();
  assert.match(result.system, /指令\n\n模板/);
  assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
  assert.equal(s.warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(s.logs), /内部错误含私密内容/);
});

test('角色变更后不借正文兜底读取新角色专用书', async () => {
  const wait = deferred();
  const reads = [];
  const s = await setup({ guides: true,
    context: { loadWorldInfo: async (book) => { reads.push(book); return { entries: {} }; } },
    window: { TavernHelper: { getLorebookEntries: () => wait.promise } },
  });
  const sending = s.send();
  await flush();
  s.context.name2 = '新角色';
  wait.resolve([guide()]);
  await sending;
  assert.ok(!reads.includes('新角色-剧情指导'));
});

for (const change of ['角色', '聊天', '模式代次']) {
  test(change + '在读取中变化时丢弃旧可选参考，不读取新目标', async () => {
    const wait = deferred();
    const calls = [];
    const s = await setup({ history: true, guides: true, window: { TavernHelper: { getLorebookEntries: (book) => { calls.push(book); return wait.promise; } } }, apiContext: { buildWorldInfo: async () => '' } });
    const sending = s.send();
    await flush();
    if (change === '角色') s.context.name2 = '新角色';
    else if (change === '聊天') s.context.chatId = '新聊天';
    else s.mode.generation++;
    wait.resolve([guide()]);
    const result = await sending;
    assert.deepEqual(plain(result.messages), [{ role: 'user', content: '本轮提问' }]);
    assert.doesNotMatch(result.system, /世界书大纲标记/);
    assert.deepEqual(calls, ['测试角色-剧情指导']);
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0].message, /变化/);
  });
}
