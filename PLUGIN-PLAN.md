# dsh-tui-plugin 插件化与预设切换实施方案

> 基于 dsh-v0.1.1-rc.2（b150a551b8）机制调研（子代理 E/F/G 报告）制定。
> 基线事实：299 测试全绿、typecheck 通过；机制核心文件 rc.5→rc.2 零变化（plugin.ts/args.ts/profile-boot.ts/profile.ts 0 diff），
> TUI 现有 dsh.bundle.patch 声明已满足插件门槛。

## 目标
1. 做成真正可用的 dsh 插件（dsh plugin --profile tui add 即可安装）
2. 正常安装/卸载（remove 干净剔除 bundles/dependencies/node_modules）
3. TUI 支持 Agent 预设：启动选择（--preset / 交互选择）、空白会话内切换（/preset）、开始后锁定并提示新建会话

## 关键机制事实（证据）
- 插件 = 声明 "dsh":{"bundle":{"patch":"./cordis.patch.yml"}} 的 npm 包（profile.ts:42-45）；install/uninstall = pnpm 透传 +
  reconcilePlugins 按安装态对账 dsh.profile.bundles（plugin.ts:59-91）。
- profile 初始化 bundles=['@deepseek-ai/dsh-base']，无 tui 模板亦可（DEFAULT_PROFILE_BUNDLES）。
- 唯一硬阻塞：@deepseek-ai/dsh-tui 是 tui-app peer，autoInstallPeers:false → 不会进 profile node_modules。
- 预设 = 目录含 agent.cordis.yml；standing mount 每进程一次；agent scope parent 链 agent→preset→global。
- mount 唯一合法调用点 = agent factory setup(agentCtx)（agent-presets/index.ts:275-288）。
- 切换 = blank 会话上 recompose + append agent-preset/selected 事件；非 blank 锁定（api-proxy.ts:2984-3034）。
- blank 判定：无 turn/start 事件（api-proxy.ts:448-450）。
- 无 --preset 旗标先例；resume 与 log 冲突时 web 报 agent-preset-conflict（api-proxy.ts:1143-1150）。

## 实施步骤

### R1 插件化打通（安装/卸载）
- [x] 1. tui-app/package.json：@deepseek-ai/dsh-tui 从 peerDependencies 移入 dependencies（devDependencies 条目同步清理）
- [x] 2. 两包 peers 补 @deepseek-ai/dsh-agent-presets（devDependencies 同步补，类型用）
- [x] 3. CI：DSH_HARNESS_REF 47f9438 → b150a551b8（dsh-v0.1.1-rc.2）
- [x] 4. 新增 bundle.spec：解析 cordis.patch.yml（entryListSchema）、断言 dsh.bundle.patch 声明、行 id 无碰撞、tools/tui 注入 tuiStartup
- [x] 5. e2e 冒烟（本地）：DSH_HOME 指向临时目录 → dsh plugin --profile tui add <本仓 tui-app 路径> → dsh --profile tui 启动校验 → remove 后 bundles/dependencies 清空
- [x] 6. README 安装/卸载用法更新

### R2 预设能力接线
- [x] 1. tui-app/cordis.patch.yml：insert agent-presets 行（id: agent-presets, name: '@deepseek-ai/dsh-agent-presets', config: { default: standard }）
- [x] 2. 镜像 web-app 的 host 平面 agent 行 disable 段（web-app/cordis.patch.yml:314-429）+ 移除 TUI 全局 tool-ask-user 行
- [x] 3. insert code-runtime 行支撑 code 预设（web-app:47-49 同款）
- [x] 4. runtime.ts：TuiStartupValues 增 preset 字段；startup.ts 增 --preset 旗标
- [x] 5. index.ts run()：create 前 resolve(presetId ?? default)；meta.agentPreset 入 header；setup = installSelection + mount(agentCtx, preset.id)；resume 用 resolveSessionPreset 组回，冲突报错；无 roster 跳过（现状兜底）
- [x] 6. /preset 命令 + 选择对话框（list() → 名称/描述/trust/broken）；blank → recompose + append agent-preset/selected；非 blank → 提示锁定（新建会话可换）
- [x] 7. /status 卡片显示当前预设
- [x] 8. 测试：setup 挂载/恢复/冲突/blank 切换/事件追加的单元测试（presets.spec 5 例 + mount.spec 4 例 + startup.spec 1 例 + bundle.spec 5 例）

## 验证门禁（每轮）
pnpm lint + typecheck + 299 测试全绿 + 快照逐字节不变 + build + 导入冒烟；R1 后加本地 dsh plugin 安装/卸载 e2e。

## 开放问题（随实现定案）
- resume 时 --preset 与 log 冲突语义（照 web：报错退出？还是覆盖？）→ 倾向照 web 报 agent-preset-conflict
- TUI 单 agent 模型下"切换预设"的边界：blank 可 recompose；开始后只能换会话（对齐 web）
- dsh-agent 是否升为 runtime peer（类型仅编译用，devDep 已足；观察 install 语义再定）
