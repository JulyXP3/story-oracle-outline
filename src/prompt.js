// 模块：大纲模式提示词构建
// 作用：实现 registerMode.onSend，用 StoryOracleAPI 的 context 构建角色卡、世界书、
// 最近对话记录，并排除「<角色>-剧情指导」世界书，最终返回 {system, messages}。
import { LOG_PREFIX, OUTLINE_DEFAULT_SYSTEM_PROMPT, OUTLINE_PRESET_IDENTITY_HEADER, SO_BUILTIN_JB_SENTINEL } from './constants.js';
import { getTemplate, selectedTemplateId } from './templates.js';

// 内置破限的正文是本体模块内部的冻结常量（BUILTIN_JB_CORE / BUILTIN_JB_TAIL），不在酒馆
// 预设表里、也没有经 Hook API 暴露，只能经 api.unsafe.eval 只读提取（§2.3 台账第四处）。
// 一次 eval 连 kill switch 一起读回：本体关闭内置破限（ENABLE_BUILTIN_JAILBREAK=false）→
// 视为未启用；本体改名/移除常量 → eval 抛错 → 回落「不拼破限」（即 1.6.x 的现状），绝不拼出残缺内容。
function getBuiltinJb(api) {
  try {
    if (!api.unsafe || typeof api.unsafe.eval !== 'function') return null;
    const blob = api.unsafe.eval('({ on: ENABLE_BUILTIN_JAILBREAK, core: BUILTIN_JB_CORE, tail: BUILTIN_JB_TAIL })');
    if (!blob || blob.on !== true) return null;
    if (typeof blob.core !== 'string' || !blob.core) return null;
    return { systemPrompt: blob.core, tail: typeof blob.tail === 'string' ? blob.tail : '' };
  } catch (e) {
    console.warn(LOG_PREFIX + '读取本体内置破限常量失败（回落为不拼破限）:', e);
    return null;
  }
}

// 自定义补全预设走本体同款「快照逐块、保 role 组装」（与本体 buildPresetMessages 同语义）：
// 读 settings.curatedPresets[name].items（「重新挑选要保留的块」的冻结结果，顺序即快照顺序）。
// 快照缺失（选了名但没保存过策展）→ 按本体 presetCurationActive 口径视为未启用，返回 null。
// 读 settings 公开对象即可，不用 unsafe.eval。
function getCuratedPresetItems(api) {
  try {
    const settings = api.context.getSettings();
    const presetName = settings && settings.sysPromptPresetName;
    if (!presetName || presetName === SO_BUILTIN_JB_SENTINEL) return null;
    const snap = settings.curatedPresets && settings.curatedPresets[presetName];
    const items = snap && snap.items;
    if (!Array.isArray(items) || !items.length) return null;
    return items;
  } catch (e) {
    console.warn(LOG_PREFIX + '读取预设策展快照失败:', e);
    return null;
  }
}

// 单块宏替换（本体 subst 同款：失败保留原文）。
function substBlock(ctx, text) {
  try {
    if (ctx && typeof ctx.substituteParams === 'function') return ctx.substituteParams(String(text == null ? '' : text));
  } catch (e) {
    console.warn(LOG_PREFIX + '预设块宏替换失败，保留原文:', e);
  }
  return String(text == null ? '' : text);
}

// 把快照拆成槽前 / 槽后两组消息：文本块保 role 落位（空内容跳过，同本体 pushMsg），
// marker 块一律跳过（大纲自带卡/世界书/记录，同参谋/世界书模式策略）；首个 chatHistory
// 为槽位，后续重复槽位同样跳过（只放一次）。
function splitPresetBlocks(items, ctx) {
  const pre = [];
  const post = [];
  let sawHistory = false;
  let slotOpen = false;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (it.kind === 'marker') {
      if (it.identifier === 'chatHistory' && !sawHistory) {
        sawHistory = true;
        slotOpen = true;
      }
      continue;
    }
    const content = substBlock(ctx, it.content);
    if (!content.trim()) continue;
    (slotOpen ? post : pre).push({ role: it.role || 'system', content });
  }
  return { pre, post, sawHistory };
}

