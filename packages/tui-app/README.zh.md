# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

dsh 终端启动粘合插件。可安装的 profile 组合包位于仓库根（根级 `cordis.patch.yml` + 已提交的 `lib/` 产物）：它在 `dsh-base` 之上覆盖编码 persona、接通工具展示模式、插入存储栈（/resume 标题的持久化 checkpoint 缓存）、会话引用提供方、`tui-startup` 参数提供方、`tui` 行本身、**agent-presets 预设名册**（默认 `standard`）与 `code-runtime` 行，并像 web 界面一样禁用宿主平面上的 agent 行，使每个会话挂载的预设成为模型唯一可见的工具集。

## 启动

`tui-startup` 插件（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（宿主提供的 `dsh-cmdline`），解析 `dsh --profile tui` 参数族，并提供不可变的 `tuiStartup` 服务；需要它的行注入该服务并从惰性配置读取，因此 `--help`（不提供任何值）永远不会挂载终端。服务键在这里重复定义（而非导入），使根包 startup 产物保持自包含；测试将两份定义锁定为相等。

| 参数 | 效果 |
|---|---|
| `--resume <sessionId>` | 恢复持久化会话，而非新建。 |
| `--session <sessionId>` | 本次调用新建会话的显式 id。 |
| `--model <provider>/<model>` | 本会话的 provider/model 路由。 |
| `--tool-mode <native\|code\|both>` | 工具展示模式；覆盖 `DSH_TOOLS_MODE` 与 schema 默认值。 |
| `--preset <id>` | 以指定 agent 预设组合本会话；缺省挂载名册默认预设。恢复的会话保持其记录的预设；与记录矛盾的 `--preset` 会启动失败。 |

## goal 栈关系

该 profile 骑在 `dsh-base` 的 goal 栈之上（goal 服务 + projection + 命令单元）：终端渲染的 goal 状态行来自持久化 goal projection，goal 命令（`/goal`）是通道命令分发执行的 agent 作用域注册；base 的 `interaction`/approval 行为终端审批对话框供料。

## 模型体验

### 终端组合包模型上下文

#### 模型看到什么

本组合包自身不添加任何提示内容；它只选择 persona 文本（base 持有）、工具模式与从 `--model` 解析的模型路由。所有模型可见内容来自 base 行与终端通道（`dsh-tui`）。

#### Token 影响

本包无影响；persona 与工具选择属于 base 行。

#### KV Cache 影响

无；启动提供方不向任何请求前缀添加内容。

## 已知限制与暂缓事项

- **需要终端** — 该 profile 仅交互式；非 TTY 调用在 `tui` 插件的 `apply` 中明确报错（`--help` 与 `--dump-default-config` 除外，它们不会挂载终端）。
- **单一终端界面** — 该组合包只挂载一个 `tui` 行；多界面布局需要另一个组合包。
- **pi-tui 补丁分发** — 编辑器 prompt/frame 补丁（仓库 `patches/`）在构建期经由本工作区的 `patchedDependencies` 生效，并随已提交的根产物 `lib/tui.mjs` 一起分发；未打补丁树本地构建的产物会回落到默认边框与提示符（仅外观差异）。将补丁上游化到 pi-tui 可消除此限制。
