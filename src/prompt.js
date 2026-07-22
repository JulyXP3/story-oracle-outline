// 模块：大纲模式提示词构建
// 作用：实现 registerMode.onSend，用 StoryOracleAPI 的 context 构建角色卡、世界书、
// 最近对话记录，并排除「<角色>-剧情指导」世界书，最终返回 {system, messages}。
import { LOG_PREFIX, OUTLINE_DEFAULT_SYSTEM_PROMPT } from './constants.js';
import { getTemplate, selectedTemplateId } from './templates.js';

function getPresetSystemPrompt(api) {
  try {
    const pwin = window.parent || window;
    const helper = pwin.TavernHelper;
    if (!helper || typeof helper.getPreset !== 'function') return null;
    const settings = api.context.getSettings();
    const presetName = settings && settings.sysPromptPresetName;
    if (!presetName) return null;
    const preset = helper.getPreset(presetName);
    if (!preset || !Array.isArray(preset.prompts)) return null;
    let systemPrompt = preset.prompts.find((p) => p.identifier === 'system_prompt');
    if (!systemPrompt) systemPrompt = preset.prompts.find((p) => p.name === 'Main Prompt' && p.role === 'system');
    if (!systemPrompt) systemPrompt = preset.prompts.find((p) => p.role === 'system');
    if (systemPrompt && systemPrompt.content) {
      console.log(LOG_PREFIX + '使用补全预设:', presetName);
      return systemPrompt.content;
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '获取补全预设失败:', e);
  }
  return null;
}

function getOutlineSystemPrompt(api) {
  const usePreset = !!document.getElementById('so-outline-use-preset')?.checked;
  const s = api.context.getSettings();
  const outlinePrompt = (typeof s.outlineSystemPrompt === 'string' && s.outlineSystemPrompt.trim())
    ? s.outlineSystemPrompt
    : OUTLINE_DEFAULT_SYSTEM_PROMPT;
  let basePrompt = outlinePrompt;
  if (usePreset) {
    const presetPrompt = getPresetSystemPrompt(api);
    if (presetPrompt) basePrompt = presetPrompt + '\n\n' + basePrompt;
  }
  const template = getTemplate(selectedTemplateId());
  return template && template.content ? basePrompt + '\n\n' + template.content : basePrompt;
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
  const parts = [getOutlineSystemPrompt(api)];

  try {
    if (settings && settings.includeCard) {
      const card = api.context.buildCardSection(ctx);
      if (card) parts.push(card);
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '构建角色卡上下文失败:', e);
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

  return { system, messages: buildMessages(userText, api) };
}

function buildMessages(userText, api) {
  const includeAllChat = document.getElementById('so-outline-include-all-chat')?.checked;
  if (!includeAllChat || !api.unsafe || typeof api.unsafe.eval !== 'function') {
    return [{ role: 'user', content: String(userText || '') }];
  }
  try {
    const rounds = api.unsafe.eval(
      '[...convo].filter(m => m && (m.role === "user" || m.role === "assistant")).slice(0, -1)'
    );
    if (Array.isArray(rounds) && rounds.length) {
      const msgs = rounds.map(m => ({ role: m.role, content: m.content }));
      msgs.push({ role: 'user', content: String(userText || '') });
      return msgs;
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '通过unsafe.eval读取convo历史失败:', e);
  }
  return [{ role: 'user', content: String(userText || '') }];
}