// MVU（MagVarUpdate 变量框架）公开 API 读取当前 stat_data——与本体参谋模式同源（本体 getMvuStatData
// 底层就是 Mvu.getMvuData）。走公开通道，不经本体、不用 unsafe.eval；非 MVU 卡静默返回空串。
async function loadMvuStatSection() {
  try {
    const pwin = window.parent || window;
    const th = pwin.TavernHelper || window.TavernHelper;
    let Mvu = pwin.Mvu || window.Mvu || null;
    if (!Mvu && th && typeof th.waitGlobalInitialized === 'function') {
      // MVU 框架可能比插件晚就绪：等它全局初始化，最多 5 秒（与本体 getMvu 同款超时）。
      Mvu = await Promise.race([
        th.waitGlobalInitialized('Mvu'),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]).catch(() => null);
    }
    if (!Mvu || typeof Mvu.getMvuData !== 'function') return '';
    const data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    // 少数卡把变量摊在 MvuData 顶层而没有 stat_data —— 与本体 diagStatOf 同口径退回整份。
    const stat = (data && data.stat_data) ? data.stat_data : (data ?? null);
    return stat ? JSON.stringify(stat, null, 2) : '';
  } catch (e) {
    console.warn(LOG_PREFIX + '读取 MVU 变量状态失败（视为无 MVU）:', e);
    return '';
  }
}

// 大纲正文（系统提示词 + 当前模板）：不含任何补全预设/破限成分，预设块与破限由
// buildOutlineSend 在消息级组装（保 role，与本体参谋/世界书模式同理）。
function getOutlineDirective(api) {
  const s = api.context.getSettings();
  const outlinePrompt = (typeof s.outlineSystemPrompt === 'string' && s.outlineSystemPrompt.trim())
    ? s.outlineSystemPrompt
    : OUTLINE_DEFAULT_SYSTEM_PROMPT;
  const template = getTemplate(selectedTemplateId());
  return template && template.content ? outlinePrompt + '\n\n' + template.content : outlinePrompt;
}

function getPlotGuideBookName(ctx) {
  const charName = ctx && ctx.name2;
  return charName ? charName + '-剧情指导' : '';
}

function isPlotGuideEntry(entry) {
  const comment = String((entry && entry.comment) || '');
  return comment === '剧情指导' || /^剧情指导\d+$/.test(comment);
}

function getPlotEntriesFromWorldInfoData(data) {
  const entries = Array.isArray(data) ? data : Object.values((data && data.entries) || {});
  return entries.filter((entry) =>
    entry &&
    entry.disable !== true &&
    entry.enabled !== false &&
    isPlotGuideEntry(entry) &&
    typeof entry.content === 'string' &&
    entry.content.trim()
  );
}

async function loadPlotGuideEntries(bookName, ctx) {
  if (!bookName) return [];
  try {
    if (ctx && typeof ctx.loadWorldInfo === 'function') {
      const data = await ctx.loadWorldInfo(bookName);
      const entries = getPlotEntriesFromWorldInfoData(data);
      if (entries.length) return entries;
    }
  } catch (e) {
    // 书不存在或当前 ST 上下文不暴露 loadWorldInfo 时继续走 TavernHelper 兜底。
  }

  const pwin = window.parent || window;
  const apis = [pwin.TavernHelper, pwin.TavernHelper_API_ACU].filter(Boolean);
  for (const api of apis) {
    if (typeof api.getLorebookEntries !== 'function') continue;
    try {
      const entries = getPlotEntriesFromWorldInfoData(await api.getLorebookEntries(bookName));
      if (entries.length) return entries;
    } catch (e) {
      // 兜底 API 读不到该书时尝试下一个来源。
    }
  }
  return [];
}

async function stripPlotGuide(worldInfo, ctx) {
  if (!worldInfo || !String(worldInfo).trim()) return worldInfo;
  try {
    const entries = await loadPlotGuideEntries(getPlotGuideBookName(ctx), ctx);
    if (!entries.length) return worldInfo;
    let stripped = String(worldInfo);
    for (const entry of entries) {
      const content = String(entry.content || '').trim();
      if (content && stripped.includes(content)) stripped = stripped.split(content).join('');
    }
    return stripped.replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn(LOG_PREFIX + '剧情指导世界书剔除失败:', e);
    return worldInfo;
  }
}

