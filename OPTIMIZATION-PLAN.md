# dsh-tui-plugin 模块深度分析汇总与优化方案

> 生成方式：4 个子代理按模块并行深读（渲染管线 / 对话框与选择器 / 命令·补全·挂载 / tui-app 与工程链），
> 分别实测 14 / 74 / 8 个相关测试全绿后输出报告；本文件为主代理汇总后的统一优化方案。
> 基线：HEAD bb29dee，299 测试全绿（35 文件），lint 0 告警 0 错误，typecheck 1.9s，build 1.8s，
> 产物 packages/tui/lib/index.js 202.7 kB（gzip 56.3 kB），源码 6802 行，无 TODO/FIXME/console/any/死模块。

## 1. 模块现状总览

### M-A 渲染/呈现管线（components/*、chat/timing|tokens、index.ts 闭包内编排）
- **职责**：transcript 追加/折叠（index.ts:407-524）、事件分发 renderEvent（531-635）、历史分页 loadHistory（694-724）、
  驻留账本与淘汰（333-405）、status footer/prompt/终端标题刷新（273-311）；组件层在 components/transcript.ts
  （Header/UserMessage/StreamingAssistant/CachedCard/ToolCard/ContextCard）、theme.ts 单表调色板、xml-tool-output.ts（saxes 解析）。
- **机制**：pi-tui 每帧全树 render(width) + 新旧行 diff；CachedCardComponent 按宽度缓存行数组（transcript.ts:432-439）；
  流式按 chunk 全量 rebuild；淘汰按 UTF-16 length 计费、O(n) indexOf/shift；footer 每帧两次 openStepPhase 尾扫描 + tokenMeter.measure；
  diff 超过 maxDiffEditLength 回退整侧渲染（防巨型 pending edit 卡死）。
- **已知热点**：requestRender 每次全树 invalidate 打穿全部卡片缓存（index.ts:324）；流式 rebuild 呈二次方；
  footer 每帧 O(step) 尾扫描；Header/StatusCard 无缓存。

### M-B 对话框/审批/模型选择/resume/配置（components/dialogs.ts、chat/*）
- **职责**：TuiOverlayManager FIFO 单活跃模态 + GuardedOverlayComponent 错误围栏；QuestionDialog（选项/自定义/多选/分页/压缩布局）；
  ApprovalDialog；ModelDialog（过滤 + Shift+Tab effort 循环）+ createModelController（上下文窗口缓存、NO_ADAPTER 停车、串行队列）；
  ResumePicker + createResumeController（扫描代际计数 + AbortController + preflight + 终端交接）；session-reference 预留-释放协议；config.ts schema/resolve 双来源 parity。
- **机制**：/model 只写 ModelSelectionRef，由 prompt assembly 在步边界原子应用；既有竞态防护较完善（stale 早退、NO_ADAPTER 重试、
  扫描取消、preflight 复检、引用失败释放）。
- **已知问题**：render 方法带副作用（分页推进、focus 写入）；approval 尺寸硬编码不走 config；questions.ts 所传 options 对 inline 无效；
  question.intent 从未被读取；readModelChoices 每模型一次 resolveModelInfo。

### M-C 命令/补全/频道接线/扩展服务/挂载（chat/commands|autocomplete|file-autocomplete、extension/*、index.ts 装配）
- **职责**：命令注册走 agent-scoped fiber（10 条命令 + 每次执行独立 AbortController、dispose 全 abort、settle 后吞声）；
  补全三层并行合并（base/文件/会话，各自容错，abort 回退 base）；WorkspaceFileSearch 双态索引（目录级 live readdir 防 symlink 逃逸 +
  裸模糊查询全仓 BFS 上限 10k）；TuiOverlayManager 五类关闭原因幂等状态机；extension-service 以 ctx.effect 绑定调用方 fiber；
  mountTui/run/disposeRootAndExit（5s 兜底 + exit 单次守卫）；apply 双 TTY 检查 + COLORTERM 探测。
- **已知问题**：全仓扫描无时间预算、跨交互不缓存；无 @ token 时每键 invalidate 误杀扫描；'/' 前缀判定吞掉绝对路径消息；
  shutdown(false)/shutdown(true) 经 shuttingDown ??= memo 有吞 exit 竞态；全库无 SIGINT/SIGTERM 处理器；dispose 超时兜底直接 exit 可能残留 raw mode。

