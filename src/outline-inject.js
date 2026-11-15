// 模块：剧情大纲注入世界书
// 作用：把带模板标签的大纲原文写入 TavernHelper 世界书「<角色>-剧情指导」。
// 只使用同一个 Helper 的公开接口，不依赖 Story Oracle 主体私有函数。
import {
  extractTagContentFromEnd,
  extractTagNameFromTemplate,
  getCurrentTemplate,
} from "./tags.js";
import { showToast } from "./toast.js";
import { LOG_PREFIX } from "./constants.js";

let soApi = null;
// 按书名而非消息加锁，覆盖读取、选择、写入和关联；不同目标书互不抢占面板。
const pendingBooks = new Set();

export function setStoryOracleApi(api) {
  soApi = api;
}

function getPublicContext() {
  return (
    soApi?.context?.getContext?.() ||
    window.SillyTavern?.getContext?.() ||
    (window.parent || window).SillyTavern?.getContext?.() ||
    null
  );
}

function captureTarget() {
  const ctx = getPublicContext();
  if (!ctx || typeof ctx.name2 !== "string" || !ctx.name2.trim()) {
    throw new Error("未找到当前角色");
  }
  return {
    name: ctx.name2,
    characterId: ctx.characterId ?? null,
    avatar: ctx.avatar ?? ctx.characters?.[ctx.characterId]?.avatar ?? null,
    chatId: ctx.getCurrentChatId?.() ?? ctx.chatId ?? ctx.chat_id ?? null,
    groupId: ctx.groupId ?? null,
  };
}

function assertTarget(target) {
  const current = captureTarget();
  if (Object.keys(target).some((key) => target[key] !== current[key])) {
    throw new Error("角色或聊天已变化，已停止操作，请在当前会话重新确认");
  }
}

function getPlotAPI() {
  const pwin = window.parent || window;
  const apis = [pwin.TavernHelper_API_ACU, pwin.TavernHelper, getPublicContext()];
  const writable = apis.filter((api) =>
    api && typeof api.getLorebookEntries === "function" &&
    (typeof api.updateLorebookEntriesWith === "function" ||
      (typeof api.createLorebookEntries === "function" &&
        typeof api.setLorebookEntries === "function")),
  );
  // 优先能由同一对象完成读写和关联的候选；仅剩读写能力时仍由后续精确报告关联未完成。
  return writable.find((api) =>
    (typeof api.getCharWorldbookNames === "function" && typeof api.rebindCharWorldbooks === "function") ||
    (typeof api.getCharLorebooks === "function" && typeof api.setCurrentCharLorebooks === "function"),
  ) || writable[0] || null;
}

function reportFailure(message, error = null, level = "error") {
  console[level === "warning" ? "warn" : level](LOG_PREFIX + message, ...(error ? [error] : []));
  showToast(message, level);
  return false;
}

function entryNumber(entry) {
  if (entry.comment === "剧情指导") return 1;
  return Number(entry.comment.slice("剧情指导".length));
}

function getPlotEntries(entries) {
  return entries
    .filter((entry) => typeof entry?.comment === "string" && /^剧情指导(?:\d+)?$/.test(entry.comment))
    .sort((a, b) => entryNumber(a) - entryNumber(b));
}

function validUid(uid) {
  return Number.isSafeInteger(uid) && uid >= 0;
}

function requireEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("辅助 API 未返回有效的世界书条目集合");
  return entries;
}

async function readEntries(operation) {
  assertTarget(operation.target);
  const entries = requireEntries(await operation.api.getLorebookEntries(operation.bookName));
  assertTarget(operation.target);
  return entries;
}

function beforeWrite(operation) {
  assertTarget(operation.target);
  // Helper 可能在写入成功后的回读阶段抛错；调用过写接口便不能断言完全未写入。
  operation.writeAttempted = true;
}

function plotSnapshot(entries) {
  return getPlotEntries(entries).map(({ uid, comment, content, enabled }) => ({ uid, comment, content, enabled }));
}

function assertSamePlots(expected, entries) {
  const current = plotSnapshot(entries);
  if (current.length !== expected.length || expected.some((old) => {
    const matches = current.filter((entry) => entry.uid === old.uid);
    return matches.length !== 1 || Object.keys(old).some((key) => old[key] !== matches[0][key]);
  })) {
    throw new Error("剧情条目已变化，请检查世界书后重试并重新确认");
  }
}

function assertUniquePlotUids(entries) {
  for (const plot of getPlotEntries(entries)) {
    if (!validUid(plot.uid) || entries.filter((entry) => entry.uid === plot.uid).length !== 1) {
      throw new Error("剧情条目的 UID 缺失或不唯一，已停止写入，请检查世界书");
    }
  }
}

