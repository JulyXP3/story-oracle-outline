# 故事神谕·大纲版维护文档

本文面向后续接手维护本仓库的人，说明当前插件相对《交接指南》中 Hook API 路线的符合情况、项目结构、本体与插件的边界，以及后续改动应该从哪里下手。

> **版本基线**：本文最初对应插件 1.5.0 + 故事神谕本体 1.22.0。1.5.0 删除了旧「最终模式兼容层」与「删除二次确认」两块补丁；后续为支持大纲系统提示词进入本体设置面板、发送全量大纲聊天记录、以及大纲模式独立聊天房间，重新引入少量 `api.unsafe.eval`。除 §2.3 明确列出的逃生阀外，主链路仍走 `StoryOracleAPI` 正式接口 + 本体原生开关。

---

## 1. 架构现状

本仓已经从旧的「内置故事神谕本体 + 外置补丁」迁移成「独立插件 + `window.StoryOracleAPI` Hook API」。大纲模式主链路完全符合交接指南：

- 插件入口通过 `story-oracle-ready` / `window.StoryOracleAPI` 握手。
- 大纲模式通过 `api.registerMode()` 注册。
- 大纲请求通过 `registerMode.onSend` 构造 `{ system, messages }`，不再全局拦截 `fetch`。
- 回复按钮通过 `api.addMessageAction()` 注册。
- 编辑 / 标签补充通过 `api.updateReply()` 持久化。
- Markdown 渲染、历史消息恢复、`data-so-raw` 原文保存由本体负责。

故事神谕本体 1.22.0 把旧两块补丁原生化后，本插件已整层删除并回到纯 Hook API 路线：

- **旧最终模式** → 本体直连区原生开关 `directRawUrl`（「地址原样使用（不自动补 /v1）」）+ `directViaBackend`（「经酒馆后端转发」）。连接预设原生保存 / 恢复 `rawUrl` 字段。
- **删除二次确认**（删预设 / 删消息）→ 本体 1.22.0 原生 `uiConfirm`。
- **旧用户配置迁移** → `src/migrate-final-mode.js` 启动时一次性把停留在旧最终模式的配置搬到本体原生开关上。

> 关于本体 1.22.0 新增的 `api.unsafe.eval(code)`：它是原作者提供的**非正式逃生阀**（模块作用域直接 `eval`，可读 / 改本体内部任意顶层绑定），但**不入版本契约、无兼容承诺**。日常维护仍首选正式接口；`unsafe.eval` 只在正式接口确实覆盖不到、且能接受本体更新后跟着改的风险时才考虑。**本插件已在下述场景使用它——见 §2.3。**

---

## 2. Hook 路线符合情况

交接指南的核心要求：不要依赖故事神谕本体的私有函数、闭包变量、未承诺 DOM 结构和请求链路；尽量只使用 `StoryOracleAPI` 暴露的稳定接口。

**结论：大纲主链路仍走 Hook API；少数本体设置 / 房间能力缺口走 §2.3 的 `api.unsafe.eval` 补丁。** 下方按「走 Hook API」「Hook 之外但不算违背」「unsafe.eval 逃生阀」三类列出，便于维护者快速定位。

### 2.1 走 `StoryOracleAPI` 正式接口的模块

| 模块                    | 使用的接口                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/plugin.js`         | `api.isCompatible()`、`api.registerMode()`、`api.addMessageAction()`（经 `message-actions.js`）       |
| `src/prompt.js`         | `api.context.getContext()`、`api.context.getSettings()`、`api.context.buildCardSection()`、`api.context.buildWorldInfo({ excludeBooks })`、`api.context.buildTranscript()` |
| `src/message-actions.js`| `api.addMessageAction()`、`api.updateReply()`、`data-so-raw`                                          |
| `src/ui.js`             | `registerMode.buildBar()` 给的容器（Hook API 设计允许的扩展点）                                       |
| `src/migrate-final-mode.js` | `api.context.getSettings()`、`api.context.getContext().saveSettingsDebounced()`                  |

### 2.2 Hook 之外但不算违背的依赖

这些位置没有完全走 `StoryOracleAPI`，但**不属于依赖故事神谕本体私有实现**，不算违背 Hook 路线：

| 位置                | 做法                                                                                                                       | 性质                                                                                              | 维护建议                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/outline-inject.js` | 用 TavernHelper 写入 `<角色>-剧情指导` 世界书                                                                          | SillyTavern / TavernHelper 侧能力，交接指南已明确该文件与故事神谕本体无关                          | 保留。TavernHelper API 变化时再跟进                                                                                  |
| `src/prompt.js`      | 调 `api.context.buildWorldInfo({ excludeBooks })` 后，仍用 `ctx.loadWorldInfo` / `TavernHelper.getLorebookEntries` 兜底剔除「剧情指导」 | 外部依赖（ST / TavernHelper）+ 双保险逻辑，**不是**本体私有函数依赖                                | 可保留。它解决不同环境里 `excludeBooks` 可能未完全剔除的兼容问题。若确认本体 1.21+ 的 `excludeBooks` 稳定可靠，可简化掉兜底剔除 |
| `src/templates.js`   | 用 localStorage 保存大纲模板                                                                                               | 插件自有状态，不依赖本体                                                                           | 保留                                                                                                                  |

