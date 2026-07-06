// ============================================================================
// 故事神谕·大纲版 —— StoryOracleAPI v1 插件入口
// ----------------------------------------------------------------------------
// 根入口只负责握手和加载模块；业务逻辑在 src/ 下。
// ============================================================================
(function () {
  'use strict';

  function onStoryOracleReady(cb) {
    if (window.StoryOracleAPI) {
      cb(window.StoryOracleAPI);
      return;
    }
    document.addEventListener('story-oracle-ready', () => cb(window.StoryOracleAPI), { once: true });
  }

  async function boot(api) {
    try {
      const { registerOutlinePlugin } = await import('./src/plugin.js');
      registerOutlinePlugin(api);
    } catch (e) {
      console.error('[故事神谕·大纲版] 模块加载失败:', e);
    }
  }

  onStoryOracleReady(boot);
})();