export async function buildOutlineSend(userText, ctx, api) {
  const settings = api.context.getSettings();
  const parts = [getOutlineDirective(api)];

  try {
    if (settings && settings.includeCard) {
      const card = api.context.buildCardSection(ctx);
      if (card) parts.push(card);
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '构建角色卡上下文失败:', e);
  }

  try {
    if (!settings || settings.chatIncludeStat !== false) {
      const stat = await loadMvuStatSection();
      if (stat) parts.push('=== 当前变量状态（stat_data，来自 MVU —— 剧情推进到此刻的实时数值）===\n' + stat);
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '构建变量状态上下文失败:', e);
  }

  try {
    const bookName = getPlotGuideBookName(ctx);
    const excludeBooks = bookName ? [bookName] : [];
    let worldInfo = await api.context.buildWorldInfo({ excludeBooks });
    worldInfo = await stripPlotGuide(worldInfo, ctx);
    if (worldInfo) parts.push('=== 世界书 / 设定 ===\n' + worldInfo);
  } catch (e) {
    console.warn(LOG_PREFIX + '构建世界书上下文失败:', e);
  }

  try {
    const transcript = api.context.buildTranscript(ctx);
    if (transcript) parts.push('=== 故事对话记录（最新的在最后）===\n' + transcript);
  } catch (e) {
    console.warn(LOG_PREFIX + '构建故事对话记录失败:', e);
  }

  let system = parts.filter(Boolean).join('\n\n');
  if (ctx && typeof ctx.substituteParams === 'function') {
    try {
      system = ctx.substituteParams(system);
    } catch (e) {
      console.warn(LOG_PREFIX + '宏替换失败，保留原文:', e);
    }
  }

  // 「套用补全预设」勾选时走本体同款消息级组装（保 role，顺序跟快照）。
  if (document.getElementById('so-outline-use-preset')?.checked) {
    const presetName = settings && settings.sysPromptPresetName;
    // 哨兵（内置破限）：消息级包裹 [core, 大纲正文, ...对话, tail]，与本体 wrapBuiltinJb 同形。
    if (presetName === SO_BUILTIN_JB_SENTINEL) {
      const jb = getBuiltinJb(api);
      if (jb) {
        console.log(LOG_PREFIX + '使用本体内置破限（哨兵命中，unsafe.eval 只读提取）');
        const messages = [
          { role: 'system', content: substBlock(ctx, jb.systemPrompt) },
          { role: 'system', content: system },
          ...buildMessages(userText, api, ''),
        ];
        const tail = substBlock(ctx, jb.tail);
        if (tail.trim()) messages.push({ role: 'system', content: tail });
        return { system: '', messages };
      }
      // kill switch 关 / 常量读失败 → 回落纯路径（getBuiltinJb 内已告警）。
    } else if (presetName) {
      const items = getCuratedPresetItems(api);
      if (items) {
        console.log(LOG_PREFIX + '使用补全预设策展快照:', presetName);
        return { system: '', messages: assembleCuratedOutline(items, system, userText, ctx, api) };
      }
      // 有名无快照 = 没保存过策展 → 按本体口径忽略预设（presetCurationActive 为假）。
      console.log(LOG_PREFIX + '补全预设无策展快照，按本体口径忽略预设走纯提示词路径:', presetName);
    }
  }

  return { system, messages: buildMessages(userText, api, '') };
}

// 大纲正文在 chatHistory 槽位落位（同本体 placeAdv/placeLore 骨架）：槽前块 → 大纲正文 →
// 本轮对话 → 槽后块；快照无槽位则全部预设块在前、大纲正文与对话缀后。
function assembleCuratedOutline(items, directive, userText, ctx, api) {
  const { pre, post, sawHistory } = splitPresetBlocks(items, ctx);
  const convo = buildMessages(userText, api, '');
  const dirMsgs = directive.trim() ? [{ role: 'system', content: directive }] : [];
  // 大纲版身份头：立在全部预设块之前（仿本体 OFFSTAGE_PRESET_HEADERS），仅策展路径生效。
  const head = [{ role: 'system', content: OUTLINE_PRESET_IDENTITY_HEADER }];
  if (!sawHistory) return [...head, ...pre, ...post, ...dirMsgs, ...convo];
  return [...head, ...pre, ...dirMsgs, ...convo, ...post];
}

function buildMessages(userText, api, jbTail) {
  const includeAllChat = document.getElementById('so-outline-include-all-chat')?.checked;
  let msgs;
  if (!includeAllChat || !api.unsafe || typeof api.unsafe.eval !== 'function') {
    msgs = [{ role: 'user', content: String(userText || '') }];
  } else {
    try {
      const rounds = api.unsafe.eval(
        '[...convo].filter(m => m && (m.role === "user" || m.role === "assistant")).slice(0, -1)'
      );
      if (Array.isArray(rounds) && rounds.length) {
        msgs = rounds.map(m => ({ role: m.role, content: m.content }));
        msgs.push({ role: 'user', content: String(userText || '') });
      } else {
        msgs = [{ role: 'user', content: String(userText || '') }];
      }
    } catch (e) {
      console.warn(LOG_PREFIX + '通过unsafe.eval读取convo历史失败:', e);
      msgs = [{ role: 'user', content: String(userText || '') }];
    }
  }
  // jbTail 保留形参兼容：当前所有调用方均传 ''（破限尾块已在哨兵分支消息级追加）。
  if (jbTail) msgs.push({ role: 'system', content: jbTail });
  return msgs;
}