### 2.3 `api.unsafe.eval` 逃生阀使用记录

以下功能因 Hook API v1 未覆盖对应能力，走 `api.unsafe.eval` 直接操作本体模块作用域。**本体更新后这些调用可能失效，维护时优先关注此处。**

| 功能                  | 位置              | unsafe.eval 操作                                                                                                                                               | 替代方案（如果 Hook API 未来支持）                                                        | 失效后果                         |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| 大纲系统提示词注入设置面板 | `src/plugin.js` `injectOutlineSysPrompt()` | 向本体 `SYSPROMPT_MODES` 数组 push `{ id:'outline', key:'outlineSystemPrompt', ... }`；设 `defaults.outlineSystemPrompt = ''`；往 `#so-sysprompt-which` 下拉框补选项 | Hook API 新增 `api.registerSysPromptMode(id, label, builtin)`                             | 设置面板下拉框无"大纲"选项，用户无法在设置里编辑大纲提示词。插件退化为只使用内置默认提示词 |
| 发送全量大纲聊天记录 | `src/prompt.js` `buildMessages()` | 当用户勾选"发送全量大纲聊天记录"时，读本体模块作用域的 `convo` 数组，过滤 `user`/`assistant` 轮次，排除最新一条（即当前输入），拼入 `messages` | Hook API 新增 `api.getConversation()` 或 `registerMode` 支持 `historyMode: true`（本体已预留字段但未实现） | 勾选框无效，相当于没勾，退化为只发当前 user 消息 |
| 大纲模式独立聊天房间 | `src/plugin.js` `injectOutlineModeRoom()` / `syncOutlineModeRoom()` | 包装本体 `convoStreamKeyForMode(mode, s)`：`mode === 'outline'` 时返回 `'outline'`；进入大纲模式时额外调用本体 `syncConvoStream()` 完成实际换房 | `registerMode` 支持 `streamKey: 'outline'`，并在本体 `toggleRegisteredMode()` 设定 `activeRegisteredModeId` 后自动同步房间 | 大纲模式继续落在 `main` 流，和普通聊天共用 `storyOracle_convo` |

**排查要点：**
- 若设置面板下拉框缺少「大纲」→ 检查 `SYSPROMPT_MODES` 是否改名 / 移出模块顶层（如变成 `let` 或移到函数内）
- 若编辑后发送不生效 → 检查 defaults 对象的 `outlineSystemPrompt` key 是否被本体覆盖（如 `Object.assign` 重置了 defaults）
- 本体未来若把 `SYSPROMPT_MODES` 改为函数返回 / Map 结构 / 移出模块作用域，本表所有调用需同步改动
- 若「发送全量大纲聊天记录」勾选后无效 → 检查本体 `convo` 变量是否改名、是否仍为模块顶层变量（如改为 `let convo` 仍可读，若移入函数作用域则 unsafe.eval 无法访问）
- 若大纲模式仍和普通聊天共用记录 → 检查 `convoStreamKeyForMode` 是否改名、是否仍可重赋值；再检查 `syncConvoStream()` 是否改名、注册模式 `onEnter` 是否仍在 `activeRegisteredModeId = id` 后执行；最后检查本体是否改了房间 key 生成规则 `convoMetaKeyFor()`

> ⚠️ 注意：旧版文档曾把 `src/prompt.js` 的兜底剔除列为「违背 Hook 路线」，那是旧 `final-mode.js` 时代风险表里的归类错误——它既不是本体私有函数，也不是 `eval`，本就不属于「违背故事神谕 Hook 路线」范畴。1.5.0 文档已更正。

