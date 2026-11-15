// 模块：大纲菜单与楼层弹窗的展示兼容
// 不更改本体楼层规则；仅在已确认独立房间时呈现原生工具，退出撤销全部自有状态。
import { LOG_PREFIX } from './constants.js';
import { showToast } from './toast.js';

const FLOOR_DIALOG = 'dialog.so-local-dialog.so-owned-dialog.so-local-browser';
const FLOOR_BUTTONS = '#so-keepfloors-btn, #so-floors-btn';
let modeState = { generation: 0, active: false, roomReady: false };
let refreshHistory = null;

export function getOutlineModeState() { return { ...modeState }; }
export function notifyOutlineHistoryChanged() { refreshHistory?.(); }

export function createOutlineModeCompat() {
  let root = null;
  let observer = null;
  let titleObserver = null;
  let owned = null;
  let note = null;
  let blocked = false;
  let warned = false;
  const disabled = new Map();

  function isOutline() {
    return modeState.active && root?.isConnected && root.classList.contains('so-outline-on');
  }

  function dialogs() { return Array.from(document.querySelectorAll(FLOOR_DIALOG)); }

  function structure(dialog) {
    if (!dialog?.isConnected || !dialog.dataset.room) return null;
    const title = dialog.querySelector('.so-local-head .so-local-title');
    const close = dialog.querySelector('.so-local-x');
    const keep = dialog.querySelector('.so-local-tab[data-tab="keep"]');
    const browse = dialog.querySelector('.so-local-tab[data-tab="browse"]');
    return title && close && keep && browse ? { title, close, keep, browse } : null;
  }

  function warn() {
    if (warned) return;
    warned = true;
    const message = '大纲或楼层面板未能确认，已停用本次楼层工具适配，请退出大纲后重试。';
    console.warn(LOG_PREFIX + message);
    showToast(message, 'warning');
  }

  function updateButtons() {
    if (!root) return;
    const unavailable = !modeState.roomReady || blocked;
    root.dataset.soOutlineFloors = unavailable ? 'blocked' : 'ready';
    if (!unavailable) return;
    for (const button of root.querySelectorAll(FLOOR_BUTTONS)) {
      if (!disabled.has(button)) disabled.set(button, {
        aria: button.getAttribute('aria-disabled'), title: button.getAttribute('title'),
      });
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('title', '大纲或楼层面板未确认，暂不可用');
    }
  }

  function block() { blocked = true; updateButtons(); warn(); }

  function forgetDialog() {
    titleObserver?.disconnect();
    titleObserver = null;
    note?.remove();
    note = null;
    owned = null;
  }

  function renderDialog() {
    if (!isOutline() || !modeState.roomReady || blocked || !owned?.isConnected) return;
    const list = dialogs();
    const ui = structure(owned);
    if (list.length !== 1 || list[0] !== owned || owned.dataset.room !== 'outline' || !ui) {
      forgetDialog();
      block();
      return;
    }
    const keep = ui.keep.getAttribute('aria-selected') === 'true';
    const browse = ui.browse.getAttribute('aria-selected') === 'true';
    if (keep === browse) { forgetDialog(); block(); return; }
    const title = (keep ? '保留最近楼层' : '楼层浏览器') + ' · 大纲';
    if (ui.title.textContent !== title) ui.title.textContent = title;
    if (!note) {
      note = document.createElement('div');
      note.className = 'so-outline-floor-note';
      ui.title.parentNode.parentNode.insertBefore(note, ui.title.parentNode.nextSibling);
    }
    const enabled = document.getElementById('so-outline-include-all-chat')?.checked;
    const text = enabled
      ? '该功能只针对大纲对话历史，不影响酒馆故事正文和世界书大纲。'
      : '当前未附带大纲对话历史，该功能暂不生效；楼层浏览器仍可用。';
    if (note.textContent !== text) note.textContent = text;
  }

  function scanDialog() {
    if (!isOutline() || !modeState.roomReady || blocked) return;
    const list = dialogs();
    if (!list.length) { forgetDialog(); return; }
    const dialog = list[0];
    const ui = structure(dialog);
    if (list.length !== 1 || dialog.dataset.room !== 'outline' || !ui) { forgetDialog(); block(); return; }
    if (owned !== dialog) {
      forgetDialog();
      owned = dialog;
      const generation = modeState.generation;
      titleObserver = new MutationObserver(() => {
        if (modeState.generation === generation && owned === dialog) renderDialog();
      });
      titleObserver.observe(ui.title, { childList: true, characterData: true, subtree: true });
    }
    renderDialog();
  }

  function guardFloorClick(event) {
    if (!isOutline()) return;
    const target = event.target?.closest?.(FLOOR_BUTTONS);
    if (!target || !root.contains(target)) return;
    // 本体菜单是 div，disabled 属性不会阻止委托点击；只在不可用时截停，不接管正常动作。
    scanDialog();
    if (!modeState.roomReady || blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      updateButtons();
      warn();
    }
  }

  function beforeEnter() {
    const list = dialogs();
    if (!list.length) return true;
    if (list.length !== 1) return false;
    const dialog = list[0];
    const ui = structure(dialog);
    if (!ui) return false;
    if (isOutline() && modeState.roomReady && !blocked && owned === dialog && dialog.dataset.room === 'outline') return true;
    ui.close.click();
    return !dialog.isConnected;
  }

  function enter(room, canAdapt = true) {
    const nextRoot = document.getElementById('so-window');
    if (!nextRoot?.classList.contains('so-outline-on')) return;
    if (isOutline() && root === nextRoot && modeState.roomReady === (room === 'outline') && !blocked && canAdapt) {
      scanDialog();
      return;
    }
    if (root) exit();
    root = nextRoot;
    blocked = !canAdapt;
    warned = false;
    modeState = { generation: modeState.generation + 1, active: true, roomReady: room === 'outline' };
    root.dataset.soOutlineMenu = 'true';
    root.addEventListener('click', guardFloorClick, true);
    updateButtons();
    refreshHistory = renderDialog;
    if (typeof MutationObserver !== 'function') { block(); return; }
    const generation = modeState.generation;
    observer = new MutationObserver(() => { if (modeState.generation === generation) scanDialog(); });
    observer.observe(document.body, { childList: true });
    if (!modeState.roomReady || blocked) warn();
    else scanDialog();
  }

  function exit() {
    if (!root) return;
    const list = dialogs();
    if (owned && list.length === 1 && list[0] === owned && owned.dataset.room === 'outline') {
      structure(owned)?.close.click();
    }
    observer?.disconnect();
    observer = null;
    forgetDialog();
    root.removeEventListener('click', guardFloorClick, true);
    delete root.dataset.soOutlineMenu;
    delete root.dataset.soOutlineFloors;
    for (const [button, previous] of disabled) {
      if (button.getAttribute('aria-disabled') === 'true') {
        if (previous.aria === null) button.removeAttribute('aria-disabled');
        else button.setAttribute('aria-disabled', previous.aria);
      }
      if (button.getAttribute('title') === '大纲或楼层面板未确认，暂不可用') {
        if (previous.title === null) button.removeAttribute('title');
        else button.setAttribute('title', previous.title);
      }
    }
    disabled.clear();
    root = null;
    refreshHistory = null;
    modeState = { generation: modeState.generation + 1, active: false, roomReady: false };
  }

  return { beforeEnter, enter, exit };
}