function assertOverwriteTarget(selected, entries) {
  const latest = getPlotEntries(entries).at(-1);
  if (!validUid(selected.uid) || !latest || latest.uid !== selected.uid ||
    latest.comment !== selected.comment || latest.content !== selected.content ||
    entries.filter((entry) => entry.uid === selected.uid).length !== 1) {
    throw new Error("待覆盖的条目或内容已变化，请重试并重新确认");
  }
}

function showInlineChoicePanel(anchorMsg, message, choices) {
  return new Promise((resolve) => {
    if (!anchorMsg?.isConnected || !anchorMsg.parentNode) {
      console.warn(LOG_PREFIX + "无法显示操作选择，已取消本次写入");
      resolve("cancel");
      return;
    }
    // 不删除其他操作的待决面板，否则它们的 Promise 将永远无法结束。
    const panel = document.createElement("div");
    panel.className = "so-inline-choice-panel";
    const msgEl = document.createElement("div");
    msgEl.className = "so-inline-choice-msg";
    msgEl.textContent = message;
    const actions = document.createElement("div");
    actions.className = "so-inline-choice-actions";
    const listeners = [];
    let settled = false;
    let observer = null;
    function finish(value) {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      for (const [button, listener] of listeners) button.removeEventListener("click", listener);
      panel.remove();
      resolve(value);
    }
    function cancelIfDisconnected() {
      if (settled) return true;
      if (anchorMsg.isConnected && panel.isConnected) return false;
      console.warn(LOG_PREFIX + "操作面板或消息已移除，已取消本次写入");
      finish("cancel");
      return true;
    }
    choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "so-fix-run-btn so-inline-choice-btn " + (choice.variant || "");
      btn.textContent = choice.label;
      const onClick = () => {
        if (cancelIfDisconnected()) return;
        console.info(LOG_PREFIX + "剧情指导操作选择：" + choice.label);
        finish(choice.value);
      };
      btn.addEventListener("click", onClick);
      listeners.push([btn, onClick]);
      actions.appendChild(btn);
    });
    panel.append(msgEl, actions);
    try {
      anchorMsg.parentNode.insertBefore(panel, anchorMsg.nextSibling);
      // 只在本面板待决期间观察公开 DOM；祖先聊天容器移除也会结束选择并释放书锁。
      observer = new MutationObserver(cancelIfDisconnected);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      if (cancelIfDisconnected()) return;
    } catch (error) {
      console.error(LOG_PREFIX + "操作面板生命周期监听失败，已取消本次写入", error);
      finish("cancel");
      return;
    }
    try {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      // 滚动仅为提示，不影响选择。
    }
  });
}

function makePlotEntry(content, comment) {
  return {
    comment,
    content,
    keys: [],
    enabled: true,
    type: "constant",
    position: "at_depth_as_system",
    order: 9999,
    depth: 4,
    prevent_recursion: true,
  };
}

function findNewEntry(entries, previous, created, declaredUids) {
  const oldUids = new Set(previous.map((entry) => entry.uid));
  const matches = entries.filter((entry) => validUid(entry.uid) && !oldUids.has(entry.uid) &&
    entry.comment === created.comment && entry.content === created.content);
  if (matches.length !== 1 || matches[0].enabled !== true ||
    entries.filter((entry) => entry.uid === matches[0].uid).length !== 1 ||
    (Array.isArray(declaredUids) &&
      (declaredUids.length !== 1 || declaredUids[0] !== matches[0].uid))) {
    throw new Error("无法唯一确认新增条目的 UID，状态未确认；未继续禁用旧条目，请检查世界书");
  }
  return matches[0];
}

async function recoverEnabled(operation, oldEntries, created, cause) {
  let confirmed = true;
  try {
    beforeWrite(operation);
    const result = await operation.api.setLorebookEntries(operation.bookName,
      oldEntries.map(({ uid, enabled }) => ({ uid, enabled })));
    if (result === false) throw new Error("辅助 API 明确拒绝恢复旧条目");
  } catch (error) {
    confirmed = false;
    console.error(LOG_PREFIX + "恢复旧条目启用状态失败", error);
  }
  try {
    const entries = await readEntries(operation);
    const matches = entries.filter((entry) => entry.uid === created.uid &&
      entry.comment === created.comment && entry.content === created.content);
    if (matches.length !== 1) throw new Error("无法确认需要停用的新条目");
    beforeWrite(operation);
    const result = await operation.api.setLorebookEntries(operation.bookName, [{ uid: created.uid, enabled: false }]);
    if (result === false) throw new Error("辅助 API 明确拒绝停用新条目");
  } catch (error) {
    confirmed = false;
    console.error(LOG_PREFIX + "停用本次新条目失败", error);
  }
  try {
    const entries = await readEntries(operation);
    const expected = oldEntries.concat({ ...created, enabled: false });
    if (expected.some((old) => {
      const matches = entries.filter((entry) => entry.uid === old.uid);
      return matches.length !== 1 || matches[0].enabled !== old.enabled;
    })) throw new Error("补偿后的启用状态回读不一致");
  } catch (error) {
    confirmed = false;
    console.error(LOG_PREFIX + "补偿结果核验失败", error);
  }
  return reportFailure(confirmed
    ? "禁用旧条目失败；辅助 API 回读已确认旧条目启用状态已恢复、本次新条目已停用但未删除，请核对后重试"
    : "禁用旧条目失败，已尝试补偿，但状态未确认；请检查世界书中的新旧条目后重试", cause);
}

