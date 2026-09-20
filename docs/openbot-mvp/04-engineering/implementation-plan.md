# OpenBot MVP 实施计划

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 记录已有脚手架并补齐文档/测试 | 先保存再改；implementation-loop | 保存点 8fea153 |

## 1. 当前决策

- 当前实施策略：保留已提交控制面/worker，补 opc-skills 文档、测试、README 安装路径，再跑最小验证。
- 当前阶段划分：保存点 → 文档 → 测试与安装打通 → Code PR（中文）。
- 当前依赖关系：文档与代码同一 feature 目录 `docs/openbot-mvp/`。

## 2. 项目发现

- 相关 repo：`https://github.com/BiuBiuHu/OpenBot`（唯一）。
- 包管理器：npm。
- 启动命令：`npm install && npm run build && npx openbot serve`
- 测试命令：`npm test`
- lint/typecheck 命令：`npx tsc --noEmit`（无独立 eslint）。
- dev server 和端口：控制面 `3847`，worker `3848`。
- 环境变量样例：`.env.example` → `~/.openbot/.env`
- 当前分支：`cursor/openbot-mvp-a7b3`（由已同步的 `origin/main` @ `a377505` 创建）。
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

| 阶段 | 任务 | 退出条件 | 失败处理 |
|------|------|----------|----------|
| 0 | 提交脚手架保存点 | commit 存在 | 停止改代码 |
| 1 | 写 00–06 文档 | 模板章节填实 | 先补文档 |
| 2 | 补测试与 README | `npm test` 与 `tsc` 通过 | 读失败再修 |
| 3 | 尝试本机 SSH bind | 有则写入报告；无则 worker 直连 + 说明 | 不伪造 VPS |
| 4 | 中文 Code PR | PR 链接 | 不宣布生产发布 |

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

- 云 Agent 环境不一定能装 sshd：预备 worker 直连证明协议，SSH 作为产品路径保留。
- 无真实 BYOK key：聊天 happy path 用契约测试或跳过并记录。
