# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

DeepSeek Harness 智能体的交互式全屏终端前门。由 [`@deepseek-ai/dsh-tui-app`](../../bundle/tui-app/README.md) 组合包以 `tui` 行挂载；插件的 `apply` 在进程没有 TTY 时明确报错，通过 `TuiRuntime` 接缝挂载真实终端，并持有键盘、屏幕与根智能体的生命周期，直到操作者退出或进程被拆除。

## 界面

- **单一根智能体** — `mountTui` 创建（或通过 `--resume` 恢复）一个持久化会话并在整个终端生命周期内驱动它；transcript、流式步骤、工具卡与对话框全部从持久化会话日志渲染。
- **Transcript** — 用户/助手消息、流式文本与推理增量、按步骤的计时页脚、回合结束通知。长会话不会构建整棵组件树：挂载只回放最近 `maxInitialMessages` 条用户消息，`/more`（或 PageUp）按 `historyPageSize` 条消息按需加载更早的页；驻留账本在 `transcriptResidentMaxBytes` / `cardCacheEntries` 预算下驱逐最旧的已结算行与卡片。
- **工具卡** — 每个工具调用一张卡，支持 `generic`、`terminal` 或 `diff` 展示，Ctrl+O 折叠/展开、Ctrl+R 隐藏推理；超出 `maxDiffEditLength` 的大 diff 退化渲染完整两侧。
- **交互** — goal 状态行、审批对话框、`ask_user_question` 对话框与扩展 overlay 通过 `ctx.tui.openOverlay` 渲染；Ctrl+C 取消当前回合，Esc 取消活动 overlay。
- **命令** — `/clear`、`/details`、`/exit`、`/help`、`/model`、`/more`、`/palette`、`/quit`、`/resume`、`/status`，外加 goal 命令单元的自身命令；空提示符下的 Ctrl+D 与 Ctrl+C 同样退出。
- **选择与补全** — `/model` 选择器（来自 `ctx.llm` 的 provider/model/effort）、`/resume` 会话选择器（projection-cache 标题、有界并发扫描），以及带工作区索引边界的 `@` 文件与会话引用补全。
- **状态页脚** — 阶段字形、运行墙钟（运行期间按 `statusIntervalMs` 跳动）、排队 steering、token 桶、KV 缓存命中率、上下文占用、模型路由与工具卡模式，按终端宽度截断；终端标题跟随持久化会话标题。

## 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `sessionId` | string | `'main'` | 新会话的会话标识。 |
| `model` | string | — | 从启动器参数解析的 `provider/model` 路由。 |
| `showReasoning` | boolean | `true` | 渲染推理块；Ctrl+R 切换。 |
| `maxToolOutputLines` | number | `6` | 工具卡正文的预览行预算。 |
| `maxDiffEditLength` | number | `1000` | diff 预算；更大的编辑渲染完整两侧。 |
| `maxQuestionOptions` / `maxModelOptions` / `maxResumeOptions` | number | `8` | 选择器上限。 |
| `resumeScanConcurrency` | number | `4` | /resume 标题扫描的有界并行度。 |
| `questionDialogWidth` / `questionDialogMaxHeight` | number | `200` / `20` | 问题对话框几何。 |
| `modelDialogWidth` / `modelDialogMaxHeight` / `detailsDialogWidth` | number | `76` / `20` / `72` | 选择器几何。 |
| `fileSearchMaxResults` / `fileSearchMaxEntries` | number | `20` / `2000` | `@` 补全索引边界。 |
| `fileSearchExcludedDirectories` | string[] | `['node_modules', '.git', …]` | 补全索引排除项。 |
| `showHardwareCursor` | boolean | `false` | 使用硬件光标替代 Pi 文本光标。 |
| `frameBudgetMs` | number | `16` | 声明的渲染帧预算（Pi 自身的 16 ms 节流已覆盖同一目标）。 |
| `maxInitialMessages` | number | `200` | 初始 transcript 窗口内的用户消息数。 |
| `historyPageSize` | number | `100` | /more 每页加载的用户消息数。 |
| `transcriptResidentMaxBytes` | number | `4194304` | 驻留 transcript 字节预算。 |
| `cardCacheEntries` | number | `2000` | 驻留工具/上下文卡预算。 |
| `statusIntervalMs` | number | `500` | 运行期间页脚时钟的跳动间隔。 |
| `theme` | object | `{color: true, …}` | `color`、`truecolor`、提示符字符串。 |
| `title` | string | `'DeepSeek Harness'` | 回退终端标题。 |

## 模型体验

### 终端通道模型上下文

#### 模型看到什么

通道自身不贡献任何系统提示块。操作者输入作为普通用户消息提交（回合运行中则作为 steering）；`@` 补全展开为普通提示文本；会话引用在消息处注入其记录的上下文快照；`/model` 选择由 agent setup 钩子在每个步骤边界原子应用。对话框、状态页脚与 `/status` 卡是仅终端可见的诊断信息，永不进入请求。

#### Token 影响

通道自身对每个请求无影响；提示词与工具 token 属于基础行与所选模型路由。会话引用会为提交消息增加其快照自身的 token 开销。

#### KV Cache 影响

模型路由与 effort 选择会改变请求前缀，从而在下一个步骤边界改变 provider 的 KV 缓存命中面；其余内容复用缓存前缀。页脚的缓存率段反映已记录的用量。

## 已知限制与暂缓事项

- **同时只有一个会话** — 终端持有单个根智能体；没有多会话分屏（通过 /resume 切换会话，它会向宿主递交恢复请求）。
- **不支持鼠标交互** — 界面按设计仅键盘操作；对话框与选择器使用 Tab/方向键/Enter。
- **需要 TTY** — 非 TTY 进程上 `apply` 明确报错；请在 `dsh --profile tui` 内运行。
- **崩溃时的终端恢复** — 硬杀（SIGKILL）无法恢复备用屏幕；正常关闭路径（`/exit`、Ctrl+C/Ctrl+D、SIGTERM 处理）在退出前恢复终端。
