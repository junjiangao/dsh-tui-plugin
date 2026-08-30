# dsh-tui 消息三 block 样式对齐 opencode 优化计划（思考 / 正文 / 工具调用）

> 状态：已实施（2026-08-30）：P0 `3810fbe`（块容器 + palette bar 角色）、P1+P2 `d0adb2b`（思考/正文块）、P3 `ea80e68`（工具块 + 授权双条）、P4（shimmer + driver）；lint/typecheck 全绿，40 文件 364 测试通过，14 个 keyless 快照按阶段刷新并逐字节复核，`lib/tui.mjs` 已重建。收口结论：块间距一致无需修正；块底 info 行保持 timing footer 现状不合入（见 §3.3）。
> 基线：HEAD `dadf13c`（`feat(tui): add /permission mode selector below the input box`）；pi-tui patch 346 行；14 个 keyless 语义快照。
> 前置：`UI-BEAUTIFY-PLAN.md` 已完成（输入框圆角边框、`BackgroundPanel` 消息背景面板、panel 背景角色）。本计划是其延续，聚焦消息流三种 block 的观感与交互。
> 参考：opencode TUI（`/work/Repos/github/opencode/packages/tui`）。Go/bubbletea 版块渲染集中在 `internal/components/chat/message.go` 的 `renderContentBlock` / `renderText` / `renderToolDetails` / `renderToolTitle`（该版本已在 commit `f68374ad` 删除，需从 git 历史读取）；现行 TS/SolidJS 版入口在 `src/routes/session/index.tsx`，工具样式在 `src/util/tool-display.ts`、`src/context/thinking.ts`。

## 1. 背景与需求

- 用户要求：当前 TUI 的消息展示对齐 opencode 风格，集中在三种 block：
  1. **思考 block**（reasoning）
  2. **正文/回复 block**（assistant text；用户消息作为对照一并统一）
  3. **工具调用 block**（tool call 卡片）
- 范围限定：只动这三个 block 的视觉容器、标题行、状态表达与折叠交互；**不改数据模型、事件流、输入区、布局装配**（后两者 `UI-BEAUTIFY-PLAN` 已收口）。
- 硬约束不变：
  - 主题无关：仅标准 16 色 + SGR 属性，无 256 色/真彩，`tests/headless-terminal.ts` 的 `themeViolations()` 必须为空；
  - 13 个语义快照逐字节比对，改动后统一 `DSH_SNAPSHOT=refresh` 刷新并逐个 review；
  - 根 `lib/tui.mjs` 为已提交 bundle，改完必须 `pnpm build` 重生成并提交；
  - 不扩展 pi-tui patch（块容器全部用仓库内组件组合实现）。

## 2. opencode 样式解构（目标规格）

从 Go 版源码提炼的块渲染规格（现行 TS 版交互与之一致，仅触发方式不同，见 §3.3）。

### 2.1 统一块容器 `renderContentBlock`

- 所有块共用一个容器：**只有左右两条粗边框（无上下边），边框前景默认 = 面板背景色**，即左边框实际呈现为「一条与面板同色的竖向轨道」；块内 padding 上下 1 行、左右 2 列。
- 块与块之间固定 1 个空行；内容实际可用宽度 = 终端宽 − 6（左右各 1 边框 + 2 padding）。
- 四类块只差三个参数：**边框条颜色、面板底有无、标题/info 行**：

| 块类型 | 面板底 | 左竖条 | 标题行 | 备注 |
|---|---|---|---|---|
| 用户消息 | 有 | 蓝（secondary），可见 | 底部 muted `author (时间)` | 正文不做 markdown，`@file` 高亮 |
| assistant 正文 | **无** | 无 | 底部 muted `agent · model (时间)` | 与终端底色融合，缩进 3 列 |
| 思考 block | 有 | 面板色（**隐形**） | `Thinking...` muted，流式时 Shimmer | 默认**隐藏**，全局键 `ctrl+x b` 切换 |
| 工具调用 | 有 | 面板色（隐形）；错误=红；permission=橙且双条 | 标题行见 §2.2 | 默认收起，全局键 `ctrl+x d` 切换 |

