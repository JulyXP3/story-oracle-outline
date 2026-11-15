// 模块：回复消息动作
// 作用：通过 api.addMessageAction 给每条神谕 AI 回复注册「注入剧情大纲」和「编辑」按钮，
// 并通过 api.updateReply 持久化编辑/标签补充结果。
import { showToast } from './toast.js';
import { supplementTags } from './tags.js';
import { injectOutlineToWorldInfo } from './outline-inject.js';
import { LOG_PREFIX } from './constants.js';

function isStreaming(msgEl) {
  const contentEl = msgEl && msgEl.querySelector('.so-content');
  // 本体在正文节点标记流式状态；仅检查当前消息，同时兼容根节点标记。
  return !!(msgEl && (msgEl.classList.contains('so-streaming') ||
    (contentEl && contentEl.classList.contains('so-streaming'))));
}

function persistReply(api, msgEl, text, action) {
  try {
    // StoryOracleAPI v1 同步返回 boolean；不能将非布尔值或 Promise 当作成功。
    if (api.updateReply(msgEl, text, { persist: true, render: 'markdown' }) === true) return true;
    console.error(LOG_PREFIX + action + '失败：updateReply 未返回 true。');
  } catch (error) {
    console.error(LOG_PREFIX + action + '失败：更新回复时发生异常。', error);
  }
  showToast(action + '失败，请重试', 'error');
  return false;
}

export function editAssistantMessage(msgEl, rawText, api) {
  if (isStreaming(msgEl)) {
    showToast('消息正在生成，请完成后再编辑', 'warning');
    return;
  }
  const contentEl = msgEl && msgEl.querySelector('.so-content');
  if (!contentEl || msgEl.querySelector('.so-msg-edit-area')) return;
  const currentText = rawText || contentEl.dataset.soRaw || contentEl.textContent || '';
  const messagesPanel = document.querySelector('#so-messages');
  const panelHeight = messagesPanel ? messagesPanel.clientHeight : 600;
  const editHeight = Math.max(300, Math.floor(panelHeight * 0.8));

  const textarea = document.createElement('textarea');
  textarea.className = 'so-msg-edit-area';
  textarea.value = currentText;
  textarea.style.cssText = 'width:100%;height:' + editHeight + 'px;min-height:300px;max-height:90vh;padding:12px;background:rgba(0,0,0,0.3);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,0.2));border-radius:8px;color:var(--SmartThemeBodyColor,#e6e6e6);font-family:inherit;font-size:inherit;line-height:1.5;resize:vertical;box-sizing:border-box;';

  const btnBar = document.createElement('div');
  btnBar.className = 'so-msg-edit-btns';
  btnBar.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'so-btn-secondary';
  saveBtn.type = 'button';
  saveBtn.textContent = '保存';
  saveBtn.style.padding = '6px 12px';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'so-btn-secondary';
  cancelBtn.type = 'button';
  cancelBtn.textContent = '取消';
  cancelBtn.style.padding = '6px 12px';
  btnBar.append(saveBtn, cancelBtn);

  contentEl.style.display = 'none';
  contentEl.parentNode.insertBefore(textarea, contentEl);
  textarea.parentNode.insertBefore(btnBar, textarea.nextSibling);
  textarea.focus();

  const closeEditor = () => {
    contentEl.style.display = '';
    textarea.remove();
    btnBar.remove();
  };
  saveBtn.addEventListener('click', () => {
    if (isStreaming(msgEl)) {
      showToast('消息正在生成，请完成后再保存', 'warning');
      return;
    }
    if (!persistReply(api, msgEl, textarea.value, '保存修改')) return;
    closeEditor();
    showToast('已保存修改', 'success');
  });
  cancelBtn.addEventListener('click', closeEditor);
}

export function handleTagFix(api) {
  const messages = Array.from(document.querySelectorAll('#so-window .so-msg.so-assistant'));
  if (!messages.length) {
    showToast('没有找到AI消息', 'warning');
    return;
  }
  const latestMsg = messages[messages.length - 1];
  if (isStreaming(latestMsg)) {
    showToast('消息正在生成，请完成后再补充标签', 'warning');
    return;
  }
  const contentEl = latestMsg.querySelector('.so-content');
  const rawText = (contentEl && (contentEl.dataset.soRaw || contentEl.textContent)) || '';
  if (!rawText.trim()) {
    showToast('消息内容为空', 'warning');
    return;
  }
  const fixedText = supplementTags(rawText);
  if (fixedText === null) {
    showToast('无法安全补充标签，请检查模板与消息标签结构', 'warning');
    return;
  }
  if (fixedText === rawText) {
    showToast('标签已完整，无需补充', 'warning');
    return;
  }
  if (persistReply(api, latestMsg, fixedText, '补充标签')) {
    showToast('已补充标签并保存', 'success');
  }
}

export function registerMessageActions(api) {
  api.addMessageAction({
    id: 'outline-inject',
    icon: 'fa-solid fa-file-import',
    title: '注入剧情大纲',
    onClick(msgEl, rawText) {
      injectOutlineToWorldInfo(rawText, msgEl);
    },
  });

  api.addMessageAction({
    id: 'outline-edit',
    icon: 'fa-solid fa-pen',
    title: '编辑',
    onClick(msgEl, rawText) {
      editAssistantMessage(msgEl, rawText, api);
    },
  });
}
