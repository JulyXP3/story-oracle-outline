/**
 * Story Oracle Patch
 * 非侵入式补丁系统
 */
(function () {
  "use strict";

  const NAMESPACE = "StoryOraclePatch";
  const VERSION = "1.0.0";

  // 获取当前脚本路径
  function getScriptPath() {
    if (document.currentScript?.src) {
      return document.currentScript.src;
    }

    try {
      throw new Error();
    } catch (e) {
      const stackLine = e.stack.split("\n")[1];
      const match = stackLine.match(/https?:\/\/[^)]+/);
      if (match) return match[0];
    }

    const scripts = Array.from(document.getElementsByTagName("script"));
    for (let i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src.includes("patch.js")) {
        return scripts[i].src;
      }
    }

    return "";
  }

  const currentScript = getScriptPath();
  const baseUrl = currentScript.substring(
    0,
    currentScript.lastIndexOf("/") + 1,
  );

  // 防止重复加载
  if (window[NAMESPACE]?.loaded) {
    console.warn("[Story Oracle Patch] Already loaded, skipping.");
    return;
  }

  window[NAMESPACE] = {
    loaded: true,
    version: VERSION,
    baseUrl,
  };

  console.log("[Story Oracle Patch] 补丁系统加载中...");

  // 补丁模块列表
  const PATCH_MODULES = [
    "patches/advisor-collapse.js",
    "patches/tools-expand.js",
    "patches/settings-panel.js",
    "patches/dev-options.js",
    "patches/tools-expand-toggle.js",
    "patches/connection-presets.js",
    "patches/outline-mode.js",
    "patches/outline-templates.js",
    "patches/outline-inject.js",
    "patches/outline-request.js",
    "patches/message-actions.js",
    "patches/actions-bottom.js",
    "patches/markdown-render.js",
  ];

  // 加载脚本
  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = baseUrl + path;
      script.async = false;
      script.onload = () => resolve(path);
      script.onerror = () => reject(new Error(`Failed to load: ${path}`));
      document.head.appendChild(script);
    });
  }

  // 加载主模块
  async function loadMainModule() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = baseUrl + "index.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // 应用所有补丁
  function applyPatches() {
    setTimeout(() => {
      const patch = window[NAMESPACE];

      if (patch.applyAdvBarPatch) {
        patch.applyAdvBarPatch();
      }

      if (patch.improveSettingsPanel) {
        patch.improveSettingsPanel();
      }

      if (patch.addDevOptions) {
        patch.addDevOptions();
      }

      if (patch.addToolsExpandToggle) {
        patch.addToolsExpandToggle();
      }

      // 根据设置决定是否展开工具按钮
      if (
        patch.isToolsExpandEnabled &&
        patch.isToolsExpandEnabled() &&
        patch.moveToolsToHeader
      ) {
        patch.moveToolsToHeader();
      }

      if (patch.createOutlineModeUI) {
        patch.createOutlineModeUI();
      }

      if (patch.initTemplateManager) {
        patch.initTemplateManager();
      }

      if (patch.addMessageActions) {
        patch.addMessageActions();

        // 监听消息变化，自动为新消息添加操作按钮（带防抖）
        const messagesEl = document.querySelector("#so-messages");
        if (messagesEl) {
          let debounceTimer = null;
          const observer = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              patch.addMessageActions();
            }, 500); // 150ms 防抖延迟
          });
          observer.observe(messagesEl, { childList: true, subtree: true });
        }
      }

      if (patch.addConnectionPresets) {
        patch.addConnectionPresets();
      }

      // 初始化完成后触发一次模式切换，确保状态正确
      initModeState();
    }, 100);
  }

  // 触发一次模式切换以初始化状态
  function initModeState() {
    setTimeout(() => {
      const win = document.getElementById("so-window");
      const lbBtn = win?.querySelector("#so-lorebook-btn");
      if (lbBtn) {
        lbBtn.click();
        setTimeout(() => lbBtn.click(), 50);
      }
    }, 200);
  }

  // 应用所有补丁（续）
  function applyPatchesContinued() {
    setTimeout(() => {
      const patch = window[NAMESPACE];

      // 监听窗口创建（备用）
      const observer = new MutationObserver(() => {
        if (document.getElementById("so-adv-bar")) {
          patch.applyAdvBarPatch?.();
          observer.disconnect();
        }
      });

      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }, 100);
  }

  // 启动
  async function bootstrap() {
    try {
      // 1. 加载所有补丁模块
      for (const modulePath of PATCH_MODULES) {
        await loadScript(modulePath);
      }
      console.log("[Story Oracle Patch] 补丁模块加载完成");

      // 2. 加载主模块
      await loadMainModule();
      console.log("[Story Oracle Patch] 主模块加载成功");

      // 3. 应用补丁
      applyPatches();
    } catch (error) {
      console.error("[Story Oracle Patch] 启动失败:", error);
    }
  }

  bootstrap();
})();
