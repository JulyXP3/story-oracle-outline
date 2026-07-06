// 模块：插件注册入口
// 作用：校验 StoryOracleAPI 版本，注册大纲模式、回复动作，并安装最终模式兼容层。
// 这里只编排模块，不承载具体业务实现。
import { LOG_PREFIX, REQUIRED_API_VERSION } from './constants.js';
import { buildOutlineSend } from './prompt.js';
import { buildOutlineBar } from './ui.js';
import { registerMessageActions } from './message-actions.js';
import { setStoryOracleApi } from './outline-inject.js';
import { installFinalModeCompat } from './final-mode.js';

let deleteConfirmInstalled = false;

async function confirmDanger(message) {
  try {
    const ctx = window.SillyTavern?.getContext?.();
    const popup = ctx?.callGenericPopup;
    const type = ctx?.POPUP_TYPE?.CONFIRM;
    if (typeof popup === 'function' && type) return !!(await popup(message, type, '', { okButton: '删除', cancelButton: '取消' }));
  } catch (e) { /* fall back */ }
  return window.confirm(message);
}

function findMessageRole(delBtn) {
  const msg = delBtn.closest('.so-msg');
  if (!msg) return '';
  if (msg.classList.contains('so-user')) return 'user';
  if (msg.classList.contains('so-assistant')) return 'assistant';
  return '';
}

function installDeleteConfirmations() {
  if (deleteConfirmInstalled) return;
  deleteConfirmInstalled = true;
  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const presetDel = target.closest('#so-conn-preset-del');
    const messageDel = target.closest('.so-del-btn');
    const btn = presetDel || messageDel;
    if (!btn || btn.dataset.soDeleteConfirmed === 'true') {
      if (btn) delete btn.dataset.soDeleteConfirmed;
      return;
    }

    let message = '';
    if (presetDel) {
      const name = document.querySelector('#so-conn-preset-select')?.value || '';
      if (!name) return;
      message = '删除连接预设「' + name + '」？此操作无法撤销。';
    } else if (messageDel) {
      const role = findMessageRole(messageDel);
      message = role === 'user'
        ? '确定删除这条用户消息吗？如果下一条是神谕回复，本体会一并删除。此操作无法撤销。'
        : '确定删除这条消息吗？此操作无法撤销。';
    }
    if (!message) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (!(await confirmDanger(message))) return;
    btn.dataset.soDeleteConfirmed = 'true';
    btn.click();
  }, true);
}

export function registerOutlinePlugin(api) {
  setStoryOracleApi(api);
  if (!api || typeof api.isCompatible !== 'function' || !api.isCompatible(REQUIRED_API_VERSION)) {
    console.warn(LOG_PREFIX + '需要 Story Oracle Hook API v' + REQUIRED_API_VERSION + '，当前为 v' + (api && api.version) + '，跳过挂载。');
    return;
  }

  const registered = api.registerMode({
    id: 'outline',
    icon: 'fa-solid fa-list-check',
    title: '大纲',
    accent: '#4ade80',
    placeholder: '你需要什么样的大纲? 别忘了选择大纲模板捏~',
    order: 'before:advisor',
    buildBar: buildOutlineBar,
    onSend: buildOutlineSend,
    render: 'markdown',
    stripReasoning: false,
  });

  if (!registered) {
    console.warn(LOG_PREFIX + 'registerMode(outline) 失败，跳过消息动作注册。');
    return;
  }

  registerMessageActions(api);
  installFinalModeCompat(api);
  installDeleteConfirmations();
  console.log(LOG_PREFIX + '已通过 StoryOracleAPI v' + api.version + ' 挂载大纲模式。');
}