### 2.2 工具调用 block 细节

- **标题行**：`<显示名> <主参数摘要>`，按宽度截断。显示名映射（`bash→Shell`、`webfetch→Fetch`，其余 Title-case）；主参数取第一个参数键（edit/write=文件名、bash=description、read=相对路径）。
- **状态表达**：pending = 动作文案（`Reading file...` / `Working...`）+ Shimmer 流光，整行铺面板底；error = 标题与错误文本全部 `error` 色；完成 = 正常色。不用 ✓/✗ 圆点。
- **专项输出渲染**（同一文件内 switch，无独立渲染器）：read=按扩展名语法高亮仅 6 行；edit=diff（宽≥120 用 split）+ LSP diagnostics；write=全文；bash=```$ cmd + output```；webfetch=截 10 行；todowrite=checklist；default=**最多 10 行** muted。
- **收起态**：工具块整体不渲染，标题折进所属文本块尾部 `∟ <标题>`（错误红色）。

### 2.3 交互与动效

- 折叠是**全局开关**而非逐块：`ctrl+x b` 切思考块、`ctrl+x d` 切工具详情，状态持久化，toast 提示。
- 动效：90ms tick 的 Shimmer（2.5s 周期扫过高亮段），仅真彩终端启用；工具 pending 与流式思考标题使用。

## 3. 设计映射与决策

### 3.1 opencode 视觉 → 本项目 16 色映射

| opencode 视觉 | 本项目实现 | 说明 |
|---|---|---|
| 面板底 `#141414` | `palette.panel`（SGR 100）+ 现有 `BackgroundPanel` | 已具备 |
| 左侧彩色竖条 | **背景色空格列**（1 列宽，上下贯穿整块） | 见 D2 |
| 助手正文无底无边 | 直接去掉 `BackgroundPanel` 包裹 | 见 D5 |
| Shimmer 真彩流光 | 亮度摆动：bold↔normal 交替扫过标题行 | 16 色可表达；仅在流式/pending 时启用 |
| `Thinking...` muted 标题 | `palette.dim` 标题行，斜体沿用现状可选 | |
| 错误红条/红字 | `palette.error`（fg 31 / bg 101 列） | |
| permission 橙条 | `palette.warning`（fg 33 / bg 103 列） | 对应工具等待授权态 |

### 3.2 方案决策记录

