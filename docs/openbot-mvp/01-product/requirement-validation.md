# OpenBot MVP 需求验证

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始验证 | 用户要求可安装垂直切片，且后续必须走 opc-skills | 锁定 Bind / Persist / Remote 三条 P0 |
| v0.2 | 2026-09-20 | Bind/Persist/Remote 纳入远端 Agent 循环；补 1:1 / 群组 | 用户确认常驻 Agent + 本地会话面 | 思考权威在主机；群组不挡 P0 |
| v0.3 | 2026-09-21 | 聊天窗口含本机 LLM 模式 | 聊天 ≠ 总是 Agent | 默认不上 VPS；REQ-011 |
| v0.4 | 2026-09-21 | 改为本机 Agent 交接流 | 不是三个对等 mode | 本机=编排；远端=电脑 |

## 1. 当前结论

- 是否可以进入 PRD/UI/架构：**可以**。用户目标已澄清：SSH 自己的机器当 Agent PC；**本机 Agent** 规划/编排；需要电脑时**交接**给远端 `openbot-agent`；结果回流同一线程再收尾。**不是三个对等 mode。** 群组后置。
- 是否需要竞品调研：**需要**，见 `../00-research/competitor-research.md`。
- 是否需要用户确认：产品隐喻已锁定；本 Code PR 同时交付文档与可运行 MVP（用户明确要求“文档+MVP 一起成 PR”，视为实施授权）。
- 当前最大风险：本环境可能没有用户真实 VPS；必须用本机 SSH 或直接 worker 证明 `uname -a` 在“远端”执行，并在文档中区分实验室主机与用户 VPS。

## 2. 目标澄清

- 用户真正想完成的业务结果：跟本机 Agent 想清楚；需要电脑时交接给**自己的** Linux 主机上的远端 Agent；结果回到同一条对话再收尾。钥匙留在用户手里。
- 主要用户/角色：个人开发者 / 自托管爱好者（C 端）。无 B 端运营台。
- 核心操作闭环：本机 Agent 规划 →（可选）`bind` → 提出交接（确认）→ 远端执行 → 回流同一线程 → 本机收尾。合盖停规划，已交接任务继续。
- 工作单元和批量范围：v0 **一条线程** + 零或多条远端任务。群组扇出后置。无批量生图、无批量扣费。
- 成本、时延和质量约束：2C4G 无头**单进程**远端；本机 Agent 用笔记本 BYOK，远端用主机 BYOK；交接先问、危险工具再问。
- 返工/重试/回滚粒度：拒绝交接或拒绝审批；重新 `bind`；无数据库迁移。
- 已向用户确认的结论：本机 Agent 没有电脑，远端才有；不是三个 mode 切换器；computer-use ≠ Agent；群组不阻塞内核。
- 仍需反问用户的问题：无阻塞问题。真实公网 VPS 由用户在自己环境配置。

## 3. 需求拆解

| 需求 ID | 需求描述 | 用户/角色 | 场景 | 优先级 |
|---------|----------|-----------|------|--------|
| REQ-OPENBOT-001 | Bind：用 SSH 把一台 Linux 主机登记为“我的电脑”并 bootstrap **openbot-agent** | 个人用户 | 首次安装 | P0 |
| REQ-OPENBOT-002 | Persist：Agent 进程 + 任务/事件在笔记本断开后继续（含**远端 Agent 循环**） | 个人用户 | 合盖、断网、关 UI | P0 |
| REQ-OPENBOT-003 | Remote：远端 Agent 循环 + shell / 工作区文件工具执行并回传 | 个人用户 | 聊天或 `openbot run` | P0 |
| REQ-OPENBOT-004 | BYOK：本机 Agent 用笔记本 key；远端循环用主机 secrets | 个人用户 | 规划与交接 | P0 |
| REQ-OPENBOT-005 | 危险命令审批门：执行前必须批准 | 个人用户 | `rm -rf` / `sudo` / 关机 等 | P0 |
| REQ-OPENBOT-006 | 2C4G 无头单进程；禁止伪称 Firecracker / 像素桌面；computer-use ≠ Agent | 所有人 | 文档与实现 | P0 |
| REQ-OPENBOT-007 | 密钥与 token 只在 `~/.openbot*`，永不入库 | 所有人 | 配置 | P0 |
| REQ-OPENBOT-008 | 新鲜克隆 → 配置 SSH+key → 聊天或 run → `uname -a` 来自远端 | 贡献者 | 安装验收 | P0 |
| REQ-OPENBOT-009 | 交接后远端事件回到同一线程，本机 Agent 收尾 | 个人用户 | 每天遥控 | P1 |
| REQ-OPENBOT-010 | 群组：本机 Agent 向多名远端扇出交接 | 个人用户 | 多角色协作 | P2 |
| REQ-OPENBOT-011 | 本机 Agent 规划 + 交接提案（策略则确认）；无需 bind 也能规划 | 个人用户 | 规划 / 起草 / 澄清 | P1 |

## 4. 歧义、冲突和隐藏假设

