# OpenBot MVP Backlog

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初版 | 把 v0 不做的事从主路径拿走 | 避免范围膨胀 |
| v0.2 | 2026-09-20 | 按远端 Agent 阶段重排 | 循环 / 瘦客户端 / 浏览 / 群组 分层 | 群组不挡内核 |
| v0.3 | 2026-09-21 | 补本机 LLM 会话 | 聊天 ≠ 总是 Agent | BL-014；默认可先于 Agent 内核 |
| v0.4 | 2026-09-21 | 本机 Agent 交接取代 mode 切换 | UX 澄清 | BL-014/011 改为规划+handoff |
| v0.5 | 2026-09-21 | 补 OH Agent Server trial 后的运行时决策 | 摸手感对照，避免当成内核 | BL-015 |
| v0.6 | 2026-09-22 | v0 锁定 OH runtime；补 adapter；native 延后 | 用户确认出货路径 | BL-016 P0；BL-010 延后；BL-015 已决 |
| v0.7 | 2026-09-22 | 补扩展层：桌面/VNC 近端项 | OH 无可见屏幕；避免 OH-only forever | BL-017 P2；不挡 v0；不 fork OH |

## 1. 当前决策

文档 PR 只锁定架构。实现按下面阶段推进；**群组不阻塞 v0**。
**v0 远端 Agent runtime = OpenHands Agent Server**（dependency / plugin，不 fork）。本机壳要做 **OH runtime adapter**（BL-016）。OpenBot 另留 **扩展层**（BL-017）：OH 缺的能力（先点名桌面 / VNC / 可见屏幕）挂在同一台 BYO 机器、OH 旁边，**不挡 v0**。自建 `openbot-agent`（BL-010）**延后**。决策：[runtime-decision-v0.md](../03-architecture/runtime-decision-v0.md)。试装：[openhands-agent-server-trial.md](../06-ops/openhands-agent-server-trial.md)。

## 2. 阶段主线

| ID | 项 | 优先级 | 依赖 | 备注 |
|----|----|--------|------|------|
| BL-016 | Phase 1：**本机壳的 OH runtime adapter**（隧道 / API、交接投递、事件回流、探活） | P0 | PR#1 bind 故事；[试装笔记](../06-ops/openhands-agent-server-trial.md) | v0 执行后端；不 fork OH；不自建远端循环 |
| BL-014 | **本机 Agent**（规划/编排，笔记本 BYOK，无需 bind）+ `handoff_proposal` | P1 | 本机控制面 | 不挡 Phase 1；无确认不创建远端任务 |
| BL-011 | Phase 2：交接确认、远端事件回流**同一线程**、本机收尾 | P1 | BL-016、BL-014 | 不是切到另一个聊天 mode |
| BL-012 | Phase 3：无头浏览 plugin | P3 | BL-016、2C4G 评估 | 禁止冒充 Grok 桌面；plugin ≠ Agent；**不是** BL-017 的可见屏幕 |
| BL-013 | v0.5：Agent 群组房间（mention / 本机编排 / 按 Agent 扇出） | P2 | BL-011 | 共享发言 vs 私有 memory；不挡 Phase 1 |
| BL-017 | **扩展层**：可选桌面 / VNC / 实时可见屏幕（同一台 BYO 机器上的 sidecar，挂在 OH **旁边**） | P2 | BL-016（本机壳先通） | **不挡 v0**；不 fork OH；不是第二个 Agent；以后 connectors 走同一层 |

## 3. 后续项

| ID | 项 | 优先级 | 依赖 | 备注 |
|----|----|--------|------|------|
| BL-001 | 多主机切换 UI | P2 | 配置格式 | 保持“一台电脑”隐喻；群组可先指向已 bind 的多 host |
| BL-002 | Agent 热升级 | P2 | bind | 现为整文件覆盖；兼容旧 `openbot-worker` 单元 |
| BL-003 | 会话权威在远端（1:1 已由 tasks/events 覆盖） | P2 | BL-016 | 取代控制面内存历史 |
| BL-004 | 可选无头浏览 | P3 | = BL-012 | 同上 |
| BL-005 | OpenHands API 深适配（会话/事件字段对齐产品契约） | P3 | BL-016 | 调研已记录；v0 先做薄 adapter，本项是加深，不是再决策一次 |
| BL-015 | OpenHands Agent Server trial 后决策 | — | 已决 2026-09-22 | **选用 OH 作 v0 远端 runtime**（plugin，不 fork）。不再「丢掉 vs 保留」悬空 |
| BL-010 | 以后可选：**自建 `openbot-agent` 原生循环**（队列 + BYOK + 工具 + `/v1/tasks`） | P3 | BL-016 跑通后 | **不挡 v0**；与 OH 并列的 optional / native runtime |
| BL-006 | 正式托管预发 | — | 产品决策 | 当前按本地安装发布 |
| BL-007 | 跨机 workspace 同步 | P3 | BL-013 | 群组默认不同步文件 |

## 4. Inbox

无独立 inbox 条目。定位 README 已并入本 feature。