---

## 3. 项目架构

### 3.1 根目录核心文件

| 文件 / 目录             | 职责                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `manifest.json`         | SillyTavern 扩展清单。当前加载 `index.js` 和 `style.css`，版本号在这里维护 |
| `index.js`              | 插件入口。只做 StoryOracleAPI 握手和动态导入 `src/plugin.js`               |
| `style.css`             | 插件样式，包含大纲设置栏、消息编辑框、内联选择面板等 UI 样式               |
| `src/`                  | 当前插件的全部业务代码                                                     |
| `交接指南/`             | 原作者提供的 Hook API 迁移指南和示例插件材料                               |
| `与原作者对接/`         | 早期 GAP 评估、Hook API 设计讨论和改造方案                                 |
| `故事神谕本体1.22.0/`   | 用于对照 Hook API 落地实现的故事神谕本体代码副本，不是本插件运行时打包内容 |

### 3.2 `src/` 模块分工

| 文件                    | 职责                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `plugin.js`             | 注册入口。校验 API 版本、迁移旧最终模式配置、注册大纲模式与回复动作                        |
| `constants.js`          | Hook API 版本、localStorage key、默认系统提示词、默认大纲模板                              |
| `prompt.js`             | 大纲模式 `onSend`。组合系统提示词、模板、角色卡、世界书、聊天记录，返回模型请求消息        |
| `ui.js`                 | 大纲模式设置栏。模板选择、模板管理、补全预设开关、标签补充按钮                             |
| `templates.js`          | 大纲模板的 localStorage 增删改查和当前模板选择                                             |
| `tags.js`               | 从模板识别标签、从模型回复末尾提取标签内容、补全缺失标签                                   |
| `message-actions.js`    | 注册「注入剧情大纲」和「编辑」两个回复动作；编辑后调 `api.updateReply()` 持久化            |
| `outline-inject.js`     | 把大纲写入 TavernHelper 世界书 `<角色>-剧情指导`，必要时创建世界书或新条目                 |
| `migrate-final-mode.js` | 一次性迁移：把停留在旧最终模式的用户配置搬到本体 1.22.0 原生 `directRawUrl` 开关上         |
| `toast.js`              | 插件内提示消息。优先用 `toastr`，不可用时退回轻量 DOM toast                                |

### 3.3 运行时加载顺序

1. SillyTavern 加载本插件 `index.js`。
2. `index.js` 等待故事神谕本体暴露 `window.StoryOracleAPI` 或派发 `story-oracle-ready`。
3. 握手成功后动态导入 `src/plugin.js`。
4. `plugin.js` 校验 `api.isCompatible(1)`，不通过则放弃挂载。
5. 校验通过后调用 `migrateFinalModeState(api)`——仅旧最终模式用户触发一次，把配置搬到本体原生开关。
6. 调用 `api.registerMode({ id: 'outline', ... })` 注册大纲模式。
7. 调用 `api.addMessageAction()`（在 `registerMessageActions` 内）注册回复按钮。

---

## 4. 本体与本插件的关系

故事神谕本体和本插件是两个独立扩展，不应再合并打包。

### 4.1 故事神谕本体负责

- 提供主窗口、模式按钮区、消息列表、设置面板、连接配置、模型请求和回复渲染。
- 暴露 `window.StoryOracleAPI` v1。
- 维护稳定 Hook 契约：`registerMode`、`context.*`、`addMessageAction`、`updateReply`、`renderMarkdown`、`run`、`appendReply`、`data-so-raw` 等。
- 原生处理交接指南中已移入本体的功能：Markdown 渲染、连接预设、参谋栏折叠、工具展开、切模式收设置、开发者请求日志等。
- 1.22.0 起原生承载旧「最终模式」语义：直连区「地址原样使用（不自动补 /v1）」(`directRawUrl`) + 「经酒馆后端转发」(`directViaBackend`) 两个开关；连接预设保存 / 恢复 `rawUrl` 字段；删预设 / 删消息的二次确认经原生 `uiConfirm`。

### 4.2 本插件负责

