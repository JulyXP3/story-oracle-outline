// 模块：大纲标签处理
// 作用：从当前模板识别首尾标签，并为模型输出补全缺失的 <plot_outline> 一类标签。
// 编辑和「标签补充」按钮都会复用这里的纯文本处理逻辑。
import { getTemplate, selectedTemplateId } from './templates.js';
import { showToast } from './toast.js';

export function extractTagNameFromTemplate(template) {
  if (!template) return null;
  const match = template.match(/<([a-z_][a-z0-9_-]*)[^>]*>[\s\S]*?<\/\1>/i);
  return match ? match[1] : null;
}

export function extractTagContentFromEnd(text, tagName) {
  if (!text || !tagName) return null;
  const pattern = new RegExp('<' + tagName + '[^>]*>([\\s\\S]*?)<\\/' + tagName + '>(?![\\s\\S]*<\\/' + tagName + '>)', 'i');
  const match = text.match(pattern);
  return match ? match[0].trim() : null;
}

export function getCurrentTemplate() {
  return getTemplate(selectedTemplateId()) || null;
}

function hasCompleteTag(text, tagName) {
  const pattern = new RegExp('<' + tagName + '[^>]*>[\\s\\S]*?<\\/' + tagName + '>', 'i');
  return pattern.test(text);
}

function stripHeadTailTags(text) {
  let result = String(text || '').trim();
  let changed = true;
  while (changed) {
    const before = result;
    result = result.replace(/^<\/?[^>]*>?/i, '').trim();
    result = result.replace(/<\/?[^>]*>?$/i, '').trim();
    changed = before !== result;
  }
  return result;
}

export function supplementTags(text) {
  const template = getCurrentTemplate();
  if (!template) {
    showToast('未找到大纲模板', 'warning');
    return null;
  }
  const tagName = extractTagNameFromTemplate(template.content);
  if (!tagName) {
    showToast('模板格式错误：未找到闭合标签', 'warning');
    return null;
  }
  if (hasCompleteTag(text, tagName)) {
    showToast('标签已完整，无需补充', 'success');
    return text;
  }
  const hasAnyTag = /<[^>]+>/.test(text) || /<\/[^>]+>/.test(text);
  const content = hasAnyTag ? stripHeadTailTags(text) : String(text || '').trim();
  const result = '<' + tagName + '>\n\n' + content + '\n\n</' + tagName + '>';
  showToast('已补充 <' + tagName + '> 标签', 'success');
  return result;
}
