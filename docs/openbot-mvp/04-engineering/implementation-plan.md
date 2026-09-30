# OpenBot MVP 实施计划

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 记录已有脚手架并补齐文档/测试 | 先保存再改；implementation-loop | 保存点 8fea153 |
| v0.2 | 2026-09-20 | 锁定远端 Agent 三阶段 + 对话节奏 | 架构决策已确认；本 PR 只改文档 | Phase 1 循环 → Phase 2 瘦客户端/1:1 → Phase 3 浏览 plugin；群组 v0.5 |
| v0.3 | 2026-09-21 | 会话面默认本机 LLM | 聊天 ≠ Agent | Phase 2 含 Local LLM；可与 Phase 1 并行 |
| v0.4 | 2026-09-21 | Phase 2 改为交接流 | 不是三个 mode | 规划 → 提案 → 回流 → 收尾 |
| v0.5 | 2026-09-22 | Phase 1 改为 OH runtime adapter；native 延后 | v0 runtime 锁定 | 不先自建 `openbot-agent` |
| v0.6 | 2026-09-22 | 近端扩展：桌面/VNC sidecar | OH 无可见屏幕 | 不挡 Phase 1/2；不 fork OH |
| v0.7 | 2026-09-22 | Phase 1 薄 adapter 代码 | 文档 PR#4 已锁 runtime | `oh-client` + CLI 探活/run + 交接 stub |

## 1. 当前决策

- 当前实施策略：PR#1 垂直切片保持可运行；文档 PR#4 已锁 v0 runtime。**本代码 PR 做 Phase 1 薄 adapter**（探活、建会话、轮询、交接确认 stub），不自建远端循环，不删 `worker.py`。
- 当前阶段划分：文档锁定（#4）→ Phase 1 **OH runtime adapter（本 PR 薄切片）** → Phase 2 本机 Agent + **交接回流** → Phase 3 无头浏览 plugin。自建 `openbot-agent` = **以后 optional**。群组 = **v0.5**（后置）。
- 当前依赖关系：实现叠在 `cursor/v0-oh-runtime-decision-361d`（#4）上；SSH bind 仍是 PR#1；远端循环复用已试装的 Agent Server。

## 2. 项目发现

- 相关 repo：`https://github.com/BiuBiuHu/OpenBot`（唯一）。
- 包管理器：npm。
- 启动命令：`npm install && npm run build && npx openbot serve`
- 测试命令：`npm test`
- lint/typecheck 命令：`npx tsc --noEmit`（无独立 eslint）。
- dev server 和端口：控制面 `3847`，worker `3848`。
- 环境变量样例：`.env.example` → `~/.openbot/.env`
- 当前分支：架构文档从 `cursor/openbot-mvp-a7b3`（PR#1）拉出；`main` 当时尚无 `docs/openbot-mvp/`。
- 未提交改动：以各提交时 `git status` 为准。

## 3. 保存点

- 保存方式：Git commit。
- commit/stash/patch：`8fea153` WIP scaffold；后续提交叠加文档与测试。
- 回滚方式：`git reset --hard 8fea153` 或回到 `a377505`。
- 主分支同步：创建本分支前 `main` 与 `origin/main` 一致。用户要求继续当前工作，不从 main 另开第二条需求分支。

## 4. 变更清单

| 模块/文件 | 改动 | 原因 | 验证方式 |
|-----------|------|------|----------|
| `src/*` `worker/*` | 控制面 + worker | Bind/Persist/Remote | build + 测试 |
| `docs/openbot-mvp/**` | opc-skills 主文档 | 过程门禁 | 目录齐全 |
| `README.md` `ARCHITECTURE.md` | 安装路径与隐喻 | REQ-008/006 | 人工读 + 构建 |
| `tests/*` | 审批、config、worker、e2e | P0 证据 | `npm test` |
| `LICENSE` `.gitignore` `.env.example` | 开源底线 | 约束 | 文件存在 |

## 5. 执行顺序

PR#1 已完成：脚手架 → 00–06 文档 → 测试与 localhost SSH bind → 中文 Code PR。

**Phase 1 薄切片**：adapter CLI + 交接 stub（#5）。**下一刀（本分支）**：Web 默认 This computer → 交接卡 → OH 事件回流；`serve` 可不 bind worker。完整本机规划仍属 Phase 2。

| 阶段 | 任务 | 退出条件 | 失败处理 |
|------|------|----------|----------|
| 1 | **OH runtime adapter**：本机经隧道 / API 对接 Agent Server；交接投递、事件回流、探活 | 拔掉隧道后已交接任务仍能到终态或停在审批 | 不 fork OH；不自建远端循环；保留 PR#1 jobs 作对照 |
| 2 | **本机 Agent + 交接**：规划、提案、确认、同一线程回流、收尾 | 未 bind 能规划；确认后合盖任务仍在；终态后本机收尾 | 禁止三个 mode 切换器；禁止静默打到远端 |
| 3 | **无头浏览 plugin** | 工具表可开关；2C4G 可关 | 禁止宣称桌面对等；plugin ≠ Agent |
| 近端 | **扩展层：桌面/VNC sidecar**（同一台 BYO 机器、OH 旁边） | 可选打开可见屏幕；2C4G 可关 | 不挡 v0；不 fork OH；不是第二个 Agent |
| 以后 | **optional native `openbot-agent`** | 与 OH 并列可选 | 不挡 v0 |
| v0.5 | **群组房间**：participants、mention/本机编排、按 Agent 扇出任务 | 房间消息能变成多条远端任务 | 不做跨机文件同步；不挡 Phase 1 |

文档 PR#4 退出条件已满足（锁 v0 = OH）。本代码 PR 退出条件：adapter 探活 + 建/轮询会话（mock 绿；真实路径见 ops 笔记），中文 PR 待审。不合并。

## 6. 自动执行循环

- 每轮修改：小步提交相关文件。
- 最小验证：先 `npx tsc --noEmit` 与相关 `tsx --test`。
- 失败归因：构建 / worker HTTP / SSH 分层。
- 复验方式：同命令再跑。
- 证据写入：`evidence-manifest.md` 与 `test-report.md`。

全量无关测试：无历史套件。`npm test` 即本 feature 最小充分集。

## 7. 兼容、迁移与回滚

无旧版本兼容。回滚=恢复 git + 停远端 worker。

## 8. 风险与未解决问题

- 云 Agent 环境不一定能装 sshd：预备直连证明协议，SSH 作为产品路径保留。
- 无真实 BYOK key：聊天 happy path 用契约测试或跳过并记录。
- Phase 1 是 OH adapter，不是改名 worker→agent。PR#1 `openbot-worker` 继续可跑；不要为了文档名拆用户机上的旧单元。
- 群组若提前做，容易把单进程远端拖成编排平台。文档已列为 v0.5。
