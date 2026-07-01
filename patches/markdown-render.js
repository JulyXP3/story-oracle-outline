/**
 * Markdown 渲染补丁 —— 用 showdown+DOMPurify（ST 内置）填补 index.js 未覆盖的场景：
 *   - F5 刷新后历史消息无渲染
 *   - 大纲模式下 index.js 的 isPlainChat 可能不覆盖
 *
 * 与 index.js 协作：index.js 在 generateReply 中已渲染的消息带 so-rendered class，
 * 本补丁识别后直接跳过，不做二次渲染。
 *
 * 关键保护：拦截 .so-content 的 innerHTML setter，在 index.js 用 DOMPurify 剥离
 * <plot_outline> 等自定义标签之前，把原始 Markdown 文本保存到 data-original-content，
 * 确保编辑/标签补充/注入大纲功能能取到带标签的原文。
 */
(function () {
  "use strict";

  var soMdConverter = null;

  // 懒初始化 showdown converter（配置与 index.js renderMarkdownOnly 完全一致）
  function getConverter() {
    if (!soMdConverter && typeof window !== "undefined" && window.showdown) {
      soMdConverter = new window.showdown.Converter({
        simpleLineBreaks: true,
        strikethrough: true,
        tables: false,
        literalMidWordUnderscores: true,
      });
    }
    return soMdConverter;
  }

  // === 渲染 Markdown → 安全 HTML（showdown + DOMPurify） ===
  function renderMarkdown(text) {
    try {
      var converter = getConverter();
      if (converter && typeof window !== "undefined" && window.DOMPurify) {
        var html = window.DOMPurify.sanitize(
          converter.makeHtml(String(text || "")),
        );
        if (typeof html === "string" && html) return html;
      }
    } catch (e) {
      console.warn(
        "[Story Oracle Patch] markdown render failed; showing raw text.",
        e,
      );
    }
    return null;
  }

  // === 保护元素：拦截 innerHTML setter（存原文）+ 重写 textContent getter（返原文） ===
  // 两个关键问题的统一解决方案：
  //   1. DOMPurify 渲染时剥离 <plot_outline> 等自定义标签 → 原文丢失
  //   2. index.js 的 copy/edit/inject 都读 textContent → 读到的是被剥离后的文本
  // 解决：
  //   - innerHTML setter：在渲染前保存 textContent 到 data-original-content
  //   - textContent getter：有 data-original-content 就返回它（含完整标签）
  //   这样所有读 textContent 的代码（复制/编辑/注入）自动拿到原文。
  function protectContentElement(contentEl) {
    if (!contentEl || contentEl.dataset.soProtected === "true") return;
    contentEl.dataset.soProtected = "true";

    var baseHTML = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "innerHTML",
    );
    var baseText = Object.getOwnPropertyDescriptor(
      Node.prototype,
      "textContent",
    );
    if (!baseHTML || !baseText) return;

    // 重写 innerHTML setter：渲染前把原文存入 data-original-content
    Object.defineProperty(contentEl, "innerHTML", {
      get: function () {
        return baseHTML.get.call(this);
      },
      set: function (value) {
        // 渲染前用原生 getter 获取完整原文（含 <plot_outline> 等标签）
        var rawText = baseText.get.call(this);
        if (
          rawText &&
          rawText.trim() &&
          !this.dataset.originalContent
        ) {
          this.dataset.originalContent = rawText;
        }
        // 放行渲染
        baseHTML.set.call(this, value);
      },
      configurable: true,
      enumerable: true,
    });

    // 重写 textContent getter：有原文时返回原文（含完整标签）
    Object.defineProperty(contentEl, "textContent", {
      get: function () {
        if (this.dataset.originalContent) {
          return this.dataset.originalContent;
        }
        return baseText.get.call(this);
      },
      set: function (value) {
        baseText.set.call(this, value);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // === 处理单条消息元素 ===
  function processMessage(contentEl) {
    if (!contentEl) return false;

    // 三层防重复：
    // 1. index.js 已渲染（generateReply 设置 so-rendered）
    // 2. 本补丁已处理（data-so-md-done）
    if (contentEl.classList.contains("so-rendered")) {
      contentEl.dataset.soMdDone = "true";
      return false;
    }
    if (contentEl.dataset.soMdDone === "true") return false;

    var text = contentEl.textContent;
    if (!text || !text.trim()) return false;

    // 保存原始文本（供编辑/标签补充/注入大纲读取）
    if (!contentEl.dataset.originalContent) {
      contentEl.dataset.originalContent = text;
    }

    var html = renderMarkdown(text);
    if (html) {
      contentEl.innerHTML = html;
      contentEl.classList.add("so-rendered", "markdown-content");
      contentEl.style.whiteSpace = "normal";
      contentEl.dataset.soMdDone = "true";
      return true;
    }
    return false;
  }

  // === 扫描并渲染所有未处理消息（F5 修复） ===
  function renderAllMessages() {
    var messagesEl = document.querySelector("#so-messages");
    if (!messagesEl) return;

    var contents = messagesEl.querySelectorAll(
      ".so-assistant .so-content",
    );
    var count = 0;
    for (var i = 0; i < contents.length; i++) {
      // F5 后新插入的元素也要保护
      protectContentElement(contents[i]);
      if (processMessage(contents[i])) count++;
    }
    if (count > 0) {
      console.log(
        "[Story Oracle Patch] F5 恢复：已渲染 " + count + " 条历史消息",
      );
    }
  }

  // === 监听消息容器 ===
  function observeMessages() {
    var messagesEl = document.querySelector("#so-messages");
    if (!messagesEl) {
      // 窗口尚未创建，轮询等待（最多 30 秒）
      if (!observeMessages._retries) observeMessages._retries = 0;
      if (observeMessages._retries < 60) {
        observeMessages._retries++;
        setTimeout(observeMessages, 500);
      }
      return;
    }

    // 先保护现有元素，再渲染（F5 修复）
    renderAllMessages();

    // 监听新消息节点
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j];
          if (node.nodeType !== 1) continue;

          // 直接是一个 .so-content —— 立即保护，让 index.js 后续设 innerHTML 时自动保存原文
          if (node.classList && node.classList.contains("so-content")) {
            protectContentElement(node);
            processMessage(node);
            continue;
          }

          // 新插入的 .so-assistant 气泡
          if (node.classList && node.classList.contains("so-assistant")) {
            var cel = node.querySelector(".so-content");
            if (cel) {
              protectContentElement(cel);
              processMessage(cel);
            }
            continue;
          }

          // 其他容器内可能包含 .so-assistant .so-content
          if (node.querySelectorAll) {
            var contents = node.querySelectorAll(
              ".so-assistant .so-content",
            );
            for (var k = 0; k < contents.length; k++) {
              protectContentElement(contents[k]);
              processMessage(contents[k]);
            }
          }
        }
      }
    });

    observer.observe(messagesEl, { childList: true, subtree: true });
  }

  // === 注入 Markdown 样式 ===
  function addMarkdownStyles() {
    if (document.getElementById("markdown-render-styles")) return;

    var style = document.createElement("style");
    style.id = "markdown-render-styles";
    style.textContent =
      "/* Markdown 基础样式 */\n" +
      ".markdown-content { line-height: 1.6; }\n" +
      ".markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4, .markdown-content h5, .markdown-content h6 { margin: 1em 0 0.5em 0; font-weight: 600; line-height: 1.3; }\n" +
      ".markdown-content h1 { font-size: 1.8em; border-bottom: 2px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }\n" +
      ".markdown-content h2 { font-size: 1.5em; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }\n" +
      ".markdown-content h3 { font-size: 1.3em; }\n" +
      ".markdown-content h4 { font-size: 1.1em; }\n" +
      ".markdown-content h5 { font-size: 1em; }\n" +
      ".markdown-content h6 { font-size: 0.9em; opacity: 0.8; }\n" +
      ".markdown-content p { margin: 0.8em 0; }\n" +
      ".markdown-content strong { font-weight: 600; color: #4ade80; }\n" +
      ".markdown-content em { font-style: italic; opacity: 0.9; }\n" +
      ".markdown-content code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: 'Consolas','Monaco',monospace; font-size: 0.9em; color: #fbbf24; }\n" +
      ".markdown-content pre { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 1em 0; border: 1px solid rgba(255,255,255,0.1); }\n" +
      ".markdown-content pre code { background: none; padding: 0; color: #e6e6e6; font-size: 0.85em; }\n" +
      ".markdown-content ul, .markdown-content ol { margin: 0.8em 0; padding-left: 2em; }\n" +
      ".markdown-content li { margin: 0.3em 0; }\n" +
      ".markdown-content ul { list-style-type: disc; }\n" +
      ".markdown-content ol { list-style-type: decimal; }\n" +
      ".markdown-content blockquote { margin: 1em 0; padding: 0.5em 1em; border-left: 4px solid #4ade80; background: rgba(74,222,128,0.1); border-radius: 0 4px 4px 0; }\n" +
      ".markdown-content blockquote p { margin: 0.5em 0; }\n" +
      ".markdown-content a { color: #60a5fa; text-decoration: none; border-bottom: 1px solid rgba(96,165,250,0.3); }\n" +
      ".markdown-content a:hover { color: #93c5fd; border-bottom-color: #93c5fd; }\n" +
      ".markdown-content hr { margin: 2em 0; border: none; border-top: 1px solid rgba(255,255,255,0.2); }\n" +
      ".markdown-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }\n" +
      ".markdown-content th, .markdown-content td { border: 1px solid rgba(255,255,255,0.2); padding: 8px 12px; text-align: left; }\n" +
      ".markdown-content th { background: rgba(255,255,255,0.1); font-weight: 600; }\n" +
      ".markdown-content tr:hover { background: rgba(255,255,255,0.05); }\n" +
      ".markdown-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; }\n";

    document.head.appendChild(style);
  }

  // === 初始化 ===
  function init() {
    addMarkdownStyles();
    observeMessages();
    console.log(
      "[Story Oracle Patch] Markdown 渲染补丁已启用 (showdown + DOMPurify)",
    );
  }

  // 启动：等 DOM 就绪（如果还没就绪）
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // === 暴露到全局 ===
  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.renderMarkdown = renderMarkdown;
  window.StoryOraclePatch.processMessage = processMessage;
  window.StoryOraclePatch.markdownEnabled = true;
})();