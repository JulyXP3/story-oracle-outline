import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from '../helpers/load-plugin.mjs';

async function setup(template = '<plot_outline>模板</plot_outline>') {
  const toasts = [];
  const { namespace } = await loadPlugin('src/tags.js', {}, {
    'src/templates.js': {
      getTemplate: () => template === null ? null : ({ id: 'default', content: template }),
      selectedTemplateId: () => 'default',
    },
    'src/toast.js': { showToast: (...args) => toasts.push(args) },
  });
  return { tags: namespace, toasts };
}

test('提取最后一份独立大纲，不跨越前一份闭合标签', async () => {
  const { tags } = await setup();
  assert.equal(tags.extractTagContentFromEnd('<plot_outline>旧</plot_outline>说明<plot_outline>新</plot_outline>', 'plot_outline'), '<plot_outline>新</plot_outline>');
});

test('相似标签名、嵌套和不配对标签不能猜测成合法大纲', async () => {
  const { tags } = await setup();
  for (const text of ['<plot_outline_extra>x</plot_outline>', '<plot_outline>外<plot_outline>内</plot_outline></plot_outline>', '</plot_outline><plot_outline>x</plot_outline>', '<plot_outline>x</plot_outline><plot_outline>未闭合']) {
    assert.equal(tags.extractTagContentFromEnd(text, 'plot_outline'), null, text);
  }
  assert.equal(tags.extractTagContentFromEnd('<plot_outline>x</plot_outline>', '.*'), null);
});

test('精确标签允许大小写和属性，输出保留原始内容', async () => {
  const { tags } = await setup();
  assert.equal(tags.extractTagContentFromEnd('前言<Plot_Outline type="a">\n x \n</PLOT_OUTLINE>结尾', 'plot_outline'), '<Plot_Outline type="a">\n x \n</PLOT_OUTLINE>');
  assert.equal(tags.extractTagNameFromTemplate('<plot_outline_extra>文本</plot_outline>'), null);
});

test('补标签保留边缘HTML且无成功提示副作用', async () => {
  const { tags, toasts } = await setup();
  assert.equal(tags.supplementTags('<div>正文</div>'), '<plot_outline>\n\n<div>正文</div>\n\n</plot_outline>');
  assert.deepEqual(toasts, []);
});

test('完整标签正文原样返回，缺失一侧只补目标标签', async () => {
  const { tags } = await setup();
  const complete = '前言\n<plot_outline><div>正文</div></plot_outline>\n结尾';
  assert.equal(tags.supplementTags(complete), complete);
  assert.equal(tags.supplementTags('<plot_outline><div>正文</div>'), '<plot_outline><div>正文</div>\n\n</plot_outline>');
  assert.equal(tags.supplementTags('<div>正文</div></plot_outline>'), '<plot_outline>\n\n<div>正文</div></plot_outline>');
});

test('目标标签边缘残缺可修复，重复或嵌套目标失败', async () => {
  const { tags } = await setup();
  assert.equal(tags.supplementTags('<plot_outline\n正文'), '<plot_outline>\n正文\n\n</plot_outline>');
  assert.equal(tags.supplementTags('<plot_outline>正文</plot_outline'), '<plot_outline>正文</plot_outline>');
  assert.equal(tags.supplementTags('<plot_outline>一</plot_outline><plot_outline>二</plot_outline>'), null);
  assert.equal(tags.supplementTags('<plot_outline><plot_outline>x</plot_outline></plot_outline>'), null);
});

test('非法标签名参数不能进入正则匹配', async () => {
  const { tags } = await setup();
  for (const name of ['.*', 'plot_outline|div', 'plot_outline ', 'plot_outline\n', '1plot', {}, 1]) {
    assert.equal(tags.extractTagContentFromEnd('<plot_outline>x</plot_outline>', name), null, String(name));
  }
});

test('带引号属性和尾标签空白不改变原始块内容', async () => {
  const { tags } = await setup();
  const block = '<Plot_Outline data-test="1 > 0" title="<plot_outline>">\n<b>正文</b>\n</PLOT_OUTLINE \t>';
  assert.equal(tags.extractTagContentFromEnd('前言' + block + '结尾', 'plot_outline'), block);
  assert.equal(tags.extractTagNameFromTemplate('<Plan-2_Outline type="a > b">模板</PLAN-2_OUTLINE >'), 'Plan-2_Outline');
});

test('完整块旁的残缺或自闭合目标标签必须拒绝提取', async () => {
  const { tags } = await setup();
  for (const text of [
    '<plot_outline>旧</plot_outline>前言<plot_outline\n未完成',
    '<plot_outline/>说明<plot_outline>正文</plot_outline>',
    '<plot_outline>正文</plot_outline></plot_outline',
  ]) {
    assert.equal(tags.extractTagContentFromEnd(text, 'plot_outline'), null, text);
  }
});

test('相似名称和其他HTML属性中的标签文字不算目标标签', async () => {
  const { tags } = await setup();
  for (const text of [
    '<plot_outline_extra>正文</plot_outline_extra>',
    '<plot-outline>正文</plot-outline>',
    '<div title="<plot_outline>">正文</div>',
  ]) {
    assert.equal(tags.supplementTags(text), '<plot_outline>\n\n' + text + '\n\n</plot_outline>');
  }
});

test('仅修复确定的边缘残缺且保留属性、大小写与空白', async () => {
  const { tags } = await setup();
  assert.equal(tags.supplementTags(' \n<Plot_Outline\n<div>正文</div></PLOT_OUTLINE \n'), ' \n<Plot_Outline>\n<div>正文</div></PLOT_OUTLINE> \n');
  assert.equal(tags.supplementTags('<PLOT_OUTLINE role="a"><b>正文</b>'), '<PLOT_OUTLINE role="a"><b>正文</b>\n\n</plot_outline>');
  assert.equal(tags.supplementTags(' \n<div>正文</div> \n'), '<plot_outline>\n\n \n<div>正文</div> \n\n\n</plot_outline>');
});

test('中间残缺、倒序、重复和自闭合目标标签不能盲补', async () => {
  const { tags } = await setup();
  for (const text of [
    '前言<plot_outline\n正文',
    '<plot_outline>正文</plot_outline 后文',
    '</plot_outline>正文<plot_outline>',
    '<plot_outline>正文</plot_outline></plot_outline>',
    '<plot_outline>正文<plot_outline',
    '<plot_outline/>',
    '<plot_outline type="未闭合',
  ]) {
    assert.equal(tags.supplementTags(text), null, text);
  }
});

test('模板不可用和格式错误返回null且纯文本模块不弹提示', async () => {
  for (const template of [null, '没有标签', '<plot_outline_extra>模板</plot_outline>']) {
    const { tags, toasts } = await setup(template);
    assert.equal(tags.supplementTags('正文'), null);
    assert.deepEqual(toasts, []);
  }
  const { tags, toasts } = await setup();
  tags.supplementTags('<plot_outline>完整</plot_outline>');
  tags.supplementTags('<plot_outline><plot_outline>嵌套</plot_outline></plot_outline>');
  assert.deepEqual(toasts, []);
});
