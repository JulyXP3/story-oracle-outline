/**
 * 大纲模式 - 请求拦截模块
 */
(function () {
  "use strict";

  const OUTLINE_DEFAULT_SYSTEM_PROMPT = `
你是「故事神谕」的大纲模式助手，专门用于生成剧情大纲。信条：**人物决定剧情，非剧情驱动人物**。拒绝刻板印象、脸谱化、套路。人的复杂性——矛盾、犹豫、自我欺骗、隐秘动机——是好故事的根基。

## 你会收到:
- 大纲模板
- 当前的故事上下文（角色设定，世界书信息，最近的对话记录）

## 最高原则一：仅输出模板内容
- 你的**唯一输出**是用户提供的大纲模板的填充后版本——从首部标签（如 \`<plot_outline>\`）开始，到尾部标签（如 \`</plot_outline>\`）结束。
- **禁止输出任何其他内容**：禁止输出工序标记（如 \`[Step N 完成]\`）、禁止输出分析过程、禁止输出解释说明、禁止输出补充评论。用户看到的第一行必须是模板首部标签，最后一行必须是模板尾部标签。

## 最高原则二：模板标签完整性
- 标签名因模板而异，但必须原样保留用户模板的首尾标签——不可省略、改写、替换或自行编造。此原则优先级高于一切。

## 核心约束：人物行动逻辑
人物任何行动必须基于以下之一，禁止"因剧情需要"凭空行动：
- **所知所见**：仅依据该人物当前已知信息行动，禁用读者/作者视角的全局信息
- **具体触发**：至亲被辱、师尊被杀、贪念骤起、旧伤被揭、尊严受践、利益骤现等，需明确写出触发条件
每次设计人物行动时自查：此刻他凭什么做这个决定？若答案不成立，行动作废重写。

## 内部工序（思考过程，不输出）
以下步骤在内部完成，仅用于指导你生成最终大纲，**不得输出给用户**：

### [Step 1] 人物档案解构
对每个主要人物内部分析7维度（禁用"善良""邪恶""勇敢"等模板词），每项1-2句：
1. 核心欲望（具体可触摸的目标）
2. 内在恐惧（如何影响每个决定）
3. 自我认知偏差（自以为是什么人，实际不是）
4. 行为矛盾（什么情境下做与人设相反的事）
5. 隐秘羞耻（最不愿被知道的过往）
6. 关系面具（在不同人面前扮演什么角色）
7. 道德灰色地带（什么条件突破底线，线在哪）

### [Step 2] 冲突矩阵
1. 识别≥3组冲突对，每组含三层：表层（利益碰撞）、深层（价值观对立）、误解层（认知偏差恶化冲突）
2. 逐一检验不可调和性："说清楚就没事"的冲突不合格
3. 识别≥1个外部系统压力（制度、阶级、历史遗留、文化禁忌），说明其如何扭曲多人物选择

### [Step 3] 反套路剧情设计
**禁止**：英雄之旅弧光、天降救星、反派死于话多、误会→和解→大团圆、爱情拯救一切、一人牺牲救世界、"一切是梦/幻觉"。
**选≥2种策略**：代价递增（每次代价更大且不可逆）、立场反转（中段质疑"谁是对的"）、次要人物夺权、目标腐蚀（追求中意义消解）、结构性无解（根源在不可变结构）、情感错位（A给的B需要但无法接受，B渴望的A无法理解）。
确定策略及具体应用，确定走向概述（200字内，含3-5转折点）。

### [Step 4] 章节大纲生成
严格按用户模板格式填充，首尾标签原样保留，字段必填。
每条事件自查：人物行为是否符合Step 1档案？是否OOC或"降智"？必须事件含成功/失败分支？建议事件含揭示人物另一面的细节？悬念钩子为开放式问题？

### [Step 5] 回溯审查
1. 人物弧光：状态变化是否连贯，有无跳跃式转变
2. 伏笔登记：所有伏笔是否标注预计回收阶段
3. 节奏诊断：本章在铺垫/冲突升级/转折/后果中属哪个位置，与前后章是否失衡
4. OOC风险：对可能被质疑OOC的行为，确认人物内在逻辑成立

审查通过后，直接输出填充后的大纲模板（仅模板内容，无任何附加文字）。

## 补充约束
- 人物动机须可追溯到Step 1档案，不可凭空加设定
- 人物信息不足须在Step 1前向用户提问，不可自编
- 多分支时选最不舒适、最具挑战性的方向——好故事让读者不安，非安心
`;

  const originalFetch = window.fetch;

  function getTemplateContent(templateId) {
    try {
      const templates = JSON.parse(
        localStorage.getItem("so_outline_templates") || "[]",
      );
      const DEFAULT_TEMPLATE = {
        id: "default",
        content:
          '\n若你在执行大纲输出任务，此为你的输出格式:\n通用大纲模板\n<plot_outline>\n\n[EXECUTION PRIORITY: MANDATORY - 按序触发以下核心节点]\n\n## 📍 当前章节\n\n章节名: ${章节标题}\n\n时间跨度: ${起始时间} - ${结束时间}\n\n核心区域: ${主要活动地点}\n\n## 🎯 必须触发事件（MUST）\n\n按相对时间排序，LLM必须在剧情中实现这些节点：\n\n| 序号 | 触发条件 | 事件描述 | 检定要求 | 分支标记 |\n|------|----------|----------|----------|----------|\n| M1 | ${相对时间或前置事件} | ${15字内核心描述} | ${检定类型或"无"} | ${成功/失败导向} |\n| M2 | ... | ... | ... | ... |\n\n（控制在5-8条以内）\n\n## 📌 建议触发事件（SHOULD）\n\n丰富剧情但非必要，可根据节奏取舍：\n\n• ${事件A}: ${触发条件} → ${10字描述}\n• ${事件B}: ...\n\n（控制在3-5条以内）\n\n## 👁️ 主视角可观察现象\n\n主角能通过感官捕获的线索，用于暗示"场外事件"：\n\n• ${现象1}: ${观察方式} → ${现象描述}\n• ${现象2}: ...\n\n## 🔒 GM专用（禁止在主视角叙事中透露）\n\n场外事件的因果逻辑，仅供理解NPC动机：\n\n> ${简要背景描述，50字以内}\n\n## ❓ 悬念钩子\n\n本章结束时应留下的未解问题：\n\n• ${悬念1}\n• ${悬念2}\n</plot_outline>',
      };

      if (!templates.find((t) => t.id === "default")) {
        templates.unshift(DEFAULT_TEMPLATE);
      }

      const template = templates.find((t) => t.id === templateId);
      return template?.content || "";
    } catch (e) {
      return "";
    }
  }

  function getStoryOracleSettings() {
    try {
      const pwin = window.parent || window;
      const ctx = pwin.SillyTavern?.getContext?.();
      if (!ctx) return null;

      const MODULE = "storyOracle";
      return ctx.extensionSettings?.[MODULE] || null;
    } catch (e) {
      console.error("[Story Oracle Patch] 获取设置失败:", e);
      return null;
    }
  }

  function getPresetSystemPrompt() {
    try {
      const pwin = window.parent || window;
      const api = pwin.TavernHelper;
      if (!api) return null;

      const settings = getStoryOracleSettings();
      if (!settings) return null;

      const presetName = settings.sysPromptPresetName;
      if (!presetName) return null;

      const preset = api.getPreset(presetName);
      if (preset?.prompts) {
        // 尝试多种方式查找系统提示词
        let systemPrompt = preset.prompts.find(
          (p) => p.identifier === "system_prompt",
        );

        if (!systemPrompt) {
          systemPrompt = preset.prompts.find(
            (p) => p.name === "Main Prompt" && p.role === "system",
          );
        }

        if (!systemPrompt) {
          systemPrompt = preset.prompts.find((p) => p.role === "system");
        }

        if (systemPrompt?.content) {
          console.log(`[Story Oracle Patch] 使用补全预设: ${presetName}`);
          return systemPrompt.content;
        }
      }

      return null;
    } catch (e) {
      console.error("[Story Oracle Patch] 获取补全预设失败:", e);
      return null;
    }
  }

  function isOutlineMode() {
    const win = document.getElementById("so-window");
    return win?.classList.contains("so-outline-on");
  }

  function getOutlineSystemPrompt() {
    const usePresetCheckbox = document.getElementById("so-outline-use-preset");
    const usePreset = usePresetCheckbox?.checked;

    // 参谋模式「套用我的补全预设」的语义是【叠加】而非覆盖：预设内容（越狱 / 破限基底）
    // 在前，模式自身的职责指令在后。大纲模式沿用同一语义 —— 内置大纲职责提示词始终保留，
    // 勾选补全预设时把预设提示词【前置】作为基底，再叠上大纲职责，最后接大纲模板。
    // 这样既借到了预设的越狱力，又不会丢掉大纲模式「只规划不续写 / 严格输出标签」的核心约束。
    let basePrompt;
    if (usePreset) {
      const presetPrompt = getPresetSystemPrompt();
      if (presetPrompt) {
        basePrompt = presetPrompt + "\n\n" + OUTLINE_DEFAULT_SYSTEM_PROMPT;
      } else {
        basePrompt = OUTLINE_DEFAULT_SYSTEM_PROMPT;
      }
    } else {
      basePrompt = OUTLINE_DEFAULT_SYSTEM_PROMPT;
    }

    const templateSelect = document.getElementById(
      "so-outline-template-select",
    );
    const templateId = templateSelect?.value;
    if (templateId) {
      const templateContent = getTemplateContent(templateId);
      if (templateContent) {
        return basePrompt + "\n\n" + templateContent;
      }
    }

    return basePrompt;
  }

  // 大纲模式剔除「${角色名}-剧情指导」世界书里【启用】条目的内容。
  // 这些条目是 outline-inject.js 注入的剧情大纲（constant，恒被世界书扫描带入请求），
  // 大纲模式再带它进请求会让模型看到上一次的大纲、白白多耗 token，还可能左右新大纲的生成。
  // 做法是：从 buildWorldInfo() 已构建好的世界书字符串里，把启用条目的 content 原样剔除
  //（禁用的旧条目本就不会被注入，跳过）。书不存在 / 读取失败则原样返回，零副作用。
  async function stripPlotGuide(worldInfo, ctx) {
    if (!worldInfo || !ctx || typeof ctx.loadWorldInfo !== "function") {
      return worldInfo;
    }
    let charName = null;
    try { charName = ctx.name2 || null; } catch (e) { /* ignore */ }
    if (!charName) return worldInfo;

    const bookName = `${charName}-剧情指导`;
    let data;
    try {
      data = await ctx.loadWorldInfo(bookName);
    } catch (e) {
      return worldInfo; // 书不存在或读取失败，原样返回
    }
    const entries = Object.values((data && data.entries) || {});
    if (!entries.length) return worldInfo;

    let stripped = worldInfo;
    for (const e of entries) {
      if (!e || e.disable) continue; // 只剥离启用条目（禁用的旧条目不会被注入）
      const c = String(e.content || "").trim();
      if (c && stripped.indexOf(c) !== -1) {
        stripped = stripped.split(c).join("");
      }
    }
    return stripped.replace(/\n{3,}/g, "\n\n").trim();
  }

  // 大纲模式请求重写：把 body.messages 里所有系统消息合并成一条
  //   「大纲提示词 + 角色卡 + 世界书 + 最近对话记录」
  // 的系统消息，保留下方的 user / assistant 对话。这样大纲模式下只会有大纲模式的
  // 提示词（不会混入普通聊天或预设里的其它系统提示词），并且带上世界书内容。
  // 上下文构建复用 index.js 的同名顶层函数（与普通聊天模式同源、行为一致；index.js
  // 是经典脚本，顶层 function 均挂在 window 上，与已打补丁的 stripReasoningTags 同理）。
  async function rewriteForOutlineMode(body) {
    const pwin = window.parent || window;
    const outlinePrompt = getOutlineSystemPrompt();
    const parts = [outlinePrompt];

    let ctx = null;
    let s = null;
    try {
      ctx = typeof pwin.getCtx === "function" ? pwin.getCtx() : null;
      s = typeof pwin.getSettings === "function" ? pwin.getSettings() : null;
    } catch (e) {
      /* 取不到上下文，退化为只发大纲提示词 */
    }

    if (ctx && s) {
      try {
        // 角色卡（角色信息）
        if (s.includeCard && typeof pwin.buildCardSection === "function") {
          const card = pwin.buildCardSection(ctx);
          if (card) parts.push(card);
        }
        // 世界书（尊重设置里的「世界书 / 知识库」选项；off 时 buildWorldInfo 返回空串）
        if (typeof pwin.buildWorldInfo === "function") {
          let wi = await pwin.buildWorldInfo();
          if (wi) {
            // 剔除「剧情指导」条目内容，避免大纲请求携带上一次注入的剧情大纲导致 token 膨胀
            wi = await stripPlotGuide(wi, ctx);
            if (wi) parts.push("=== 世界书 / 设定 ===\n" + wi);
          }
        }
        // 最近的故事对话记录
        if (typeof pwin.buildTranscript === "function") {
          const tr = pwin.buildTranscript(ctx, s);
          if (tr) parts.push("=== 故事对话记录（最新的在最后）===\n" + tr);
        }
      } catch (e) {
        console.warn("[Story Oracle Patch] 大纲模式上下文构建失败:", e);
      }
    }

    let systemContent = parts.filter(Boolean).join("\n\n");
    // 宏替换（与 index.js buildSystemPrompt 保持一致）
    if (ctx && typeof ctx.substituteParams === "function") {
      try {
        systemContent = ctx.substituteParams(systemContent);
      } catch (e) {
        /* 宏替换失败则保留原文 */
      }
    }

    // 用单一系统消息替换所有系统消息。大纲模式每轮请求【只带最新一条用户指令】，
    // 丢弃全部历史对话（含旧大纲）——大纲生成是无状态的：系统提示词里已带足故事上下文
    //（角色卡 / 世界书 / 主聊天对话记录），旧大纲只会徒增 token、还可能左右新大纲的生成；
    // 且不同模板用不同标签，按标签折叠也不严谨。仅改请求体副本，UI 历史不受影响。
    const nonSystem = body.messages.filter((m) => m.role !== "system");
    let lastUser = null;
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      if (nonSystem[i] && nonSystem[i].role === "user") {
        lastUser = nonSystem[i];
        break;
      }
    }
    body.messages = lastUser
      ? [{ role: "system", content: systemContent }, lastUser]
      : [{ role: "system", content: systemContent }];
  }

  function interceptFetch() {
    window.fetch = async function (url, options) {
      if (options?.method === "POST" && options?.body) {
        try {
          const body = JSON.parse(options.body);
          if (body.messages && Array.isArray(body.messages)) {
            // 大纲模式：用「大纲提示词 + 故事上下文」重写系统消息，确保只有大纲模式的
            // 提示词（不混入普通聊天 / 预设里的其它系统提示词），并补上世界书内容。
            if (isOutlineMode()) {
              await rewriteForOutlineMode(body);
              options.body = JSON.stringify(body);
            }

            // 如果开启了开发者选项，输出最终请求内容（所有修改完成后）
            const showPrompt = window.StoryOraclePatch?.isShowPromptEnabled?.();
            if (showPrompt) {
              console.log("=".repeat(80));
              console.log("[Story Oracle] 最终请求内容:");
              console.log("=".repeat(80));
              body.messages.forEach((msg, idx) => {
                console.log(`\n[消息 ${idx + 1}] 角色: ${msg.role}`);
                console.log("-".repeat(40));
                console.log(msg.content);
              });
              console.log("\n" + "=".repeat(80));
            }
          }
        } catch (e) {
          console.error("[Story Oracle Patch] 拊请求失败:", e);
        }
      }
      return originalFetch.call(this, url, options);
    };
    console.log("[Story Oracle Patch] 请求拦截器已安装");
  }

  function patchStripReasoningTags() {
    const win = window.parent || window;
    if (!win.stripReasoningTags) return;

    const originalStripReasoningTags = win.stripReasoningTags;
    win.stripReasoningTags = function (text) {
      if (isOutlineMode()) {
        return text;
      }
      return originalStripReasoningTags.call(this, text);
    };
    console.log("[Story Oracle Patch] stripReasoningTags 已打补丁");
  }

  function init() {
    console.log("[Story Oracle Patch] 大纲模式初始化中...");

    interceptFetch();
    patchStripReasoningTags();
    console.log("[Story Oracle Patch] 大纲模式初始化成功");
  }

  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.initOutlineRequestInterceptor = init;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
