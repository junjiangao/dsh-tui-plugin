# dsh-tui 输入框美化与 TUI 视觉升级（opencode / grok build 风格）优化计划

> 状态：计划已批准（2026-08-30），本地实施完成（2026-08-30）：lint/typecheck/test/build 全绿，快照已刷新，`lib/tui.mjs` 已重建。待远程 CI 通过后关闭 goal。
> 基线：HEAD `9b8b39c`（`fix(tui): boot on the deployment default model`）；pi-tui patch 346 行；13 个 keyless 语义快照。

## 1. 背景与需求

- 用户要求：TUI 界面美化，输入框需要有边框；样式参考 grok build 与 opencode tui。
- 目标：在保持「主题无关（仅标准 16 色 + SGR 属性，无背景色/真彩/扩展色）、全部既有功能不变」的前提下，把输入区升级为带圆角边框的现代卡片式输入框，并完成整体视觉收口。
- 交付：本计划文档 + `UI-BEAUTIFY-GOAL.md`（goal 提示词，可直接粘贴到 dsh goal 模式驱动实现）。

## 2. 现状（已核实，HEAD 9b8b39c）

- 输入框：`packages/tui/src/index.ts:193-203` 构造 `Editor`，当前为
  - `borderColor: palette.dim`
  - `paddingX: 1`
  - `frame: 'none'`（无边框，仅内容行）
  - `prompt: { first: 'dsh > ', continuation: ... }`
- 布局：`ui.addChild` 顺序为 header → chat → Spacer → promptLine → statusLine → questionContainer → editor（`index.ts:288-294`）；`ui.setFocus(editor)` 三处（`295 / 1055 / 1176`）。
- `requestRender()`（`index.ts:345`）内 `updatePromptLine()` + `updateStatusLine()` + `ui.invalidate()` + `ui.requestRender()`；`updateStatusLine` 已读取 `selection.current` 拼 model 段。
- pi-tui 0.80.7 `Editor` 原生只支持 `frame: 'horizontal' | 'none'`，没有整框边框能力；仓库对 pi-tui 已有 346 行补丁（`patches/@earendil-works__pi-tui@0.80.7.patch`），`OPTIMIZATION-PLAN.md` D7 已将其列为维护风险。
- 仓库已有圆角边框样式可复用：
  - `renderDialog`：`╭ label ─╮` + `│ body │` + `╰──╯`（`components/dialogs.ts:253-268`，accent）；
  - `StatusCardComponent`：`╭─ Title ─...╮`（`components/dialogs.ts:216-223`，dim）。
- 测试约束：
  - 13 个 keyless 语义快照逐字节比对（`tests/tui.snapshot.spec.ts` + `tests/snapshots/*.expected.txt`）；
  - `checkpoint()` 强制 `themeViolations()` 为空（无 256 色/真彩/背景色）；
  - `autocomplete.spec.ts` 等用 `toContain('dsh > …')` 断言子串，边框不会破坏。
- 构建约束：根 `lib/tui.mjs` / `lib/startup.mjs` 为已提交的自包含 bundle（CI 重建并 diff），源码改动后必须 `pnpm build` 重生成并提交。

## 3. 样式参考与设计映射

| 参考 | 视觉特征 | 本方案映射 |
|---|---|---|
| opencode tui | 底部输入为圆角边框盒子，框内左侧模式/模型芯片、右侧提示，边框随焦点变化 | 输入框圆角边框；上边框左标签 `dsh`；上边框右侧 model 芯片；聚焦 accent / 失焦 dim |
| grok build | 简洁卡片式输入区、圆角、弱化装饰、信息集中在输入区附近 | 保留上方 promptLine/statusLine 两行 dim 信息，输入框作为底部主视觉卡片 |

设计原则：

1. **不扩展 pi-tui patch**。用仓库内组件包装 `Editor`，避免继续扩大已标记为维护风险的补丁面。
2. **继承 `Container`**。pi-tui 的 `isComponentMounted` 只沿 `Container` 树查找，包装组件必须继承 `Container` 才能保持 overlay focus-restore 语义。
3. **聚焦高亮**。边框色 = `editor.focused ? palette.accent : palette.dim`；对话框/模态打开时 editor 失焦，边框自动变 dim。
4. **标签与芯片可截断**。顶边布局镜像 `StatusCardComponent`；右芯片先截断加 `…`，仍放不下则整段丢弃，绝不溢出终端宽度。
5. **入口统一 sanitize**。标签与芯片文本经 `displayText()` 处理，截断用 `truncateToWidth`（ANSI 安全）。

