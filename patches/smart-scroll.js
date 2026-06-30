/**
 * 智能滚动补丁 - 允许用户在AI流式回复时查看历史消息
 */
(function () {
  "use strict";

  // 等待消息容器元素准备好
  function waitForMessagesElement() {
    return new Promise((resolve) => {
      const check = () => {
        const messagesEl = document.querySelector("#so-messages");
        if (messagesEl) {
          resolve(messagesEl);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // 初始化智能滚动
  async function initSmartScroll() {
    const messagesEl = await waitForMessagesElement();

    // 保存原始的 scrollTop 描述符
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop"
    );

    if (!originalDescriptor) {
      console.error(
        "[Smart Scroll] 无法获取 scrollTop 描述符，智能滚动可能无法工作"
      );
      return;
    }

    // 定义新的 scrollTop setter
    Object.defineProperty(messagesEl, "scrollTop", {
      get() {
        return originalDescriptor.get.call(this);
      },
      set(value) {
        // 获取当前滚动状态
        const currentScrollTop = originalDescriptor.get.call(this);
        const scrollHeight = this.scrollHeight;
        const clientHeight = this.clientHeight;

        // 检查用户是否在底部附近（80px 阈值）
        const atBottom = scrollHeight - currentScrollTop - clientHeight < 80;

        // 检查是否是尝试滚动到底部的操作
        const isScrollToBottom = value >= scrollHeight - clientHeight - 10;

        if (isScrollToBottom && !atBottom) {
          // 用户不在底部，且代码试图滚动到底部 → 阻止
          return;
        }

        // 其他情况：允许滚动
        originalDescriptor.set.call(this, value);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSmartScroll);
  } else {
    initSmartScroll();
  }

  // 暴露到全局（可选，用于调试）
  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.smartScrollEnabled = true;
})();