async function createPlotEntry(operation, previous, created) {
  const { api, bookName } = operation;
  const expected = plotSnapshot(previous);
  const enabled = getPlotEntries(previous).filter((entry) => entry.enabled === true);
  if (typeof api.updateLorebookEntriesWith === "function") {
    beforeWrite(operation);
    const result = await api.updateLorebookEntriesWith(bookName, (entries) => {
      assertTarget(operation.target);
      requireEntries(entries);
      assertSamePlots(expected, entries);
      assertUniquePlotUids(entries);
      // updater 返回完整集合：旧条目原序保留全部，只改 enabled，新条目末尾不带 UID。
      return entries.map((entry) => enabled.some((old) => old.uid === entry.uid)
        ? { ...entry, enabled: false } : entry).concat(created);
    });
    assertTarget(operation.target);
    const saved = requireEntries(result);
    findNewEntry(saved, previous, created);
    if (enabled.some((old) => !saved.some((entry) => entry.uid === old.uid && entry.enabled === false))) {
      throw new Error("辅助 API 返回的旧条目启用状态不一致，请检查世界书");
    }
    return true;
  }

  // 两步接口没有原子性：先创建，明确识别新 UID 后才能禁用原先已启用的旧条目。
  beforeWrite(operation);
  const result = await api.createLorebookEntries(bookName, [created]);
  const entries = await readEntries(operation);
  const added = findNewEntry(entries, previous, created, result?.new_uids);
  assertSamePlots(expected, entries.filter((entry) => entry.uid !== added.uid));
  if (!enabled.length) return true;
  beforeWrite(operation);
  try {
    const disabled = await api.setLorebookEntries(bookName, enabled.map(({ uid }) => ({ uid, enabled: false })));
    if (disabled === false) throw new Error("辅助 API 明确拒绝禁用旧条目");
    const saved = await readEntries(operation);
    if (enabled.some((old) => !saved.some((entry) => entry.uid === old.uid && entry.enabled === false))) {
      throw new Error("禁用旧条目的结果回读不一致");
    }
    findNewEntry(saved, previous, created, [added.uid]);
    return true;
  } catch (error) {
    return recoverEnabled(operation, enabled, added, error);
  }
}

async function overwritePlotEntry(operation, selected) {
  const { api, bookName } = operation;
  beforeWrite(operation);
  if (typeof api.updateLorebookEntriesWith === "function") {
    const result = await api.updateLorebookEntriesWith(bookName, (entries) => {
      assertTarget(operation.target);
      requireEntries(entries);
      assertOverwriteTarget(selected, entries);
      return entries.map((entry) => entry.uid === selected.uid ? { ...entry, content: operation.content } : entry);
    });
    assertOverwriteTarget({ ...selected, content: operation.content }, requireEntries(result));
  } else {
    // setter 只收 UID 和 content，不能把用户确认前的旧字段快照回写。
    const result = await api.setLorebookEntries(bookName, [{ uid: selected.uid, content: operation.content }]);
    if (result === false) throw new Error("辅助 API 明确拒绝覆盖条目");
    assertOverwriteTarget({ ...selected, content: operation.content }, await readEntries(operation));
  }
  assertTarget(operation.target);
}

