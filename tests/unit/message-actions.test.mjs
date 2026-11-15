import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';
import { createMessageDom } from '../helpers/message-dom.mjs';

async function setup({ rawText = '原消息', streaming = false, updateReply = () => true, template = '<plot_outline>模板</plot_outline>' } = {}) {
  const dom = createMessageDom();
  const { message, content } = dom.addMessage(rawText, { streaming });
  const toasts = [];
  const errors = [];
  const calls = [];
  const events = [];
  const registered = [];
  const injections = [];
  const toastr = Object.fromEntries(['success', 'warning', 'error'].map((type) => [type, (text) => {
    toasts.push({ text, type });
    events.push('toast:' + type);
  }]));
  const api = {
    updateReply(msgEl, text, options) {
      calls.push({ msgEl, text, options });
      events.push('updateReply');
      const result = updateReply(msgEl, text, options);
      // 替身仅模拟公开 API 的同步布尔返回与成功后的消息更新。
      if (result === true) {
        const target = msgEl.querySelector('.so-content');
        target.dataset.soRaw = text;
        target.textContent = text;
      }
      return result;
    },
    addMessageAction: (action) => registered.push(action),
  };
  const { namespace } = await loadPlugin('src/message-actions.js', {
    document: dom.document,
    window: { toastr },
    console: { ...console, error: (...args) => errors.push(args) },
  }, {
    'src/templates.js': {
      getTemplate: () => template === null ? null : ({ id: 'default', content: template }),
      selectedTemplateId: () => 'default',
    },
    'src/outline-inject.js': { injectOutlineToWorldInfo: (...args) => injections.push(args) },
  });
  return { ...dom, actions: namespace, api, message, content, toasts, errors, calls, events, registered, injections };
}

function openEditor(fixture, rawText) {
  fixture.actions.editAssistantMessage(fixture.message, rawText, fixture.api);
  const textarea = fixture.message.querySelector('.so-msg-edit-area');
  const buttons = fixture.message.querySelector('.so-msg-edit-btns').querySelectorAll('button');
  return { textarea, save: buttons[0], cancel: buttons[1] };
}

function assertWrite(call, message, text) {
  assert.equal(call.msgEl, message);
  assert.equal(call.text, text);
  assert.deepEqual({ ...call.options }, { persist: true, render: 'markdown' });
}

function assertFailure(fixture) {
  assert.equal(fixture.errors.length, 1);
  assert.match(fixture.errors[0][0], /^\[故事神谕·大纲版\] .*失败/);
  assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['error']);
  assert.match(fixture.toasts[0].text, /失败/);
  assert.deepEqual(fixture.events, ['updateReply', 'toast:error']);
}

test('编辑保存返回false保留编辑器、草稿和原文，允许再次保存', async () => {
  let accepted = false;
  const fixture = await setup({ updateReply: () => accepted });
  const { textarea, save } = openEditor(fixture);
  textarea.value = '未保存的草稿';
  save.click();
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), textarea);
  assert.equal(textarea.value, '未保存的草稿');
  assert.equal(fixture.content.style.display, 'none');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.content.textContent, '原消息');
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '未保存的草稿');
  assertFailure(fixture);
  accepted = true;
  save.click();
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
  assert.equal(fixture.content.dataset.soRaw, '未保存的草稿');
  assert.equal(fixture.calls.length, 2);
});

test('编辑保存抛异常时捕获错误并保留编辑器和草稿', async () => {
  const failure = new Error('模拟持久化异常');
  const fixture = await setup({ updateReply: () => { throw failure; } });
  const { textarea, save } = openEditor(fixture);
  textarea.value = '异常时的草稿';
  assert.doesNotThrow(() => save.click());
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), textarea);
  assert.equal(textarea.value, '异常时的草稿');
  assert.equal(fixture.content.style.display, 'none');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assertFailure(fixture);
  assert.ok(fixture.errors[0].includes(failure));
});

test('编辑保存只有同步布尔true才算成功，非布尔值均保留草稿', async () => {
  for (const result of [undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const fixture = await setup({ updateReply: () => result });
    const { textarea, save } = openEditor(fixture);
    textarea.value = '仍需保存';
    save.click();
    await Promise.resolve();
    assert.equal(fixture.message.querySelector('.so-msg-edit-area'), textarea, String(result));
    assert.equal(textarea.value, '仍需保存');
    assert.equal(fixture.content.dataset.soRaw, '原消息');
    assertFailure(fixture);
  }
});

test('编辑保存true后才关闭编辑器并发出成功提示，原样提交草稿', async () => {
  let fixture;
  fixture = await setup({ updateReply: () => {
    assert.ok(fixture.message.querySelector('.so-msg-edit-area'));
    assert.deepEqual(fixture.toasts, []);
    return true;
  } });
  const { textarea, save } = openEditor(fixture, '动作提供的原文');
  assert.equal(textarea.value, '动作提供的原文');
  assert.equal(fixture.document.activeElement, textarea);
  textarea.value = ' \n<div>新内容</div> \n';
  save.click();
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
  assert.equal(fixture.message.querySelector('.so-msg-edit-btns'), null);
  assert.equal(fixture.content.style.display, '');
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, ' \n<div>新内容</div> \n');
  assert.deepEqual(fixture.events, ['updateReply', 'toast:success']);
  assert.deepEqual(fixture.errors, []);
});