- **D1 统一块容器**：在 `transcript.ts` 新增块渲染辅助（暂名 `MessageBlock`）：输入内容行数组 + `{ bar: 'none'|'panel'|'accent'|'error'|'warning', panel: boolean }`，输出「可选 bar 列 + 可选面板底 + 上下 padding 1 行」的统一块。三种 block 全部经由它渲染，保证左缩进、间距、截断一致。实现为纯函数式辅助 + `CachedCardComponent` 缓存，不引入新框架概念。
- **D2 左竖条用背景色空格列，不用 `▌` glyph**：opencode 本身的实现就是「边框字符铺背景色」，等价移植最保真；且 `▌`（U+258C）在 CJK 终端的 East-Ambiguous 宽度下可能占 2 列，存在对不齐风险（用户环境为 CJK locale）。为此需在 `paletteSpec` 新增 **4 个标准 16 色 BackgroundRole**：`accentBg`(105)、`warningBg`(103)、`errorBg`(101)、`successBg`(102)，与现有 `panel`(100) 同级，不违反主题无关约束（仍是标准 16 色码，`themeViolations` 只禁 256 色/真彩）。颜色嵌套禁令不受影响（bar 列是单一 bg span）。若实机观感不佳，回退方案为 `▌` glyph + 现有 fg 角色（不改 palette）。
- **D3 思考块保留三态循环**：保留 `hidden | collapsed | expanded` 与 `Ctrl+R`（opencode 是全局两态开关，但本项目三态+逐项已落地且语义更细）。默认值维持 `collapsed`（opencode 默认隐藏，但一行 `▸ Thinking` 的占位信息量是正收益，不回退）。改的只是观感：collapsed=面板底单行标题；expanded=面板底 + bar 列 + dim 正文（去斜体可选）；流式期间标题为 `Thinking…`。
- **D4 用户消息加 accent 条**：`UserMessageComponent` 在面板底外加 1 列 accentBg 竖条（opencode 蓝条的对应物，沿用既有 `accent` 角色语义）。
- **D5 assistant 正文去面板、去 `Response` 小标题**：对齐 opencode「正文与终端底色融合」。角色头 `Assistant`（下划线 accent）**保留**——它是可扫读锚点且 `applyTurnFolding` 依赖它；turn 级 timing footer 保留。这意味着部分回退 `c01e8ab` 的面板观感，属于本次对齐 opencode 的预期代价（用户消息/思考/工具仍有面板底，正文留白反而形成 opencode 式的层次对比）。左缩进 3 列与其它块内容对齐。
- **D6 工具卡标题行重构为 opencode 式**：`● Tool / <name> / <desc>` → `<状态列> <显示名> <主参数摘要>`（如 `Read packages/tui/src/index.ts`、`Shell pnpm build`），状态列沿用现有 `○/●`（pending=warning、成功=success、错误=error，颜色即状态，不加文字）。主参数摘要从现有 `ToolDefinition.presentCall` 的 `ToolCallView` 取（title 字段已具备），不新增展示逻辑。输出视图（terminal/diff/read/search/web/generic/XML 树）**全部保留**，仅收纳进块容器并统一高度预算（默认收起走现有 `preview()` head/tail，展开上限对齐 opencode 的 10 行档位可后续调参）。
- **D7 错误与授权态**：错误卡加 errorBg 竖条 + 标题/摘要 error 色；工具等待授权时加 warningBg 双列条（对应 opencode 橙色双边框），并沿用现有 permission 选择器提示。
- **D8 动效最小化**：只做「流式思考标题 + pending 工具标题」的亮度摆动（约 120ms tick，仅改标题一个字符串后 `requestRender()`，行级 diff 成本可忽略）。**必须**在 headless 测试路径下禁用（实现时确认 `tests/headless-terminal.ts` 的判定 env 并显式短路），否则快照不确定。Shimmer 不做则 P4 整项可跳过，不影响其余阶段。
- **D9 不改数据模型**：tool-call/result 仍是独立 session 事件靠 `callId` 关联、卡片挂在 chat 尾部，现有 `moveStreamingToTail` / `applyTurnFolding` 已提供「工具块内嵌消息流」的观感，不在本次扩大。

### 3.3 与 opencode 的有意差异（不追平项）

| opencode | 本项目 | 理由 |
|---|---|---|
| 思考块默认隐藏、全局键 `ctrl+x b` | 默认 collapsed、`Ctrl+R` 三态循环 | 已有交互更细；改动属产品决策而非样式 |
| 工具详情全局开关 `ctrl+x d` | `Ctrl+O` 全局循环（含 hidden） | 同上 |
| 用户正文纯文本 | 用户正文 markdown | 能力保留，非本次范围 |
| 块底 muted agent·model·时间 info 行 | turn 级 timing footer | 已有等价物，避免重复信息（可在 P4 评估合并） |

## 4. 分阶段实施

> 每阶段独立可交付：改完即跑 lint/typecheck/vitest + 刷快照 + `pnpm build`。阶段间可暂停。

### P0 统一块容器（地基）

- 文件：`packages/tui/src/components/transcript.ts`（新增 `MessageBlock` 辅助，`BackgroundPanel` 增加可选 bar 列参数）；`packages/tui/src/components/theme.ts`（新增 4 个 BackgroundRole）。
- 验收：现有渲染经容器重构后快照 diff 仅为预期微调；`themeViolations()` 为空；`/palette` 自检覆盖新角色。

