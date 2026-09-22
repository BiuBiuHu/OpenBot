# v0 远端 runtime 决策

2026-09-22 用户确认。本文件锁 **v0 用谁当远端 Agent runtime**，以及 OpenBot 必须留出的 **扩展层**。不改交接 UX，也不改「这台机器就是我的电脑」。

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-22 | 锁定 v0 远端 runtime = OpenHands Agent Server；自建 `openbot-agent` 延后 | 出货速度；2C4G ECS 已证明 OH 能常驻 | v0 自建本机壳 + adapter，不自建远端循环，不 fork OH |
| v0.2 | 2026-09-22 | 补扩展层：OH 缺的能力（先点名桌面/VNC）由 OpenBot 外挂 | 避免画地为牢成「永远只有 OH」 | 桌面/VNC 不挡 v0；挂在同一台 BYO 机器、OH 旁边 |

## 1. 当前决策

- **v0 远端执行后端 = OpenHands Agent Server**。用户 BYO Linux 上常驻；本机薄客户端经 SSH 隧道 / HTTP API 跟它说话。
- **本仓库 v0 自建**：本机 app shell + BYOK + SSH bind/bootstrap + **同一条线程**里本机规划 → 确认 → 远端执行 → 回流收尾。
- OpenHands 是 **dependency / remote Agent runtime plugin**，不是整仓 fork，也不是产品控制台。
- OpenBot 必须保留显式 **扩展层**：OH 没有的能力（第一缺口：**无桌面 / 无 VNC / 无实时可见屏幕**）由本仓库 **外挂**，不靠 fork OH 去补。
- **v0 出货范围**：OH runtime + 本机壳 / 交接。桌面 / VNC **不是** v0 门禁，但必须在近端 backlog 占位，避免「永远只有 OH」。
- 自建 systemd **`openbot-agent` 延后到 v0 之后**。以后可以再作为 optional / native runtime 回来，不挡 v0。
- 现场试装（2C4G ECS，无真实 IP/密钥）：[openhands-agent-server-trial.md](../06-ops/openhands-agent-server-trial.md)。交接协议仍见 [remote-agent.md](remote-agent.md)。总图见 [architecture.md](architecture.md)。扩展项见 backlog **BL-017**。

## 2. 为什么（出货速度）

- Agent Server 已在用户同类 **2C4G** 主机上装起来、探活、经 `ssh -L` 到达。再自建一套远端模型循环，会拖住本机壳和交接 UX。
- v0 要证明的是：**自己的机器 + 自己的钥匙 + 一条线程交接**。执行循环可以先租 OH，不必先写完 `openbot-agent`。
- PR#1 的 worker 仍是执行原语来源；v0 不把它升格成第二个远端大脑。

## 3. 边界：我们拥有 vs OpenHands

| 我们拥有（本仓库） | OpenHands 拥有（dependency） | 两边都不拥有 |
|--------------------|------------------------------|--------------|
| 产品壳：本机 Agent、会话面、同一 `thread_id`、交接卡、审批转发 | **Agent 循环 / 工具 / 事件**（想 + 在这台主机上做、其落盘） | 用户的 SSH 主机、workspace、各侧 API key |
| `openbot bind` / bootstrap / 可选 `ssh -L` | Agent Server 进程与其 HTTP | 托管 Firecracker；宣称 Grok 像素对等 |
| runtime **adapter**（提案 → 远端任务 → 事件回流） | 被 adapter 调用的 API | OH 控制台当产品主界面 |
| **扩展层**（桌面 / VNC / 可见屏幕，以后 connectors） | —（OH 没有这些，也不该被 fork 进去） | 整仓 fork、把 OH 商标写进用户日常对谈 |

用户语言仍是：**这台机器就是我的电脑**。不是「这次任务跑在哪个 OpenHands backend」。

## 3.1 扩展层（挂在 OH 旁边，不进 fork）

OH 是 v0 的远端 **Agent runtime**，不是能力天花板。缺的东西用 OpenBot 扩展补，**attach** 到同一台 BYO 机器 / 同一会话隐喻，不要改 OH 源码。

| 原则 | 含义 |
|------|------|
| 同一台电脑 | 扩展看见的是用户已经 bind 的那台主机，不是第二套「云桌面」 |
| plugin / sidecar | 和 OH **并列**（可选进程或本机壳模块），不是 OH 内部补丁 |
| 第一缺口 | **无桌面 / 无 VNC / 无实时可见屏幕**。计划外挂可选桌面流或 GUI sidecar |
| v0 | **不必**出货桌面 / VNC；本机壳 + 交接先通 |
| 近端 | backlog 必须占位（BL-017），避免文档把世界画成「OH-only forever」 |
| 以后 | 其他 connectors 走同一扩展层，仍不 fork OH |

扩展 ≠ Agent。桌面 / VNC 是这台电脑上的能力，不是第三个聊天 mode，也不是 computer-use 人格。

## 4. 非目标

- **不** fork OpenHands 整仓，不把其 UI / VSCode / 编码控制台做成 OpenBot，也不为了桌面 / VNC 去改 OH。
- **不**为 v0 自建 `openbot-agent` 单进程循环（队列 + 模型 + 工具 + `/v1/tasks`）。那是以后的 optional native。
- **不**把桌面 / VNC 当成 v0 出货门禁；也 **不**把「v0 不做」写成永远不做。
- **不**把 OH 升格成本机 Agent，也不让用户切三个对等 mode。
- **不**无鉴权绑 `0.0.0.0`。只听 `127.0.0.1`，本机用 SSH 本地转发。扩展流同样不得对公网裸奔。
- 密钥、PEM、公网 IP **不**入库、不写进本文件。

## 5. 迁移（以后可选 native agent）

v0 跑通后，自建 `openbot-agent` 可以回来，作为与 OH **并列的** optional / native runtime：

1. 本机壳与交接协议不变（同一线程、`handoff_proposal`、先问再动手）。
2. adapter 按 runtime 选型：OH Agent Server，或本机实现的 `/v1/tasks`。
3. 默认安装仍可以是已经验证过的 OH；native 不自动替换用户已有的电脑隐喻。
4. 丢掉 OH、只留 native，也是以后的产品选择，不是 v0 门禁。

`/v1/tasks` 草图仍写在 [remote-agent.md](remote-agent.md)，当作**产品级交接契约**；v0 由 adapter 映射到 OH API，不必先实现自建进程。

## 6. 相关文档

| 文档 | 关系 |
|------|------|
| [remote-agent.md](remote-agent.md) | 交接 UX、状态机、以后 native 进程草图 |
| [architecture.md](architecture.md) | 分层与一条线程 |
| [openhands-agent-server-trial.md](../06-ops/openhands-agent-server-trial.md) | ECS 试装 / 探活 / 隧道 / 卸载（PR#3） |
| [backlog.md](../04-engineering/backlog.md) | BL-016 adapter；BL-017 桌面/VNC 扩展；BL-010 native 延后 |