test('取消编辑不更新回复、不改原文、不发保存提示', async () => {
  const fixture = await setup();
  const { textarea, cancel } = openEditor(fixture);
  textarea.value = '丢弃草稿';
  cancel.click();
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
  assert.equal(fixture.message.querySelector('.so-msg-edit-btns'), null);
  assert.equal(fixture.content.style.display, '');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.content.textContent, '原消息');
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.toasts, []);
  assert.deepEqual(fixture.errors, []);
});

test('同一消息已有编辑器时不重复创建也不覆盖草稿', async () => {
  const fixture = await setup();
  const { textarea } = openEditor(fixture);
  textarea.value = '草稿';
  fixture.actions.editAssistantMessage(fixture.message, '较旧的原文', fixture.api);
  assert.equal(fixture.message.querySelectorAll('.so-msg-edit-area').length, 1);
  assert.equal(textarea.value, '草稿');
  assert.deepEqual(fixture.calls, []);
});

test('当前流式消息不能打开编辑器', async () => {
  const fixture = await setup({ streaming: true });
  fixture.actions.editAssistantMessage(fixture.message, '生成中', fixture.api);
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
  assert.equal(fixture.content.style.display, '');
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.toasts.some((toast) => toast.type === 'success'), false);
});

test('打开编辑器后变为流式消息也不能保存，草稿仍保留', async () => {
  const fixture = await setup();
  const { textarea, save, cancel } = openEditor(fixture);
  textarea.value = '生成开始前的草稿';
  fixture.message.classList.add('so-streaming');
  save.click();
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), textarea);
  assert.equal(textarea.value, '生成开始前的草稿');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.toasts.some((toast) => toast.type === 'success'), false);
  cancel.click();
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
});

test('其他消息流式生成不阻止编辑当前非流式消息', async () => {
  const fixture = await setup();
  fixture.addMessage('另一条生成中', { streaming: true });
  const { textarea, save } = openEditor(fixture);
  textarea.value = '当前消息的新内容';
  save.click();
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '当前消息的新内容');
});

test('仅当前正文节点带流式标记时不能打开编辑器', async () => {
  const fixture = await setup();
  fixture.content.classList.add('so-streaming');
  assert.equal(fixture.message.classList.contains('so-streaming'), false);
  fixture.actions.editAssistantMessage(fixture.message, '生成中', fixture.api);
  assert.equal(fixture.message.querySelectorAll('.so-msg-edit-area').length, 0);
  assert.equal(fixture.message.querySelectorAll('.so-msg-edit-btns').length, 0);
  assert.equal(fixture.content.style.display, '');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['warning']);
});

test('打开编辑器后仅正文节点变为流式时不能保存且保留草稿', async () => {
  const fixture = await setup();
  const { textarea, save } = openEditor(fixture);
  textarea.value = '正文生成前的草稿';
  fixture.content.classList.add('so-streaming');
  assert.equal(fixture.message.classList.contains('so-streaming'), false);
  save.click();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), textarea);
  assert.equal(textarea.value, '正文生成前的草稿');
  assert.equal(fixture.content.style.display, 'none');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.content.textContent, '原消息');
  assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['warning']);
  fixture.content.classList.remove('so-streaming');
  save.click();
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '正文生成前的草稿');
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
});

test('其他消息正文流式生成不阻止当前消息编辑和保存', async () => {
  const fixture = await setup();
  const other = fixture.addMessage('另一条正文生成中');
  other.content.classList.add('so-streaming');
  const { textarea, save } = openEditor(fixture);
  textarea.value = '当前非流式消息的新内容';
  save.click();
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '当前非流式消息的新内容');
  assert.equal(other.content.dataset.soRaw, '另一条正文生成中');
  assert.equal(fixture.message.querySelector('.so-msg-edit-area'), null);
  assert.deepEqual(fixture.events, ['updateReply', 'toast:success']);
});

test('补标签成功提示必须晚于updateReply且保留正文HTML', async () => {
  let fixture;
  fixture = await setup({ rawText: '<div>正文</div>', updateReply: () => {
    assert.deepEqual(fixture.toasts, []);
    return true;
  } });
  fixture.actions.handleTagFix(fixture.api);
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '<plot_outline>\n\n<div>正文</div>\n\n</plot_outline>');
  assert.deepEqual(fixture.events, ['updateReply', 'toast:success']);
  assert.deepEqual(fixture.errors, []);
});

test('补标签更新false时保留原消息并在门禁后报告失败', async () => {
  const fixture = await setup({ updateReply: () => false });
  fixture.actions.handleTagFix(fixture.api);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.content.textContent, '原消息');
  assertFailure(fixture);
});