### P1 思考 block

- 文件：`transcript.ts`（`assistantMessageChildren` L235 的 reasoning 分支、`StreamingAssistantComponent` L314 的 reasoning 缓冲分支）。
- 内容：collapsed/expanded 两态均入面板容器；expanded 加隐形 bar 列 + dim 正文；标题统一 `Thinking…` 风格；流式实时性保持。
- 验收：`Ctrl+R` 三态均正常；快照更新；流式中途折叠不撕裂。

### P2 正文 block

- 文件：`transcript.ts`（`UserMessageComponent` L216 加 accent 条；`assistantMessageChildren` L261 去 `Response` 小标题与 `BackgroundPanel`，改缩进对齐）。
- 验收：用户块=面板底+accent 条；助手块=无底无边、与其它块左缩进对齐；拖选复制行为不回退（无前缀字符混入行首）。

### P3 工具调用 block

- 文件：`transcript.ts`（`ToolCardComponent` L497 标题行重构、错误/授权态 bar、输出视图收纳进块容器）；`packages/tui/src/chat/permission.ts`（等待授权态透传，若需）。
- 内容：标题行 `<状态●> <显示名> <主参数>`；generic 卡的 pretty-JSON rawInput 收敛为单行参数摘要（展开态保留完整视图）；错误/授权态按 D7。
- 验收：`Ctrl+O` 三态正常；terminal/diff/read/search/web/XML 六类视图在块容器内无错位；错误卡红条红字；授权等待橙条。

### P4 动效与收口（可选）

- 文件：`transcript.ts`（StreamingAssistantComponent/ToolCardComponent 标题 shimmer）、测试环境短路。
- 收口：全局块间距统一 1 空行复查；`UI-BEAUTIFY-PLAN` 输入区与新块观感联调；评估把块底 info 行并入 timing footer（见 §3.3）。
- 验收：headless 下无定时器；实机流式观感确认。

## 5. 测试与验收流程

1. `pnpm vitest run packages/tui/tests/` —— 单测/快照全绿；
2. `DSH_SNAPSHOT=refresh pnpm vitest run packages/tui/tests/tui.snapshot.spec.ts` 后 `git diff tests/snapshots/` 逐文件 review，确认每处变化都能对应到本计划某条决策；
3. `checkpoint()` 处 `themeViolations()` 为空（新增 bg 角色必须通过）；
4. `pnpm build` 重生成 `lib/tui.mjs` / `lib/startup.mjs` 并提交；
5. 手工矩阵：三 block × {正常、流式中、错误、折叠/展开} 共 12 态 + 浅色/深色终端主题 + 窄终端（60 列）。

## 6. 风险与权衡

| 风险 | 应对 |
|---|---|
| 去掉 assistant 面板 = 部分回退 `c01e8ab` 观感 | 这是 opencode 对齐的核心（其正文就是无底色）；其余三类块保留面板底，层次感由对比产生。不可接受时仅 P2 的 D5 可单独裁掉，不影响其它阶段 |
| 新增 bg 角色在浅色终端主题下观感不可控 | bg 列只用于 1 列宽竖条（非整块），面积小；且 `panel`(100) 已 precedent。实机验收矩阵含浅色主题；不达标走 D2 回退（`▌` glyph） |
| `▌`/块字符在 CJK ambiguous 宽度终端错位 | 主方案已避开（bg 空格列宽度恒为 1）；若走回退需实测 `visibleWidth` |
| shimmer 定时器破坏快照确定性 | D8：headless 判定短路 + 快照 checkpoint 前无 tick；最坏情况整体裁掉 P4 |
| 快照大面积变化难 review | 分阶段提交，每阶段快照独立 diff；决策表 §3.2 作为 review 对照单 |
| `ToolCallView` title 不足以支撑主参数摘要 | 已有 six 类视图与 presentCall 机制兜底；仅 generic 卡需要收敛 rawInput，风险最低 |
