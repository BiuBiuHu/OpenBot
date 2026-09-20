# OpenBot MVP 实施计划

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 记录已有脚手架并补齐文档/测试 | 先保存再改；implementation-loop | 保存点 8fea153 |
| v0.2 | 2026-09-20 | 锁定远端 Agent 三阶段 + 对话节奏 | 架构决策已确认；本 PR 只改文档 | Phase 1 循环 → Phase 2 瘦客户端/1:1 → Phase 3 浏览 plugin；群组 v0.5 |

## 1. 当前决策

- 当前实施策略：PR#1 垂直切片（本机循环 + 远端 Worker）保持可运行；**本 PR 只锁目标架构文档**。下一支代码 PR 再搬模型循环。
- 当前阶段划分：文档锁定 → Phase 1 远端 Agent 循环 → Phase 2 瘦客户端 + **1:1 聊天** → Phase 3 无头浏览 plugin。群组房间 = **v0.5**，不作为 Phase 1 门禁。
- 当前依赖关系：文档在 `docs/openbot-mvp/`；实现仍基于 PR#1 的 SSH bind 与执行原语。

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

**下一支实现（不在本文档 PR 写代码）**：

| 阶段 | 任务 | 退出条件 | 失败处理 |
|------|------|----------|----------|
| 1 | **远端 Agent 循环**：单进程常驻、`/v1/tasks`、BYOK、shell/文件、`awaiting_approval`、事件落盘 | 拔掉隧道后任务仍能到终态或停在审批 | 保留 PR#1 jobs 协议作 tool step；不拆微服务 |
| 2 | **瘦客户端 + v0 1:1 聊天**：本机只创建任务、订阅事件、批准；具名 Agent 线程 | UI/CLI 合盖后再订阅能看到同一线程 | 本机不再调模型；无 key 时 exec 仍可用 |
| 3 | **无头浏览 plugin** | 工具表可开关；2C4G 可关 | 禁止宣称桌面对等；plugin ≠ Agent |
| v0.5 | **群组房间**：participants、mention/本机编排、按 Agent 扇出任务 | 房间消息能变成多条 `/v1/tasks` | 不做跨机文件同步；不挡 Phase 1 |

本 PR（文档）退出条件：架构写清 Agent、状态机、1:1/群组分层，并开中文 PR 待审。不合并。

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
- Phase 1 若一次改名 worker→agent，bootstrap 与用户机上旧单元会漂。实现时先兼容 `openbot-worker` 单元名。
- 群组若提前做，容易把单进程内核拖成编排平台。文档已列为 v0.5。
