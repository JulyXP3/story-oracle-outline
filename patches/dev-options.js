/**
 * 开发者选项 - 最终提示词日志
 */
(function () {
  "use strict";

  function addDevOptions() {
    const win = document.getElementById("so-window");
    if (!win) {
      console.warn("[Story Oracle Patch] 未找到 so-window");
      return false;
    }

    const settingsPanel = win.querySelector("#so-settings");
    if (!settingsPanel) {
      console.warn("[Story Oracle Patch] 未找到 so-settings");
      return false;
    }

    // 检查是否已添加
    if (document.getElementById("so-dev-show-prompt")) {
      return true;
    }

    // 查找"界面"折叠区域
    const collapses = settingsPanel.querySelectorAll(
      ".so-settings-collapse, details",
    );

    let uiCollapse = null;
    for (const collapse of collapses) {
      const summary = collapse.querySelector("summary");
      if (summary?.textContent.includes("界面")) {
        uiCollapse = collapse;
        break;
      }
    }

    if (!uiCollapse) {
      console.warn('[Story Oracle Patch] 未找到"界面"设置区域');
      return false;
    }

    // 查找内容区域
    const collapseBody = uiCollapse.querySelector(".so-set-body");
    if (!collapseBody) {
      console.warn("[Story Oracle Patch] 未找到 .so-set-body 容器");
      return false;
    }

    // 创建开发者选项复选框
    const devOption = document.createElement("label");
    devOption.className = "so-check";
    devOption.innerHTML = `<input type="checkbox" id="so-dev-show-prompt"><span>控制台显示请求拦截提示词（开发者专用）</span>`;

    collapseBody.appendChild(devOption);

    // 读取保存的设置
    const savedValue = localStorage.getItem("so_dev_show_prompt");
    const checkbox = document.getElementById("so-dev-show-prompt");
    if (savedValue === "true") {
      checkbox.checked = true;
    }

    // 保存设置
    checkbox.addEventListener("change", () => {
      localStorage.setItem("so_dev_show_prompt", checkbox.checked);
    });

    return true;
  }

  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.addDevOptions = addDevOptions;

  // 导出检查函数
  window.StoryOraclePatch.isShowPromptEnabled = function () {
    return localStorage.getItem("so_dev_show_prompt") === "true";
  };
})();