| 类型 | 问题 | 影响 | 处理结论 |
|------|------|------|----------|
| 歧义 | “远端”是用户 VPS 还是本机 loopback | 验收环境 | 产品路径永远是 SSH；测试可用 localhost SSH 或直接打 worker，但 UI/CLI 文案必须说“host”不是“this browser” |
| 假设 | 主机有 `python3` + `bash` | bind 失败 | bootstrap 明确失败并打印日志；不静默降级到本机执行 |
| 冲突 | opc-skills 默认先审文档再编码 | 已有脚手架 | 用户第二轮明确要求把进度折进文档并完成 docs+MVP PR，走 `implementation-loop` |
| 假设 | 用户会提供 LLM key | 聊天 | 无对应 key 时该模式失败；`run` 仍可用；不假装模型 |
| 歧义 | Worker / 本机 Agent / 远端 Agent / computer-use | 产品与架构 | Worker=只执行；本机 Agent=编排无电脑；远端=有电脑；computer-use=工具。不是三个 mode |
| 假设 | 合盖后仍要执行 | Persist | **已交接任务**循环在远端。本机规划合盖停是预期 |

## 5. 状态、权限和环境

- 状态机：本机规划不进任务状态机。交接：提案 →（确认）→ 远端 `queued → running → awaiting_approval → succeeded|failed|cancelled|timeout` → 本机收尾。
- 角色权限：单用户，SSH 账号即该主机执行账号。无多租户。群组里每名 Agent 仍只在自己的 SSH 用户下动手；编排器无额外工具权。
- 预发/线上差异：本产品是本地可安装应用，**没有托管 SaaS 预发**。共享环境发布不适用；“发布”= GitHub 默认分支上的可克隆提交。
- 数据来源：主机 `uname`、workspace、任务事件；本机 Agent 调笔记本 BYOK，远端循环调主机 BYOK。
- 数据写入和副作用：只有确认交接后才写远端 shell / workspace / `~/.openbot-agent`。本机规划只写线程缓存。

## 6. 边界、异常和成本保护

- 空态：未 bind（规划仍可用）/ 远端不可达 / 无任务 / 无本机 key。
- 错误态：SSH 失败、bootstrap 失败、无对应 API key、拒绝交接、审批拒绝、命令非零退出。隧道断只挡交接，不挡规划。
- 慢请求/超时：job `timeout_sec`；隧道 `ServerAliveInterval`。
- 重复提交：每次 run 新 job id；审批 id 一次性。
- 并发/顺序：v0 Agent **同时只跑一条模型循环**；队列可堆积。聊天一轮 tool 上限沿用实现常量。群组扇出 = 多名 Agent 各跑自己的循环。
- AI/生成成本保护：无生图。规划与远端任务才打模型；`run` 零模型成本。默认不交接，避免无意打到 VPS。交接确认 + 危险工具审批。
- 缓存/对象存储复用：不适用（无 OSS）。
- 最小返工粒度：单条命令 / 单次审批。

## 7. 验收证据映射

| 需求 ID | 验收标准 | 证据类型 | 负责环节 | 不可接受结果 |
|---------|----------|----------|----------|--------------|
| REQ-OPENBOT-001 | `openbot bind` 经 SSH 安装 Agent（现阶段实现仍可为 PR#1 worker bootstrap）并打印 persist | 命令输出 / 日志 | 研发+QA | 只在本机偷偷执行却显示“已绑定” |
| REQ-OPENBOT-002 | 断开本机后常驻进程仍监听，**任务/循环**文件仍在 | 进程 + 远端 tasks/jobs | QA | 关 CLI 后思考与执行一起死且无文档 |
| REQ-OPENBOT-003 | `uname -a` 输出含远端内核字符串；目标态合盖后 Agent 循环仍能推进任务 | 测试 + 命令输出 | QA | 返回笔记本内核却声称远端 |
| REQ-OPENBOT-004 | 无对应 key 时该步失败；key 不入库；本机 Agent 读笔记本 env，远端读主机 secrets | 测试 + 代码审 | 研发 | 密钥进 git |
| REQ-OPENBOT-005 | `rm -rf /` 类命令先 approval 再执行 | 单测 + UI/CLI | QA | 自动跑破坏性命令 |
| REQ-OPENBOT-006 | README/架构明确无桌面、无 Firecracker；区分 Worker/Agent/computer-use | 文档审 | 产品 | 营销对等声明 |
| REQ-OPENBOT-007 | `.gitignore` 忽略 `.env`；config mode 0600 | 文件 + 测试 | 研发 | 示例里填真实 key |
| REQ-OPENBOT-008 | README 给出可复制安装命令且 `npm run build` 可用 | 安装复跑 | 联调 | 只有定位文案没有入口 |
| REQ-OPENBOT-009 | 同一线程看到远端 thought/tool/审批，随后本机收尾 | UI / 契约 | 研发 | 切到另一个“远端聊天窗口” |
| REQ-OPENBOT-010 | 群组扇出写进架构；实现不挡 Phase 1 | 文档 | 产品 | 为群组先拆微服务 |
| REQ-OPENBOT-011 | 未 bind 也能规划；交接须提案（+确认）；不创建任务除非交接 | UI / 契约 | 研发 | 默认闲聊却去 VPS 跑命令 |

## 8. 未解决问题

- 用户真实公网 VPS 不在本 Agent 环境内；实验室用 localhost SSH 或 worker 直连代替，并在测试报告标明。
