# OpenBot MVP PRD

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 从定位 README 落成可验收 PRD | opc-skills 要求目标先于字段 | Bind / Persist / Remote 成为唯一 P0 主线 |
| v0.2 | 2026-09-20 | Persist/Remote 含远端 Agent 循环；本机为瘦客户端；对话分 1:1 与群组 | 用户确认远端是 think+execute 的常驻 Agent | 模型循环与任务权威迁到主机；群组为 v0.5 |
| v0.3 | 2026-09-21 | 同一窗口三种会话；默认可本机 LLM | 聊天 ≠ 总是 Agent | 未 bind 也能 NL 聊；点选 Agent 才上 VPS |
| v0.4 | 2026-09-21 | 一条线程交接流，取代三个对等 mode | 本机 Agent 规划，远端拥有电脑 | 提案→确认→回流→收尾 |
| v0.5 | 2026-09-22 | v0 远端 runtime 定为 OpenHands Agent Server | 出货速度；用户确认 | 不要求 v0 自建 `openbot-agent` |

## 1. 当前决策

- 当前产品决策：SSH 绑定用户自己的 Linux 主机 + **v0 远端 runtime = OpenHands Agent Server（拥有电脑）** + 本机 **Agent（思考/编排同伴）**。用户始终在**一条线程**里跟本机 Agent 说话；需要电脑时由它**交接**给远端，结果回流后再收尾。口号：**SSH your own machine. The agent gets a computer — you keep the keys.**
- v0 本仓库自建本机壳 + BYOK + bind + 交接；OH 是 **dependency / plugin**，不是整仓 fork。自建 `openbot-agent` **延后**。见 [runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。
- **不是三个对等聊天 mode。** 群组是以后的事（v0.5）。
- 被拒绝的替代方案：远端只当哑 Worker、用户来回切 Local/Remote/Group、把每句规划静默变成远端任务、托管 Firecracker、v0 像素桌面、把 computer-use 叫成 Agent、为 v0 fork OpenHands。
- 当前范围边界：单机、单用户、无头 2C4G、远端**单进程**（v0 = OH）。v0 = 本机 Agent + 向一台主机交接。群组后置。

## 2. 需求验证结论

- 需求验证文档：`requirement-validation.md`
- 已消除的歧义：电脑 = 用户 SSH 主机；**本机 Agent = 编排同伴（没有电脑）**；远端 Agent = 拥有电脑；一条线程交接，不是三个 mode；Worker ≠ 任一种 Agent ≠ computer-use。
- 仍需确认的问题：无阻塞项。群组房间权威落本机或 lead 主机，放到 v0.5。
- 不进入本版本的内容：团队 ACL、技能市场、浏览器自动化（Phase 3 plugin）、多主机切换 UI、完整多 Agent 编排。

## 3. 目标澄清

- 用户真正想完成的业务结果：先跟本机 Agent 把事情想清楚；需要电脑时，把**自己的** Linux 主机交给远端 Agent 去做；结果回到同一条对话，再一起收尾。
- 主要用户/角色：会 SSH 的个人开发者。
- 核心工作流：本机 Agent 规划 → 提出交接（策略则确认）→ 远端执行 → 事件回流同一线程 → 本机 Agent 收尾。合盖只停本机思考，已交接任务继续。
- 工作单元和批量范围：v0 **一条线程**，可含零或一条（随后可多条）远端任务。群组扇出是 v0.5。
- 成本、时效和质量约束：2C4G 单进程远端；python3+bash；交接先问、危险工具再问；本机 Agent 用笔记本 BYOK，远端用主机 BYOK。
- 返工/重试/回滚方式：拒绝交接或拒绝审批；重新 bind；v0 重启远端 `openhands-agent-server`（以后 native 才是 `openbot-agent`）。
- 用户已确认结论：隐喻对齐 Grok Bot 的持久电脑；本机 Agent 没有电脑，远端才有；不是三个 mode 切换器。

## 4. 用户、问题与场景

### 4.1 用户与角色

一个人，一台他已经能 SSH 进去的 Linux 机器（VPS / 迷你主机 / 闲置笔记本）。

### 4.2 要解决的问题

只聊天的助手在合上笔记本时结束。托管 Agent PC 把机器和 token 锁在平台里。用户需要：**电脑是我的，钥匙是我的**。

### 4.3 触发场景和使用频率

- 第一次：克隆、init、bind、serve。
- 每天：跟本机 Agent 规划；它提出交接后让 VPS 动手；或 `run` 一条不经模型的命令。
- 以后：本机 Agent 向群组里多名远端扇出交接。
- 中断：地铁/合盖；本机规划停，已交接任务继续；回来仍是同一条线程。

### 4.4 当前替代方案和痛点

| 替代 | 痛点 |
|------|------|
| 自己 SSH 手工敲 | 没有远端 Agent 循环，没有审批记录 |
| OpenHands | 产品是编码任务控制台，不是“我的电脑” |
| Grok Bot | 不是你的主机，也不是你的 token 计量 |

## 5. 范围

### 5.1 In Scope

1. Bind：`openbot init` + `openbot bind`（SSH 只做登记与 bootstrap）
2. Persist：主机常驻远端 runtime（**v0 = OpenHands Agent Server**，试装见 [openhands-agent-server-trial.md](../06-ops/openhands-agent-server-trial.md)）；任务/事件在远端盘
3. Remote：**远端循环**（想 + 执行；v0 用 OH）+ shell / 文件工具 + 事件回传
4. 本机 Agent + **交接**：规划、提案、确认、远端事件回流同一线程、收尾。群组 v0.5。本机壳含 **OH runtime adapter**
5. 审批门（任务状态 `awaiting_approval`）
6. MIT、`.gitignore`、`.env.example`、架构文档（含 Worker≠Agent≠computer-use）

### 5.2 Out of Scope

团队 ACL、市场、Firecracker、桌面/浏览器自动化（Phase 3 才做 plugin）、移动端精修、和 OpenHands 比 IDE、v0 完整多 Agent 群组（v0.5）。

### 5.3 权限和环境范围

SSH 用户能做的，Agent 就能做。审批门是产品控制，不是安全沙箱。

## 6. 核心流程

### 6.1 主流程

```text
clone → npm install && npm run build
 → openbot init --host … --user …
 → 把 OPENAI_API_KEY 写入 ~/.openbot/.env（可选）
 → openbot bind
 → openbot serve | openbot run 'uname -a' | openbot chat '…'
```

### 6.2 状态流转

本机 Agent：未配置 key → 可规划 / 缺 key 报错（**不依赖 bind**）。交接：提案 →（确认）→ 远端 `queued → running → awaiting_approval → succeeded|failed` → 本机收尾。群组后置。

### 6.3 异常、空态和失败路径

SSH 失败、主机无 python3、隧道断、无 API key、拒绝交接、审批拒绝、命令失败。全部必须对人可读。隧道断时本机 Agent 仍能规划。禁止把本机输出标成 host，也禁止静默交接或把远端任务改在本机执行。

### 6.4 成本保护和返工流程

- 本机规划与远端任务才调用模型（各用各的 BYOK）；`run` 不调用。
- 只有确认交接后才动 VPS；危险工具再审批。
- 合盖杀死本机规划，不杀死已交接的远端循环。

## 7. 验收标准

| 需求 ID | 验收标准 | 证据类型 | 优先级 |
|---------|----------|----------|--------|
| REQ-OPENBOT-001 | bind 经 SSH 登记主机并让远端 runtime 可达（**v0 = OpenHands Agent Server**，保留 bootstrap 故事；不必为 v0 自建 `openbot-agent`），config 记下 token 与 persist | 命令/日志 | P0 |
| REQ-OPENBOT-002 | 停掉本机后 Agent 仍响应 /health；**任务与 Agent 循环**仍在远端盘 | 进程+文件 | P0 |
| REQ-OPENBOT-003 | Remote 含远端 Agent 循环；`uname -a` 级执行仍在主机并回传 | 测试/CLI | P0 |
| REQ-OPENBOT-004 | BYOK 分两处：本机 Agent 用笔记本 key，远端用主机 key；缺对应 key 时该步不可用，exec/run 可用 | 代码+测试 | P0 |
| REQ-OPENBOT-005 | 危险命令必须批准（任务进入 `awaiting_approval`） | 单测+UI | P0 |
| REQ-OPENBOT-006 | 文档禁止 Firecracker/像素对等声明；computer-use ≠ Agent | 文档 | P0 |
| REQ-OPENBOT-007 | 密钥不进仓库 | 扫描+gitignore | P0 |
| REQ-OPENBOT-008 | README 安装路径可跑通 `npm run build` | 安装复跑 | P0 |
| REQ-OPENBOT-009 | 交接后远端事件回到**同一线程**；随后本机 Agent 收尾 | UI+API | P1（Phase 2） |
| REQ-OPENBOT-010 | 群组：本机 Agent 向多名远端扇出交接 | 文档→实现 | P2（v0.5，后置） |
| REQ-OPENBOT-011 | 本机 Agent 规划（无需 bind）+ `handoff_proposal`；策略要求则确认；禁止静默上 VPS | UI+API | P1 |

## 8. 指标与版本节奏

### 8.1 成功指标

陌生人能克隆并在 2C4G 上跑通；隐喻在 README 一眼可读；出现外部 issue/PR。

### 8.2 版本路线

- v0 内核：OH runtime adapter（Phase 1）+ 本机 Agent 与交接（Phase 2）。自建 `openbot-agent` 不在 v0 门禁。
- v0.5：群组（后置）。
- 以后：无头浏览 plugin（Phase 3）。不把群组当内核门禁。不是三个 mode 切换器。

## 9. 未解决问题

- 托管预发/SaaS 发布矩阵不适用；见 `06-ops/release-plan.md`。
