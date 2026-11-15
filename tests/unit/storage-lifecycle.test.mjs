import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { storageEnvironment, deferred, fakeClock, flush, plain } from '../helpers/storage-env.mjs';

async function setup(options = {}, globals = {}) {
  const env = storageEnvironment(options);
  const result = await loadPlugin('src/storage.js', { ...env.globals, ...globals }, { 'src/toast.js': { showToast() {} } });
  return { env, storage: result.namespace };
}

test('并发初始化只读一次权威索引，ready早于刷新事件', async () => {
  let storage;
  const observed = [];
  const setupResult = await setup({ onEvent: () => { if (storage?.getTemplateStorageStatus) observed.push(storage.getTemplateStorageStatus().ready); } });
  storage = setupResult.storage;
  const { env } = setupResult;
  await Promise.all([storage.initTemplateStorage(), storage.initTemplateStorage()]);
  assert.equal(env.calls.filter((call) => call.url.startsWith(env.indexUrl)).length, 1);
  assert.equal(typeof storage.getTemplateStorageStatus, 'function');
  assert.equal(storage.getTemplateStorageStatus().ready, true);
  assert.equal(observed.at(-1), true);
});

test('全部持久化层失败不得发布候选缓存', async () => {
  const { env, storage } = await setup();
  await storage.initTemplateStorage();
  const before = plain(storage.getCachedTemplates());
  env.failLocal(true);
  env.setHandler((url) => url === '/api/files/upload' ? env.response(500, 'failed') : null);
  const ok = await storage.persistTemplates([{ ...before[0], content: '未保存草稿' }]);
  assert.equal(ok, false);
  assert.deepEqual(plain(storage.getCachedTemplates()), before);
});

test('权威索引上传失败只能报告本地降级，不更新镜像或删旧正文', async () => {
  const { env, storage } = await setup({ idb: true });
  await storage.initTemplateStorage();
  const beforeSettings = JSON.stringify(env.settings);
  env.setHandler((url, init) => url === '/api/files/upload' && JSON.parse(init.body).name.endsWith('index.json') ? env.response(500, 'index failed') : null);
  assert.equal(await storage.persistTemplates([{ ...env.templates[0], name: '改名', content: '修改' }]), true);
  assert.equal(storage.currentTier(), 'idb');
  assert.equal(JSON.stringify(env.settings), beforeSettings);
  assert.equal(env.calls.filter((call) => call.url === '/api/files/delete').length, 0);
  assert.equal(env.files.get('/user/files/so-outline-tpl-default.txt'), '自定义默认内容');
});

test('部分正文读取失败保留元数据，保存另一项不删掉失败项', async () => {
  const { env, storage } = await setup({ templates: [{ id: 'default', name: '默认', content: '正文' }, { id: 'broken', name: '未加载', content: '保护内容' }] });
  env.setHandler((url) => url.endsWith('-broken.txt') ? env.response(500, 'read failed') : null);
  await storage.initTemplateStorage();
  assert.equal(typeof storage.getTemplateStorageStatus, 'function');
  assert.equal(storage.getTemplateStorageStatus().loadErrors[0].id, 'broken');
  assert.equal(await storage.persistTemplates([{ id: 'default', name: '默认', content: '新正文' }]), true);
  assert.ok(env.index().some((entry) => entry.id === 'broken'));
  assert.equal(env.files.get('/user/files/so-outline-tpl-broken.txt'), '保护内容');
});

test('权威索引网络失败不当空索引迁移覆盖', async () => {
  const { env, storage } = await setup({ local: [{ id: 'default', name: '本地', content: '旧快照' }] });
  env.setHandler((url) => url.startsWith(env.indexUrl) ? env.response(500, 'unavailable') : null);
  await storage.initTemplateStorage();
  assert.equal(storage.currentTier(), 'local');
  assert.equal(env.uploadCalls().length, 0);
  assert.equal(storage.getCachedTemplates()[0].content, '旧快照');
});

