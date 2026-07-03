/**
 * 大纲模式 - 基础UI模块
 */
(function () {
  "use strict";

  const OUTLINE_MODE_ID = "outline";

  function createOutlineModeUI() {
    const win = document.getElementById("so-window");
    if (!win) return false;

    const headerBtns = win.querySelector("#so-header-btns");
    if (!headerBtns) return false;

    // 在参谋按钮之前插入大纲模式按钮
    const advisorBtn = headerBtns.querySelector("#so-advisor-btn");
    if (!advisorBtn) return false;

    // 创建大纲模式按钮
    const outlineBtn = document.createElement("div");
    outlineBtn.className = "so-iconbtn";
    outlineBtn.id = "so-outline-btn";
    outlineBtn.title = "大纲模式 —— 管理和注入剧情大纲";
    outlineBtn.innerHTML = '<i class="fa-solid fa-list-check"></i>';

    // 插入到参谋按钮之前
    advisorBtn.parentNode.insertBefore(outlineBtn, advisorBtn);

    // 创建大纲模式面板
    createOutlinePanel();

    // 绑定点击事件
    outlineBtn.addEventListener("click", toggleOutlineMode);

    // 绑定标签补充按钮事件
    bindTagFixButton();

    console.log("[Story Oracle Patch] 大纲模式按钮已创建");
    return true;
  }

  function bindTagFixButton() {
    setTimeout(() => {
      const fixBtn = document.getElementById("so-outline-fix-tags");
      if (fixBtn && !fixBtn.dataset.bound) {
        fixBtn.addEventListener("click", handleTagFix);
        fixBtn.dataset.bound = "true";
      }
    }, 100);
  }

  function handleTagFix() {
    // 获取最新的AI消息
    const win = document.getElementById("so-window");
    if (!win) return;

    const messages = Array.from(win.querySelectorAll(".so-msg.so-assistant"));
    if (messages.length === 0) {
      showToast("没有找到AI消息", "warning");
      return;
    }

    const latestMsg = messages[messages.length - 1];
    const contentEl = latestMsg.querySelector(".so-content");
    if (!contentEl) return;

    // **优先读取原始内容（Markdown 渲染前保存的）**
    const originalText =
      contentEl.dataset.originalContent || contentEl.textContent;
    if (!originalText.trim()) {
      showToast("消息内容为空", "warning");
      return;
    }

    // 调用标签补充函数
    if (typeof window.StoryOraclePatch?.supplementTags === "function") {
      const fixedText = window.StoryOraclePatch.supplementTags(originalText);
      if (fixedText && fixedText !== originalText) {
        // 更新原始内容
        contentEl.dataset.originalContent = fixedText;

        // 重置 markdown 处理标记
        delete contentEl.dataset.soMdDone;
        contentEl.classList.remove("so-rendered");

        // 更新显示内容（设置纯文本，然后触发 markdown 渲染）
        contentEl.textContent = fixedText;

        // 通过统一的 processMessage 触发重新渲染（含 showdown + DOMPurify）
        if (typeof window.StoryOraclePatch?.processMessage === "function") {
          window.StoryOraclePatch.processMessage(contentEl);
        }
      }
    } else {
      showToast("标签补充功能不可用", "error");
    }
  }

  // Toast 容器管理（限制最多显示数量）
  const toastManager = {
    maxToasts: 3,
    activeToasts: [],

    addToast(message, type = "success") {
      // 如果使用 toastr，直接调用
      if (window.toastr) {
        window.toastr[type](message);
        return;
      }

      // 如果已达到最大数量，移除最旧的
      if (this.activeToasts.length >= this.maxToasts) {
        const oldestToast = this.activeToasts.shift();
        if (oldestToast && oldestToast.parentNode) {
          oldestToast.remove();
        }
      }

      const colors = {
        success: "rgba(74, 222, 128, 0.9)",
        warning: "rgba(251, 191, 36, 0.9)",
        error: "rgba(239, 68, 68, 0.9)",
      };

      const toast = document.createElement("div");
      toast.textContent = message;
      toast.style.cssText = `
            position: fixed;
            bottom: ${20 + this.activeToasts.length * 60}px;
            right: 20px;
            padding: 12px 20px;
            background: ${colors[type]};
            color: ${type === "warning" ? "#000" : "#fff"};
            border-radius: 8px;
            z-index: 10001;
            font-size: 14px;
            max-width: 300px;
            white-space: pre-line;
            transition: all 0.3s ease;
        `;

      document.body.appendChild(toast);
      this.activeToasts.push(toast);

      // 自动移除
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
          toast.remove();
          const index = this.activeToasts.indexOf(toast);
          if (index > -1) {
            this.activeToasts.splice(index, 1);
          }
          // 重新调整剩余 toast 的位置
          this.repositionToasts();
        }, 300);
      }, 3000);
    },

    repositionToasts() {
      // 过滤掉已经从 DOM 中移除的 toast
      this.activeToasts = this.activeToasts.filter((toast) => {
        return toast && toast.parentNode;
      });

      // 重新定位剩余的 toast
      this.activeToasts.forEach((toast, index) => {
        if (toast && toast.style) {
          toast.style.bottom = `${20 + index * 60}px`;
        }
      });
    },
  };

  function showToast(message, type = "success") {
    toastManager.addToast(message, type);
  }

  function createOutlinePanel() {
    const win = document.getElementById("so-window");
    const chatArea = win.querySelector("#so-messages");
    if (!chatArea) return;

    // 创建大纲模式面板容器（与其他模式栏同级）
    const outlineBar = document.createElement("div");
    outlineBar.id = "so-outline-bar";
    outlineBar.innerHTML = `
            <details class="so-mode-collapse" id="so-outline-settings-collapse" open>
                <summary class="so-mode-collapse-sum">
                    <i class="fa-solid fa-sliders"></i>
                    <span>大纲设置</span>
                </summary>
                <div class="so-mode-collapse-body">
                    <div class="so-outline-template-selector">
                        <label class="so-field">
                            <span>大纲模板预设</span>
                            <select id="so-outline-template-select">
                                <option value="default">默认模板</option>
                            </select>
                        </label>
                        <button type="button" class="so-btn-secondary" id="so-outline-template-manage">
                            <i class="fa-solid fa-pen-to-square"></i> 管理模板
                        </button>
                        <div style="display: flex; gap: 8px;">
                            <label class="so-checkbox-field" style="flex: 1;">
                                <input type="checkbox" id="so-outline-use-preset">
                                <span>套用我的补全预设（大纲提示词叠加其上）</span>
                            </label>
                            <button type="button" class="so-btn-secondary" id="so-outline-fix-tags" title="为AI回复补充或修正标签">
                                <i class="fa-solid fa-tags"></i> 标签补充(仅限最新一楼)
                            </button>
                        </div>
                    </div>
                </div>
            </details>
        `;

    // 找到 so-adv-bar 的位置，插入在其后
    const advBar = win.querySelector("#so-adv-bar");
    if (advBar) {
      advBar.parentNode.insertBefore(outlineBar, advBar.nextSibling);
    }

    // 添加绿色主题样式
    addOutlineStyles();
  }

  function addOutlineStyles() {
    const style = document.createElement("style");
    style.id = "so-outline-theme";
    style.textContent = `
            /* 大纲模式强调色 */
            :root {
                --so-outline-accent: #4ade80;
            }

            /* 大纲模式栏（默认隐藏） */
            #so-outline-bar {
                display: none;
                flex-direction: column;
                gap: 10px;
                padding: 12px;
                background: rgba(0, 0, 0, 0.18);
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            }

            /* 大纲模式激活时显示栏 */
            #so-window.so-outline-on #so-outline-bar {
                display: flex;
            }

            /* 设置面板打开时隐藏模式栏 */
            #so-window.so-settings-open #so-outline-bar {
                display: none;
            }

            /* 大纲模式按钮激活状态 */
            #so-outline-btn.so-outline-active {
                color: var(--so-outline-accent);
                background-color: color-mix(in srgb, var(--so-outline-accent) 16%, transparent);
                opacity: 1;
            }

            /* 大纲模式激活时的标题栏渐变背景 */
            #so-window.so-outline-on #so-header {
                background: linear-gradient(180deg,
                    color-mix(in srgb, var(--so-outline-accent) 22%, transparent),
                    transparent);
            }

            /* 大纲模式激活时的全局强调色 */
            #so-window.so-outline-on {
                --so-accent: var(--so-outline-accent);
            }

            /* 大纲模式下隐藏空状态提示 */
            #so-window.so-outline-on .so-empty {
                display: none !important;
            }

            /* 模板选择器样式 */
            .so-outline-template-selector {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .so-outline-template-selector .so-field {
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 0.85em;
            }

            .so-outline-template-selector .so-field > span {
                opacity: 0.7;
            }

            .so-outline-template-selector select {
                width: 100%;
                box-sizing: border-box;
                color: var(--SmartThemeBodyColor, #e6e6e6);
                background-color: var(--black30a, rgba(0, 0, 0, 0.32));
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
                border-radius: 8px;
                padding: 6px 9px;
                font-family: inherit;
                transition: border-color 0.15s, box-shadow 0.15s;
            }

            .so-outline-template-selector select:focus {
                outline: none;
                border-color: var(--so-accent);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--so-accent) 25%, transparent);
            }

            .so-btn-secondary {
                padding: 8px 12px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
                border-radius: 8px;
                color: var(--SmartThemeBodyColor, #e6e6e6);
                cursor: pointer;
                transition: all 0.2s;
                font-family: inherit;
                font-size: 0.85em;
            }

            .so-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.15);
                border-color: var(--so-accent);
            }

            .so-btn-secondary i {
                margin-right: 6px;
            }

            /* 复选框样式 */
            .so-checkbox-field {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.85em;
                cursor: pointer;
                padding: 8px 0;
            }

            .so-checkbox-field input[type="checkbox"] {
                width: 16px;
                height: 16px;
                cursor: pointer;
                accent-color: var(--so-outline-accent, #4ade80);
            }

            .so-checkbox-field span {
                opacity: 0.9;
            }

            .so-checkbox-field:hover span {
                opacity: 1;
            }

            /* 标签补充按钮样式（紧凑型，与复选框高度一致） */
            #so-outline-fix-tags {
                padding: 6px 10px;
                font-size: 0.85em;
                white-space: nowrap;
                height: fit-content;
                align-self: center;
            }

            #so-outline-fix-tags i {
                margin-right: 4px;
            }

            /* 模板管理器对话框样式 */
            .so-template-manager-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }

            .so-template-manager {
                width: 90%;
                max-width: 800px;
                height: 80vh;
                background: var(--SmartThemeBlurTintColor, #1a1a1a);
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
                border-radius: 12px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .so-template-manager-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
            }

            .so-template-manager-header h3 {
                margin: 0;
                font-size: 1.2em;
            }

            .so-template-manager-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }

            .so-template-list {
                width: 250px;
                border-right: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
                display: flex;
                flex-direction: column;
            }

            .so-template-list-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px;
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
                font-size: 0.9em;
            }

            #so-template-items {
                flex: 1;
                overflow-y: auto;
            }

            .so-template-item {
                padding: 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.05));
                transition: background 0.2s;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .so-template-item:hover {
                background: rgba(255, 255, 255, 0.05);
            }

            .so-template-item.active {
                background: rgba(74, 222, 128, 0.15);
                border-left: 3px solid var(--so-outline-accent, #4ade80);
            }

            .so-template-badge {
                font-size: 0.75em;
                padding: 2px 6px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                opacity: 0.7;
            }

            .so-template-editor {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 16px;
                gap: 12px;
            }

            .so-template-editor-header input {
                width: 100%;
                padding: 10px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
                border-radius: 8px;
                color: var(--SmartThemeBodyColor, #e6e6e6);
                font-size: 1em;
                font-family: inherit;
            }

            #so-template-content {
                flex: 1;
                padding: 12px;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
                border-radius: 8px;
                color: var(--SmartThemeBodyColor, #e6e6e6);
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 0.9em;
                line-height: 1.5;
                resize: none;
            }

            .so-template-editor-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }

            .so-btn-danger {
                background: rgba(220, 38, 38, 0.2);
                border-color: rgba(220, 38, 38, 0.4);
            }

            .so-btn-danger:hover {
                background: rgba(220, 38, 38, 0.3);
            }

            .so-btn-danger:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            /* 隐藏状态的消息样式 */
            .so-msg.so-msg-hidden {
                opacity: 0.5;
                position: relative;
            }

            .so-msg.so-msg-hidden::after {
                content: '已隐藏';
                position: absolute;
                top: 8px;
                left: 8px;
                padding: 2px 8px;
                background: rgba(239, 68, 68, 0.3);
                border: 1px solid rgba(239, 68, 68, 0.5);
                border-radius: 4px;
                font-size: 0.75em;
                color: #ef4444;
                pointer-events: none;
            }
        `;
    document.head.appendChild(style);
  }

  function toggleOutlineMode() {
    const win = document.getElementById("so-window");
    if (!win) return;

    const outlineBtn = win.querySelector("#so-outline-btn");
    const isActive = win.classList.contains("so-outline-on");
    const inputBox = win.querySelector("#so-input");

    if (isActive) {
      // 关闭大纲模式
      win.classList.remove("so-outline-on");
      outlineBtn?.classList.remove("so-outline-active");
      if (inputBox)
        inputBox.placeholder =
          "就当前剧情问点什么吧...（Enter发送，Shift+Enter换行）";
    } else {
      // 激活大纲模式，关闭其他模式
      win.classList.remove("so-diag-on", "so-lb-on", "so-adv-on", "so-fix-on");
      win.classList.add("so-outline-on");

      // 取消其他按钮的激活状态
      win.querySelector("#so-diagnose-btn")?.classList.remove("so-diag-active");
      win.querySelector("#so-lorebook-btn")?.classList.remove("so-lb-active");
      win.querySelector("#so-advisor-btn")?.classList.remove("so-adv-active");
      win.querySelector("#so-fix-btn")?.classList.remove("so-fix-active");

      // 激活大纲按钮
      outlineBtn?.classList.add("so-outline-active");
      if (inputBox)
        inputBox.placeholder =
          "你需要什么样的大纲? 别忘了选择大纲模板捏~ （Enter发送，Shift+Enter换行）";
    }
  }

  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.createOutlineModeUI = createOutlineModeUI;
})();