- 注册「大纲」模式，并定义它的提示词构造方式。
- 管理大纲模板和模板选择。
- 给故事神谕回复提供「注入剧情大纲」和「编辑」动作。
- 把模型输出的大纲写入当前角色的 `<角色>-剧情指导` 世界书。
- 启动时把停留在旧最终模式的用户配置一次性迁移到本体原生开关上（`migrate-final-mode.js`，仅旧用户触发一次）。

### 4.3 边界原则

- 大纲模式相关逻辑优先走 `StoryOracleAPI`，不要再新增 `fetch` 拦截、prototype hack、直接改本体聊天数组之类的逻辑；已存在的本体补丁只限 §2.3 列出的 `api.unsafe.eval`。
- 写世界书属于 SillyTavern / TavernHelper 侧能力，不属于故事神谕本体 Hook 范围，继续放在插件内。
- 连接层（旧最终模式）一律走本体 1.22.0 原生 `directRawUrl` + `directViaBackend` 开关，本插件不再维护任何连接层补丁、`eval` patch 或 DOM patch。
- 若未来确需新增读 / 改本体内部状态，先评估能否请求本体补 Hook API；确实覆盖不到时才用 `api.unsafe.eval`（非正式、无兼容承诺），并必须写入 §2.3。**这是兜底，不是日常路径。**

---

## 5. 后续维护应该如何下手

### 5.1 升级故事神谕本体时

优先按这个顺序验证：

1. 本体是否仍暴露 `window.StoryOracleAPI`，且 `api.isCompatible(1)` 通过。
2. 标题栏是否出现「大纲」按钮，进入 / 退出大纲模式是否正常。
3. 大纲发送是否正常，且世界书中 `<角色>-剧情指导` 没有被再次塞进大纲请求上下文。
4. 回复是否保留 `data-so-raw`，自定义标签是否能被「注入剧情大纲」读取。
5. 「编辑」保存后刷新，修改是否仍存在。
6. 「标签补充」是否只修改最新一条助手回复并持久化。
7. 直连区「地址原样使用」+「经酒馆后端转发」两个开关是否能正常获取模型、发送请求。
8. 删除消息和删除连接预设是否仍弹出确认（本体 1.22.0 原生 `uiConfirm`，插件不再拦截）。

排查入口：

- 只有大纲模式坏了 → 先看 `src/plugin.js`、`src/prompt.js`、`src/message-actions.js`。
- 只有注入世界书坏了 → 先看 `src/outline-inject.js` 和 TavernHelper API 是否变化。
- 旧最终模式用户升级后配置异常 → 先看 `src/migrate-final-mode.js` 的一次性迁移是否跑过；连接层行为本身由本体原生开关负责，不再有插件侧补丁可查。

### 5.2 修改大纲提示词或模板

- 默认系统提示词在 `src/constants.js` 的 `OUTLINE_DEFAULT_SYSTEM_PROMPT`。
- 默认模板在 `src/constants.js` 的 `DEFAULT_TEMPLATE`。
- 用户自建模板保存在 localStorage key `so_outline_templates`。
- 当前选中模板保存在 localStorage key `so_outline_template_selected`。
- 修改默认模板时注意：已有用户 localStorage 中若已有 `default` 模板，不一定会自动覆盖成新默认值。

### 5.3 修改大纲请求上下文

入口是 `src/prompt.js` 的 `buildOutlineSend(userText, ctx, api)`。

当前请求结构：

- system：默认系统提示词 + 可选补全预设 + 当前模板 + 角色卡 + 世界书 + 最近故事对话记录。
- messages：只保留本轮用户输入 `[{ role: 'user', content: userText }]`。

维护时注意：

- 不要恢复旧版 `fetch` 拦截。
- 不要直接调用本体私有的 `buildSystemPrompt`、`generateReply`、`stripReasoningTags`。
- 需要故事上下文时优先使用 `api.context.*`。
- `api.context.*` 返回未宏替换文本，最终只在拼完后调用一次 `ctx.substituteParams()`。

### 5.4 修改消息按钮或回复编辑

入口是 `src/message-actions.js`。

- 新增回复按钮继续用 `api.addMessageAction({ id, icon, title, onClick })`。
- 读模型原文用 `rawText` 或 `.so-content.dataset.soRaw`。
- 改某条回复用 `api.updateReply(msgEl, newText, { persist: true, render: 'markdown' })`。
- 不要重新引入旧版 `data-original-content`、`innerHTML` setter 拦截或手动改本体 `convo`。

### 5.5 修改世界书注入

入口是 `src/outline-inject.js`。

