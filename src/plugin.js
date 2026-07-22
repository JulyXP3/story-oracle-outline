// 模块：插件注册入口
// 作用：校验 StoryOracleAPI 版本，迁移旧最终模式配置，注册大纲模式与回复动作。
// 这里只编排模块，不承载具体业务实现。
import { LOG_PREFIX, OUTLINE_DEFAULT_SYSTEM_PROMPT, REQUIRED_API_VERSION } from './constants.js';
import { buildOutlineSend } from './prompt.js';
import { buildOutlineBar } from './ui.js';
import { registerMessageActions } from './message-actions.js';
import { setStoryOracleApi } from './outline-inject.js';
import { migrateFinalModeState } from './migrate-final-mode.js';

export function registerOutlinePlugin(api) {
  setStoryOracleApi(api);
  if (!api || typeof api.isCompatible !== 'function' || !api.isCompatible(REQUIRED_API_VERSION)) {
    console.warn(LOG_PREFIX + '需要 Story Oracle Hook API v' + REQUIRED_API_VERSION + '，当前为 v' + (api && api.version) + '，跳过挂载。');
    return;
  }

  // 一次性迁移：把停留在旧最终模式的用户配置搬到本体 1.22.0 原生 directRawUrl 开关上。
  // 必须在 registerMode 之前跑——它只改本体 settings，与大纲模式注册无依赖，但越早还原连接配置越好。
  migrateFinalModeState(api);

  const registered = api.registerMode({
    id: 'outline',
    icon: 'fa-solid fa-list-check',
    title: '大纲',
    accent: '#4ade80',
    placeholder: '你需要什么样的大纲? 别忘了选择大纲模板捏~',
    order: 'before:advisor',
    buildBar: buildOutlineBar,
    onEnter: syncOutlineModeRoom,
    onSend: buildOutlineSend,
    render: 'markdown',
    stripReasoning: false,
  });

  if (!registered) {
    console.warn(LOG_PREFIX + 'registerMode(outline) 失败，跳过消息动作注册。');
    return;
  }

  registerMessageActions(api);
  injectOutlineSysPrompt(api);
  injectOutlineModeRoom(api);
  console.log(LOG_PREFIX + '已通过 StoryOracleAPI v' + api.version + ' 挂载大纲模式。');
}

function injectOutlineSysPrompt(api) {
  if (!api.unsafe || typeof api.unsafe.eval !== 'function') {
    console.warn(LOG_PREFIX + 'api.unsafe.eval 不可用，大纲系统提示词无法注入设置面板。');
    return;
  }
  try {
    api.unsafe.eval(
      `if (!SYSPROMPT_MODES.some(m => m.id === 'outline')) {\n` +
      `  SYSPROMPT_MODES.push({ id: 'outline', label: '大纲', key: 'outlineSystemPrompt', builtin: ${JSON.stringify(OUTLINE_DEFAULT_SYSTEM_PROMPT)} });\n` +
      `  defaults.outlineSystemPrompt = '';\n` +
      `  const sel = win.querySelector('#so-sysprompt-which');\n` +
      `  if (sel && !Array.from(sel.options).some(o => o.value === 'outline')) {\n` +
      `    const opt = document.createElement('option');\n` +
      `    opt.value = 'outline';\n` +
      `    opt.textContent = '大纲';\n` +
      `    sel.appendChild(opt);\n` +
      `  }\n` +
      `}`
    );
    console.log(LOG_PREFIX + '已注入大纲系统提示词到设置面板。');
  } catch (e) {
    console.warn(LOG_PREFIX + '注入大纲系统提示词失败:', e);
  }
}

function injectOutlineModeRoom(api) {
  if (!api.unsafe || typeof api.unsafe.eval !== 'function') {
    console.warn(LOG_PREFIX + 'api.unsafe.eval 不可用，大纲模式无法独立聊天记录。');
    return;
  }
  try {
    api.unsafe.eval(
      `if (typeof convoStreamKeyForMode === 'function' && !convoStreamKeyForMode.__soOutlinePatched) {\n` +
      `  const originalConvoStreamKeyForMode = convoStreamKeyForMode;\n` +
      `  convoStreamKeyForMode = function(mode, s) {\n` +
      `    if (mode === 'outline') return 'outline';\n` +
      `    return originalConvoStreamKeyForMode(mode, s);\n` +
      `  };\n` +
      `  convoStreamKeyForMode.__soOutlinePatched = true;\n` +
      `}`
    );
    console.log(LOG_PREFIX + '已注入大纲模式独立聊天记录补丁。');
  } catch (e) {
    console.warn(LOG_PREFIX + '注入大纲模式独立聊天记录失败:', e);
  }
}

function syncOutlineModeRoom(api) {
  if (!api.unsafe || typeof api.unsafe.eval !== 'function') return;
  try {
    api.unsafe.eval('syncConvoStream()');
  } catch (e) {
    console.warn(LOG_PREFIX + '切换到大纲独立聊天记录失败:', e);
  }
}
