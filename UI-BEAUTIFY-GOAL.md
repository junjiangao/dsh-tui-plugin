# Goal：dsh-tui 输入框美化与 TUI 视觉升级（参照 opencode tui / grok build）

> 本文件是可直接粘贴到 dsh goal 模式执行的 goal 提示词。设计细节与证据见 `UI-BEAUTIFY-PLAN.md`。

## 1. Goal 目标

让 dsh-tui-plugin 的 TUI 在保持「主题无关（仅标准 16 色 + SGR 属性，无背景色/真彩/扩展色）、全部既有功能不变」的前提下，完成输入框与整体视觉的现代化升级，视觉语言参照 opencode tui（圆角输入框 + 框内模型芯片）与 grok build（简洁卡片式输入区）：

- 输入框（pi-tui Editor）获得完整圆角边框（╭─╮│╰─╯），取代当前无边框布局；
- 上边框内嵌左侧品牌标签 `dsh` 与右侧 model 芯片（`model <name>`，未选模型时不显示），96/56 列均不溢出；
- 边框聚焦高亮：编辑器聚焦时 accent（SGR 95）、失焦（对话框/模态打开）时 dim（SGR 2;39）；
- 多行输入、滚动指示（↑/↓ N more）、@ 文件自动补全列表都正确渲染在框内；
- 实现全部落在本仓库（不扩展 pi-tui 补丁，patch 保持 346 行不变），纯函数可单测。

完成标准见 Final DoD；逐项核对通过才 complete。

## 2. 执行协议（每轮）

1. 完成该轮全部任务 → 更新本文档 checkbox 与 Evidence → 跑该轮 Gate；
2. Gate 全绿才进入下一轮；任何失败先修复再推进；
3. 快照刷新必须用 `DSH_SNAPSHOT=refresh pnpm vitest run packages/tui/tests/tui.snapshot.spec.ts`，随后 `git diff` 逐字节审阅并记录摘要到 Evidence；
4. 源码变更后必须 `pnpm build` 重生成根 `lib/tui.mjs`（已提交产物）并一并提交。

## 3. Round 与 Gate

| Round | 主题 | 交付 | Gate | 状态 |
|---|---|---|---|---|
| R0 | 立 goal 与基线 | 本文档 + 基线证据（HEAD、实测测试数、13 快照清单、patch 行数 346、lib/tui.mjs 哈希） | 文档就位，基线可复现 | ✅ |
| R1 | 边框组件 | `packages/tui/src/components/bordered-editor.ts`：`BorderedEditor extends Container`（包装 Editor，addChild）+ 纯函数 `composeTopBorder(width, leftLabel, rightLabel?)`；聚焦 accent/失焦 dim；focused/wantsKeyRelease 透传 | 单测绿：96/56 列、有/无芯片、空标签、width<4、总宽不溢出 | ✅ |
| R2 | 通道接线 | `packages/tui/src/index.ts`：`addChild(inputBox)` 替换 `addChild(editor)`（当前 @294）；`updateInputBox()` 在 requestRender（当前 @345）内按 `selection.current` 更新芯片（`displayText('model ' + compactTargetLabel(...))`，未选传 undefined）；三处 `ui.setFocus(editor)`（当前 @295/1055/1176）不变 | typecheck 绿；快照目视：status-diagnostics 有芯片、对话框快照为 dim 边框；minimal-chat 因 harness 默认 agent 选项也显示芯片 | ✅ |
| R3 | 快照与回归 | 刷新 13 快照 + 新增 `input-wrapped` checkpoint（长输入在框内换行）；新增 `packages/tui/tests/bordered-editor.spec.ts` | `pnpm test` 全绿；themeViolations() 为空；快照 diff 仅输入区与行号位移 | ✅ |
| R4 | 构建与文档 | `pnpm build` 重生成 lib/tui.mjs 并提交；UI-BEAUTIFY-PLAN.md / UI-BEAUTIFY-GOAL.md 就位 | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿；lib 哈希已更新 | ✅ |

## 4. Final DoD

- [x] D1 输入框四边圆角边框（╭╮│╰╯），聚焦 accent / 失焦 dim
- [x] D2 上边框左标签 `dsh`、右 model 芯片（未选隐藏），96/56 列均不溢出
- [x] D3 多行输入、滚动指示、@ 自动补全均在框内正确渲染
- [x] D4 13 个快照刷新并逐字节审阅（Evidence 有 diff 摘要）；新增 `input-wrapped` 快照
- [x] D5 theme-agnostic：HeadlessTerminal.themeViolations() 为空
- [x] D6 `pnpm lint / typecheck / test / build` 全绿；lib/tui.mjs 重生成并提交
- [x] D7 pi-tui patch 未改动（346 行不变）；无新增配置项；文档（PLAN/GOAL）就位

## 5. Evidence

### R0 基线

- HEAD：`9b8b39c`
- patch 行数：`346`
- 语义快照：`13`（minimal-chat / streaming / disposed-terminal / goal-commands / model-selector / model-selector-filtered / resume-sessions-loading / resume-sessions / resume-sessions-all-workspaces / file-autocomplete / session-reference / status-diagnostics / status-diagnostics-narrow）
- `lib/tui.mjs` 哈希：实施前基线未记录（实施后见 R4）

### R1–R4

- R1：新增 `packages/tui/src/components/bordered-editor.ts`（`BorderedEditor` + `composeTopBorder`）；`packages/tui/tests/bordered-editor.spec.ts` 10 个用例全绿。
- R2：`packages/tui/src/index.ts` 接线 `addChild(inputBox)`、`updateInputBox()`；`ui.setFocus(editor)` 三处保持不变。
- R3：刷新 13 个既有语义快照 + 新增 `input-wrapped`，共 14 个快照；`DSH_SNAPSHOT=refresh ./node_modules/.bin/vitest run packages/tui/tests/tui.snapshot.spec.ts` 通过；快照 diff 仅输入区新增圆角边框与行号/光标列位移，transcript/status/overlay 内容无变化；`themeViolations()` 全部为空。
- R4：本地门禁：
  - `./node_modules/.bin/oxlint` → 0 warnings / 0 errors
  - `./node_modules/.bin/tsc -p packages/tui/tsconfig.json --noEmit` 与 `./node_modules/.bin/tsc -p packages/tui-app/tsconfig.json --noEmit` → 通过
  - `./node_modules/.bin/vitest run` → 38 files / 333 tests passed
  - `./node_modules/.bin/tsdown -c tsdown.root.config.ts` → `lib/tui.mjs` / `lib/startup.mjs` 重建成功
- `lib/tui.mjs` 实施后哈希：`bb245ca8a2e05333d16a04f307a6285b7de1d4278588c84c77fb1bb3afc54eaf`
- `lib/startup.mjs` 实施后哈希：`c21beaa118b16fa3097aa73e97782523b995ee5ab708c1391c9de13d060f1b14`
- pi-tui patch 行数保持 `346` 未改动；无新增配置项。
