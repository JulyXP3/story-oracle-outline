// 模块：回复消息动作
// 作用：通过 api.addMessageAction 给每条神谕 AI 回复注册「注入剧情大纲」和「编辑」按钮，
// 并通过 api.updateReply 持久化编辑/标签补充结果。
import { showToast } from './toast.js';
import { supplementTags } from './tags.js';
import { injectOutlineToWorldInfo } from './outline-inject.js';

export function editAssistantMessage(msgEl, rawText, api) {
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
    const ok = api.updateReply(msgEl, textarea.value, { persist: true, render: 'markdown' });
    closeEditor();
    showToast(ok ? '已保存修改' : '保存失败', ok ? 'success' : 'error');
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
  const contentEl = latestMsg.querySelector('.so-content');
  const rawText = (contentEl && (contentEl.dataset.soRaw || contentEl.textContent)) || '';
  if (!rawText.trim()) {
    showToast('消息内容为空', 'warning');
    return;
  }
  const fixedText = supplementTags(rawText);
  if (fixedText && fixedText !== rawText) {
    api.updateReply(latestMsg, fixedText, { persist: true, render: 'markdown' });
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
