// 模块：插件注册入口
// 作用：校验 StoryOracleAPI 版本，迁移旧最终模式配置，注册大纲模式与回复动作。
// 这里只编排模块，不承载具体业务实现。
import { LOG_PREFIX, REQUIRED_API_VERSION } from './constants.js';
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
    onSend: buildOutlineSend,
    render: 'markdown',
    stripReasoning: false,
  });

  if (!registered) {
    console.warn(LOG_PREFIX + 'registerMode(outline) 失败，跳过消息动作注册。');
    return;
  }

  registerMessageActions(api);
  console.log(LOG_PREFIX + '已通过 StoryOracleAPI v' + api.version + ' 挂载大纲模式。');
}
