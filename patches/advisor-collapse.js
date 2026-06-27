/**
 * 参谋设置折叠模块
 */
(function () {
    'use strict';

    function applyAdvBarPatch() {
        const advBar = document.getElementById('so-adv-bar');
        if (!advBar || advBar.querySelector('.so-mode-collapse')) {
            return false;
        }

        const children = Array.from(advBar.children);

        const details = document.createElement('details');
        details.className = 'so-mode-collapse';
        details.id = 'so-adv-collapse';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'so-mode-collapse-sum';
        summary.innerHTML = '<i class="fa-solid fa-compass"></i><span>参谋设置</span>';

        const body = document.createElement('div');
        body.className = 'so-mode-collapse-body';

        children.forEach((child) => body.appendChild(child));
        details.appendChild(summary);
        details.appendChild(body);
        advBar.innerHTML = '';
        advBar.appendChild(details);

        console.log('[Story Oracle Patch] 参谋设置折叠已应用');
        return true;
    }

    window.StoryOraclePatch = window.StoryOraclePatch || {};
    window.StoryOraclePatch.applyAdvBarPatch = applyAdvBarPatch;
})();
