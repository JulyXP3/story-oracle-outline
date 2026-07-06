// 模块：最终模式兼容层
// 作用：把旧补丁里的「最终模式」迁移为独立模块，向 Story Oracle 设置里的连接模式下拉。
//
// 当前架构：
// 1. UI / localStorage 永远保存用户填写的原始最终模式地址，例如 https://host/custom/path。
// 2. 写入 Story Oracle 本体 settings 时，把该地址临时转换为 https://host/custom/path/chat/completions。
// 3. 这样本体闭包里的 normalizeUrl 会认为 URL 已完整，不再追加 /v1/chat/completions。
// 4. 本体后端转发 buildBackendForwardPayload 会剥掉 /chat/completions，最终 custom_url 回到用户原始地址。
// 关键点：不要在最终模式里走 generateRaw/custom_api，也不要把原始地址直接写进 s.endpoint；否则会重新触发 /v1 拼接。
// 注意：StoryOracleAPI v1 本身没有连接层扩展接口，因此本模块仍是兼容补丁。
import { LOG_PREFIX } from './constants.js';

const STORAGE_KEY = 'so_final_mode_fields';
let installed = false;

function getGlobalBinding(name) {
  try {
    return (0, eval)(name);
  } catch (e) {
    return undefined;
  }
}

function setGlobalBinding(name, value) {
  try {
    window.__soFinalModeBinding = value;
    (0, eval)(name + ' = window.__soFinalModeBinding');
    return true;
  } catch (e) {
    console.warn(LOG_PREFIX + '无法改写全局绑定 ' + name + ':', e);
    return false;
  } finally {
    try { delete window.__soFinalModeBinding; } catch (e) { window.__soFinalModeBinding = undefined; }
  }
}

function getFinalFields() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveFinalFields(fields) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
  } catch (e) {
    console.warn(LOG_PREFIX + '保存最终模式字段失败:', e);
  }
}

function getSettingsSafe(api) {
  try {
    return api.context.getSettings();
  } catch (e) {
    return {};
  }
}

function isFinalMode(api) {
  const s = getSettingsSafe(api);
  return !!(s._useFinalMode || s.mode === 'final');
}

// 模型列表仍沿用旧补丁语义：原始地址 + /models，不自动补 /v1。
function finalModelsUrl(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (!u) return u;
  if (/\/models$/.test(u)) return u;
  return u + '/models';
}

// 给 Story Oracle 本体看的「哨兵 URL」。本体 normalizeUrl 只在看到 /chat/completions 时才不补 /v1；
// 后续本体 buildBackendForwardPayload 又会剥掉这个后缀，所以最终 custom_url 等于用户原始地址。
function finalEndpointForClassic(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (!u) return u;
  if (/\/chat\/completions$/.test(u)) return u;
  return u + '/chat/completions';
}

function buildBackendModelsPayload(endpoint, apiKey) {
  const customUrl = finalModelsUrl(endpoint).replace(/\/models$/, '');
  const headers = apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
  return {
    chat_completion_source: 'custom',
    custom_url: customUrl,
    custom_include_headers: JSON.stringify(headers),
  };
}

