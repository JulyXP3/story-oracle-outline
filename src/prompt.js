// 模块：大纲模式提示词构建
// 作用：实现 registerMode.onSend，用 StoryOracleAPI 的 context 构建角色卡、世界书、
// 最近对话记录，并排除「<角色>-剧情指导」世界书，最终返回 {system, messages}。
import { LOG_PREFIX, OUTLINE_DEFAULT_SYSTEM_PROMPT, OUTLINE_PRESET_IDENTITY_HEADER, SO_BUILTIN_JB_SENTINEL } from './constants.js';
import { getTemplate, selectedTemplateId } from './templates.js';
import { initTemplateStorage } from './storage.js';
import { buildPlotGuideSection, getPlotGuideBookName, loadEnabledPlotGuides, stripPlotGuide } from './plot-guide-context.js';
import { getOutlineModeState } from './mode-compat.js';
import { showToast } from './toast.js';

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
// 只共享探测，不缓存变量值；失败后短暂退避，迟到就绪仍在每次发送时检查。
let mvuProbe = null;
let mvuCooldownUntil = 0;

async function loadMvuStatSection() {
  try {
    const pwin = window.parent || window;
    const th = pwin.TavernHelper || window.TavernHelper;
    let Mvu = pwin.Mvu || window.Mvu || null;
    if (!Mvu && th && typeof th.waitGlobalInitialized === 'function' && Date.now() >= mvuCooldownUntil) {
      if (!mvuProbe) {
        let timer;
        mvuProbe = Promise.race([
          Promise.resolve().then(() => th.waitGlobalInitialized('Mvu')),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); }),
        ]).catch(() => null).then((value) => {
          const found = pwin.Mvu || window.Mvu || value;
          if (!found || typeof found.getMvuData !== 'function') mvuCooldownUntil = Date.now() + 30000;
          return found;
        }).finally(() => { clearTimeout(timer); mvuProbe = null; });
      }
      Mvu = await mvuProbe;
    }
    Mvu = pwin.Mvu || window.Mvu || Mvu;
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
function getOutlineDirective(api, templateId) {
  const s = api.context.getSettings();
  const outlinePrompt = (typeof s.outlineSystemPrompt === 'string' && s.outlineSystemPrompt.trim())
    ? s.outlineSystemPrompt
    : OUTLINE_DEFAULT_SYSTEM_PROMPT;
  const template = getTemplate(templateId);
  if (!template || template.id !== templateId) throw new Error('本次大纲模板未成功加载，请重新选择可用模板后重试');
  return template.content ? outlinePrompt + '\n\n' + template.content : outlinePrompt;
}

function targetIdentity(ctx) {
  try {
    return {
      name: ctx?.name2 ?? null,
      characterId: ctx?.characterId ?? null,
      avatar: ctx?.avatar ?? ctx?.characters?.[ctx?.characterId]?.avatar ?? null,
      chatId: ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? ctx?.chat_id ?? null,
      groupId: ctx?.groupId ?? null,
    };
  } catch (e) { return null; }
}

function isSameTarget(target, ctx) {
  const current = targetIdentity(ctx);
  return !!target && !!current && Object.keys(target).every((key) => target[key] === current[key]);
}

function historySnapshot(userText, api, mode, warnings) {
  const unavailable = '本次未附带大纲对话历史：未能确认大纲或历史读取接口。';
  if (!mode.active || !mode.roomReady || !api.unsafe || typeof api.unsafe.eval !== 'function') {
    warnings.push(unavailable);
    return [];
  }
  try {
    // 已登记的同一次只读历史调用：立刻复制需要的字段，不把本体消息引用留到异步等待之后。
    const snapshot = api.unsafe.eval(
      '({ room: convoStreamKey, messages: [...convo].filter(m => m && (m.role === "user" || m.role === "assistant")).map(m => ({ role: m.role, content: m.content, soHide: m.soHide })) })'
    );
    if (snapshot?.room !== 'outline' || !Array.isArray(snapshot.messages)) throw new Error('历史结构异常');
    const messages = snapshot.messages;
    const last = messages.at(-1);
    if (!last || last.role !== 'user' || last.content !== userText || messages.some((item) =>
      !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' ||
      (item.soHide !== undefined && typeof item.soHide !== 'boolean')
    )) throw new Error('本轮历史边界异常');
    return messages.slice(0, -1).filter((item) => item.soHide !== true)
      .map((item) => ({ role: item.role, content: item.content }));
  } catch (e) {
    warnings.push('本次未附带大纲对话历史：房间或本轮历史边界不符合预期，请检查后重试。');
    return [];
  }
}

function reportContextWarnings(warnings) {
  if (!warnings.length) return;
  const message = [...new Set(warnings)].join('\n');
  console.warn(LOG_PREFIX + message);
  try { showToast(message, 'warning'); } catch (e) {
    // 外部提示组件损坏不能把可选降级变成向本体外抛，完整基础提示词仍须返回。
    console.warn(LOG_PREFIX + '未能显示上下文告警，未附带原因已记录；基础请求继续。');
  }
}

