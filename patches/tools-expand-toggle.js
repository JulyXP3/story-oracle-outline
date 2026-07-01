/**
 * 工具按钮展开开关
 */
(function () {
  "use strict";

  function addToolsExpandToggle() {
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
    if (document.getElementById("so-tools-expand-toggle")) {
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

    // 创建工具展开选项复选框
    const toggleOption = document.createElement("label");
    toggleOption.className = "so-check";
    toggleOption.innerHTML = `<input type="checkbox" id="so-tools-expand-toggle"><span>模式按钮全展开至上方标题栏</span>`;

    collapseBody.appendChild(toggleOption);

    // 读取保存的设置
    const savedValue = localStorage.getItem("so_tools_expand_enabled");
    const checkbox = document.getElementById("so-tools-expand-toggle");
    if (savedValue === "true") {
      checkbox.checked = true;
    }

    // 保存设置并应用变化
    checkbox.addEventListener("change", () => {
      localStorage.setItem("so_tools_expand_enabled", checkbox.checked);

      // 如果开启，执行工具移动；如果关闭，刷新页面恢复
      if (checkbox.checked) {
        if (window.StoryOraclePatch?.moveToolsToHeader) {
          window.StoryOraclePatch.moveToolsToHeader();
        }
      } else {
        // 提示用户需要刷新
        alert("已关闭工具按钮展开，请刷新页面使更改生效");
      }
    });

    return true;
  }

  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.addToolsExpandToggle = addToolsExpandToggle;

  // 导出检查函数
  window.StoryOraclePatch.isToolsExpandEnabled = function () {
    return localStorage.getItem("so_tools_expand_enabled") === "true";
  };
})();