async function linkWorldbookToCurrentCharacter(operation) {
  const { api, bookName } = operation;
  assertTarget(operation.target);
  let getBindings;
  let setBindings;
  if (typeof api.getCharWorldbookNames === "function" && typeof api.rebindCharWorldbooks === "function") {
    getBindings = () => api.getCharWorldbookNames("current");
    setBindings = (current) => api.rebindCharWorldbooks("current", {
      primary: current.primary,
      additional: current.additional.concat(bookName),
    });
  } else if (typeof api.getCharLorebooks === "function" && typeof api.setCurrentCharLorebooks === "function") {
    getBindings = () => api.getCharLorebooks();
    setBindings = (current) => api.setCurrentCharLorebooks({ ...current, additional: current.additional.concat(bookName) });
  } else {
    throw new Error("当前 Helper 缺少完整的角色世界书关联接口");
  }
  const current = getBindings();
  assertTarget(operation.target);
  if (!current || !Array.isArray(current.additional)) throw new Error("无法读取当前角色世界书关联");
  if (current.primary === bookName || current.additional.includes(bookName)) return;
  beforeWrite(operation);
  const result = await setBindings(current);
  if (result === false) throw new Error("辅助 API 明确拒绝关联世界书");
  assertTarget(operation.target);
  const confirmed = getBindings();
  assertTarget(operation.target);
  if (confirmed?.primary !== bookName && !confirmed?.additional?.includes(bookName)) {
    throw new Error("角色世界书关联回读未确认");
  }
}

export async function injectOutlineToWorldInfo(content, anchorMsg) {
  let operation = null;
  let lockedBook = null;
  try {
    if (typeof content !== "string" || !content.trim()) return reportFailure("内容为空", null, "warning");
    const template = getCurrentTemplate();
    if (!template) return reportFailure("未找到大纲模板", null, "warning");
    const tagName = extractTagNameFromTemplate(template.content);
    if (!tagName) return reportFailure("模板格式错误：未找到闭合标签", null, "warning");
    const extractedContent = extractTagContentFromEnd(content, tagName);
    if (!extractedContent) return reportFailure("未找到 <" + tagName + "> 标签内容", null, "warning");

    const target = captureTarget();
    const bookName = target.name + "-剧情指导";
    if (pendingBooks.has(bookName)) return reportFailure("此世界书已有待处理操作，请先完成或取消，勿重复点击", null, "warning");
    pendingBooks.add(bookName);
    lockedBook = bookName;
    const api = getPlotAPI();
    if (!api) throw new Error("辅助 API 不可用：同一 Helper 必须具备完整的世界书读写能力");
    operation = { api, bookName, target, content: extractedContent, writeAttempted: false };

    let entries;
    try {
      entries = await readEntries(operation);
    } catch (error) {
      // 仅首次读取的明确“书不存在”允许创建；不能把后续写入/回读失败当成需要重建。
      if (!error?.message?.includes("未能找到世界书")) throw error;
      if (typeof api.createLorebook !== "function") throw new Error("世界书不存在，当前 Helper 不支持创建世界书");
      beforeWrite(operation);
      const created = await api.createLorebook(bookName);
      if (created !== true) throw new Error("创建世界书失败：辅助 API 未返回 true，已停止添加条目");
      entries = await readEntries(operation);
    }
    const selectedPlots = plotSnapshot(entries);
    let choice = "create";
    if (selectedPlots.length) {
      choice = await showInlineChoicePanel(anchorMsg,
        "世界书「" + bookName + "」已有 " + selectedPlots.length + " 个剧情条目，请选择操作方式",
        [
          { label: "新建条目", value: "create", variant: "primary" },
          { label: "覆盖最新", value: "overwrite", variant: "secondary" },
          { label: "取消", value: "cancel", variant: "" },
        ]);
      if (choice === "cancel") return false;
    }
    assertTarget(target);
    entries = await readEntries(operation);
    assertUniquePlotUids(entries);
    let comment;
    if (choice === "overwrite") {
      const selected = selectedPlots.at(-1);
      assertOverwriteTarget(selected, entries);
      await overwritePlotEntry(operation, selected);
      comment = selected.comment;
    } else {
      assertSamePlots(selectedPlots, entries);
      const plots = getPlotEntries(entries);
      const nextNumber = plots.reduce((max, entry) => Math.max(max, entryNumber(entry)), 0) + 1;
      if (!Number.isSafeInteger(nextNumber)) throw new Error("剧情指导编号超出有效范围，请检查世界书");
      comment = plots.length ? "剧情指导" + nextNumber : "剧情指导";
      if (!await createPlotEntry(operation, entries, makePlotEntry(extractedContent, comment))) return false;
    }
    try {
      await linkWorldbookToCurrentCharacter(operation);
    } catch (error) {
      return reportFailure("已写入剧情指导，但关联未完成：" + (error.message || error) + "；请核对世界书与角色关联", error);
    }
    showToast("已写入「" + comment + "」并确认当前角色关联（辅助 API 回读）", "success");
    return true;
  } catch (error) {
    const uncertain = operation?.writeAttempted ? "；辅助 API 可能已写入，状态未确认，请检查世界书后重试" : "";
    return reportFailure("注入剧情大纲失败：" + (error.message || error) + uncertain, error);
  } finally {
    if (lockedBook !== null) pendingBooks.delete(lockedBook);
  }
}