export async function buildOutlineSend(userText, ctx, api) {
  // 先固定本次发送目标，防止初始化ready事件将选择回退后悄悄换用模板。
  const templateId = selectedTemplateId();
  const input = String(userText || '');
  const includeHistory = !!document.getElementById('so-outline-include-all-chat')?.checked;
  const includeGuides = !!document.getElementById('so-outline-include-plot-guides')?.checked;
  const usePreset = !!document.getElementById('so-outline-use-preset')?.checked;
  const target = targetIdentity(ctx);
  const mode = getOutlineModeState();
  const warnings = [];
  let history = includeHistory ? historySnapshot(input, api, mode, warnings) : [];
  const isCurrent = () => {
    try {
      const currentMode = getOutlineModeState();
      return currentMode.active && currentMode.generation === mode.generation &&
        isSameTarget(target, api.context.getContext?.() || ctx);
    } catch (e) { return false; }
  };
  // 只固定角色身份和书名，不冻结或改写酒馆的公开上下文对象。
  const guideContext = { name2: target?.name, characterId: target?.characterId, groupId: target?.groupId,
    characters: target?.characterId !== null ? { [target?.characterId]: { name: ctx?.characters?.[target?.characterId]?.name } } : {} };
  await initTemplateStorage();
  if (selectedTemplateId() !== templateId) throw new Error('等待期间大纲模板选择已变化，请重新选择模板后重试');
  const settings = api.context.getSettings();
  const parts = [getOutlineDirective(api, templateId)];

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

  const guides = includeGuides ? await loadEnabledPlotGuides(guideContext, { isCurrent }) : null;
  if (guides?.warning) warnings.push(guides.warning);
  try {
    const bookName = getPlotGuideBookName(includeGuides ? guideContext : ctx);
    const excludeBooks = bookName ? [bookName] : [];
    let worldInfo = await api.context.buildWorldInfo({ excludeBooks });
    const snapshot = guides && ['ok', 'empty'].includes(guides.status) ? guides.entries : undefined;
    if (!includeGuides || isCurrent()) {
      worldInfo = await stripPlotGuide(worldInfo, ctx, snapshot, { skipHelpers: includeGuides });
    }
    if (worldInfo) parts.push('=== 世界书 / 设定 ===\n' + worldInfo);
  } catch (e) {
    console.warn(LOG_PREFIX + '构建世界书上下文失败:', e);
  }
  const guideIndex = parts.length;

  try {
    const transcript = api.context.buildTranscript(ctx);
    if (transcript) parts.push('=== 故事对话记录（最新的在最后）===\n' + transcript);
  } catch (e) {
    console.warn(LOG_PREFIX + '构建故事对话记录失败:', e);
  }

  if (includeHistory || includeGuides) {
    if (!isCurrent()) {
      history = [];
      warnings.length = 0;
      warnings.push('角色、聊天或模式已变化，本次未附带原大纲对话历史及世界书大纲；基础请求仍按现有流程生成。');
    } else if (guides?.status === 'ok') {
      parts.splice(guideIndex, 0, buildPlotGuideSection(guides.entries));
    }
  }
  reportContextWarnings(warnings);
  const conversation = [...history, { role: 'user', content: input }];
  let system = parts.filter(Boolean).join('\n\n');
  if (ctx && typeof ctx.substituteParams === 'function') {
    try {
      system = ctx.substituteParams(system);
    } catch (e) {
      console.warn(LOG_PREFIX + '宏替换失败，保留原文:', e);
    }
  }

  // 「套用补全预设」勾选时走本体同款消息级组装（保 role，顺序跟快照）。
  if (usePreset) {
    const presetName = settings && settings.sysPromptPresetName;
    // 哨兵（内置破限）：消息级包裹 [core, 大纲正文, ...对话, tail]，与本体 wrapBuiltinJb 同形。
    if (presetName === SO_BUILTIN_JB_SENTINEL) {
      const jb = getBuiltinJb(api);
      if (jb) {
        console.log(LOG_PREFIX + '使用本体内置破限（哨兵命中，unsafe.eval 只读提取）');
        const messages = [
          { role: 'system', content: substBlock(ctx, jb.systemPrompt) },
          { role: 'system', content: system },
          ...conversation,
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
        return { system: '', messages: assembleCuratedOutline(items, system, conversation, ctx) };
      }
      // 有名无快照 = 没保存过策展 → 按本体口径忽略预设（presetCurationActive 为假）。
      console.log(LOG_PREFIX + '补全预设无策展快照，按本体口径忽略预设走纯提示词路径:', presetName);
    }
  }

  return { system, messages: conversation };
}

// 大纲正文在 chatHistory 槽位落位（同本体 placeAdv/placeLore 骨架）：槽前块 → 大纲正文 →
// 本轮对话 → 槽后块；快照无槽位则全部预设块在前、大纲正文与对话缀后。
function assembleCuratedOutline(items, directive, convo, ctx) {
  const { pre, post, sawHistory } = splitPresetBlocks(items, ctx);
  const dirMsgs = directive.trim() ? [{ role: 'system', content: directive }] : [];
  // 大纲版身份头：立在全部预设块之前（仿本体 OFFSTAGE_PRESET_HEADERS），仅策展路径生效。
  const head = [{ role: 'system', content: OUTLINE_PRESET_IDENTITY_HEADER }];
  if (!sawHistory) return [...head, ...pre, ...post, ...dirMsgs, ...convo];
  return [...head, ...pre, ...dirMsgs, ...convo, ...post];
}