## 4. 方案决策

### 4.1 组件设计（新增 `packages/tui/src/components/bordered-editor.ts`）

```ts
export class BorderedEditor extends Container {
  // 构造时 addChild(editor)
  // render(width):
  //   width < 4 → super.render(Math.max(1, width))
  //   innerWidth = width - 2
  //   body = super.render(innerWidth)          // Editor 在 innerWidth 内渲染
  //   边框色 = editor.focused ? palette.accent : palette.dim
  //   顶边  = composeTopBorder(width, leftLabel, rightLabel)
  //   内容  = '│' + padToWidth(line, innerWidth) + '│'
  //   底边  = '╰' + '─'.repeat(innerWidth) + '╯'
  // focused / wantsKeyRelease 透传 editor
}

export function composeTopBorder(
  width: number,
  leftLabel: string,
  rightLabel: string | undefined,
): string
```

- 顶边格式（镜像 `StatusCardComponent`）：
  - 无芯片：`╭─ dsh <dashes>╮`
  - 有芯片：`╭─ dsh <dashes> model <name> <dashes>╮`（两段 dashes 均 ≥ 1）
- 截断规则：优先保证总宽 = width；右芯片放不下先 `truncateToWidth(..., '…')`，仍放不下则整体丢弃；左标签固定为 ` dsh `（极短，不截断）。
- 内容行 `padToWidth` 用 `visibleWidth` / `truncateToWidth` 补足到 `innerWidth`（Editor 自身输出通常已满宽，防御性补齐）。

### 4.2 接线（`packages/tui/src/index.ts`）

- 构造 editor 后：
  `const inputBox = new BorderedEditor(editor, palette, { leftLabel: displayInlineText(' dsh ') })`
- `ui.addChild(editor)`（@294）→ `ui.addChild(inputBox)`。
- `ui.setFocus(editor)` 三处（@295/1055/1176）保持不变。
- `requestRender()`（@345）内新增 `updateInputBox()`：
  `inputBox.setRightLabel(selection.current === undefined ? undefined : displayText('model ' + compactTargetLabel(selection.current)))`
- model 变化经 `modelController → requestRender` 自动刷新；新提交的部署默认模型启动路径同样会设置 `selection.current`，因此真实使用中芯片几乎总是显示。

### 4.3 范围外（明确不做）

- 框内占位提示（"Ask anything…"）与底部快捷键提示；
- promptLine / statusLine 移入框内、header 重设计；
- 新增配置项（保持硬编码风格，与 dialogs 一致）；
- 扩展 pi-tui patch、修改 theme 角色表。

## 5. 实施任务

| # | 任务 | 文件 | 交付 |
|---|---|---|---|
| T1 | 边框组件 | `packages/tui/src/components/bordered-editor.ts`（新） | `BorderedEditor` + `composeTopBorder` |
| T2 | 通道接线 | `packages/tui/src/index.ts` | `addChild(inputBox)`（@294）+ `updateInputBox()`（@345） |
| T3a | 纯函数单测 | `packages/tui/tests/bordered-editor.spec.ts`（新） | 96/56 列、有/无芯片、空标签、超窄宽度、总宽不溢出 |
| T3b | 快照 | `packages/tui/tests/tui.snapshot.spec.ts` + `tests/snapshots/*.expected.txt` | 新增 `input-wrapped` checkpoint；刷新 13 个快照并逐字节审阅 |
| T4 | 构建与文档 | 根 `lib/tui.mjs`；`UI-BEAUTIFY-PLAN.md`、`UI-BEAUTIFY-GOAL.md` | `pnpm build` 全绿；文档就位 |

## 6. 测试与门禁

每轮 Gate：

1. `pnpm lint`：0 告警 0 错误；
2. `pnpm typecheck`：两包通过；
3. `pnpm test`：全绿（快照逐字节匹配、`themeViolations()` 为空、perf 预算不回归）；
4. `pnpm build`：成功，`lib/tui.mjs` 与源码一致并提交；
5. 快照 diff 人工审阅并记录摘要。

快照刷新命令：

```bash
DSH_SNAPSHOT=refresh pnpm vitest run packages/tui/tests/tui.snapshot.spec.ts
```

审阅要求：