test('返回缓存是独立对象，外部修改不污染下一次读取', async () => {
  const { storage } = await setup();
  await storage.initTemplateStorage();
  storage.getCachedTemplates()[0].content = '误改';
  assert.equal(storage.getCachedTemplates()[0].content, '自定义默认内容');
});

test('缺少索引时优先较新的IDB快照，保留自定义默认模板', async () => {
  const { env, storage } = await setup({ absent: true, idb: true, idbData: [{ id: 'default', name: '我的默认', content: 'IDB较新内容' }], local: [{ id: 'default', name: '旧默认', content: '旧本地' }] });
  await storage.initTemplateStorage();
  assert.equal(storage.getCachedTemplates()[0].content, 'IDB较新内容');
  const meta = env.index().find((item) => item.id === 'default');
  assert.equal(env.files.get(meta.url), 'IDB较新内容');
});

test('索引坏JSON降级时不覆盖远端，失败队列仍可接收下一笔', async () => {
  const { env, storage } = await setup({ local: [{ id: 'default', name: '本地', content: '原文' }] });
  env.files.set(env.indexUrl, '{bad');
  await storage.initTemplateStorage();
  env.failLocal(true);
  assert.equal(await storage.persistTemplates([{ id: 'default', name: '本地', content: '未存' }]), false);
  env.failLocal(false);
  assert.equal(await storage.persistTemplates([{ id: 'default', name: '本地', content: '已存' }]), true);
  assert.equal(storage.getCachedTemplates()[0].content, '已存');
  assert.equal(env.files.get(env.indexUrl), '{bad');
});

test('部分读取后降级保存仍保留未读默认模板的两层备份', async () => {
  const backup = [{ id: 'default', name: '自定义默认', content: '不能丢失' }, { id: 'other', name: '其他', content: '旧' }];
  const { env, storage } = await setup({ templates: backup, local: backup, idb: true, idbData: backup });
  env.setHandler((url, init) => url.endsWith('-default.txt') ? env.response(500, 'read failed') : url === '/api/files/upload' && JSON.parse(init.body).name.endsWith('index.json') ? env.response(500, 'index failed') : null);
  await storage.initTemplateStorage();
  assert.equal(await storage.persistTemplates([{ id: 'other', name: '其他', content: '新' }]), true);
  assert.equal(env.idbData().find((item) => item.id === 'default')?.content, '不能丢失');
  assert.equal(JSON.parse(env.local.get('so_outline_templates')).find((item) => item.id === 'default')?.content, '不能丢失');
});

for (const initiallyUnread of [true, false]) {
  test((initiallyUnread ? '原有未读项' : '提交后新增未读项') + '保留备份，已确认删除不在重载后复活', async () => {
    const backup = [
      { id: 'default', name: '默认', content: '默认正文' },
      { id: 'a', name: '未读项', content: 'A的已有备份' },
      { id: 'b', name: '待删除', content: 'B的正文' },
    ];
    const { env, storage } = await setup({ templates: backup, local: backup, idb: true, idbData: backup });
    if (initiallyUnread) env.setHandler((url) => url.endsWith('-a.txt') ? env.response(500, 'read failed') : null);
    await storage.initTemplateStorage();
    if (!initiallyUnread) {
      const index = env.index();
      index.find((item) => item.id === 'a').url = '/user/files/so-outline-tpl-a-new.txt';
      env.files.set(env.indexUrl, JSON.stringify({ templates: index }));
      env.setHandler((url) => url.endsWith('-a-new.txt') ? env.response(500, 'read failed') : null);
    }
    const result = await storage.commitTemplateOperations([{ kind: 'delete', id: 'b', base: backup[2] }]);
    assert.equal(result.ok, true);
    assert.equal(result.tier, 'server');
    assert.ok(storage.getTemplateStorageStatus().loadErrors.some((item) => item.id === 'a'));
    await flush();
    for (const saved of [env.idbData(), JSON.parse(env.local.get('so_outline_templates'))]) {
      assert.equal(saved.some((item) => item.id === 'b'), false, '已确认删除必须反映到本地备份');
      assert.equal(saved.find((item) => item.id === 'a')?.content, 'A的已有备份');
    }
    const { namespace: reloaded } = await loadPlugin('src/storage.js', env.globals, { 'src/toast.js': { showToast() {} } });
    await reloaded.initTemplateStorage();
    assert.equal(env.index().some((item) => item.id === 'b'), false);
    assert.equal(reloaded.getCachedTemplates().some((item) => item.id === 'b'), false);
    assert.equal(env.calls.filter((call) => call.url === '/api/files/delete').length, 0);
  });
}

