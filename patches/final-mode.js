/**
 * 最终模式补丁 —— 在"设置-连接模式"下添加"最终模式"
 * 特性：
 *   - 不会自动修改用户输入的 URL（不追加 /v1/chat/completions）
 *   - 始终经酒馆服务器转发请求（自动避免浏览器 CORS）
 *   - 与直连模式各自保存独立的 URL / 密钥 / 模型
 *   - 与所有模式共用"连接预设"功能
 *
 * 核心原则：不修改 index.js 和 style.css
 */
(function () {
  "use strict";

  const STORAGE_KEY = "so_final_mode_fields";

  // 从 localStorage 加载最终模式专属字段
  function getFinalFields() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveFinalFields(fs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fs));
    } catch (e) {
      console.warn("[Story Oracle Patch] 保存最终模式字段失败:", e);
    }
  }

  // ──────── 判断是否为最终模式 ────────
  function isFinalMode() {
    try {
      const s = typeof getSettings === "function" ? getSettings() : {};
      return !!s._useFinalMode;
    } catch (e) {
      return false;
    }
  }

  // ──────── 获取当前模式对应的字段元素 ────────
  function getFinalFieldEls() {
    return {
      endpointEl: document.getElementById("so-endpoint-final"),
      apikeyEl: document.getElementById("so-apikey-final"),
      modelEl: document.getElementById("so-model-final"),
    };
  }

  function getDirectFieldEls() {
    return {
      endpointEl: document.getElementById("so-endpoint"),
      apikeyEl: document.getElementById("so-apikey"),
      modelEl: document.getElementById("so-model"),
    };
  }

  // ──────── 同步最终模式字段值到 s.endpoint / s.apiKey / s.model ────────
  function syncFinalFieldsToSettings() {
    const s = getSettings();
    const ff = getFinalFields();
    const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();

    const endpoint = endpointEl ? endpointEl.value : ff.endpoint || "";
    const apiKey = apikeyEl ? apikeyEl.value : ff.apiKey || "";
    const model = modelEl ? modelEl.value : ff.model || "";

    s.endpoint = endpoint;
    s.apiKey = apiKey;
    s.model = model;
    return { endpoint, apiKey, model };
  }

  // ──────── 从设置同步到最终模式字段 UI ────────
  function syncSettingsToFinalFields() {
    const ff = getFinalFields();
    const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
    if (endpointEl) endpointEl.value = ff.endpoint || "";
    if (apikeyEl) apikeyEl.value = ff.apiKey || "";
    if (modelEl) modelEl.value = ff.model || "";
  }

  // ──────── 模式切换：进入最终模式 ────────
  function enterFinalMode() {
    const s = getSettings();
    const {
      endpointEl: dEp,
      apikeyEl: dKey,
      modelEl: dModel,
    } = getDirectFieldEls();

    // 备份当前直连字段
    const ff = getFinalFields();
    ff._backup_direct_endpoint = dEp ? dEp.value : "";
    ff._backup_direct_apikey = dKey ? dKey.value : "";
    ff._backup_direct_model = dModel ? dModel.value : "";
    ff._backup_direct_via_backend = s.directViaBackend;
    saveFinalFields(ff);

    // 把最终模式的字段值写入 s
    s.endpoint = ff.endpoint || "";
    s.apiKey = ff.apiKey || "";
    s.model = ff.model || "";
    s._useFinalMode = true;
    s.mode = "direct"; // 内部用 direct 走通所有代码路径
    s.directViaBackend = true; // 强制经酒馆后端转发

    // 更新直连字段 UI（显示备份值以便切换回来时参考）
    if (dEp) dEp.value = ff._backup_direct_endpoint || "";
    if (dKey) dKey.value = ff._backup_direct_apikey || "";
    if (dModel) dModel.value = ff._backup_direct_model || "";

    // 更新最终字段 UI
    syncSettingsToFinalFields();
  }

  // ──────── 模式切换：退出最终模式 ────────
  function exitFinalMode() {
    const s = getSettings();
    const ff = getFinalFields();

    // 把当前 s 中的值保存到最终模式备份
    ff.endpoint = s.endpoint || "";
    ff.apiKey = s.apiKey || "";
    ff.model = s.model || "";

    // 恢复之前备份的直连字段
    s.endpoint = ff._backup_direct_endpoint || "";
    s.apiKey = ff._backup_direct_apikey || "";
    s.model = ff._backup_direct_model || "";
    s.directViaBackend =
      ff._backup_direct_via_backend !== undefined
        ? ff._backup_direct_via_backend
        : false;

    delete ff._backup_direct_endpoint;
    delete ff._backup_direct_apikey;
    delete ff._backup_direct_model;
    delete ff._backup_direct_via_backend;
    saveFinalFields(ff);

    s._useFinalMode = false;
    // s.mode 已在 bind handler 中被设置为 'direct' 或 'profile'

    // 更新直连字段 UI
    const {
      endpointEl: dEp,
      apikeyEl: dKey,
      modelEl: dModel,
    } = getDirectFieldEls();
    if (dEp) dEp.value = s.endpoint || "";
    if (dKey) dKey.value = s.apiKey || "";
    if (dModel) dModel.value = s.model || "";
  }

  // ──────── 初始化：安装所有覆盖 ────────
  function addFinalMode() {
    const win = document.getElementById("so-window");
    if (!win) {
      setTimeout(addFinalMode, 200); // 窗口可能还没创建，稍后重试
      return false;
    }

    const modeSelect = document.getElementById("so-mode");
    if (!modeSelect) {
      setTimeout(addFinalMode, 200);
      return false;
    }

    // 检查是否已安装
    if (document.getElementById("so-final-fields")) {
      return true;
    }

    // ── 1. 添加"最终模式"选项到下拉 ──
    const option = document.createElement("option");
    option.value = "final";
    option.textContent = "最终模式";
    modeSelect.appendChild(option);

    // ── 2. 添加最终模式专属字段 UI ──
    const directFields = document.getElementById("so-direct-fields");
    if (!directFields) {
      console.warn("[Story Oracle Patch] 未找到 so-direct-fields");
      return false;
    }

    const finalFields = document.createElement("div");
    finalFields.id = "so-final-fields";
    finalFields.style.display = "none";
    finalFields.innerHTML =
      '<label class="so-field"><span>端点 URL（最终模式）</span>' +
      '<input id="so-endpoint-final" type="text" placeholder="https://your-api.com/path"></label>' +
      '<label class="so-field"><span>API 密钥（最终模式）</span>' +
      '<input id="so-apikey-final" type="password" placeholder="sk-..."></label>' +
      '<label class="so-field"><span>模型（最终模式）</span>' +
      '<div class="so-model-row">' +
      '<input id="so-model-final" type="text" placeholder="model-name">' +
      '<div class="so-iconbtn" id="so-model-fetch-final" title="从服务商获取可用模型列表"><i class="fa-solid fa-cloud-arrow-down"></i></div>' +
      "</div></label>" +
      '<select id="so-model-list-final" style="display:none"></select>' +
      '<div class="so-hint" id="so-model-hint-final"></div>' +
      '<div class="so-hint" style="margin-top:6px">最终模式：请求经酒馆服务器转发（自动避免CORS）。前面两种模式都连不上时试试这个。参考酒馆询问机做出来的模式。</div>';

    directFields.parentNode.insertBefore(finalFields, directFields.nextSibling);

    // ── 3. 覆盖 applyModeVisibility ──
    // 注意：bind handler 先把 s.mode 置为 'final' 再调用本函数，然后我们的 change handler
    // 才修正 s.mode='direct'+s._useFinalMode=true。因此本函数需同时识别两种状态，
    // 且在最终模式期间完全控制可见性（不让原函数把直连字段重新显示出来）。
    const origApplyModeVisibility = window.applyModeVisibility;
    window.applyModeVisibility = function () {
      const s = typeof getSettings === "function" ? getSettings() : {};
      // 最终模式的两种标志：已经正式进入 (_useFinalMode) 或 bind handler 刚写到 mode 尚未修正
      const isFinal = s._useFinalMode || s.mode === "final";

      if (isFinal) {
        // 最终模式：我们完全控制可见性
        const df = document.getElementById("so-direct-fields");
        const ff = document.getElementById("so-final-fields");
        const pf = document.getElementById("so-profile-fields");
        if (df) df.style.display = "none";
        if (ff) ff.style.display = "";
        if (pf) pf.style.display = "none";
        return;
      }

      // 非最终模式：先隐藏最终字段，再委托原函数处理直连 / profile 的显示
      const ff = document.getElementById("so-final-fields");
      if (ff) ff.style.display = "none";
      if (origApplyModeVisibility) origApplyModeVisibility();
    };

    // ── 4. 覆盖 updateBadge ──
    const origUpdateBadge = window.updateBadge;
    window.updateBadge = function () {
      const s = typeof getSettings === "function" ? getSettings() : {};
      const isFinal = !!(s._useFinalMode || s.mode === "final");
      if (isFinal) {
        const badge = document.querySelector("#so-mode-badge");
        if (badge) badge.textContent = `· ${s.model || "未设置模型"} (最终)`;
        return;
      }
      if (origUpdateBadge) origUpdateBadge();
    };

    // ── 5. 覆盖 normalizeUrl —— 最终模式不改 URL ──
    const origNormalizeUrl = window.normalizeUrl;
    window.normalizeUrl = function (u) {
      if (isFinalMode()) {
        return (u || "").trim().replace(/\/+$/, "");
      }
      return origNormalizeUrl(u);
    };

    // ── 6. 覆盖 modelsUrl —— 最终模式不改 URL ──
    const origModelsUrl = window.modelsUrl;
    window.modelsUrl = function (u) {
      if (isFinalMode()) {
        u = (u || "").trim().replace(/\/+$/, "");
        if (!u) return u;
        if (/\/models$/.test(u)) return u;
        return u + "/models";
      }
      return origModelsUrl(u);
    };

    // ── 7. 覆盖 callDirect —— 最终模式强制走后端转发 ──
    const origCallDirect = window.callDirect;
    window.callDirect = async function (url, apiKey, body, signal) {
      if (isFinalMode()) {
        if (typeof callBackendForward !== "function") {
          throw new Error(
            "此 SillyTavern 版本缺少 ChatCompletionService，无法使用最终模式。",
          );
        }
        return callBackendForward(url, apiKey, body, signal);
      }
      return origCallDirect(url, apiKey, body, signal);
    };

    // ── 8. 覆盖 streamDirect ──
    const origStreamDirect = window.streamDirect;
    window.streamDirect = async function (url, apiKey, body, signal, onDelta) {
      if (isFinalMode()) {
        if (typeof streamBackendForward !== "function") {
          throw new Error(
            "此 SillyTavern 版本缺少 ChatCompletionService，无法使用最终模式。",
          );
        }
        return streamBackendForward(url, apiKey, body, signal, onDelta);
      }
      return origStreamDirect(url, apiKey, body, signal, onDelta);
    };

    // ── 9. 覆盖 streamDirectArc ──
    const origStreamDirectArc = window.streamDirectArc;
    window.streamDirectArc = async function (
      url,
      apiKey,
      body,
      signal,
      onLive,
    ) {
      if (isFinalMode()) {
        if (typeof streamBackendForwardArc !== "function") {
          throw new Error(
            "此 SillyTavern 版本缺少 ChatCompletionService，无法使用最终模式。",
          );
        }
        return streamBackendForwardArc(url, apiKey, body, signal, onLive);
      }
      return origStreamDirectArc(url, apiKey, body, signal, onLive);
    };

    // ── 10. 覆盖 loadSettingsIntoForm —— 恢复最终模式状态 ──
    const origLoadSettingsIntoForm = window.loadSettingsIntoForm;
    window.loadSettingsIntoForm = function () {
      if (origLoadSettingsIntoForm) origLoadSettingsIntoForm();
      const s = typeof getSettings === "function" ? getSettings() : {};
      const ms = document.getElementById("so-mode");
      if (s._useFinalMode) {
        if (ms) ms.value = "final";
        syncSettingsToFinalFields();
        if (typeof applyModeVisibility === "function") applyModeVisibility();
      } else if (ms) {
        // 确保非最终模式时下拉显示正确值
        ms.value = s.mode || "direct";
      }
    };

    // ── 11. 覆盖 onFetchModels —— 最终模式走后端获取模型列表 ──
    const origOnFetchModels = window.onFetchModels;
    window.onFetchModels = async function () {
      const s = typeof getSettings === "function" ? getSettings() : {};
      if (s._useFinalMode) {
        // 使用最终模式专属元素
        const hint = document.querySelector("#so-model-hint-final");
        const sel = document.querySelector("#so-model-list-final");
        const btn = document.querySelector("#so-model-fetch-final");

        if (!s.endpoint) {
          if (hint) {
            hint.textContent = "请先填写端点 URL。";
            hint.classList.add("so-hint-error");
          }
          return;
        }
        if (hint) {
          hint.classList.remove("so-hint-error");
          hint.textContent = "正在加载模型…";
        }
        if (btn) btn.classList.add("so-busy");

        try {
          const signal =
            typeof AbortSignal !== "undefined" && AbortSignal.timeout
              ? AbortSignal.timeout(20000)
              : undefined;
          const data = await fetchModelsViaBackend(
            s.endpoint,
            s.apiKey,
            signal,
          );
          let list = Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data)
              ? data
              : Array.isArray(data?.models)
                ? data.models
                : [];
          const ids = [
            ...new Set(
              list
                .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
                .filter(Boolean),
            ),
          ].sort((a, b) => a.localeCompare(b));

          if (!ids.length) {
            if (hint) {
              hint.textContent = "服务商未返回任何模型。";
            }
            if (sel) sel.style.display = "none";
            return;
          }
          if (sel) {
            sel.innerHTML = "";
            const ph = document.createElement("option");
            ph.value = "";
            ph.textContent = `— 选择一个模型（共 ${ids.length} 个）—`;
            sel.appendChild(ph);
            for (const id of ids) {
              const opt = document.createElement("option");
              opt.value = id;
              opt.textContent = id;
              sel.appendChild(opt);
            }
            if (s.model && ids.includes(s.model)) sel.value = s.model;
            sel.style.display = "";
          }
          if (hint)
            hint.textContent = `共 ${ids.length} 个模型 —— 选择其一，或继续输入自定义名称。`;
        } catch (err) {
          const aborted =
            err?.name === "TimeoutError" || err?.name === "AbortError";
          if (hint) {
            hint.textContent = aborted
              ? "请求超时。"
              : `获取模型失败：${err?.message || err}`;
            hint.classList.add("so-hint-error");
          }
          if (sel) sel.style.display = "none";
          console.error("[Story Oracle · 最终模式] 模型获取失败:", err);
        } finally {
          if (btn) btn.classList.remove("so-busy");
        }
        return;
      }
      if (origOnFetchModels) return origOnFetchModels();
    };

    // ── 12. 监听模式切换——交换字段 ──
    modeSelect.addEventListener("change", function () {
      const s = typeof getSettings === "function" ? getSettings() : {};
      const val = modeSelect.value;

      if (val === "final" && !s._useFinalMode) {
        // 切到最终模式
        enterFinalMode();
        modeSelect.value = "final"; // 恢复下拉显示
        if (typeof applyModeVisibility === "function") applyModeVisibility();
        if (typeof updateBadge === "function") updateBadge();
        if (typeof updatePresetVisibility === "function")
          updatePresetVisibility();
        if (typeof save === "function") save();
      } else if (val !== "final" && s._useFinalMode) {
        // 从最终模式切出
        exitFinalMode();
        if (typeof applyModeVisibility === "function") applyModeVisibility();
        if (typeof updateBadge === "function") updateBadge();
        if (typeof updatePresetVisibility === "function")
          updatePresetVisibility();
        if (typeof save === "function") save();
      }
    });

    // ── 13. 绑定最终模式字段的实时保存 ──
    function bindFinalField(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        const s = typeof getSettings === "function" ? getSettings() : {};
        if (!s._useFinalMode) return;
        // 把值同步到 s
        const ff = getFinalFields();
        const { endpointEl, apikeyEl, modelEl } = getFinalFieldEls();
        ff.endpoint = endpointEl ? endpointEl.value : "";
        ff.apiKey = apikeyEl ? apikeyEl.value : "";
        ff.model = modelEl ? modelEl.value : "";
        saveFinalFields(ff);

        syncFinalFieldsToSettings();
        if (typeof updateBadge === "function") updateBadge();
        if (typeof save === "function") save();
      });
    }
    bindFinalField("so-endpoint-final");
    bindFinalField("so-apikey-final");
    bindFinalField("so-model-final");

    // ── 13b. 最终模式专属：模型获取按钮 + 下拉列表事件 ──
    const fetchBtnFinal = document.getElementById("so-model-fetch-final");
    if (fetchBtnFinal) {
      fetchBtnFinal.addEventListener("click", function () {
        if (typeof onFetchModels === "function") onFetchModels();
      });
    }
    const modelListFinal = document.getElementById("so-model-list-final");
    if (modelListFinal) {
      modelListFinal.addEventListener("change", function (e) {
        const val = e.target.value;
        if (!val) return;
        const s = typeof getSettings === "function" ? getSettings() : {};
        const input = document.getElementById("so-model-final");
        if (input) {
          input.value = val;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        s.model = val;
        if (typeof updateBadge === "function") updateBadge();
        if (typeof save === "function") save();
      });
    }

    // ── 14. 初始化状态恢复 ──
    const s = typeof getSettings === "function" ? getSettings() : {};
    if (s._useFinalMode) {
      // 页面刚加载 → 恢复最终模式 UI 状态
      const ms = document.getElementById("so-mode");
      if (ms) ms.value = "final";
      syncSettingsToFinalFields();
      // 确保内部状态一致
      s.mode = "direct";
      s.directViaBackend = true;
      if (typeof applyModeVisibility === "function") {
        setTimeout(function () {
          applyModeVisibility();
        }, 50);
      }
      if (typeof updateBadge === "function") {
        setTimeout(function () {
          updateBadge();
        }, 50);
      }
    }

    console.log("[Story Oracle Patch] 最终模式已启用");
    return true;
  }

  // 导出
  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.addFinalMode = addFinalMode;
})();
