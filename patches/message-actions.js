/**
 * 消息操作模块 - 扩展原有消息按钮
 */
(function () {
  "use strict";

  // 为消息添加额外的操作按钮（注入大纲、编辑）
  function addMessageActions() {
    const win = document.getElementById("so-window");
    if (!win) return;

    const messages = win.querySelectorAll(".so-msg");
    messages.forEach((msg) => {
      const actionsBar = msg.querySelector(".so-actions");
      if (!actionsBar) return;

      // 检查是否已添加（通过检查注入按钮）
      if (actionsBar.querySelector(".so-inject-btn")) return;

      // 如果是AI消息，添加编辑按钮（在重新生成按钮后）
      if (msg.classList.contains("so-assistant")) {
        const editBtn = document.createElement("button");
        editBtn.className = "so-msg-btn so-edit-btn";
        editBtn.type = "button";
        editBtn.title = "编辑";
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';

        // 找到重新生成按钮，插入在其后
        const regenBtn = actionsBar.querySelector(".so-regen-btn");
        if (regenBtn) {
          regenBtn.parentNode.insertBefore(editBtn, regenBtn.nextSibling);
        } else {
          actionsBar.appendChild(editBtn);
        }

        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          editAssistantMessage(msg);
        });

        // 添加"注入大纲"按钮
        const injectBtn = document.createElement("button");
        injectBtn.className = "so-msg-btn so-inject-btn";
        injectBtn.type = "button";
        injectBtn.title = "注入剧情大纲";
        injectBtn.innerHTML = '<i class="fa-solid fa-file-import"></i>';

        actionsBar.insertBefore(injectBtn, actionsBar.firstChild);

        injectBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          injectOutlineFromMessage(msg);
        });
      }
    });
  }

  // 从消息中提取并注入剧情大纲
  function injectOutlineFromMessage(msg) {
    const contentEl = msg.querySelector(".so-content");
    if (!contentEl) return;

    // **优先读取原始内容（Markdown 渲染前保存的）**
    const content = contentEl.dataset.originalContent || contentEl.textContent || "";

    if (!content.trim()) {
      showToast("消息内容为空");
      return;
    }

    // 注入到世界书（使用Story Oracle的剧情注入逻辑）
    if (
      typeof window.StoryOraclePatch?.injectOutlineToWorldInfo === "function"
    ) {
      window.StoryOraclePatch.injectOutlineToWorldInfo(content, msg);
    } else {
      // 简单实现：复制到剪贴板
      navigator.clipboard.writeText(content).then(() => {
        showToast("大纲已复制到剪贴板");
      });
    }
  }

  // 编辑AI消息
  function editAssistantMessage(msg) {
    const contentEl = msg.querySelector(".so-content");
    if (!contentEl) return;

    // **优先读取原始内容（Markdown 渲染前保存的）**
    const currentText = contentEl.dataset.originalContent || contentEl.textContent;

    // 计算主面板高度的80%
    const messagesPanel = document.querySelector("#so-messages");
    const panelHeight = messagesPanel ? messagesPanel.clientHeight : 600;
    const editHeight = Math.max(300, Math.floor(panelHeight * 0.8));

    // 创建编辑区域
    const textarea = document.createElement("textarea");
    textarea.className = "so-msg-edit-area";
    textarea.value = currentText;
    textarea.style.cssText = `
            width: 100%;
            height: ${editHeight}px;
            min-height: 300px;
            max-height: 90vh;
            padding: 12px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
            border-radius: 8px;
            color: var(--SmartThemeBodyColor, #e6e6e6);
            font-family: inherit;
            font-size: inherit;
            line-height: 1.5;
            resize: vertical;
            box-sizing: border-box;
        `;

    // 替换内容区域
    contentEl.style.display = "none";
    contentEl.parentNode.insertBefore(textarea, contentEl);

    // 创建操作按钮
    const btnBar = document.createElement("div");
    btnBar.className = "so-msg-edit-btns";
    btnBar.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
        `;

    const saveBtn = document.createElement("button");
    saveBtn.className = "so-btn-secondary";
    saveBtn.textContent = "保存";
    saveBtn.style.padding = "6px 12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "so-btn-secondary";
    cancelBtn.textContent = "取消";
    cancelBtn.style.padding = "6px 12px";

    btnBar.appendChild(saveBtn);
    btnBar.appendChild(cancelBtn);
    textarea.parentNode.insertBefore(btnBar, textarea.nextSibling);

    // 聚焦并选中文本
    textarea.focus();

    // 保存按钮
    saveBtn.addEventListener("click", () => {
      const newText = textarea.value;

      // 持久化到 convo：找到对应条目（按 DOM 上的 data-cid 匹配 entry.id），
      // 更新 entry.content 并 persistConvo()。否则只改了 DOM，F5 刷新会从元数据还原旧内容。
      const pwin = window.parent || window;
      const cid = msg?.dataset?.cid;
      if (cid != null && typeof pwin.convoForPrompt === "function") {
        try {
          const entry = pwin
            .convoForPrompt()
            .find((e) => e && String(e.id) === String(cid));
          if (entry) {
            entry.content = newText;
            if (typeof pwin.persistConvo === "function") pwin.persistConvo();
          } else {
            console.warn(
              "[Story Oracle Patch] 未找到 data-cid 对应的 convo 条目，本次编辑不会持久化",
            );
          }
        } catch (e) {
          console.error("[Story Oracle Patch] 持久化编辑失败:", e);
        }
      }

      // 更新原始内容
      contentEl.dataset.originalContent = newText;

      // 重置 markdown 处理标记，以便重新渲染
      delete contentEl.dataset.soMdDone;
      contentEl.classList.remove("so-rendered");

      // 更新显示内容（设置纯文本，然后触发 markdown 渲染）
      contentEl.textContent = newText;

      // 通过统一的 processMessage 触发重新渲染（含 showdown + DOMPurify）
      if (typeof window.StoryOraclePatch?.processMessage === "function") {
        window.StoryOraclePatch.processMessage(contentEl);
      }

      contentEl.style.display = "";
      textarea.remove();
      btnBar.remove();
      showToast("已保存修改");
    });

    // 取消按钮
    cancelBtn.addEventListener("click", () => {
      contentEl.style.display = "";
      textarea.remove();
      btnBar.remove();
    });
  }

  // 显示提示
  function showToast(message) {
    if (window.toastr) {
      window.toastr.success(message);
      return;
    }

    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: rgba(74, 222, 128, 0.9);
            color: #000;
            border-radius: 8px;
            z-index: 10001;
            font-size: 14px;
        `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = "opacity 0.3s";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.addMessageActions = function () {
    addMessageActions();
  };
})();
