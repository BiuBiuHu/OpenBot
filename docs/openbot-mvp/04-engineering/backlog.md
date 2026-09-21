# OpenBot MVP Backlog

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初版 | 把 v0 不做的事从主路径拿走 | 避免范围膨胀 |
| v0.2 | 2026-09-20 | 按远端 Agent 阶段重排 | 循环 / 瘦客户端 / 浏览 / 群组 分层 | 群组不挡内核 |
| v0.3 | 2026-09-21 | 补本机 LLM 会话 | 聊天 ≠ 总是 Agent | BL-014；默认可先于 Agent 内核 |
| v0.4 | 2026-09-21 | 本机 Agent 交接取代 mode 切换 | UX 澄清 | BL-014/011 改为规划+handoff |
| v0.5 | 2026-09-21 | 补 OH Agent Server trial 后的运行时决策 | 摸手感对照，避免当成内核 | BL-015 |

## 1. 当前决策

文档 PR 只锁定架构。实现按下面阶段推进；**群组不阻塞远端 Agent 内核**。
OpenHands Agent Server 仅作 BYO 主机 **trial / 摸手感**；产品目标仍是 `openbot-agent`。摸完后走 BL-015，再考虑 BL-005。

## 2. 阶段主线

| ID | 项 | 优先级 | 依赖 | 备注 |
|----|----|--------|------|------|
| BL-010 | Phase 1：远端 `openbot-agent` 循环（队列 + BYOK + 工具 + 审批 + 落盘） | P0 | PR#1 执行原语 | 单进程；SSH 仍只 bind/隧道 |
| BL-014 | **本机 Agent**（规划/编排，笔记本 BYOK，无需 bind）+ `handoff_proposal` | P1 | 本机控制面 | 不挡 Phase 1；无确认不创建 `/v1/tasks` |
| BL-011 | Phase 2：交接确认、远端事件回流**同一线程**、本机收尾 | P1 | BL-010、BL-014 | 不是切到另一个聊天 mode |
| BL-012 | Phase 3：无头浏览 plugin | P3 | BL-010、2C4G 评估 | 禁止冒充 Grok 桌面；plugin ≠ Agent |
| BL-013 | v0.5：Agent 群组房间（mention / 本机编排 / 按 Agent 扇出） | P2 | BL-011 | 共享发言 vs 私有 memory；不挡 Phase 1 |

## 3. 后续项

| ID | 项 | 优先级 | 依赖 | 备注 |
|----|----|--------|------|------|
| BL-001 | 多主机切换 UI | P2 | 配置格式 | 保持“一台电脑”隐喻；群组可先指向已 bind 的多 host |
| BL-002 | Agent 热升级 | P2 | bind | 现为整文件覆盖；兼容旧 `openbot-worker` 单元 |
| BL-003 | 会话权威在远端（1:1 已由 tasks/events 覆盖） | P2 | BL-010 | 取代控制面内存历史 |
| BL-004 | 可选无头浏览 | P3 | = BL-012 | 同上 |
| BL-005 | OpenHands action-server 适配器 | P3 | 协议 | 调研已记录；依赖 BL-015 先决定是否保留 OH |
| BL-015 | OpenHands Agent Server trial 后决策：optional plugin vs 丢掉 | P2 | [试装笔记](../06-ops/openhands-agent-server-trial.md) | **不是**产品内核；目标仍是 `openbot-agent`。未决策前不要把 OH 写进主安装路径 |
| BL-006 | 正式托管预发 | — | 产品决策 | 当前按本地安装发布 |
| BL-007 | 跨机 workspace 同步 | P3 | BL-013 | 群组默认不同步文件 |

## 4. Inbox

无独立 inbox 条目。定位 README 已并入本 feature。
