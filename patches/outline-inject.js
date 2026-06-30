/**
 * 剧情大纲注入模块
 */
(function () {
    'use strict';

    const CONFIG = {
        entryCommentBase: '剧情指导',
        entryDepth: 2,
        entryOrder: 9999,
    };

    // 获取当前角色卡名称
    function getCurrentCharacterName() {
        try {
            const ctx = window.SillyTavern?.getContext?.();
            return ctx?.name2 || null;
        } catch (e) {
            return null;
        }
    }

    // 从模板中提取第一个闭合标签的标签名
    function extractTagNameFromTemplate(template) {
        if (!template) return null;
        const match = template.match(/<([a-z_][a-z0-9_-]*)[^>]*>[\s\S]*?<\/\1>/i);
        return match ? match[1] : null;
    }

    // 从文本尾部提取指定标签的内容（包含标签本身）
    function extractTagContentFromEnd(text, tagName) {
        if (!text || !tagName) return null;
        const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>(?![\\s\\S]*<\\/${tagName}>)`, 'i');
        const match = text.match(pattern);
        return match ? match[0].trim() : null;
    }

    // 获取当前选中的模板
    function getCurrentTemplate() {
        const select = document.getElementById('so-outline-template-select');
        if (!select) return null;
        const templateId = select.value;
        return window.StoryOraclePatch?.getTemplate?.(templateId);
    }

    // 检查文本是否有完整闭合的指定标签
    function hasCompleteTag(text, tagName) {
        const pattern = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'i');
        return pattern.test(text);
    }

    // 移除文本头尾的所有标签（包括闭合和未闭合的）
    function stripHeadTailTags(text) {
        let result = text.trim();
        let changed = true;

        // 循环移除头尾标签，直到没有变化
        while (changed) {
            const before = result;

            // 移除开头的标签（完整或不完整）
            // 匹配: <tag>, <tag, </tag>, </tag
            result = result.replace(/^<\/?[^>]*>?/i, '').trim();

            // 移除结尾的标签（完整或不完整）
            // 匹配: </tag>, </tag, <tag>, <tag
            result = result.replace(/<\/?[^>]*>?$/i, '').trim();

            changed = (before !== result);
        }

        return result;
    }

    // 为AI回复补充标签
    function supplementTags(text) {
        const template = getCurrentTemplate();
        if (!template) {
            showToast('未找到大纲模板', 'warning');
            return null;
        }

        const tagName = extractTagNameFromTemplate(template.content);
        if (!tagName) {
            showToast('模板格式错误：未找到闭合标签', 'warning');
            return null;
        }

        // 情况3：标签完整且名称匹配，跳过
        if (hasCompleteTag(text, tagName)) {
            showToast(`标签已完整，无需补充`, 'success');
            return text;
        }

        // 检查是否有任何标签（闭合或未闭合）
        const hasAnyTag = /<[^>]+>/.test(text) || /<\/[^>]+>/.test(text);

        let content;
        if (!hasAnyTag) {
            // 情况1：没有任何标签，直接补充
            content = text.trim();
        } else {
            // 情况2：有标签但不完整，剔除所有头尾标签
            content = stripHeadTailTags(text);
        }

        const result = `<${tagName}>\n${content}\n</${tagName}>`;
        showToast(`已补充 <${tagName}> 标签`, 'success');
        return result;
    }

    // 获取API（参考询问机二改的实现）
    function getPlotAPI() {
        const pwin = window.parent || window;
        const ctx = typeof SillyTavern !== 'undefined'
            ? SillyTavern.getContext()
            : pwin.SillyTavern?.getContext?.() || null;

        const apis = [pwin.TavernHelper_API_ACU, pwin.TavernHelper, ctx].filter(Boolean);

        for (const api of apis) {
            if (typeof api.getLorebookEntries === 'function' ||
                typeof api.setLorebookEntries === 'function') {
                return api;
            }
        }
        return null;
    }

    // 获取剧情相关条目
    function getPlotEntries(entries) {
        const base = CONFIG.entryCommentBase;
        return entries.filter(e => {
            if (!e.comment) return false;
            if (e.comment === base) return true;
            const match = e.comment.match(new RegExp('^' + base + '(\\d+)$'));
            return !!match;
        }).sort((a, b) => {
            const numA = a.comment === base ? 1 : parseInt(a.comment.replace(base, ''));
            const numB = b.comment === base ? 1 : parseInt(b.comment.replace(base, ''));
            return numA - numB;
        });
    }

    // 将世界书链接到当前角色卡
    async function linkWorldbookToCurrentCharacter(bookName) {
        try {
            const charName = getCurrentCharacterName();
            if (!charName) {
                console.log('[Outline Inject] 无法链接世界书：未找到当前角色卡');
                return false;
            }

            const pwin = window.parent || window;
            const api = pwin.TavernHelper;

            if (!api || typeof api.getCharWorldbookNames !== 'function') {
                console.error('[Outline Inject] TavernHelper API 不可用');
                return false;
            }

            // 获取当前角色卡已绑定的世界书
            const currentWorldbooks = api.getCharWorldbookNames('current');

            // 如果世界书已经在附加列表中，不重复添加
            if (currentWorldbooks.additional.includes(bookName)) {
                console.log(`[Outline Inject] 世界书「${bookName}」已经附加到角色卡`);
                return true;
            }

            // 将新世界书添加到附加列表
            const newWorldbooks = {
                primary: currentWorldbooks.primary,
                additional: [...currentWorldbooks.additional, bookName],
            };

            await api.rebindCharWorldbooks('current', newWorldbooks);

            console.log(`[Outline Inject] ✅ 已将世界书「${bookName}」附加到角色卡「${charName}」`);
            return true;
        } catch (e) {
            console.error('[Outline Inject] 链接世界书失败:', e.message);
            return false;
        }
    }

    // 显示三选项对话框
    function showThreeChoiceDialog(title, message, choice1, choice2, choice3) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'so-dialog-overlay';
            overlay.innerHTML = `
                <div class="so-dialog">
                    <div class="so-dialog-header">
                        <h3>${title}</h3>
                    </div>
                    <div class="so-dialog-body">
                        <p>${message}</p>
                    </div>
                    <div class="so-dialog-actions">
                        <button type="button" class="so-dialog-btn so-dialog-btn-primary" data-choice="create">${choice1}</button>
                        <button type="button" class="so-dialog-btn so-dialog-btn-secondary" data-choice="overwrite">${choice2}</button>
                        <button type="button" class="so-dialog-btn so-dialog-btn-cancel" data-choice="cancel">${choice3}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const buttons = overlay.querySelectorAll('.so-dialog-btn');
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const choice = btn.dataset.choice;
                    overlay.remove();
                    resolve(choice);
                });
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve('cancel');
                }
            });
        });
    }

    // 注入剧情大纲到世界书
    async function injectOutlineToWorldInfo(content) {
        if (!content || !content.trim()) {
            showToast('内容为空', 'warning');
            return false;
        }

        // 获取当前模板并提取标签名
        const template = getCurrentTemplate();
        if (!template) {
            showToast('未找到大纲模板', 'warning');
            return false;
        }

        const tagName = extractTagNameFromTemplate(template.content);
        if (!tagName) {
            showToast('模板格式错误：未找到闭合标签', 'warning');
            return false;
        }

        // 从尾部提取标签内容
        const extractedContent = extractTagContentFromEnd(content, tagName);
        if (!extractedContent) {
            showToast(`未找到 <${tagName}> 标签内容`, 'warning');
            return false;
        }

        content = extractedContent;

        const charName = getCurrentCharacterName();
        if (!charName) {
            showToast('未找到当前角色', 'warning');
            return false;
        }

        const bookName = `${charName}-剧情指导`;
        console.log('[Outline Inject] 开始注入，世界书名称:', bookName);

        const api = getPlotAPI();
        if (!api || typeof api.getLorebookEntries !== 'function') {
            showToast('API不可用', 'error');
            return false;
        }

        try {
            const entries = await api.getLorebookEntries(bookName);
            const plotEntries = getPlotEntries(entries);

            console.log('[Outline Inject] 现有剧情条目数:', plotEntries.length);

            if (plotEntries.length === 0) {
                // 无条目，创建首个
                console.log('[Outline Inject] 无条目，创建首个');
                await api.createLorebookEntries(bookName, [{
                    comment: CONFIG.entryCommentBase,
                    content: content,
                    keys: [],
                    enabled: true,
                    disable: false,
                    type: 'constant',
                    position: 4,
                    order: CONFIG.entryOrder,
                    depth: CONFIG.entryDepth,
                    prevent_recursion: true,
                }]);
                await linkWorldbookToCurrentCharacter(bookName);
                showToast('已创建剧情指导', 'success');
                return true;
            }

            // 询问用户操作方式
            const choice = await showThreeChoiceDialog(
                '注入剧情大纲',
                `世界书「${bookName}」已有 ${plotEntries.length} 个剧情条目\n请选择操作方式`,
                '新建条目',
                '覆盖最新',
                '取消'
            );

            if (choice === 'cancel') {
                return false;
            }

            if (choice === 'overwrite') {
                // 覆盖最新条目
                const latest = plotEntries[plotEntries.length - 1];
                latest.content = content;
                await api.setLorebookEntries(bookName, [latest]);
                console.log('[Outline Inject] ✅ 已覆盖条目:', latest.comment);
                showToast('已覆盖「' + latest.comment + '」', 'success');
                return true;
            }

            // 新建条目
            const newNum = plotEntries.length + 1;
            const newComment = CONFIG.entryCommentBase + newNum;

            // 禁用旧条目
            const disableUpdates = plotEntries.map(e => ({
                ...e,
                enabled: false,
                disable: true,
            }));
            await api.setLorebookEntries(bookName, disableUpdates);

            // 创建新条目
            await api.createLorebookEntries(bookName, [{
                comment: newComment,
                content: content,
                keys: [],
                enabled: true,
                disable: false,
                type: 'constant',
                position: 4,
                order: CONFIG.entryOrder,
                depth: CONFIG.entryDepth,
                prevent_recursion: true,
            }]);
            console.log('[Outline Inject] ✅ 已创建新条目:', newComment);
            showToast('已创建新条目「' + newComment + '」并禁用旧条目', 'success');
            return true;

        } catch (e) {
            console.error('[Outline Inject] 操作失败:', e.message);

            // 如果是世界书不存在的错误，尝试创建
            if (e.message && e.message.includes('未能找到世界书')) {
                console.log('[Outline Inject] 世界书不存在，尝试创建:', bookName);
                try {
                    // 先创建世界书
                    if (typeof api.createLorebook === 'function') {
                        await api.createLorebook(bookName);
                        console.log('[Outline Inject] 世界书创建成功:', bookName);
                    }
                    // 再创建条目
                    await api.createLorebookEntries(bookName, [{
                        comment: CONFIG.entryCommentBase,
                        content: content,
                        keys: [],
                        enabled: true,
                        disable: false,
                        type: 'constant',
                        position: 4,
                        order: CONFIG.entryOrder,
                        depth: CONFIG.entryDepth,
                        prevent_recursion: true,
                    }]);
                    await linkWorldbookToCurrentCharacter(bookName);
                    showToast(`已创建世界书「${bookName}」并添加剧情指导`, 'success');
                    return true;
                } catch (createError) {
                    console.error('[Outline Inject] 创建失败:', createError.message);
                    showToast('创建失败: ' + createError.message, 'error');
                    return false;
                }
            }

            showToast('操作失败: ' + e.message, 'error');
            return false;
        }
    }

    // 显示提示
    function showToast(message, type = 'success') {
        if (window.toastr) {
            window.toastr[type](message);
            return;
        }

        const colors = {
            success: 'rgba(74, 222, 128, 0.9)',
            warning: 'rgba(251, 191, 36, 0.9)',
            error: 'rgba(239, 68, 68, 0.9)'
        };

        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${colors[type]};
            color: ${type === 'warning' ? '#000' : '#fff'};
            border-radius: 8px;
            z-index: 10001;
            font-size: 14px;
            max-width: 300px;
            white-space: pre-line;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // 添加对话框样式
    function addDialogStyles() {
        if (document.getElementById('so-dialog-styles')) return;

        const style = document.createElement('style');
        style.id = 'so-dialog-styles';
        style.textContent = `
            .so-dialog-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }

            .so-dialog {
                background: var(--SmartThemeBlurTintColor, #1a1a1a);
                border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
                border-radius: 12px;
                padding: 20px;
                min-width: 400px;
                max-width: 500px;
            }

            .so-dialog-header h3 {
                margin: 0 0 16px 0;
                font-size: 1.2em;
            }

            .so-dialog-body {
                margin-bottom: 20px;
                line-height: 1.5;
                white-space: pre-line;
            }

            .so-dialog-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }

            .so-dialog-btn {
                padding: 8px 16px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                cursor: pointer;
                font-family: inherit;
                font-size: 0.9em;
                transition: all 0.2s;
            }

            .so-dialog-btn-primary {
                background: rgba(74, 222, 128, 0.2);
                color: #4ade80;
                border-color: #4ade80;
            }

            .so-dialog-btn-primary:hover {
                background: rgba(74, 222, 128, 0.3);
            }

            .so-dialog-btn-secondary {
                background: rgba(59, 130, 246, 0.2);
                color: #3b82f6;
                border-color: #3b82f6;
            }

            .so-dialog-btn-secondary:hover {
                background: rgba(59, 130, 246, 0.3);
            }

            .so-dialog-btn-cancel {
                background: rgba(255, 255, 255, 0.1);
                color: var(--SmartThemeBodyColor, #e6e6e6);
            }

            .so-dialog-btn-cancel:hover {
                background: rgba(255, 255, 255, 0.15);
            }
        `;
        document.head.appendChild(style);
    }

    // 初始化
    addDialogStyles();

    window.StoryOraclePatch = window.StoryOraclePatch || {};
    window.StoryOraclePatch.injectOutlineToWorldInfo = injectOutlineToWorldInfo;
    window.StoryOraclePatch.supplementTags = supplementTags;
})();
