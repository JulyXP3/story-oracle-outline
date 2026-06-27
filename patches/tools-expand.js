/**
 * 工具按钮展开模块
 */
(function () {
    'use strict';

    function moveToolsToHeader() {
        const toolsWrap = document.querySelector('.so-tools-wrap');
        const toolsMenu = document.getElementById('so-tools-menu');
        const headerBtns = document.getElementById('so-header-btns');

        if (!toolsWrap || !toolsMenu || !headerBtns) return false;

        const buttons = toolsMenu.querySelectorAll('.so-tools-item');
        const firstDivider = headerBtns.querySelector('.so-hdr-div');

        buttons.forEach((btn) => {
            btn.classList.remove('so-tools-item');
            btn.querySelector('span').remove();
            headerBtns.insertBefore(btn, firstDivider);
        });

        toolsWrap.remove();

        console.log('[Story Oracle Patch] 工具按钮已移至标题栏');
        return true;
    }

    window.StoryOraclePatch = window.StoryOraclePatch || {};
    window.StoryOraclePatch.moveToolsToHeader = moveToolsToHeader;
})();