test('IDB恢复可读后仍保留localStorage独有的已保存模板', async () => {
  const original = { id: 'default', name: '默认', content: '原文' };
  const unique = { id: 'local-only', name: '本地独有', content: '最后一份' };
  const { storage } = await setup({ local: [original, unique], idb: true, idbData: [original] });
  await storage.initTemplateStorage();
  assert.equal(storage.getCachedTemplates().find((item) => item.id === 'local-only')?.content, '最后一份');
});

test('已确认权威提交不等待无关远端正文再判成功', async () => {
  const clock = fakeClock();
  const { env, storage } = await setup({}, clock);
  await storage.initTemplateStorage();
  const index = env.index();
  index.push({ id: 'remote', name: '远端新项', url: '/user/files/so-outline-tpl-remote.txt' });
  env.files.set(env.indexUrl, JSON.stringify({ templates: index }));
  const slow = deferred();
  env.setHandler((url) => url.endsWith('-remote.txt') ? slow.promise : null);
  let result;
  const saving = storage.persistTemplates([{ ...env.templates[0], content: '已提交修改' }]).then((value) => { result = value; });
  try {
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(result, true);
    assert.equal(storage.currentTier(), 'server');
    assert.equal(storage.getCachedTemplates()[0].content, '已提交修改');
    assert.ok(storage.getTemplateStorageStatus().loadErrors.some((item) => item.id === 'remote'));
    await clock.advance(15000);
    assert.equal(storage.getTemplateStorageStatus().lastResult.ok, true);
  } finally { slow.resolve(env.response(200, '远端内容')); await saving; }
});

test('IDB持续挂起后local降级仍能保存而不是永远超时', async () => {
  const clock = fakeClock();
  const env = storageEnvironment({ local: [{ id: 'default', name: '默认', content: '原文' }] });
  env.globals.window.indexedDB = { open: () => ({}) };
  const { namespace: storage } = await loadPlugin('src/storage.js', { ...env.globals, ...clock }, { 'src/toast.js': { showToast() {} } });
  const init = storage.initTemplateStorage();
  await flush();
  await clock.advance(15000);
  await init;
  let result;
  const save = storage.persistTemplates([{ id: 'default', name: '默认', content: '可保存' }]).then((value) => { result = value; });
  await flush();
  await clock.advance(15000);
  await save;
  assert.equal(result, true);
  assert.equal(JSON.parse(env.local.get('so_outline_templates'))[0].content, '可保存');
  assert.equal(clock.pending(), 0);
});

test('IDB写入挂起后仍独立兜底到localStorage', async () => {
  const clock = fakeClock();
  const { env, storage } = await setup({ idb: true, idbData: [{ id: 'default', name: '默认', content: '原文' }] }, clock);
  env.setHandler((url) => url.startsWith(env.indexUrl) ? env.response(500, 'offline') : null);
  await storage.initTemplateStorage();
  assert.equal(storage.currentTier(), 'idb');
  env.globals.window.indexedDB = { open: () => ({}) };
  let result;
  const save = storage.persistTemplates([{ id: 'default', name: '默认', content: 'IDB超时后保存' }]).then((value) => { result = value; });
  await flush();
  await clock.advance(15000);
  await save;
  assert.equal(result, true);
  assert.equal(storage.currentTier(), 'local');
  assert.equal(JSON.parse(env.local.get('so_outline_templates'))[0].content, 'IDB超时后保存');
  assert.equal(clock.pending(), 0);
});