- diff 只允许「输入区新增边框行 + 行号位移」；
- `minimal-chat`：harness 的 fake agent 默认带有 `deepseek-v4-flash` 选项，因此当前快照显示 model 芯片；边框为聚焦 accent；
- `status-diagnostics`：有 model 芯片；
- 对话框快照（model-selector / resume 等）：editor 失焦 → 边框 dim；
- `status-diagnostics-narrow`（56 列）：当前 model 标签在 56 列内完整放下；更长的标签由 `composeTopBorder` 单测覆盖截断/隐藏，不溢出。

## 7. 风险与边界

- **快照大面积变更**属预期，必须逐字节审阅，防止误伤 transcript 渲染。
- **窄终端**：`width < 4` 退化无边框；56 列芯片截断由纯函数单测覆盖。
- **焦点/overlay**：包装组件继承 `Container` 保证 `isComponentMounted`；对话框打开时 editor 失焦 → dim 边框（预期）。
- **ANSI 标签**：入口统一 `displayText`，截断用 `truncateToWidth`。
- **性能**：每帧多一次包装渲染，成本可忽略；`perf.spec` 预算保持绿色。
- **新 peer 依赖** `@deepseek-ai/dsh-agent-default-model` 由既有提交处理，本方案不涉及。

## 8. Final DoD

- [x] D1 输入框四边圆角边框（`╭╮│╰╯`），聚焦 accent / 失焦 dim
- [x] D2 上边框左标签 `dsh`、右 model 芯片（未选隐藏），96/56 列均不溢出
- [x] D3 多行输入、滚动指示、@ 自动补全均在框内正确渲染
- [x] D4 13 个快照刷新并逐字节审阅（Evidence 有 diff 摘要）；新增 `input-wrapped` 快照
- [x] D5 theme-agnostic：`HeadlessTerminal.themeViolations()` 为空
- [x] D6 `pnpm lint / typecheck / test / build` 全绿；`lib/tui.mjs` 重生成并提交
- [x] D7 pi-tui patch 未改动（346 行不变）；无新增配置项；文档（PLAN/GOAL）就位

## 9. 证据区（实施时逐轮追加）

### R0 基线

- HEAD：`9b8b39c`
- patch 行数：`346`
- 语义快照：`13`（minimal-chat / streaming / disposed-terminal / goal-commands / model-selector / model-selector-filtered / resume-sessions-loading / resume-sessions / resume-sessions-all-workspaces / file-autocomplete / session-reference / status-diagnostics / status-diagnostics-narrow）
- `lib/tui.mjs` 哈希：实施前基线未记录（实施后见下）

### R1–R4 实施证据

- 新增文件：
  - `packages/tui/src/components/bordered-editor.ts`
  - `packages/tui/tests/bordered-editor.spec.ts`（10 个用例）
  - `packages/tui/tests/snapshots/input-wrapped.expected.txt`
- 修改文件：
  - `packages/tui/src/index.ts`（`inputBox` 接线 + `updateInputBox()`）
  - `packages/tui/tests/tui.snapshot.spec.ts`（新增 `input-wrapped` checkpoint）
  - 13 个既有语义快照（仅输入区新增边框 + 行号/光标列位移）
  - `lib/tui.mjs`（根 bundle 重建）
- 门禁输出：
  - `./node_modules/.bin/oxlint` → 0 warnings / 0 errors
  - `tsc -p packages/tui/tsconfig.json --noEmit` + `tsc -p packages/tui-app/tsconfig.json --noEmit` → 通过
  - `./node_modules/.bin/vitest run` → 38 files / 333 tests passed
  - `./node_modules/.bin/tsdown -c tsdown.root.config.ts` → 成功，`lib/tui.mjs` / `lib/startup.mjs` 重建
- 快照 diff 摘要：所有 diff 只出现在输入区（原单行 ` dsh > ` 变为 `╭─ dsh ─…─ model … ─╮` / `│ … │` / `╰…╯`），其余 transcript、status footer、overlay 内容未变；`themeViolations()` 全部为空。
- `lib/tui.mjs` 哈希：`bb245ca8a2e05333d16a04f307a6285b7de1d4278588c84c77fb1bb3afc54eaf`
- `lib/startup.mjs` 哈希：`c21beaa118b16fa3097aa73e97782523b995ee5ab708c1391c9de13d060f1b14`
- pi-tui patch 行数保持 `346` 未改动；无新增配置项。
