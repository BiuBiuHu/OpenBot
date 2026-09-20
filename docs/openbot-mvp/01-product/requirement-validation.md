# OpenBot MVP 需求验证

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始验证 | 用户要求可安装垂直切片，且后续必须走 opc-skills | 锁定 Bind / Persist / Remote 三条 P0 |
| v0.2 | 2026-09-20 | Bind/Persist/Remote 纳入远端 Agent 循环；补 1:1 / 群组 | 用户确认常驻 Agent + 本地会话面 | 思考权威在主机；群组不挡 P0 |

## 1. 当前结论

- 是否可以进入 PRD/UI/架构：**可以**。用户目标已澄清：SSH 自己的机器当 Agent PC；远端是 **think+execute 的 `openbot-agent`**；BYOK；合盖不丢任务；本机要能 1:1 与（v0.5）群组跟 Agent 说话。
- 是否需要竞品调研：**需要**，见 `../00-research/competitor-research.md`。
- 是否需要用户确认：产品隐喻已锁定；本 Code PR 同时交付文档与可运行 MVP（用户明确要求“文档+MVP 一起成 PR”，视为实施授权）。
- 当前最大风险：本环境可能没有用户真实 VPS；必须用本机 SSH 或直接 worker 证明 `uname -a` 在“远端”执行，并在文档中区分实验室主机与用户 VPS。

## 2. 目标澄清

- 用户真正想完成的业务结果：克隆仓库后，把**自己的** Linux 机器变成一台一直在线的 Agent PC；本机跟这名 Agent（以及以后的 Agent 群）聊天遥控；钥匙（SSH + 模型 key）留在用户手里。
- 主要用户/角色：个人开发者 / 自托管爱好者（C 端）。无 B 端运营台。
- 核心操作闭环：`init` → `bind` 经 SSH 安装 **openbot-agent** → 本机发消息/创建任务 → **远端 Agent 循环**想和做 → 合上笔记本 → 再打开能看到任务事件或待审批。
- 工作单元和批量范围：v0 **单条任务 / 单条 1:1 对话**。v0.5 房间可扇出多任务。无批量生图、无批量扣费。
- 成本、时延和质量约束：目标机 2C4G 无头**单进程**；模型调用走用户 BYOK（目标态在主机）；危险命令必须先审批；本机可关，**Agent 循环**不可因合盖而死。
- 返工/重试/回滚粒度：重新 `bind` 可覆盖 Agent；拒绝危险命令即不执行；无数据库迁移。
- 已向用户确认的结论：隐喻对齐 Grok Bot 的“持久电脑 + 聊天遥控”，不对齐托管与账单；远端是 Agent 不是哑 Worker；computer-use ≠ Agent；群组不阻塞内核。
- 仍需反问用户的问题：无阻塞问题。真实公网 VPS 由用户在自己环境配置。

## 3. 需求拆解

| 需求 ID | 需求描述 | 用户/角色 | 场景 | 优先级 |
|---------|----------|-----------|------|--------|
| REQ-OPENBOT-001 | Bind：用 SSH 把一台 Linux 主机登记为“我的电脑”并 bootstrap **openbot-agent** | 个人用户 | 首次安装 | P0 |
| REQ-OPENBOT-002 | Persist：Agent 进程 + 任务/事件在笔记本断开后继续（含**远端 Agent 循环**） | 个人用户 | 合盖、断网、关 UI | P0 |
| REQ-OPENBOT-003 | Remote：远端 Agent 循环 + shell / 工作区文件工具执行并回传 | 个人用户 | 聊天或 `openbot run` | P0 |
| REQ-OPENBOT-004 | BYOK：OpenAI-compatible 密钥跟模型循环走（目标态在主机 secrets） | 个人用户 | 聊天 | P0 |
| REQ-OPENBOT-005 | 危险命令审批门：执行前必须批准 | 个人用户 | `rm -rf` / `sudo` / 关机 等 | P0 |
| REQ-OPENBOT-006 | 2C4G 无头单进程；禁止伪称 Firecracker / 像素桌面；computer-use ≠ Agent | 所有人 | 文档与实现 | P0 |
| REQ-OPENBOT-007 | 密钥与 token 只在 `~/.openbot*`，永不入库 | 所有人 | 配置 | P0 |
| REQ-OPENBOT-008 | 新鲜克隆 → 配置 SSH+key → 聊天或 run → `uname -a` 来自远端 | 贡献者 | 安装验收 | P0 |
| REQ-OPENBOT-009 | 本机 1:1 具名 Agent 会话：消息创建/续跑任务，流式思考/工具/审批进线程 | 个人用户 | 每天遥控 | P1 |
| REQ-OPENBOT-010 | Agent 群组：房间（用户+多名 Agent）、mention/编排路由、按 Agent 扇出任务 | 个人用户 | 多角色协作 | P2 |

## 4. 歧义、冲突和隐藏假设

