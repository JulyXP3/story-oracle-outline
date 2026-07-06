/**
 * 连接预设管理模块（仅用于直连模式）
 */
(function () {
  "use strict";

  const STORAGE_KEY = "so_connection_presets";

  function addConnectionPresets() {
    const win = document.getElementById("so-window");
    if (!win) {
      console.warn("[Story Oracle Patch] 未找到 so-window");
      return false;
    }

    const settingsPanel = win.querySelector("#so-settings");
    if (!settingsPanel) {
      console.warn("[Story Oracle Patch] 未找到 so-settings");
      return false;
    }

    // 检查是否已添加
    if (document.getElementById("so-preset-container")) {
      return true;
    }

    // 查找"连接"折叠区域
    const collapses = settingsPanel.querySelectorAll(
      ".so-settings-collapse, details",
    );

    let connCollapse = null;
    for (const collapse of collapses) {
      const summary = collapse.querySelector("summary");
      if (summary?.textContent.includes("连接")) {
        connCollapse = collapse;
        break;
      }
    }

    if (!connCollapse) {
      console.warn('[Story Oracle Patch] 未找到"连接"设置区域');
      return false;
    }

    const collapseBody = connCollapse.querySelector(".so-set-body");
    if (!collapseBody) {
      console.warn("[Story Oracle Patch] 未找到 .so-set-body 容器");
      return false;
    }

    // 创建预设管理容器 —— 参考 so-fix-bundle-row 和 so-fix-run-btn 的样式
    const presetContainer = document.createElement("div");
    presetContainer.id = "so-preset-container";
    presetContainer.style.cssText = "margin-top: 4px; display: none;";

    const label = document.createElement("div");
    label.style.cssText =
      "margin-bottom: 6px; font-weight: bold; font-size: 0.85em; opacity: 0.9;";
    label.textContent = "连接预设";

    // 下拉框（独占一行）
    const select = document.createElement("select");
    select.id = "so-preset-list";
    select.title = "已保存的连接预设";
    select.style.cssText = "width: 100%; margin-bottom: 6px;";
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "（暂无已存预设）";
    select.appendChild(emptyOpt);

    // 按钮行：三个按钮均分整行
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 6px;";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.id = "so-preset-load";
    loadBtn.className = "so-fix-run-btn";
    loadBtn.style.cssText = "flex: 1; margin-top: 0; text-align: center;";
    loadBtn.textContent = "加载";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.id = "so-preset-save";
    saveBtn.className = "so-fix-run-btn";
    saveBtn.style.cssText = "flex: 1; margin-top: 0; text-align: center;";
    saveBtn.textContent = "保存";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.id = "so-preset-delete";
    deleteBtn.className = "so-fix-run-btn";
    deleteBtn.style.cssText = "flex: 1; margin-top: 0; text-align: center;";
    deleteBtn.textContent = "删除";

    btnRow.appendChild(loadBtn);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(deleteBtn);

    const hint = document.createElement("div");
    hint.className = "so-hint";
    hint.style.marginTop = "4px";
    hint.textContent =
      "保存当前连接配置（URL / 密钥 / 模型）为预设，方便快速切换。所有连接模式均可用。";

    presetContainer.appendChild(label);
    presetContainer.appendChild(select);
    presetContainer.appendChild(btnRow);
    presetContainer.appendChild(hint);

    collapseBody.appendChild(presetContainer);

    initPresetHandlers();
    updatePresetVisibility();

    console.log("[Story Oracle Patch] 连接预设管理已启用");
    return true;
  }

  // 初始化事件处理器
  function initPresetHandlers() {
    const modeSelect = document.getElementById("so-mode");
    const loadBtn = document.getElementById("so-preset-load");
    const saveBtn = document.getElementById("so-preset-save");
    const deleteBtn = document.getElementById("so-preset-delete");

    if (!modeSelect || !loadBtn || !saveBtn || !deleteBtn) return;

    // 监听连接模式切换
    modeSelect.addEventListener("change", updatePresetVisibility);

    // 加载预设
    loadBtn.addEventListener("click", () => {
      const presetList = document.getElementById("so-preset-list");
      const selectedName = presetList?.value;
      if (!selectedName) {
        alert("请先选择一个预设");
        return;
      }
      loadPreset(selectedName);
    });

    // 保存预设
    saveBtn.addEventListener("click", () => {
      const name = prompt("请输入预设名称：");
      if (!name || !name.trim()) return;
      savePreset(name.trim());
    });

    // 删除预设
    deleteBtn.addEventListener("click", () => {
      const presetList = document.getElementById("so-preset-list");
      const selectedName = presetList?.value;
      if (!selectedName) {
        alert("请先选择一个预设");
        return;
      }
      if (confirm(`确定要删除预设"${selectedName}"吗？`)) {
        deletePreset(selectedName);
      }
    });

    // 初始加载预设列表
    updatePresetList();
  }

  // 更新预设UI可见性（仅限直连模式和最终模式——配置文件模式不需要）
  function updatePresetVisibility() {
    const presetContainer = document.getElementById("so-preset-container");
    if (!presetContainer) return;

    const modeSelect = document.getElementById("so-mode");
    const modeVal = modeSelect ? modeSelect.value : "";
    // 直连模式 或 最终模式（含下拉显示值和内部标志）
    const s = (typeof getSettings === "function") ? getSettings() : {};
    const isDirectOrFinal = modeVal === "direct" || modeVal === "final" || !!s._useFinalMode;
    presetContainer.style.display = isDirectOrFinal ? "block" : "none";
  }

  // 从 localStorage 加载预设（防御：确保返回纯对象，拒绝数组 / 非对象值）
  function loadPresetsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return {};
      const parsed = JSON.parse(data);
      // 确保是纯对象 { name: { endpoint, apikey, model } }，而不是数组或其他类型
      if (
        Array.isArray(parsed) ||
        typeof parsed !== "object" ||
        parsed === null
      ) {
        // 旧数据格式不正确，重置为空对象
        console.warn(
          "[Story Oracle Patch] 预设数据格式异常（应为对象），已重置。旧数据:",
          data,
        );
        return {};
      }
      return parsed;
    } catch (e) {
      console.error("[Story Oracle Patch] 加载预设失败:", e);
      return {};
    }
  }

  // 保存预设到 localStorage
  function savePresetsToStorage(presets) {
    try {
      // 防御：只保存纯对象（非数组）
      if (
        Array.isArray(presets) ||
        typeof presets !== "object" ||
        presets === null
      ) {
        console.warn("[Story Oracle Patch] 拒绝保存非对象格式的预设数据");
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
      console.error("[Story Oracle Patch] 保存预设失败:", e);
    }
  }

  // 获取当前实际使用的字段 ID（根据当前模式 / 最终模式）
  function getActiveFieldIds() {
    const s = (typeof getSettings === "function") ? getSettings() : {};
    const isFinal = s._useFinalMode || (document.getElementById("so-mode")?.value === "final");
    if (isFinal) {
      return { endpointId: "so-endpoint-final", apikeyId: "so-apikey-final", modelId: "so-model-final" };
    }
    // direct 或 profile 模式 —— profile 没有 endpoint/apikey/model 字段，但至少保存当前有的
    return { endpointId: "so-endpoint", apikeyId: "so-apikey", modelId: "so-model" };
  }

  // 保存当前配置为预设
  function savePreset(name) {
    const ids = getActiveFieldIds();
    const endpoint = document.getElementById(ids.endpointId)?.value || "";
    const apikey = document.getElementById(ids.apikeyId)?.value || "";
    const model = document.getElementById(ids.modelId)?.value || "";

    if (!endpoint && !apikey && !model) {
      alert("当前配置为空，无法保存");
      return;
    }

    const presets = loadPresetsFromStorage();
    presets[name] = { endpoint, apikey, model };
    savePresetsToStorage(presets);
    updatePresetList();
    // 保存后自动选中新预设
    const sel = document.getElementById("so-preset-list");
    if (sel) sel.value = name;
    alert(`预设"${name}"已保存`);
  }

  // 加载预设到表单
  function loadPreset(name) {
    const presets = loadPresetsFromStorage();
    const preset = presets[name];
    if (!preset) {
      alert("预设不存在");
      return;
    }

    const ids = getActiveFieldIds();
    const endpointEl = document.getElementById(ids.endpointId);
    const apikeyEl = document.getElementById(ids.apikeyId);
    const modelEl = document.getElementById(ids.modelId);

    if (endpointEl) {
      endpointEl.value = preset.endpoint || "";
      endpointEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (apikeyEl) {
      apikeyEl.value = preset.apikey || "";
      apikeyEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (modelEl) {
      modelEl.value = preset.model || "";
      modelEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    console.log(`[Story Oracle Patch] 已加载预设"${name}": ${preset.endpoint}`);
    alert(`已加载预设"${name}"`);
  }

  // 删除预设
  function deletePreset(name) {
    const presets = loadPresetsFromStorage();
    if (!presets[name]) {
      alert("预设不存在");
      return;
    }

    delete presets[name];
    savePresetsToStorage(presets);
    updatePresetList();
    alert(`预设"${name}"已删除`);
  }

  // 更新预设下拉列表
  function updatePresetList() {
    const presetList = document.getElementById("so-preset-list");
    if (!presetList) return;

    const presets = loadPresetsFromStorage();
    const names = Object.keys(presets).sort();

    // 清空列表
    presetList.innerHTML = "";

    if (!names.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（暂无已存预设）";
      presetList.appendChild(opt);
    } else {
      // 添加预设选项
      names.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        presetList.appendChild(opt);
      });
    }
  }

  // 导出到全局对象
  window.StoryOraclePatch = window.StoryOraclePatch || {};
  window.StoryOraclePatch.addConnectionPresets = addConnectionPresets;
})();
