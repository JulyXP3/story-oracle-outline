/**
 * 设置面板优化模块
 */
(function () {
    'use strict';

    function improveSettingsPanel() {
        const win = document.getElementById('so-window');
        if (!win) return false;

        const settingsPanel = win.querySelector('#so-settings');
        if (!settingsPanel) return false;

        // 添加样式：设置面板铺满主面板
        const style = document.createElement('style');
        style.textContent = `
            #so-settings.open {
                max-height: 100% !important;
                flex: 1 1 auto !important;
            }
        `;
        document.head.appendChild(style);

        // 为所有模式按钮添加点击时自动关闭设置
        const modeButtons = [
            '#so-diagnose-btn',
            '#so-lorebook-btn',
            '#so-advisor-btn',
            '#so-fix-btn',
            '#so-normalchat-btn',
        ];

        modeButtons.forEach((selector) => {
            const btn = win.querySelector(selector);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (settingsPanel.classList.contains('open')) {
                        settingsPanel.classList.remove('open');
                        win.classList.remove('so-settings-open');
                    }
                });
            }
        });

        console.log('[Story Oracle Patch] 设置面板已优化');
        return true;
    }

    window.StoryOraclePatch = window.StoryOraclePatch || {};
    window.StoryOraclePatch.improveSettingsPanel = improveSettingsPanel;
})();