test('HTTP忽略abort也必须结束保存并隔离迟到响应', async () => {
  const clock = fakeClock();
  const { env, storage } = await setup({}, clock);
  await storage.initTemplateStorage();
  const slow = deferred();
  const started = deferred();
  let first = true;
  env.setHandler((url) => {
    if (url === '/api/files/upload' && first) { first = false; started.resolve(); return slow.promise; }
    return null;
  });
  let result;
  const save = storage.commitTemplateOperations([{ kind: 'update', id: 'default', base: env.templates[0], next: { name: '默认', content: '超时草稿' } }]).then((value) => { result = value; });
  try {
    await started.promise;
    await clock.advance(15000);
    assert.equal(result?.ok, true);
    assert.equal(result.tier, 'local');
    assert.equal(await storage.persistTemplates([{ id: 'default', name: '默认', content: '下一笔' }]), true);
    slow.resolve(env.response(200, JSON.stringify({ path: '/user/files/so-outline-tpl-late.txt' })));
    await flush();
    assert.equal(storage.getCachedTemplates()[0].content, '下一笔');
    assert.equal(env.uploadCalls().filter((body) => body.name.endsWith('index.json')).length, 0);
    assert.equal(clock.pending(), 0);
  } finally {
    slow.resolve(env.response(200, JSON.stringify({ path: '/user/files/so-outline-tpl-late.txt' })));
    await save;
  }
});

test('已提交结果不等本地镜像且迟到镜像不能倒写下一笔', async () => {
  const clock = fakeClock();
  const { env, storage } = await setup({ idb: true }, clock);
  await storage.initTemplateStorage();
  const requests = [];
  env.globals.window.indexedDB = { open() {
    const req = {};
    requests.push(req);
    if (requests.length > 1) queueMicrotask(() => req.onerror?.());
    return req;
  } };
  let result;
  const save = storage.persistTemplates([{ ...env.templates[0], content: '服务端已确认' }]).then((value) => { result = value; });
  try {
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(result, true);
    assert.equal(storage.getTemplateStorageStatus().busy, false);
    env.setHandler((url) => url === '/api/files/upload' ? env.response(500, 'offline') : null);
    assert.equal(await storage.persistTemplates([{ ...env.templates[0], content: '本地较新保存' }]), true);
    let lateWrites = 0;
    let closed = 0;
    requests[0].result = { close() { closed++; }, transaction() { lateWrites++; throw new Error('迟到镜像不应创建事务'); } };
    requests[0].onsuccess();
    await flush();
    assert.equal(lateWrites, 0);
    assert.equal(closed, 1);
    assert.equal(storage.getCachedTemplates()[0].content, '本地较新保存');
    assert.equal(JSON.parse(env.local.get('so_outline_templates'))[0].content, '本地较新保存');
    assert.equal(clock.pending(), 0);
  } finally {
    requests[0]?.onerror?.();
    await clock.advance(15000);
    await save;
  }
});

test('初始化15秒超时后允许本地保存，迟到服务端结果不覆盖', async () => {
  const clock = fakeClock();
  const { env, storage } = await setup({ local: [{ id: 'default', name: '默认', content: '本地' }] }, clock);
  const pending = deferred();
  env.setHandler((url) => url.startsWith(env.indexUrl) ? pending.promise : null);
  const init = storage.initTemplateStorage();
  await flush();
  await clock.advance(15000);
  assert.equal(typeof storage.getTemplateStorageStatus, 'function');
  assert.equal(storage.getTemplateStorageStatus().ready, true);
  await init;
  assert.equal(await storage.persistTemplates([{ id: 'default', name: '默认', content: '超时后的修改' }]), true);
  pending.resolve(env.response(200, env.files.get(env.indexUrl)));
  await flush();
  assert.equal(storage.getCachedTemplates()[0].content, '超时后的修改');
  assert.equal(clock.pending(), 0);
});