test('补标签更新抛异常时捕获并记录带前缀的中文错误', async () => {
  const failure = new Error('模拟补标签持久化异常');
  const fixture = await setup({ updateReply: () => { throw failure; } });
  assert.doesNotThrow(() => fixture.actions.handleTagFix(fixture.api));
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assertFailure(fixture);
  assert.ok(fixture.errors[0].includes(failure));
});

test('补标签更新返回非布尔值不能报成功', async () => {
  for (const result of [undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const fixture = await setup({ updateReply: () => result });
    fixture.actions.handleTagFix(fixture.api);
    await Promise.resolve();
    assert.equal(fixture.content.dataset.soRaw, '原消息');
    assert.equal(fixture.calls.length, 1);
    assertFailure(fixture);
  }
});

test('最新AI消息正在生成时不补标签，也不退回修改上一条', async () => {
  const fixture = await setup();
  const latest = fixture.addMessage('生成中', { streaming: true });
  fixture.actions.handleTagFix(fixture.api);
  assert.deepEqual(fixture.calls, []);
  assert.equal(latest.content.dataset.soRaw, '生成中');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(fixture.toasts.some((toast) => toast.type === 'success'), false);
});

test('最新AI消息仅正文节点流式时不补标签也不改上一条', async () => {
  const fixture = await setup();
  const latest = fixture.addMessage('最新正文生成中');
  latest.content.classList.add('so-streaming');
  assert.equal(latest.message.classList.contains('so-streaming'), false);
  fixture.actions.handleTagFix(fixture.api);
  assert.equal(fixture.calls.length, 0);
  assert.equal(latest.content.dataset.soRaw, '最新正文生成中');
  assert.equal(latest.content.textContent, '最新正文生成中');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['warning']);
});

test('其他消息正文流式生成不阻止最新非流式AI消息补标签', async () => {
  const fixture = await setup();
  fixture.content.classList.add('so-streaming');
  const latest = fixture.addMessage('最新非流式回复');
  fixture.actions.handleTagFix(fixture.api);
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], latest.message, '<plot_outline>\n\n最新非流式回复\n\n</plot_outline>');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.deepEqual(fixture.events, ['updateReply', 'toast:success']);
});

test('补标签仅处理最新AI消息，忽略后面的用户消息', async () => {
  const fixture = await setup();
  const latest = fixture.addMessage('最新回复');
  const user = fixture.addMessage('用户消息', { assistant: false });
  fixture.actions.handleTagFix(fixture.api);
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], latest.message, '<plot_outline>\n\n最新回复\n\n</plot_outline>');
  assert.equal(fixture.content.dataset.soRaw, '原消息');
  assert.equal(user.content.dataset.soRaw, '用户消息');
});

test('已完整标签不重复更新，不冒充保存成功', async () => {
  const rawText = '前言<plot_outline><b>正文</b></plot_outline>结尾';
  const fixture = await setup({ rawText });
  fixture.actions.handleTagFix(fixture.api);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.content.dataset.soRaw, rawText);
  assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['warning']);
  assert.match(fixture.toasts[0].text, /完整|无需/);
});

test('模板不可用或重复嵌套标签拒绝更新并给出非成功提示', async () => {
  for (const options of [
    { template: null },
    { template: '没有合法标签' },
    { rawText: '<plot_outline>一</plot_outline><plot_outline>二</plot_outline>' },
    { rawText: '<plot_outline><plot_outline>嵌套</plot_outline></plot_outline>' },
  ]) {
    const fixture = await setup(options);
    fixture.actions.handleTagFix(fixture.api);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.toasts.map((toast) => toast.type), ['warning']);
  }
});

test('无AI消息或消息为空时不调用更新', async () => {
  const missing = await setup();
  missing.message.remove();
  missing.actions.handleTagFix(missing.api);
  assert.deepEqual(missing.calls, []);
  assert.deepEqual(missing.toasts.map((toast) => toast.type), ['warning']);
  const empty = await setup({ rawText: ' \n ' });
  empty.actions.handleTagFix(empty.api);
  assert.deepEqual(empty.calls, []);
  assert.deepEqual(empty.toasts.map((toast) => toast.type), ['warning']);
});

test('公开API继续注册注入和编辑动作，编辑保存仍走updateReply', async () => {
  const fixture = await setup();
  fixture.actions.registerMessageActions(fixture.api);
  assert.deepEqual(fixture.registered.map((action) => action.id), ['outline-inject', 'outline-edit']);
  fixture.registered[0].onClick(fixture.message, '待注入大纲');
  assert.deepEqual(fixture.injections, [['待注入大纲', fixture.message]]);
  fixture.registered[1].onClick(fixture.message, '动作原文');
  const textarea = fixture.message.querySelector('.so-msg-edit-area');
  assert.equal(textarea.value, '动作原文');
  textarea.value = '动作修改';
  fixture.message.querySelector('.so-msg-edit-btns').querySelectorAll('button')[0].click();
  assert.equal(fixture.calls.length, 1);
  assertWrite(fixture.calls[0], fixture.message, '动作修改');
});
