// 模块：大纲模式提示词构建
// 作用：实现 registerMode.onSend，用 StoryOracleAPI 的 context 构建角色卡、世界书、
// 最近对话记录，并排除「<角色>-剧情指导」世界书，最终返回 {system, messages}。
import { LOG_PREFIX, OUTLINE_DEFAULT_SYSTEM_PROMPT, SO_BUILTIN_JB_SENTINEL } from './constants.js';
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

// 返回 { systemPrompt, tail }：systemPrompt 拼在大纲提示词最前，tail 非空时作为整组消息
// 的最后一条 system 追加（忠实照搬本体 wrapBuiltinJb 的头尾包裹形状）。
// 自定义预设走原有提取逻辑，tail 恒为空串；内置破限走哨兵分支（getBuiltinJb）。
function getPresetSystemPrompt(api) {
  try {
    const settings = api.context.getSettings();
    const presetName = settings && settings.sysPromptPresetName;
    if (!presetName) return null;
    if (presetName === SO_BUILTIN_JB_SENTINEL) {
      const jb = getBuiltinJb(api);
      if (jb) console.log(LOG_PREFIX + '使用本体内置破限（哨兵命中，unsafe.eval 只读提取）');
      return jb;
    }
    const pwin = window.parent || window;
    const helper = pwin.TavernHelper;
    if (!helper || typeof helper.getPreset !== 'function') return null;
    const preset = helper.getPreset(presetName);
    if (!preset || !Array.isArray(preset.prompts)) return null;
    let systemPrompt = preset.prompts.find((p) => p.identifier === 'system_prompt');
    if (!systemPrompt) systemPrompt = preset.prompts.find((p) => p.name === 'Main Prompt' && p.role === 'system');
    if (!systemPrompt) systemPrompt = preset.prompts.find((p) => p.role === 'system');
    if (systemPrompt && systemPrompt.content) {
      console.log(LOG_PREFIX + '使用补全预设:', presetName);
      return { systemPrompt: systemPrompt.content, tail: '' };
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '获取补全预设失败:', e);
  }
  return null;
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

// 返回 { text, jbTail }：text 是大纲系统提示词全文，jbTail 是内置破限尾块
// （非空时由 buildMessages 追加为最后一条消息；自定义预设恒为空串）。
function getOutlineSystemPrompt(api) {
  const usePreset = !!document.getElementById('so-outline-use-preset')?.checked;
  const s = api.context.getSettings();
  const outlinePrompt = (typeof s.outlineSystemPrompt === 'string' && s.outlineSystemPrompt.trim())
    ? s.outlineSystemPrompt
    : OUTLINE_DEFAULT_SYSTEM_PROMPT;
  let basePrompt = outlinePrompt;
  let jbTail = '';
  if (usePreset) {
    const preset = getPresetSystemPrompt(api);
    if (preset && preset.systemPrompt) {
      basePrompt = preset.systemPrompt + '\n\n' + basePrompt;
      jbTail = preset.tail || '';
    }
  }
  const template = getTemplate(selectedTemplateId());
  const text = template && template.content ? basePrompt + '\n\n' + template.content : basePrompt;
  return { text, jbTail };
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
  const outlineSys = getOutlineSystemPrompt(api);
  const parts = [outlineSys.text];

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

  // 内置破限尾块含 {{user}}，与本体 wrapBuiltinJb 同口径跑宏替换；替换失败保留原文
  // （字面 {{user}} 是小疵，直接丢尾块等于砍掉半份破限）。
  let jbTail = outlineSys.jbTail || '';
  if (jbTail && ctx && typeof ctx.substituteParams === 'function') {
    try {
      jbTail = ctx.substituteParams(jbTail);
    } catch (e) {
      console.warn(LOG_PREFIX + '内置破限尾块宏替换失败，保留原文:', e);
    }
  }

  return { system, messages: buildMessages(userText, api, jbTail) };
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
  // 内置破限尾块（post-history）：整组消息的最后一条 system —— 位序忠实照搬本体 wrapBuiltinJb。
  if (jbTail) msgs.push({ role: 'system', content: jbTail });
  return msgs;
}
