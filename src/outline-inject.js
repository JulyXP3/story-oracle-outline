// 模块：剧情大纲注入世界书
// 作用：把带模板标签的大纲原文写入 TavernHelper 世界书「<角色>-剧情指导」。
// 这是 TavernHelper/lorebook 逻辑，不依赖 Story Oracle 主体私有函数。
import {
  extractTagContentFromEnd,
  extractTagNameFromTemplate,
  getCurrentTemplate,
} from "./tags.js";
import { showToast } from "./toast.js";
import { LOG_PREFIX } from "./constants.js";

let soApi = null;

export function setStoryOracleApi(api) {
  soApi = api;
}

function getCurrentCharacterName() {
  try {
    const ctx =
      soApi?.context?.getContext?.() || window.SillyTavern?.getContext?.();
    return (ctx && ctx.name2) || null;
  } catch (e) {
    return null;
  }
}

function getPlotAPI() {
  const pwin = window.parent || window;
  let ctx = null;
  try {
    ctx =
      soApi?.context?.getContext?.() ||
      pwin.SillyTavern?.getContext?.() ||
      null;
  } catch (e) {
    ctx = null;
  }
  const apis = [pwin.TavernHelper_API_ACU, pwin.TavernHelper, ctx].filter(
    Boolean,
  );
  for (const api of apis) {
    if (
      typeof api.getLorebookEntries === "function" ||
      typeof api.setLorebookEntries === "function"
    )
      return api;
  }
  return null;
}

function getPlotEntries(entries) {
  const base = "剧情指导";
  return (entries || [])
    .filter((e) => {
      if (!e.comment) return false;
      if (e.comment === base) return true;
      return !!e.comment.match(new RegExp("^" + base + "(\\d+)$"));
    })
    .sort((a, b) => {
      const numA =
        a.comment === base ? 1 : parseInt(a.comment.replace(base, ""), 10);
      const numB =
        b.comment === base ? 1 : parseInt(b.comment.replace(base, ""), 10);
      return numA - numB;
    });
}

async function linkWorldbookToCurrentCharacter(bookName) {
  try {
    const charName = getCurrentCharacterName();
    if (!charName) return false;
    const helper = (window.parent || window).TavernHelper;
    if (!helper || typeof helper.getCharWorldbookNames !== "function")
      return false;
    const currentWorldbooks = helper.getCharWorldbookNames("current");
    if (currentWorldbooks.additional.includes(bookName)) return true;
    await helper.rebindCharWorldbooks("current", {
      primary: currentWorldbooks.primary,
      additional: currentWorldbooks.additional.concat(bookName),
    });
    return true;
  } catch (e) {
    console.error(LOG_PREFIX + "链接世界书失败:", e.message || e);
    return false;
  }
}

function showInlineChoicePanel(anchorMsg, message, choices) {
  return new Promise((resolve) => {
    if (!anchorMsg || !anchorMsg.parentNode) {
      resolve("cancel");
      return;
    }
    document
      .querySelectorAll(".so-inline-choice-panel")
      .forEach((p) => p.remove());
    const panel = document.createElement("div");
    panel.className = "so-inline-choice-panel";
    const msgEl = document.createElement("div");
    msgEl.className = "so-inline-choice-msg";
    msgEl.textContent = message;
    const actions = document.createElement("div");
    actions.className = "so-inline-choice-actions";
    choices.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "so-fix-run-btn so-inline-choice-btn " + (c.variant || "");
      btn.textContent = c.label;
      btn.addEventListener("click", () => {
        panel.remove();
        resolve(c.value);
      });
      actions.appendChild(btn);
    });
    panel.append(msgEl, actions);
    anchorMsg.parentNode.insertBefore(panel, anchorMsg.nextSibling);
    try {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      /* ignore */
    }
  });
}

async function createPlotEntry(api, bookName, content, comment) {
  await api.createLorebookEntries(bookName, [
    {
      comment,
      content,
      keys: [],
      enabled: true,
      disable: false,
      type: "constant",
      position: "at_depth_as_system",
      order: 9999,
      depth: 4,
      prevent_recursion: true,
    },
  ]);
}

export async function injectOutlineToWorldInfo(content, anchorMsg) {
  if (!content || !content.trim()) {
    showToast("内容为空", "warning");
    return false;
  }
  const template = getCurrentTemplate();
  if (!template) {
    showToast("未找到大纲模板", "warning");
    return false;
  }
  const tagName = extractTagNameFromTemplate(template.content);
  if (!tagName) {
    showToast("模板格式错误：未找到闭合标签", "warning");
    return false;
  }
  const extractedContent = extractTagContentFromEnd(content, tagName);
  if (!extractedContent) {
    showToast("未找到 <" + tagName + "> 标签内容", "warning");
    return false;
  }

  const charName = getCurrentCharacterName();
  if (!charName) {
    showToast("未找到当前角色", "warning");
    return false;
  }
  const bookName = charName + "-剧情指导";
  const api = getPlotAPI();
  if (!api || typeof api.getLorebookEntries !== "function") {
    showToast("API不可用", "error");
    return false;
  }

  try {
    const entries = await api.getLorebookEntries(bookName);
    const plotEntries = getPlotEntries(entries);
    if (plotEntries.length === 0) {
      await createPlotEntry(api, bookName, extractedContent, "剧情指导");
      await linkWorldbookToCurrentCharacter(bookName);
      showToast("已创建剧情指导", "success");
      return true;
    }

    const choice = await showInlineChoicePanel(
      anchorMsg,
      "世界书「" +
        bookName +
        "」已有 " +
        plotEntries.length +
        " 个剧情条目，请选择操作方式",
      [
        { label: "新建条目", value: "create", variant: "primary" },
        { label: "覆盖最新", value: "overwrite", variant: "secondary" },
        { label: "取消", value: "cancel", variant: "" },
      ],
    );
    if (choice === "cancel") return false;
    if (choice === "overwrite") {
      const latest = plotEntries[plotEntries.length - 1];
      latest.content = extractedContent;
      await api.setLorebookEntries(bookName, [latest]);
      showToast("已覆盖「" + latest.comment + "」", "success");
      return true;
    }

    const newNum = plotEntries.length + 1;
    await api.setLorebookEntries(
      bookName,
      plotEntries.map((e) =>
        Object.assign({}, e, { enabled: false, disable: true }),
      ),
    );
    await createPlotEntry(api, bookName, extractedContent, "剧情指导" + newNum);
    showToast("已创建新条目「剧情指导" + newNum + "」并禁用旧条目", "success");
    return true;
  } catch (e) {
    if (e.message && e.message.includes("未能找到世界书")) {
      try {
        if (typeof api.createLorebook === "function")
          await api.createLorebook(bookName);
        await createPlotEntry(api, bookName, extractedContent, "剧情指导");
        await linkWorldbookToCurrentCharacter(bookName);
        showToast("已创建世界书「" + bookName + "」并添加剧情指导", "success");
        return true;
      } catch (createError) {
        console.error(
          LOG_PREFIX + "创建世界书失败:",
          createError.message || createError,
        );
        showToast("创建失败: " + (createError.message || createError), "error");
        return false;
      }
    }
    console.error(LOG_PREFIX + "注入剧情大纲失败:", e.message || e);
    showToast("操作失败: " + (e.message || e), "error");
    return false;
  }
}