async function fetchModelsViaBackendCompat(api, endpoint, apiKey, signal) {
  const ctx = api.context.getContext();
  if (typeof ctx?.getRequestHeaders !== 'function') {
    throw new Error('此 SillyTavern 版本无法经后端转发获取模型。');
  }
  const res = await fetch('/api/backends/chat-completions/status', {
    method: 'POST',
    headers: ctx.getRequestHeaders(),
    body: JSON.stringify(buildBackendModelsPayload(endpoint, apiKey)),
    signal,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  const data = await res.json();
  if (data && data.error) throw new Error('酒馆服务器代发模型请求失败——请核对最终模式地址与密钥。');
  return data;
}

function getFinalFieldEls() {
  return {
    endpointEl: document.getElementById('so-endpoint-final'),
    apikeyEl: document.getElementById('so-apikey-final'),
    modelEl: document.getElementById('so-model-final'),
  };
}

function getDirectFieldEls() {
  return {
    endpointEl: document.getElementById('so-endpoint'),
    apikeyEl: document.getElementById('so-apikey'),
    modelEl: document.getElementById('so-model'),
  };
}

function ensureFinalPresetCompat() {
  const directFields = document.getElementById('so-direct-fields');
  if (!directFields || directFields.dataset.soFinalPresetCompat === 'true') return;
  directFields.dataset.soFinalPresetCompat = 'true';

  const keepIds = new Set(['so-conn-preset-select', 'so-conn-preset-load', 'so-conn-preset-del', 'so-conn-preset-name', 'so-conn-preset-save']);
  Array.from(directFields.children).forEach((child) => {
    child.dataset.soFinalOwnDisplay = child.style.display || '';
    if (child.querySelector && Array.from(keepIds).some((id) => child.querySelector('#' + id))) {
      child.dataset.soFinalKeep = 'true';
    }
  });
}

function setDirectFieldsVisibilityForFinal(isFinal) {
  const directFields = document.getElementById('so-direct-fields');
  if (!directFields) return;
  ensureFinalPresetCompat();
  if (isFinal) directFields.style.display = '';
  Array.from(directFields.children).forEach((child) => {
    if (isFinal) {
      child.style.display = child.dataset.soFinalKeep === 'true' ? (child.dataset.soFinalOwnDisplay || '') : 'none';
    } else {
      child.style.display = child.dataset.soFinalOwnDisplay || '';
    }
  });
}

function mirrorFinalToDirectFields() {
  const finalEls = getFinalFieldEls();
  const directEls = getDirectFieldEls();
  if (directEls.endpointEl) directEls.endpointEl.value = finalEls.endpointEl ? finalEndpointForClassic(finalEls.endpointEl.value) : '';
  if (directEls.apikeyEl) directEls.apikeyEl.value = finalEls.apikeyEl ? finalEls.apikeyEl.value : '';
  if (directEls.modelEl) directEls.modelEl.value = finalEls.modelEl ? finalEls.modelEl.value : '';
}

function saveSettings() {
  const save = getGlobalBinding('save');
  if (typeof save === 'function') save();
}

function syncFinalFieldsToSettings(api) {
  const s = getSettingsSafe(api);
  const ff = getFinalFields();
  const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
  const endpoint = endpointEl ? endpointEl.value : ff.endpoint || '';
  const apiKey = apikeyEl ? apikeyEl.value : ff.apiKey || '';
  const model = modelEl ? modelEl.value : ff.model || '';
  // settings/direct hidden field use the sentinel URL; final fields/localStorage keep the raw URL.
  s.endpoint = finalEndpointForClassic(endpoint);
  s.apiKey = apiKey;
  s.model = model;
  return { endpoint, apiKey, model };
}

function syncSettingsToFinalFields() {
  const ff = getFinalFields();
  const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
  if (endpointEl) endpointEl.value = ff.endpoint || '';
  if (apikeyEl) apikeyEl.value = ff.apiKey || '';
  if (modelEl) modelEl.value = ff.model || '';
}

function enterFinalMode(api) {
  const s = getSettingsSafe(api);
  const { endpointEl: dEp, apikeyEl: dKey, modelEl: dModel } = getDirectFieldEls();
  const ff = getFinalFields();
  ff._backup_direct_endpoint = dEp ? dEp.value : '';
  ff._backup_direct_apikey = dKey ? dKey.value : '';
  ff._backup_direct_model = dModel ? dModel.value : '';
  ff._backup_direct_via_backend = s.directViaBackend;
  saveFinalFields(ff);

  s.endpoint = finalEndpointForClassic(ff.endpoint || '');
  s.apiKey = ff.apiKey || '';
  s.model = ff.model || '';
  s._useFinalMode = true;
  s.mode = 'direct';
  s.directViaBackend = true;

  if (dEp) dEp.value = ff._backup_direct_endpoint || '';
  if (dKey) dKey.value = ff._backup_direct_apikey || '';
  if (dModel) dModel.value = ff._backup_direct_model || '';
  syncSettingsToFinalFields();
  mirrorFinalToDirectFields();
}

function exitFinalMode(api) {
  const s = getSettingsSafe(api);
  const ff = getFinalFields();
  const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
  ff.endpoint = endpointEl ? endpointEl.value : ff.endpoint || '';
  ff.apiKey = apikeyEl ? apikeyEl.value : ff.apiKey || '';
  ff.model = modelEl ? modelEl.value : ff.model || '';

  s.endpoint = ff._backup_direct_endpoint || '';
  s.apiKey = ff._backup_direct_apikey || '';
  s.model = ff._backup_direct_model || '';
  s.directViaBackend = ff._backup_direct_via_backend !== undefined ? ff._backup_direct_via_backend : false;

  delete ff._backup_direct_endpoint;
  delete ff._backup_direct_apikey;
  delete ff._backup_direct_model;
  delete ff._backup_direct_via_backend;
  saveFinalFields(ff);
  s._useFinalMode = false;

  const { endpointEl: dEp, apikeyEl: dKey, modelEl: dModel } = getDirectFieldEls();
  if (dEp) dEp.value = s.endpoint || '';
  if (dKey) dKey.value = s.apiKey || '';
  if (dModel) dModel.value = s.model || '';
}

function addFinalFieldsUI(directFields) {
  const finalFields = document.createElement('div');
  finalFields.id = 'so-final-fields';
  finalFields.style.display = 'none';
  finalFields.innerHTML =
    '<label class="so-field"><span>端点 URL（最终模式）</span>' +
    '<input id="so-endpoint-final" type="text" placeholder="https://your-api.com/path"></label>' +
    '<label class="so-field"><span>API 密钥（最终模式）</span>' +
    '<input id="so-apikey-final" type="password" placeholder="sk-..."></label>' +
    '<label class="so-field"><span>模型（最终模式）</span>' +
    '<div class="so-model-row">' +
    '<input id="so-model-final" type="text" placeholder="model-name">' +
    '<div class="so-iconbtn" id="so-model-fetch-final" title="从服务商获取可用模型列表"><i class="fa-solid fa-cloud-arrow-down"></i></div>' +
    '</div></label>' +
    '<select id="so-model-list-final" style="display:none"></select>' +
    '<div class="so-hint" id="so-model-hint-final"></div>' +
    '<div class="so-hint" style="margin-top:6px">最终模式：请求经酒馆服务器转发（自动避免CORS）。前面两种模式都连不上时试试这个。参考酒馆询问机做出来的模式。</div>';
  // 插在 direct-fields 前面：
  // - direct 模式：final-fields 隐藏，direct-fields 保持原顺序（直连字段 → 连接预设）
  // - final 模式：final-fields 显示，direct-fields 只保留连接预设，所以预设自然落在最终字段下面
  // - profile 模式：主体原生逻辑隐藏 direct-fields，连接预设不显示
  directFields.parentNode.insertBefore(finalFields, directFields);
}

function installVisibilityPatch(api) {
  const origApplyModeVisibility = getGlobalBinding('applyModeVisibility');
  const patchedApplyModeVisibility = function () {
    const s = getSettingsSafe(api);
    const isFinal = s._useFinalMode || s.mode === 'final';
    if (isFinal) {
      const final = document.getElementById('so-final-fields');
      const profile = document.getElementById('so-profile-fields');
      setDirectFieldsVisibilityForFinal(true);
      mirrorFinalToDirectFields();
      if (final) final.style.display = '';
      if (profile) profile.style.display = 'none';
      return;
    }
    const final = document.getElementById('so-final-fields');
    setDirectFieldsVisibilityForFinal(false);
    if (final) final.style.display = 'none';
    if (origApplyModeVisibility) origApplyModeVisibility();
  };
  setGlobalBinding('applyModeVisibility', patchedApplyModeVisibility);
  window.applyModeVisibility = patchedApplyModeVisibility;
}

function installBadgePatch(api) {
  const origUpdateBadge = getGlobalBinding('updateBadge');
  const patchedUpdateBadge = function () {
    const s = getSettingsSafe(api);
    if (s._useFinalMode || s.mode === 'final') {
      const badge = document.querySelector('#so-mode-badge');
      if (badge) badge.textContent = '· ' + (s.model || '未设置模型') + ' (最终)';
      return;
    }
    if (origUpdateBadge) origUpdateBadge();
  };
  setGlobalBinding('updateBadge', patchedUpdateBadge);
  window.updateBadge = patchedUpdateBadge;
}

function installUrlPatches(api) {
  const origNormalizeUrl = getGlobalBinding('normalizeUrl');
  if (typeof origNormalizeUrl === 'function') {
    setGlobalBinding('normalizeUrl', function (u) {
      if (isFinalMode(api)) return (u || '').trim().replace(/\/+$/, '');
      return origNormalizeUrl(u);
    });
  }

  const origModelsUrl = getGlobalBinding('modelsUrl');
  if (typeof origModelsUrl === 'function') {
    setGlobalBinding('modelsUrl', function (u) {
      if (isFinalMode(api)) return finalModelsUrl(u);
      return origModelsUrl(u);
    });
  }
}

function installRequestPatches(api) {
  const origCallDirect = getGlobalBinding('callDirect');
  if (typeof origCallDirect === 'function') {
    setGlobalBinding('callDirect', async function (url, apiKey, body, signal) {
      if (isFinalMode(api)) {
        const fields = syncFinalFieldsToSettings(api);
        const s = getSettingsSafe(api);
        return origCallDirect(s.endpoint, fields.apiKey || apiKey, { ...body, model: fields.model || body?.model }, signal);
      }
      return origCallDirect(url, apiKey, body, signal);
    });
  }

  const origStreamDirect = getGlobalBinding('streamDirect');
  if (typeof origStreamDirect === 'function') {
    setGlobalBinding('streamDirect', async function (url, apiKey, body, signal, onDelta) {
      if (isFinalMode(api)) {
        const fields = syncFinalFieldsToSettings(api);
        const s = getSettingsSafe(api);
        return origStreamDirect(s.endpoint, fields.apiKey || apiKey, { ...body, model: fields.model || body?.model }, signal, onDelta);
      }
      return origStreamDirect(url, apiKey, body, signal, onDelta);
    });
  }

  const origStreamDirectArc = getGlobalBinding('streamDirectArc');
  if (typeof origStreamDirectArc === 'function') {
    setGlobalBinding('streamDirectArc', async function (url, apiKey, body, signal, onLive) {
      if (isFinalMode(api)) {
        const fields = syncFinalFieldsToSettings(api);
        const s = getSettingsSafe(api);
        return origStreamDirectArc(s.endpoint, fields.apiKey || apiKey, { ...body, model: fields.model || body?.model }, signal, onLive);
      }
      return origStreamDirectArc(url, apiKey, body, signal, onLive);
    });
  }
}

function installLoadSettingsPatch(api) {
  const origLoadSettingsIntoForm = getGlobalBinding('loadSettingsIntoForm');
  const patchedLoadSettingsIntoForm = function () {
    if (origLoadSettingsIntoForm) origLoadSettingsIntoForm();
    const s = getSettingsSafe(api);
    const modeSelect = document.getElementById('so-mode');
    if (s._useFinalMode) {
      if (modeSelect) modeSelect.value = 'final';
      syncSettingsToFinalFields();
      const applyModeVisibility = getGlobalBinding('applyModeVisibility');
      if (typeof applyModeVisibility === 'function') applyModeVisibility();
    } else if (modeSelect) {
      modeSelect.value = s.mode || 'direct';
    }
  };
  setGlobalBinding('loadSettingsIntoForm', patchedLoadSettingsIntoForm);
  window.loadSettingsIntoForm = patchedLoadSettingsIntoForm;
}

function installFetchModelsPatch(api) {
  const origOnFetchModels = getGlobalBinding('onFetchModels');
  const patchedOnFetchModels = async function () {
    const s = getSettingsSafe(api);
    if (!s._useFinalMode) {
      if (origOnFetchModels) return origOnFetchModels();
      return undefined;
    }

    const fields = syncFinalFieldsToSettings(api);
    const hint = document.querySelector('#so-model-hint-final');
    const sel = document.querySelector('#so-model-list-final');
    const btn = document.querySelector('#so-model-fetch-final');
    if (!fields.endpoint) {
      if (hint) {
        hint.textContent = '请先填写端点 URL。';
        hint.classList.add('so-hint-error');
      }
      return undefined;
    }
    if (hint) {
      hint.classList.remove('so-hint-error');
      hint.textContent = '正在加载模型…';
    }
    if (btn) btn.classList.add('so-busy');

    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
      const data = await fetchModelsViaBackendCompat(api, fields.endpoint, fields.apiKey, signal);
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
      const ids = [...new Set(list.map((m) => (typeof m === 'string' ? m : m?.id || m?.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (!ids.length) {
        if (hint) hint.textContent = '服务商未返回任何模型。';
        if (sel) sel.style.display = 'none';
        return undefined;
      }
      if (sel) {
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— 选择一个模型（共 ' + ids.length + ' 个）—';
        sel.appendChild(placeholder);
        for (const id of ids) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = id;
          sel.appendChild(opt);
        }
        if (fields.model && ids.includes(fields.model)) sel.value = fields.model;
        sel.style.display = '';
      }
      if (hint) hint.textContent = '共 ' + ids.length + ' 个模型 —— 选择其一，或继续输入自定义名称。';
    } catch (err) {
      const aborted = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if (hint) {
        hint.textContent = aborted ? '请求超时。' : '获取模型失败：' + (err?.message || err);
        hint.classList.add('so-hint-error');
      }
      if (sel) sel.style.display = 'none';
      console.error(LOG_PREFIX + '模型获取失败:', err);
    } finally {
      if (btn) btn.classList.remove('so-busy');
    }
    return undefined;
  };
  setGlobalBinding('onFetchModels', patchedOnFetchModels);
  window.onFetchModels = patchedOnFetchModels;
}

function bindModeSelect(api, modeSelect) {
  modeSelect.addEventListener('change', () => {
    const s = getSettingsSafe(api);
    const val = modeSelect.value;
    if (val === 'final' && !s._useFinalMode) {
      enterFinalMode(api);
      modeSelect.value = 'final';
    } else if (val !== 'final' && s._useFinalMode) {
      exitFinalMode(api);
    }
    if (typeof window.applyModeVisibility === 'function') window.applyModeVisibility();
    if (typeof window.updateBadge === 'function') window.updateBadge();
    if (typeof window.updatePresetVisibility === 'function') window.updatePresetVisibility();
    saveSettings();
  });
}

function bindFinalField(api, id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const s = getSettingsSafe(api);
    if (!s._useFinalMode) return;
    const ff = getFinalFields();
    const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
    ff.endpoint = endpointEl ? endpointEl.value : '';
    ff.apiKey = apikeyEl ? apikeyEl.value : '';
    ff.model = modelEl ? modelEl.value : '';
    saveFinalFields(ff);
    syncFinalFieldsToSettings(api);
    mirrorFinalToDirectFields();
    if (typeof window.updateBadge === 'function') window.updateBadge();
    saveSettings();
  });
}

function bindFinalModelControls(api) {
  const fetchBtn = document.getElementById('so-model-fetch-final');
  if (fetchBtn) fetchBtn.addEventListener('click', () => window.onFetchModels && window.onFetchModels());
  const modelList = document.getElementById('so-model-list-final');
  if (!modelList) return;
  modelList.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    const s = getSettingsSafe(api);
    const input = document.getElementById('so-model-final');
    if (input) {
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    s.model = val;
    if (typeof window.updateBadge === 'function') window.updateBadge();
    saveSettings();
  });
}

function restoreInitialState(api) {
  const s = getSettingsSafe(api);
  if (!s._useFinalMode) return;
  const modeSelect = document.getElementById('so-mode');
  if (modeSelect) modeSelect.value = 'final';
  syncSettingsToFinalFields();
  syncFinalFieldsToSettings(api);
  mirrorFinalToDirectFields();
  s.mode = 'direct';
  s.directViaBackend = true;
  setTimeout(() => {
    if (typeof window.applyModeVisibility === 'function') window.applyModeVisibility();
    if (typeof window.updateBadge === 'function') window.updateBadge();
  }, 50);
}

function installFinalMode(api) {
  if (installed) return true;
  const modeSelect = document.getElementById('so-mode');
  const directFields = document.getElementById('so-direct-fields');
  if (!modeSelect || !directFields) return false;
  if (document.getElementById('so-final-fields')) {
    installed = true;
    return true;
  }

  const option = document.createElement('option');
  option.value = 'final';
  option.textContent = '最终模式';
  modeSelect.appendChild(option);
  addFinalFieldsUI(directFields);

  installVisibilityPatch(api);
  installBadgePatch(api);
  installUrlPatches(api);
  installRequestPatches(api);
  installLoadSettingsPatch(api);
  installFetchModelsPatch(api);
  bindModeSelect(api, modeSelect);
  bindFinalField(api, 'so-endpoint-final');
  bindFinalField(api, 'so-apikey-final');
  bindFinalField(api, 'so-model-final');
  bindFinalModelControls(api);
  restoreInitialState(api);

  installed = true;
  console.log(LOG_PREFIX + '最终模式兼容层已启用。');
  return true;
}

export function installFinalModeCompat(api) {
  if (installFinalMode(api)) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (installFinalMode(api) || tries > 60) {
      clearInterval(timer);
      if (tries > 60 && !installed) console.warn(LOG_PREFIX + '最终模式兼容层未找到连接设置 DOM，已跳过。');
    }
  }, 500);
}