| 类型 | 问题 | 影响 | 处理结论 |
|------|------|------|----------|
| 歧义 | “远端”是用户 VPS 还是本机 loopback | 验收环境 | 产品路径永远是 SSH；测试可用 localhost SSH 或直接打 worker，但 UI/CLI 文案必须说“host”不是“this browser” |
| 假设 | 主机有 `python3` + `bash` | bind 失败 | bootstrap 明确失败并打印日志；不静默降级到本机执行 |
| 冲突 | opc-skills 默认先审文档再编码 | 已有脚手架 | 用户第二轮明确要求把进度折进文档并完成 docs+MVP PR，走 `implementation-loop` |
| 假设 | 用户会提供 LLM key | 聊天 | 无 key 时 `run` 仍可用；聊天明确报错，不假装模型 |
| 歧义 | Worker / Agent / computer-use | 产品与架构 | Worker=只执行；Agent=思考+执行；computer-use=工具 plugin。已锁定 |
| 假设 | 合盖后仍要“想”而不只是跑完已派发的 shell | Persist | 模型循环必须在远端 Agent，不能只留在笔记本 |

## 5. 状态、权限和环境

- 状态机：未配置 → 已 init → 已 bind → 隧道连通 → 任务 `queued → running → awaiting_approval → succeeded|failed|cancelled|timeout`。
- 角色权限：单用户，SSH 账号即该主机执行账号。无多租户。群组里每名 Agent 仍只在自己的 SSH 用户下动手；编排器无额外工具权。
- 预发/线上差异：本产品是本地可安装应用，**没有托管 SaaS 预发**。共享环境发布不适用；“发布”= GitHub 默认分支上的可克隆提交。
- 数据来源：主机 `uname`、workspace 文件、任务事件；模型响应来自用户指定的 OpenAI-compatible 端点（由远端 Agent 调用）。
- 数据写入和副作用：远端 shell、workspace、`~/.openbot-agent`（迁移期兼容 `~/.openbot-worker`）、本机 `~/.openbot/config.json`。

## 6. 边界、异常和成本保护

- 空态：未 bind / worker 不可达 / 无 job。
- 错误态：SSH 失败、bootstrap 失败、无 API key、审批拒绝、命令非零退出。
- 慢请求/超时：job `timeout_sec`；隧道 `ServerAliveInterval`。
- 重复提交：每次 run 新 job id；审批 id 一次性。
- 并发/顺序：v0 Agent **同时只跑一条模型循环**；队列可堆积。聊天一轮 tool 上限沿用实现常量。群组扇出 = 多名 Agent 各跑自己的循环。
- AI/生成成本保护：无生图。聊天才打模型；`openbot run` 零模型成本。危险命令先审批再执行（低成本确认 → 高风险执行）。
- 缓存/对象存储复用：不适用（无 OSS）。
- 最小返工粒度：单条命令 / 单次审批。

## 7. 验收证据映射

| 需求 ID | 验收标准 | 证据类型 | 负责环节 | 不可接受结果 |
|---------|----------|----------|----------|--------------|
| REQ-OPENBOT-001 | `openbot bind` 经 SSH 安装 Agent（现阶段实现仍可为 PR#1 worker bootstrap）并打印 persist | 命令输出 / 日志 | 研发+QA | 只在本机偷偷执行却显示“已绑定” |
| REQ-OPENBOT-002 | 断开本机后常驻进程仍监听，**任务/循环**文件仍在 | 进程 + 远端 tasks/jobs | QA | 关 CLI 后思考与执行一起死且无文档 |
| REQ-OPENBOT-003 | `uname -a` 输出含远端内核字符串；目标态合盖后 Agent 循环仍能推进任务 | 测试 + 命令输出 | QA | 返回笔记本内核却声称远端 |
| REQ-OPENBOT-004 | 无 key 时聊天失败；key 不入库；目标态由 Agent 读取主机 secrets | 测试 + 代码审 | 研发 | 密钥进 git |
| REQ-OPENBOT-005 | `rm -rf /` 类命令先 approval 再执行 | 单测 + UI/CLI | QA | 自动跑破坏性命令 |
| REQ-OPENBOT-006 | README/架构明确无桌面、无 Firecracker；区分 Worker/Agent/computer-use | 文档审 | 产品 | 营销对等声明 |
| REQ-OPENBOT-007 | `.gitignore` 忽略 `.env`；config mode 0600 | 文件 + 测试 | 研发 | 示例里填真实 key |
| REQ-OPENBOT-008 | README 给出可复制安装命令且 `npm run build` 可用 | 安装复跑 | 联调 | 只有定位文案没有入口 |
| REQ-OPENBOT-009 | 1:1 线程能发消息并看到思考/工具/审批事件 | UI / 契约 | 研发 | 聊天只在本机循环、合盖即停思考 |
| REQ-OPENBOT-010 | 房间模型与扇出规则写进架构；实现不挡 Phase 1 | 文档 | 产品 | 为群组先拆微服务 |

## 8. 未解决问题

- 用户真实公网 VPS 不在本 Agent 环境内；实验室用 localhost SSH 或 worker 直连代替，并在测试报告标明。
