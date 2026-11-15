import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { storageEnvironment, deferred, flush, plain } from '../helpers/storage-env.mjs';

async function setup(options = {}) {
  const env = storageEnvironment(options);
  const storageModule = await loadPlugin('src/storage.js', env.globals, { 'src/toast.js': { showToast() {} } });
  const storage = storageModule.namespace;
  await storage.initTemplateStorage();
  return { env, storage };
}

test('旧列表只保存目标模板，不覆盖另一端新增项或重传无关正文', async () => {
  const { env, storage } = await setup();
  const index = env.index();
  index.push({ id: 'remote', name: '另一端', url: '/user/files/so-outline-tpl-remote.txt' });
  env.files.set('/user/files/so-outline-tpl-remote.txt', '远端正文');
  env.files.set(env.indexUrl, JSON.stringify({ templates: index }));
  assert.equal(await storage.persistTemplates([{ ...env.templates[0], content: '本次修改' }]), true);
  assert.ok(env.index().some((entry) => entry.id === 'remote'));
  assert.equal(env.uploadCalls().filter((body) => Buffer.from(body.data, 'base64').toString() === '远端正文').length, 0);
  assert.equal(env.calls.filter((call) => call.url === '/api/files/delete').length, 0);
});

test('同一目标远端已改则拒绝覆盖，也不降级成保存成功', async () => {
  const { env, storage } = await setup();
  env.files.set('/user/files/so-outline-tpl-default.txt', '另一端改过');
  const before = plain(storage.getCachedTemplates());
  assert.equal(await storage.persistTemplates([{ ...env.templates[0], content: '我的草稿' }]), false);
  assert.deepEqual(plain(storage.getCachedTemplates()), before);
  assert.equal(storage.getTemplateStorageStatus().lastResult.code, 'conflict');
  assert.equal(env.uploadCalls().length, 0);
});

test('修改上传新修订文件，索引失败不污染旧正文', async () => {
  const { env, storage } = await setup();
  env.setHandler((url, init) => url === '/api/files/upload' && JSON.parse(init.body).name.endsWith('index.json') ? env.response(500, 'failed') : null);
  await storage.persistTemplates([{ ...env.templates[0], content: '新修订' }]);
  assert.equal(env.files.get('/user/files/so-outline-tpl-default.txt'), '自定义默认内容');
  const bodyUpload = env.uploadCalls().find((body) => !body.name.endsWith('index.json'));
  assert.notEqual(bodyUpload.name, 'so-outline-tpl-default.txt');
});

test('并发新增读取队列内最新缓存，两项都保留', async () => {
  const env = storageEnvironment();
  const { namespace: templates } = await loadPlugin('src/templates.js', env.globals, { 'src/toast.js': { showToast() {} } });
  const results = await Promise.all([templates.addTemplate('甲', '甲内容'), templates.addTemplate('乙', '乙内容')]);
  assert.ok(results.every(Boolean));
  assert.deepEqual(templates.getTemplates().map((item) => item.name).sort().join(','), '乙,甲,默认');
  assert.ok(env.index().some((item) => item.name === '甲'));
  assert.ok(env.index().some((item) => item.name === '乙'));
});

test('调用方在异步等待期间修改操作对象不能改变已校验意图', async () => {
  const { env, storage } = await setup();
  const wait = deferred();
  const started = deferred();
  let first = true;
  env.setHandler((url) => {
    if (url.startsWith(env.indexUrl) && first) { first = false; started.resolve(); return wait.promise; }
    return null;
  });
  const op = { kind: 'update', id: 'default', base: { name: '默认', content: '自定义默认内容' }, next: { name: '默认', content: '修改后的默认' } };
  const saving = storage.commitTemplateOperations([op]);
  await started.promise;
  op.kind = 'delete';
  wait.resolve(env.response(200, env.files.get(env.indexUrl)));
  const result = await saving;
  assert.equal(result.ok, true);
  const meta = env.index().find((item) => item.id === 'default');
  assert.ok(meta, 'default不能被外部改操作删除');
  assert.equal(env.files.get(meta.url), '修改后的默认');
});

test('静态操作入队时固定数组和template/base/next快照', async () => {
  const { env, storage } = await setup();
  const wait = deferred();
  const started = deferred();
  let first = true;
  env.setHandler((url) => {
    if (url.startsWith(env.indexUrl) && first) { first = false; started.resolve(); return wait.promise; }
    return null;
  });
  const preceding = storage.commitTemplateOperations([{ kind: 'add', template: { id: 'ahead', name: '前一笔', content: '先保存' } }]);
  await started.promise;
  const ops = [
    { kind: 'update', id: 'default', base: { ...env.templates[0] }, next: { name: '默认', content: '排队时内容' } },
    { kind: 'add', template: { id: 'queued', name: '入队时名称', content: '入队时正文' } },
  ];
  const queued = storage.commitTemplateOperations(ops);
  ops[0].base.content = '被修改的基准';
  ops[0].next.content = '被修改的正文';
  ops[1].template.name = '被修改的名称';
  ops[1].template.content = '被修改的新增正文';
  ops.push({ kind: 'delete', id: 'default', base: ops[0].base });
  wait.resolve(env.response(200, env.files.get(env.indexUrl)));
  assert.equal((await preceding).ok, true);
  assert.equal((await queued).ok, true);
  const records = storage.getCachedTemplates();
  assert.equal(records.find((item) => item.id === 'default').content, '排队时内容');
  assert.equal(records.find((item) => item.id === 'queued').name, '入队时名称');
  assert.equal(records.find((item) => item.id === 'queued').content, '入队时正文');
});

test('工厂操作生成后立即断开外部template/base/next引用', async () => {
  const { env, storage } = await setup();
  const wait = deferred();
  const started = deferred();
  let first = true;
  env.setHandler((url) => {
    if (url.startsWith(env.indexUrl) && first) { first = false; started.resolve(); return wait.promise; }
    return null;
  });
  const ops = [
    { kind: 'update', id: 'default', base: { ...env.templates[0] }, next: { name: '默认', content: '工厂生成时正文' } },
    { kind: 'add', template: { id: 'factory', name: '工厂新增', content: '工厂新增正文' } },
  ];
  const saving = storage.commitTemplateOperations(() => ops);
  await started.promise;
  ops[0].base.content = '等待期间改基准';
  ops[0].next.content = '等待期间改正文';
  ops[1].template.id = 'changed-id';
  ops[1].template.content = '等待期间改新增';
  wait.resolve(env.response(200, env.files.get(env.indexUrl)));
  assert.equal((await saving).ok, true);
  const records = storage.getCachedTemplates();
  assert.equal(records.find((item) => item.id === 'default').content, '工厂生成时正文');
  assert.equal(records.find((item) => item.id === 'factory').content, '工厂新增正文');
  assert.equal(records.some((item) => item.id === 'changed-id'), false);
});

test('文件名限长且批量新增仅提交一次权威索引', async () => {
  const { env, storage } = await setup();
  assert.equal(typeof storage.commitTemplateOperations, 'function');
  const result = await storage.commitTemplateOperations([
    { kind: 'add', template: { id: 'a'.repeat(400), name: '../中文'.repeat(300), content: '甲' } },
    { kind: 'add', template: { id: 'b', name: '乙', content: '乙' } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(env.uploadCalls().filter((body) => body.name.endsWith('index.json')).length, 1);
  for (const body of env.uploadCalls()) {
    assert.ok(body.name.length <= 200);
    assert.match(body.name, /^[a-zA-Z0-9_.-]+$/);
  }
});
