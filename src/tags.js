// 模块：大纲标签处理
// 作用：从当前模板识别首尾标签，并为模型输出补全缺失的 <plot_outline> 一类标签。
// 这里只处理文本；保存结果与提示由消息动作负责。
import { getTemplate, selectedTemplateId } from './templates.js';

// 按完整名称扫描，不把前缀相同的标签或属性引号内的文字当成目标标签。
function scanTags(text) {
  const tags = [];
  const pattern = /<(\/?)([a-z_][a-z0-9_-]*)(?=[\s/>]|$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const nameEnd = pattern.lastIndex;
    let end = nameEnd;
    let quote = '';
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>' || char === '<') {
        break;
      }
    }
    const terminated = text[end] === '>';
    const tail = text.slice(nameEnd, end);
    const closing = match[1] === '/';
    tags.push({
      name: match[2],
      closing,
      start: match.index,
      nameEnd,
      end: terminated ? end + 1 : nameEnd,
      complete: terminated && (closing ? /^\s*$/.test(tail) : !tail || /^\s/.test(tail) || /^\/\s*$/.test(tail)),
      selfClosing: terminated && /\/\s*$/.test(tail),
    });
    pattern.lastIndex = terminated ? end + 1 : nameEnd;
  }
  return tags;
}

function lastCompleteBlock(text, tags) {
  let opening = null;
  let last = null;
  for (const tag of tags) {
    if (!tag.complete || tag.selfClosing) return null;
    if (tag.closing) {
      if (!opening) return null;
      last = text.slice(opening.start, tag.end);
      opening = null;
    } else {
      if (opening) return null;
      opening = tag;
    }
  }
  return opening ? null : last;
}

export function extractTagNameFromTemplate(template) {
  if (typeof template !== 'string') return null;
  const tags = scanTags(template);
  for (const tag of tags) {
    if (tag.closing) continue;
    const sameName = tags.filter((item) => item.name.toLowerCase() === tag.name.toLowerCase());
    if (lastCompleteBlock(template, sameName) !== null) return tag.name;
  }
  return null;
}

export function extractTagContentFromEnd(text, tagName) {
  if (typeof text !== 'string' || typeof tagName !== 'string') return null;
  const tags = scanTags(text).filter((tag) => tag.name.toLowerCase() === tagName.toLowerCase());
  return lastCompleteBlock(text, tags);
}

export function getCurrentTemplate() {
  return getTemplate(selectedTemplateId()) || null;
}

export function supplementTags(text) {
  const template = getCurrentTemplate();
  const tagName = template && extractTagNameFromTemplate(template.content);
  if (!tagName) return null;

  const source = String(text ?? '');
  const tags = scanTags(source).filter((tag) => tag.name.toLowerCase() === tagName.toLowerCase());
  const openings = tags.filter((tag) => !tag.closing);
  const closings = tags.filter((tag) => tag.closing);
  // 多块、嵌套、倒序与自闭合目标均有歧义，不猜测要保留哪一份。
  if (openings.length > 1 || closings.length > 1 || tags.some((tag) => tag.selfClosing)) return null;
  if (openings.length && closings.length && openings[0].start > closings[0].start) return null;

  let result = source;
  // 只给首部独占一行的残缺起标签、或末尾残缺尾标签补 >，不移除任何原文。
  for (const tag of tags.slice().reverse()) {
    if (tag.complete) continue;
    const remaining = source.slice(tag.nameEnd);
    const repairable = tag.closing
      ? /^\s*$/.test(remaining)
      : /^\s*$/.test(source.slice(0, tag.start)) && /^(?:[ \t]*[\r\n]|[ \t]*$)/.test(remaining);
    if (!repairable) return null;
    result = result.slice(0, tag.nameEnd) + '>' + result.slice(tag.nameEnd);
  }
  if (!openings.length) result = '<' + tagName + '>\n\n' + result;
  if (!closings.length) result += '\n\n</' + tagName + '>';
  return result;
}
