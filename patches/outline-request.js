/**
 * 大纲模式 - 请求拦截模块
 */
(function () {
    'use strict';

    const OUTLINE_DEFAULT_SYSTEM_PROMPT =
`你是「故事神谕」的大纲模式助手，专门用于生成和管理剧情大纲。
下方提供了当前的故事上下文（角色信息与最近的对话记录）。

你的职责：
- 根据用户提供的剧情需求，按照指定的大纲模板格式输出结构化的剧情大纲。
- 严格遵循模板中定义的输出格式和标记规范。
- 确保大纲包含必须触发事件（MUST）、建议事件（SHOULD）、可观察现象、GM专用信息等完整要素。
- 保持大纲的逻辑连贯性和剧情合理性。

规则：
- 你不是在续写剧情，而是在规划剧情结构。
- 严格按照用户选择的大纲模板格式输出。
- 如果用户没有提供足够信息，可以基于已有上下文合理推断，但要标注推断部分。`;

    const originalFetch = window.fetch;

    function getTemplateContent(templateId) {
        try {
            const templates = JSON.parse(localStorage.getItem('so_outline_templates') || '[]');
            const DEFAULT_TEMPLATE = {
                id: 'default',
                content: 'n若你在执行大纲输出任务，此为你的输出格式:\n通用大纲模板\n<plot_outline>\n\n[EXECUTION PRIORITY: MANDATORY - 按序触发以下核心节点]\n\n## 📍 当前章节\n\n章节名: ${章节标题}\n\n时间跨度: ${起始时间} - ${结束时间}\n\n核心区域: ${主要活动地点}\n\n## 🎯 必须触发事件（MUST）\n\n按相对时间排序，LLM必须在剧情中实现这些节点：\n\n| 序号 | 触发条件 | 事件描述 | 检定要求 | 分支标记 |\n|------|----------|----------|----------|----------|\n| M1 | ${相对时间或前置事件} | ${15字内核心描述} | ${检定类型或"无"} | ${成功/失败导向} |\n| M2 | ... | ... | ... | ... |\n\n（控制在5-8条以内）\n\n## 📌 建议触发事件（SHOULD）\n\n丰富剧情但非必要，可根据节奏取舍：\n\n• ${事件A}: ${触发条件} → ${10字描述}\n• ${事件B}: ...\n\n（控制在3-5条以内）\n\n## 👁️ 主视角可观察现象\n\n主角能通过感官捕获的线索，用于暗示"场外事件"：\n\n• ${现象1}: ${观察方式} → ${现象描述}\n• ${现象2}: ...\n\n## 🔒 GM专用（禁止在主视角叙事中透露）\n\n场外事件的因果逻辑，仅供理解NPC动机：\n\n> ${简要背景描述，50字以内}\n\n## ❓ 悬念钩子\n\n本章结束时应留下的未解问题：\n\n• ${悬念1}\n• ${悬念2}\n</plot_outline>'
            };

            if (!templates.find(t => t.id === 'default')) {
                templates.unshift(DEFAULT_TEMPLATE);
            }

            const template = templates.find(t => t.id === templateId);
            return template?.content || '';
        } catch (e) {
            return '';
        }
    }

    function getStoryOracleSettings() {
        try {
            const pwin = window.parent || window;
            const ctx = pwin.SillyTavern?.getContext?.();
            if (!ctx) return null;

            const MODULE = 'storyOracle';
            return ctx.extensionSettings?.[MODULE] || null;
        } catch (e) {
            console.error('[Story Oracle Patch] 获取设置失败:', e);
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
                let systemPrompt = preset.prompts.find(p => p.identifier === 'system_prompt');

                if (!systemPrompt) {
                    systemPrompt = preset.prompts.find(p => p.name === 'Main Prompt' && p.role === 'system');
                }

                if (!systemPrompt) {
                    systemPrompt = preset.prompts.find(p => p.role === 'system');
                }

                if (systemPrompt?.content) {
                    console.log(`[Story Oracle Patch] 使用补全预设: ${presetName}`);
                    return systemPrompt.content;
                }
            }

            return null;
        } catch (e) {
            console.error('[Story Oracle Patch] 获取补全预设失败:', e);
            return null;
        }
    }

    function isOutlineMode() {
        const win = document.getElementById('so-window');
        return win?.classList.contains('so-outline-on');
    }

    function getOutlineSystemPrompt() {
        const usePresetCheckbox = document.getElementById('so-outline-use-preset');
        const usePreset = usePresetCheckbox?.checked;

        let basePrompt = OUTLINE_DEFAULT_SYSTEM_PROMPT;
        if (usePreset) {
            const presetPrompt = getPresetSystemPrompt();
            if (presetPrompt) {
                basePrompt = presetPrompt;
            }
        }

        const templateSelect = document.getElementById('so-outline-template-select');
        const templateId = templateSelect?.value;
        if (templateId) {
            const templateContent = getTemplateContent(templateId);
            if (templateContent) {
                return basePrompt + '\n\n' + templateContent;
            }
        }

        return basePrompt;
    }

    function interceptFetch() {
        window.fetch = async function(url, options) {
            if (isOutlineMode() && options?.method === 'POST' && options?.body) {
                try {
                    const body = JSON.parse(options.body);
                    if (body.messages && Array.isArray(body.messages)) {
                        const systemMsg = body.messages.find(m => m.role === 'system');
                        if (systemMsg) {
                            const outlinePrompt = getOutlineSystemPrompt();
                            systemMsg.content = outlinePrompt;
                            options.body = JSON.stringify(body);

                            // 如果开启了开发者选项，输出完整请求内容
                            const showPrompt = window.StoryOraclePatch?.isShowPromptEnabled?.();
                            if (showPrompt) {
                                console.log('='.repeat(80));
                                console.log('[Story Oracle Patch] 完整请求内容:');
                                console.log('='.repeat(80));
                                body.messages.forEach((msg, idx) => {
                                    console.log(`\n[消息 ${idx + 1}] 角色: ${msg.role}`);
                                    console.log('-'.repeat(40));
                                    console.log(msg.content);
                                });
                                console.log('\n' + '='.repeat(80));
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Story Oracle Patch] 拦截请求失败:', e);
                }
            }
            return originalFetch.call(this, url, options);
        };
        console.log('[Story Oracle Patch] 请求拦截器已安装');
    }

    function init() {
        console.log('[Story Oracle Patch] 大纲模式初始化中...');

        interceptFetch();
        console.log('[Story Oracle Patch] 大纲模式初始化成功');
    }

    window.StoryOraclePatch = window.StoryOraclePatch || {};
    window.StoryOraclePatch.initOutlineRequestInterceptor = init;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
