# v0 远端 runtime 决策

2026-09-22 用户确认。本文件只锁 **v0 用谁当远端执行后端**，不改交接 UX，也不改「这台机器就是我的电脑」。

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-22 | 锁定 v0 远端 runtime = OpenHands Agent Server；自建 `openbot-agent` 延后 | 出货速度；2C4G ECS 已证明 OH 能常驻 | v0 自建本机壳 + adapter，不自建远端循环，不 fork OH |

## 1. 当前决策

- **v0 远端执行后端 = OpenHands Agent Server**。用户 BYO Linux 上常驻；本机薄客户端经 SSH 隧道 / HTTP API 跟它说话。
- **本仓库 v0 自建**：本机 app shell + BYOK + SSH bind/bootstrap + **同一条线程**里本机规划 → 确认 → 远端执行 → 回流收尾。
- OpenHands 是 **dependency / remote runtime plugin**，不是整仓 fork，也不是产品控制台。
- 自建 systemd **`openbot-agent` 延后到 v0 之后**。以后可以再作为 optional / native runtime 回来，不挡 v0。
- 现场试装（2C4G ECS，无真实 IP/密钥）：[openhands-agent-server-trial.md](../06-ops/openhands-agent-server-trial.md)。交接协议仍见 [remote-agent.md](remote-agent.md)。总图见 [architecture.md](architecture.md)。

## 2. 为什么（出货速度）

- Agent Server 已在用户同类 **2C4G** 主机上装起来、探活、经 `ssh -L` 到达。再自建一套远端模型循环，会拖住本机壳和交接 UX。
- v0 要证明的是：**自己的机器 + 自己的钥匙 + 一条线程交接**。执行循环可以先租 OH，不必先写完 `openbot-agent`。
- PR#1 的 worker 仍是执行原语来源；v0 不把它升格成第二个远端大脑。

## 3. 边界：我们拥有 vs OpenHands

| 我们拥有（本仓库） | OpenHands 拥有（dependency） | 两边都不拥有 |
|--------------------|------------------------------|--------------|
| 本机 Agent（规划 / 编排，笔记本 BYOK） | 远端想 + 在这台主机上做（模型循环、工具、其落盘） | 用户的 SSH 主机、workspace、各侧 API key |
| 会话面、同一 `thread_id`、交接卡、审批转发 | Agent Server 进程与其 HTTP | 托管 Firecracker / 像素桌面 |
| `openbot bind` / bootstrap / 可选 `ssh -L` | 其安装与 systemd（试装笔记） | OH 控制台当产品主界面 |
| runtime **adapter**（提案 → 远端任务 → 事件回流） | 被 adapter 调用的 API | 整仓 fork、把 OH 商标写进用户日常对谈 |

用户语言仍是：**这台机器就是我的电脑**。不是「这次任务跑在哪个 OpenHands backend」。

## 4. 非目标

- **不** fork OpenHands 整仓，不把其 UI / VSCode / 编码控制台做成 OpenBot。
- **不**为 v0 自建 `openbot-agent` 单进程循环（队列 + 模型 + 工具 + `/v1/tasks`）。那是以后的 optional native。
- **不**把 OH 升格成本机 Agent，也不让用户切三个对等 mode。
- **不**无鉴权绑 `0.0.0.0`。只听 `127.0.0.1`，本机用 SSH 本地转发。
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
| [backlog.md](../04-engineering/backlog.md) | BL-016 adapter；BL-010 native 延后 |