### M-D tui-app 包 + 工程链（cordis.patch.yml、startup.ts、CI/构建/链接脚本）
- **职责**：补丁层覆盖 base 的 system-prompt/tools 两行 + 插入 storage 栈/session-projection-cache/session-reference/tool-ask-user/tui-startup/tui 八行；
  tui-startup 解析 --resume/--session/--model/--tool-mode 并经服务提供不可变值（--help 不提供→终端不挂载）；invariant 空安装器伴生；
  link-harness.mjs 索引宿主 30 包注入 link: overrides；CI lint（自足）+ verify（clone pinned harness ref 47f9438 → install → 链接 → 四门禁）。
- **已知问题**：宿主 PROFILE_TEMPLATES 无 tui（未挂载入口）；cordis.patch.yml 零回归测试；startup.spec 夹具手抄 patch 表达式（掩盖漂移）；
  两段 tsc+tsdown 构建重复；CI 每环境重建 harness+lockfile；346 行打在 dist 上的 pi-tui 补丁维护风险；README 测试数 297 与实测 299 不符。

## 2. 优化项总表（34 项，来源子代理编号保留）

| ID | 模块 | 问题（证据） | 建议 | 工作量 | 风险 | 收益 |
|---|---|---|---|---|---|---|
| A1 | 渲染 | requestRender 全树 invalidate 打穿卡片缓存（index.ts:324→transcript.ts:432-434） | 删全树 invalidate，突变点定向 dropLines，仅 resize/主题切换级联 | M | 中 | 高 |
| A2 | 渲染 | 流式每 chunk 全量 rebuild 呈二次方（transcript.ts:328-341,385-395） | 增量追加子节点、settle 时一次重建；或按帧合并 delta | M | 中 | 高 |
| A3 | 渲染 | footer 每帧双 openStepPhase 尾扫描 + tokenMeter.measure（index.ts:283,285,299；timing.ts:161-185） | 相位改事件驱动缓存；context 占用改 usage 事件驱动 | S-M | 低 | 中 |
| A4 | 渲染 | Header/StatusCard 无行缓存（transcript.ts:153-171；dialogs.ts:187-225） | 复用 CachedCardComponent 宽度键缓存 | S | 低 | 低-中 |
| A5 | 渲染 | 淘汰账本 UTF-16 计费 + O(n) indexOf/shift（index.ts:397,367,419,428） | 按 displayText 计费、账本改链式 LRU、补引用释放断言 | M | 低 | 中 |
| A6 | 渲染 | 分页回放成本未量化（index.ts:704-724，一页最多 100 条用户消息全事件） | 加页加载预算测试，必要时惰性渲染 | M | 中 | 中 |
| A7 | 渲染 | 闭包残余编排（账本/append/renderEvent/loadHistory 仍在 168-1183） | 抽 eviction/render/footer 为 chat/ 控制器 | L | 低 | 长期可维护性 |
| B1 | 交互 | 同 A7（createTuiChat 约 1015 行） | 与 A7 合并执行 | L | 低 | 可读性/单测粒度 |
| B2 | 交互 | render 副作用：分页推进/focus 写入在 render 内（dialogs.ts:923,1015-1021,1104,405,624,842） | 分页移入 handleInput，focus 经 overlay 激活设置，render 纯读 | S-M | 中 | 渲染幂等 |
| B3 | 交互 | approval 硬编码 width:72/maxHeight:20（approval.ts:59-62）；questions options 对 inline 无效 | 尺寸走 resolved；driver.show 尊重 options | S | 低 | 一致可配置 |
| B4 | 交互 | readModelChoices 每模型一次 resolveModelInfo（dialogs.ts:112-130） | 批量接口或短缓存 + adapters-updated 失效 | S | 低 | /model 冷启延迟 |
| B5 | 交互 | question.intent 从未被读取（dialogs.ts 全文无 intent；plan-review 只渲染 detail/options） | 按 intent.kind 渲染 approve 风格默认选项 | M | 中 | plan-review 体验 |
| B6 | 交互 | prepare 失败无条件 editor.setText 覆盖用户新输入（index.ts:803） | 仅编辑器为空时恢复 | S | 低 | 修复竞态 |
| B7 | 交互 | 配置双来源（schema 表 config.ts:71-98 + resolveTuiConfig 189-217），新 knob 改 5 处 | 由 {key,schema} 表生成两者，parity 测试保留 | M | 低 | 一处登记 |
| B8 | 交互 | ResumePicker/ModelDialog/QuestionDialog 三处过滤/输入/bracketed-paste 重复 | 抽共享搜索框组件 | M | 中 | 一致性 |
| C1 | 补全 | 裸 @ 查询全仓串行 BFS 至 10k，无预算不缓存（file-autocomplete.ts:138,176-200；index.ts:643） | 时间预算续扫、mtime 增量、空闲预热 | M | 中 | 大仓补全延迟 |
| C2 | 补全 | 无 @ token 每键 invalidate 误杀扫描（autocomplete.ts:41-43） | 仅离开 @ 上下文时失效 | S | 低 | 扫描稳定性 |
| C3 | 补全 | listDirectory 每键重读并排序（file-autocomplete.ts:202-222,252-257） | 短 TTL 按目录缓存 | S | 低 | 键延迟 |
| C4 | 补全 | scoreCandidate 对 10k 候选逐键 lowercase+子序列 O(n·m)（289-313） | 索引预存小写名、query<2 跳子序列 | S | 低 | 排序开销 |
| C5 | 命令 | '/' 前缀判定吞掉绝对路径消息（commands.ts:238；注册表 /^\/[a-z][a-z0-9_-]*/） | 用 parseCommand 对齐注册表，非命令形回落为消息 | M | 中 | 行为正确性 |
| C6 | 接线 | shutdown(false/false) 与 shutdown(true) 经 ??= memo 吞 exit（index.ts:904-905） | memo 内记录 exit 标志、可升级 | S-M | 低-中 | 退出正确性 |
| C7 | 接线 | 全库无 SIGINT/SIGTERM 处理，信号杀进程残留 raw mode/alt screen | apply 边界装 process.once→shutdown/restore，接缝化 | M | 中 | 终端安全 |
| C8 | 接线 | 闭包 wiring 顺序敏感（shutdown 引用后置定义、forward 声明） | 构造后统一装配 dispose 清单 | S-M | 低 | 可维护性 |
| C9 | 接线 | dispose 5s 超时直接 exit，dispose 未完成即退（index.ts:1294） | 超时前走终端恢复接缝（与 C7 合并实现） | S-M | 低 | 终端安全 |
| C10 | 命令 | /details 手写 tokenizer（commands.ts:114-142） | 抽 mini 参数解析器 | S | 低 | 可维护性 |
| D1 | 发布 | 宿主 PROFILE_TEMPLATES 无 tui，无挂载入口（README.md:19；profile.ts:114-117） | npm 发布两包 + 文档化安装 + 上游 PR 增模板 | M | 高 | 从代码就绪到可安装 |
| D2 | 工程 | cordis.patch.yml 零回归测试（宿主 base.spec.ts:15-42 未随抽取） | 新增 bundle.spec.ts：解析、行 id 无碰撞、注入关系、!!js 可 evaluate | S | 低 | 防宿主升级漂移 |
| D3 | 工程 | startup.spec 手抄 patch 表达式（startup.spec.ts:58-68） | 夹具改从 cordis.patch.yml 构造 | S | 低 | 防同源漂移 |
| D4 | 工程 | 两段 tsc+tsdown 构建重复；typecheck 再跑两遍 tsc --noEmit | tsdown dts:true 单趟（或 emitDeclarationOnly），两包并行 build | M | 中 | 构建链简化 |
| D5 | 工程 | CI verify 40 分钟上限，每环境克隆+构建 harness+重建 lockfile | 按 DSH_HARNESS_REF 缓存 store/产物、探索可提交的相对 link: | M | 中 | CI 时长 |
| D6 | 工程 | link-harness.mjs 默认 root 硬编码、不验证 harness 已 install、无误提交保护 | 必填报错、校验 node_modules、CI 加无托管块检查 | S | 低 | 健壮性 |
| D7 | 工程 | 346 行 pi-tui 补丁打在 dist，版本精确锁定 0.80.7（patch:1-346） | 上游化 PR；CI 安装后 grep patched dist 断言生效 | M | 中 | 补丁维护风险 |
| D8 | 工程 | 文档漂移：README 测试数 297≠299、patch 位置描述过时、./src/* 导出但 files 不含 src | 修正文档与 files 清单（或去掉 src 导出） | S | 低 | 文档一致性 |
| D9 | 工程 | 宿主 base 新增 plan-mode/telemetry/ralph 等行自动进入 tui 组合、无人评估；hmr 未像 headless 显式禁用 | 按 headless 模式做行集适配评审 | S-M | 低 | 宿主升级适配 |

## 3. 优化方案（决策）

分四个 Round 实施，每轮结束后跑全部门禁：pnpm lint + typecheck + test（299 测试、13 快照逐字节不变）+ build + 节点导入冒烟。
快照不变是渲染与交互类改动的强制安全网。

### R1 正确性、终端安全与文档一致性（先做，低风险快赢）
按序实施：C7+C9（SIGINT/SIGTERM 恢复 + 超时前终端恢复，合并为一个接缝）、C6（shutdown memo 可升级 exit）、
B6（编辑器覆盖竞态）、C5（'/' 与 parseCommand 对齐）、C2（slash invalidate）、B3（对话框尺寸走 config）、
D8（文档/manifest 漂移）、D6（link-harness 健壮性）。
- 预估：约 4-6 人日（8 项 S-M）。
- Gate：299 全绿 + 为 C5/C6/B6/C2 各补 1-2 个回归测试；C7 以假 terminal 断言恢复调用序列。

### R2 性能热路径（最高收益，测量先行）
按序实施：A1（去全树 invalidate，最大单项收益）、A3（footer 事件驱动缓存）、A4（Header/StatusCard 缓存）、
C3+C4（补全目录/排序缓存）、C2 的剩余部分、C1（扫描预算/增量/预热）、A5（淘汰账本 LRU+准确计费）、
B4（readModelChoices 批量）、A2（流式增量渲染）、A6（先加分页预算测试，按数据决定是否惰性渲染）。
- 预估：约 10-15 人日。
- Gate：既有 perf 预算（挂载 <1s、按键 <50ms/键、稳态 4 万次渲染 <1s、定时器无泄漏）不回归；
  为 A1/A3/A6 新增通道内成本断言（当前缓存断言绕开通道，是测试盲区）；快照逐字节不变。

### R3 架构可维护性重构（承接 P2 路线图）
实施：A7+B1（闭包残余拆分：eviction/render/footer 控制器）、B2（render 纯化）、B7（配置单表化）、
B8（共享搜索框）、C8（wiring dispose 清单）、C10（/details 参数解析器）、B5（question.intent 渲染，需对齐 dsh-user-questions 语义）。
- 预估：约 12-18 人日（含一个 L 项）。
- Gate：全绿 + 快照不变 + 新拆分模块各配单测（对照 OPTIMIZATION-JOURNEY 的拆分经验：deps 注入 + 逐帧对齐）。

### R4 工程链与集成发布（P3）
实施：D4（构建单趟化，产物逐导出比对）、D5（CI 缓存）、D2（补丁层回归测试）、D3（夹具去重）、
D9（宿主行集适配评审）、D7（补丁上游化 + CI 生效断言）、D1（npm 发布 + 宿主挂载入口；依赖 scope 发布权限与 rc.5 版本对齐，需外部协调）。
- 预估：约 8-12 人日（D1/D7 含外部依赖，可并行推进）。
- Gate：build 产物与 exports/files 对齐 + node import 冒烟（19+3 符号）；CI verify 时长下降且可复现；
  bundle.spec 锁定 patch 行 id 与 base 无碰撞。

### 并行策略与依赖
- R1 内 8 项互相独立，可并行分包；R2 中 A1 是其他渲染优化的前置（先修 invalidate 才能让 A3/A4 的缓存真正生效于通道内）；
  C 组与 A 组互不依赖可并行；R3 依赖 R1/R2 的测试加固；R4 的 D2/D9 依赖宿主行集信息，可与 R1-R3 并行。
- 各 Round 完成后照仓库惯例更新本文档 checkbox 与 Evidence（参照 GOAL-PLAN.md 协议）。

## 4. 测试盲区补齐（穿插在各 Round 的 Gate 中）
1. 通道内缓存成本断言（A1）与流式吞吐基准（A2）——perf.spec 扩展。
2. PTY e2e（原仓 tui-keyless-replay.e2e.ts 未随抽取）——R2 后引入，覆盖 SIGINT/SIGTERM 恢复与真实按键。
3. cordis.patch.yml 解析/行 id 防碰撞测试（D2）。
4. 淘汰后组件引用释放断言（A5）。
5. 覆盖率阈值恢复评估（原仓 100%/文件，独立仓未复测）。

## 5. 终态 DoD
- [ ] 299 测试全绿且 13 个 keyless 快照逐字节不变（全程）
- [ ] R1 后：终端信号恢复可用（假终端断言 + 手动 PTY 冒烟）；C5/C6/B6/C2 各有回归测试
- [ ] R2 后：perf 预算不回归 + 新增通道内成本断言；大仓补全基准（≥5k 文件目录）延迟改善可测量
- [ ] R3 后：createTuiChat 闭包 ≤ 装配职责；render 方法纯读；新 knob 一处登记
- [ ] R4 后：CI verify 时长下降、构建单趟化、bundle.spec 就位、发布通道打通（或明确阻塞项）
- [ ] 文档与代码一致（README 测试数、patch 位置、files 清单）