当前逻辑：

1. 根据当前模板识别标签名。
2. 从 AI 回复末尾提取最后一个完整标签块。
3. 获取当前角色名，目标世界书为 `<角色>-剧情指导`。
4. 若没有条目则创建 `剧情指导`。
5. 若已有条目，用户选择「新建条目」或「覆盖最新」。
6. 新建条目时会禁用旧剧情指导条目，创建 `剧情指导N`。

这部分主要依赖 TavernHelper，而不是 StoryOracleAPI。排查问题时应先确认 TavernHelper 是否仍暴露 `getLorebookEntries`、`setLorebookEntries`、`createLorebookEntries`、`createLorebook`、`getCharWorldbookNames`、`rebindCharWorldbooks`。

### 5.6 连接层（旧「最终模式」）归属说明

旧「最终模式」兼容层（`src/final-mode.js`）已在 1.5.0 整层删除。其语义由故事神谕本体 1.22.0 的两个直连开关原生承载，**本插件不再维护连接层逻辑**——本节是历史交代，不是维护入口。

- `settings.directRawUrl`（UI：「地址原样使用（不自动补 /v1）」）：裸地址不补 `/v1`，请求打到 `地址/chat/completions`、取模型打到 `地址/models`。本体在所有直连调用点统一走 `resolveEndpointUrl(s)` / `modelsUrl(s.endpoint, !!s.directRawUrl)`。
- `settings.directViaBackend`（UI：「经酒馆后端转发」）：请求经酒馆服务器代发，绕开浏览器 CORS。
- 连接预设由本体 `connPresetUpsert` 保存 `rawUrl` 字段，加载预设时恢复 `#so-raw-url` 复选框；旧预设缺省 `false` = 保存当时的行为。

唯一与本插件相关的连接层工作，是 `src/migrate-final-mode.js` 的一次性旧用户迁移。若旧最终模式用户升级后配置异常，按以下顺序排查：

1. `settings._useFinalMode` 是否已清（迁移是否跑过）。
2. `#so-raw-url` 是否勾选、`#so-direct-backend` 是否勾选。
3. `#so-endpoint` 是否显示干净原始地址（而非带 `/chat/completions` 的哨兵值）。
4. localStorage `so_final_mode_fields` 是否已删（迁移完成会清掉）。

升级本体时验证：勾选「地址原样使用」+「经酒馆后端转发」后，获取模型与发送请求是否打到原样地址（DevTools Network 看 `/api/backends/chat-completions/...` 的 `custom_url`）。

---

## 6. 最小回归测试清单

每次改动后至少手动跑一遍：

- 只安装故事神谕本体 1.22.0+ 和本插件，不打包旧本体副本。
- 打开故事神谕，确认「大纲」按钮出现。
- 进入大纲模式，选择模板，发送一次请求。
- 确认回复 Markdown 正常、标签原文可被读取。
- 点击「注入剧情大纲」，确认写入 `<角色>-剧情指导` 世界书。
- 点击「编辑」，保存后刷新，确认编辑结果仍存在。
- 点击「标签补充」，确认最新回复被补标签且刷新后仍存在。
- 勾选直连区「地址原样使用」+「经酒馆后端转发」，填写 endpoint / key / model，获取模型并发送一次请求，确认打到原样地址。
- 保存一个连接预设（含勾选「地址原样使用」），切换再加载，确认「地址原样使用」复选框正确恢复；删除该预设弹出本体原生确认框（只弹一次）。
- 删除一条消息，弹出本体原生确认框（只弹一次）。
- 取消勾选「地址原样使用」，发送请求，确认仍打到 `地址/v1/chat/completions`，未被原样开关污染。

### 6.1 旧最终模式用户迁移验证（仅升级时跑一次）

手动构造旧状态后刷新，确认迁移生效：

- `settings._useFinalMode = true`
- `settings.endpoint = https://host/path/chat/completions`（哨兵值）
- localStorage `so_final_mode_fields = { endpoint: "https://host/path", apiKey: "sk-x", model: "m" }`

刷新后预期：

- `#so-endpoint` 显示 `https://host/path`（干净原始地址，无 `/chat/completions` 后缀）。
- `#so-raw-url` 复选框勾选、`#so-direct-backend` 复选框勾选。
- 控制台有迁移日志；`settings._useFinalMode` 已清；localStorage `so_final_mode_fields` 已删。
