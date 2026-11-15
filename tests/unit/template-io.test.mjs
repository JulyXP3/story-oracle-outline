import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { storageEnvironment } from '../helpers/storage-env.mjs';

test('批量导入一次提交索引，同批重名不覆盖，读取失败单独计数', async () => {
  const env = storageEnvironment();
  const toasts = [];
  const { namespace: io } = await loadPlugin('src/template-io.js', env.globals, { 'src/toast.js': { showToast: (...args) => toasts.push(args) } });
  const count = await io.importTemplatesFromFiles([
    { name: '测试.txt', text: async () => '一' },
    { name: '测试.TXT', text: async () => '二' },
    { name: '坏.txt', text: async () => { throw new Error('读取失败'); } },
  ]);
  assert.equal(count, 2);
  assert.equal(env.uploadCalls().filter((item) => item.name.endsWith('index.json')).length, 1);
  assert.ok(env.index().some((item) => item.name === '测试'));
  assert.ok(env.index().some((item) => item.name === '测试（2）'));
  assert.ok(toasts.some(([message]) => message.includes('坏.txt')));
});

test('导入降级成功明确说明本浏览器，全部失败不报已导入', async () => {
  const env = storageEnvironment({ local: [{ id: 'default', name: '默认', content: '本地' }] });
  const toasts = [];
  env.setHandler((url) => url.startsWith(env.indexUrl) ? env.response(500, 'failed') : null);
  const { namespace: io } = await loadPlugin('src/template-io.js', env.globals, { 'src/toast.js': { showToast: (...args) => toasts.push(args) } });
  assert.equal(await io.importTemplatesFromFiles([{ name: '一.txt', text: async () => '内容' }]), 1);
  assert.ok(toasts.some(([message]) => message.includes('已导入') && message.includes('本浏览器')));
  toasts.length = 0;
  env.failLocal(true);
  assert.equal(await io.importTemplatesFromFiles([{ name: '二.txt', text: async () => '草稿' }]), 0);
  assert.ok(!toasts.some(([message]) => message.startsWith('已导入')));
});
