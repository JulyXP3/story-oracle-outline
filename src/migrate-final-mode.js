// 模块：旧「最终模式」状态一次性迁移
// 作用：把停留在旧最终模式的用户配置迁移到故事神谕本体 1.22.0 原生的
//       「地址原样使用（不自动补 /v1）」(settings.directRawUrl) +
//       「经酒馆后端转发」(settings.directViaBackend) 两个开关上。
//
// 背景：旧最终模式（final-mode.js，已于本次重构整层删除）把用户填的原始地址
// 存在 localStorage(so_final_mode_fields)，而在本体 settings.endpoint 里写入
// 哨兵 URL（原始地址 + /chat/completions），靠本体 normalizeUrl 看到该后缀
// 不再补 /v1、再借后端转发剥掉后缀来还原。本体 1.22.0 把这套语义原生化为
// directRawUrl 开关，所以迁移只需：把原始地址还原进 settings.endpoint、
// 打开两个开关、清掉旧标记。
//
// 幂等：只在 settings._useFinalMode 为真时执行一次，迁移完清标记，再刷新不再触发。
import { LOG_PREFIX } from './constants.js';

const LEGACY_STORAGE_KEY = 'so_final_mode_fields';

// 旧最终模式进入时会把哨兵 URL 写进 settings.endpoint（finalEndpointForClassic 产物）。
// 迁移要还原成用户当初填的裸地址——优先取 localStorage 里的原始值，没有就剥哨兵后缀兜底。
function stripSentinel(u) {
  return (u || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function readLegacyFields() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export function migrateFinalModeState(api) {
  if (!api || !api.context || typeof api.context.getSettings !== 'function') return;
  const s = api.context.getSettings();
  if (!s || !s._useFinalMode) return;

  const ff = readLegacyFields();
  // 优先用进最终模式前备份的直连原值；否则用最终模式字段；最后剥哨兵兜底。
  const endpoint =
    (ff._backup_direct_endpoint != null && ff._backup_direct_endpoint) ||
    ff.endpoint ||
    stripSentinel(s.endpoint);
  const apiKey =
    (ff._backup_direct_apikey != null && ff._backup_direct_apikey) ||
    ff.apiKey ||
    s.apiKey ||
    '';
  const model =
    (ff._backup_direct_model != null && ff._backup_direct_model) ||
    ff.model ||
    s.model ||
    '';

  s.endpoint = endpoint;
  s.apiKey = apiKey;
  s.model = model;
  s.directRawUrl = true;        // 旧最终模式核心语义：裸地址不自动补 /v1
  s.directViaBackend = true;    // 旧最终模式强制经酒馆后端转发（final-mode.js:311）
  s.mode = 'direct';            // 本体原生 mode 只认 direct/profile；旧代码靠 _useFinalMode 区分，现统一
  s._useFinalMode = false;

  // 落盘：getSettings() 返回的是 extensionSettings 引用，改字段不自动落盘；
  // ST context 自带 saveSettingsDebounced（本体注释 :1523），走正式接口，无需 unsafe.eval。
  try {
    const ctx = api.context.getContext && api.context.getContext();
    if (ctx && typeof ctx.saveSettingsDebounced === 'function') {
      ctx.saveSettingsDebounced();
    }
  } catch (e) {
    console.warn(LOG_PREFIX + '迁移后触发落盘失败（字段已改，下次本体 save 时会一并写入）:', e);
  }

  // 清掉旧 localStorage 残留
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) { /* ignore */ }

  console.log(LOG_PREFIX + '已将旧最终模式配置迁移到本体原生「地址原样使用」开关。');
}
