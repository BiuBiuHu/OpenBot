# 用户自带 ECS：实施计划

## 0. 版本历史

| 版本 | 日期 | 变更 | 原因 | 影响 |
|---|---|---|---|---|
| v0.1 | 2026-11-20 | 调研后划分实施阶段 | 收敛为用户选定的三类能力 | 未修改业务代码、未连接或部署 ECS |

## 1. 当前决策

模式：manual-gated 规划。原始目标为查看项目并研究实现方式；本轮完成代码核对、参考项目调研、需求与架构建议。后续实施沿用该范围，无需重新讨论桌面或推翻 Pi/OH；真实部署必须具有指定测试环境。

## 2. 项目发现

- 仓库：OpenBot-client，npm，TypeScript，Node >=22.19.0；`npm run dev`，默认本地端口 3847。
- `npm test` 为本地测试入口，`tsc --noEmit` 可检查类型且不覆盖 dist；配置样例 `.env.example`。
- 基线：`cursor/openbot-pi-kernel-74e9` / `08d8919`。已有 src/pi-kernel.ts、src/ui/index.html、A2A card、tests、package-lock 及多份文档未提交，均保留。
- 本轮新增文档统一在本目录；旧 feature 文档不覆盖。进入实现时补 PRD、UI 原型及结构化测试用例，沿用 REQ-ECS ID。

## 3. 保存点

本轮只新增规划文档，未修改、提交或暂存既有业务改动。实施前按 OPC 要求为当前脏工作区建立保存点，再同步默认分支并建立隔离 feature 分支；不能直接切换分支丢失现有 Pi/A2A 工作。

若默认分支缺少当前未提交的 Pi/A2A 依赖，先明确集成来源并保存，不能在实现中无声退回旧路由。删除本次新增 feature 文档可撤回本轮产物，不影响已有代码。

## 4. 变更清单

| 模块 | 拟改动 | 验证 |
|---|---|---|
| connect/ssh/tunnel/config | 分离 A2A/OH 地址；主机 identity；无桌面依赖的连接状态 | 无卡、错误 key、端口冲突、切主机 |
| bootstrap + CLI | 固定版本远端 adapter/OH 启动入口、预检/安装进度、systemd | 空白测试 ECS 安装、二次执行不丢数据 |
| a2a-adapter | 异步任务、鉴权、持久 TaskStore、恢复对账 | 提交快速返回；进程重启后查询 |
| remote-agent/session-tools/pi-kernel | 保留 thread/context/task ID、任务观察恢复、能力刷新 | 跨轮上下文、不回退本机执行 |
| server/UI | 设置检查项、任务卡、进度、审批、文件面板 | 真实交互和错误/空态 |
| OH client/adapter policy | 执行侧审批、取消、预算 | 无破坏性工具的允许/拒绝、副作用计数 |
| legacy worker | 保留旧路径，必要可靠性修复单独评估 | 不混用 task/job、不双执行 |

## 5. 执行顺序

| 阶段 | 任务 | 退出条件 | 失败处理 |
|---|---|---|---|
| A | 锁定 OH/SDK 兼容矩阵，核验远端审批和持久化 | 明确 API、版本、测试夹具 | 能力不支持则调整 adapter 方案，不绕审批 |
| B | 持久 adapter + 幂等接收/查询 + 固定启动入口 | 本地集成可恢复 taskId，重复提交一次执行 | 失败保留证据，先修状态契约 |
| C | 主机预检/安装与 UI 首次接入 | 设置 → 真实 ECS 创建/读回 notes.md | 指明 SSH/版本/模型/工具哪个环节失败 |
| D | 线程恢复、远端审批、取消、文件与日志 | REQ-ECS-001～007 用例完成 | 按最小失败链路修复复验 |
| E | 测试 ECS 合盖等价验收、回滚演练 | 停本地主服务后任务仍完成，重开查同一结果 | 不把探活或 mock 标成完整通过 |

## 6. 自动执行循环

每轮只变更一条完整调用链，先测试协议和异常，再进入真实 UI。失败记录请求、任务状态、事件与文件证据，修复后只重跑相关回归。真实模型测试先用小任务，确认预算后运行；没有明确目标机器时不自动 SSH 探测私人配置中的主机。

本轮验证（2026-11-20）：

| 检查 | 结果 | 证据边界 |
|---|---|---|
| `./node_modules/.bin/tsc --noEmit` | 通过，exit 0 | 类型检查，不是远端能力验证 |
| `./node_modules/.bin/tsx --test tests/worker.test.ts tests/a2a-adapter-cases.test.ts tests/pi-kernel.test.ts tests/oh-client.test.ts` | 56 项，55 通过、1 失败，exit 1 | 本机 mock/临时 Python worker，无真实模型或 ECS |
| TC-REMOTE-001 | 断言 `/Linux/`，本机 worker 的 uname 返回 Darwin，失败 | 测试平台假设不成立；不可改成假 Linux 输出来通过 |
| TC-PERSIST-001 | 通过 | 只证明测试中的客户端断连，不证明停止本地主服务或重启 ECS 后的完整恢复 |
| `git diff --check` | 通过 | 既有 tracked diff 无空白错误；新增文档另回读检查 |

现阶段源码审查与本地测试均不等于 REQ-ECS-001～007 的真实 ECS 验收。未运行 UI 交互、真实 SSH、模型计费任务或远端部署。

## 7. 兼容、迁移与回滚

旧 worker 和 OH 调试接口保留但不伪装成新异步任务；新任务 schema 带版本号。迁移现有配置要保留用户值，新增 A2A endpoint 不覆盖 OH endpoint。部署锁定版本、备份控制状态与 OH 会话，保留工作区。生产发布、公开端口、多用户和云资源购买均不包含在本计划的已执行动作中。

## 8. 风险与未解决问题

- 本机与远端当前运行版本尚未核验；本轮没有真实机器访问证据。
- 远端审批是 P0，现有 NeverConfirm 不可当成完成。
- 现有任务/线程内存状态不足以支持重启；须先做服务端契约再做漂亮 UI。
- 安装到现有 ECS 可能与原服务/目录冲突，预检必须输出具体影响，再执行获授权的安装。

## 9. 实施更新（2026-11-20）

用户已明确授权独立可扩展 Bot 的实施与既有 ECS 联调，明确禁止将代码引入安派仓库。模式改为 implementation-loop。
保存点：stash `savepoint: plugin implementation with anpai boundary 2026-11-20`，保留。main 从 origin/main 同步至 0d5eb944，再创建 codex/byo-ecs-control；fast-forward 引入已有 Pi/A2A 提交至 08d8919，并恢复用户未提交改动。最初仓库 refspec 只抓旧分支，已显式 fetch main，未重写历史。

实施收敛：新增独立 REST /v1 任务 runtime，原 A2A 路径保留；独立测试页面 /bot 直接验证完整远端模型任务，避免依赖本机 Pi 运行才能继续。契约位于 src/bot/contracts.ts，可供未来 API 客户端使用。轻量原子 JSON 文件持久化复用现有 worker 的磁盘模式，增加进程排他、requestId 幂等；首版无需 SQLite/native 驱动。不支持多进程写同一数据目录。

本次只修改 OpenBot-client。安派代码、数据库和部署完全独立；后续只接 API。
