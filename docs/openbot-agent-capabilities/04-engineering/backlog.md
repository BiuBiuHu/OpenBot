# OpenBot 智能体能力 · Backlog

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 首版。本增量只取文档 URL；其余四能力分期 | 防止把未实现阶段标绿 | 改代码/工作区文稿/新桌面保持 pending |

## 1. 当前决策

- 当前优先级策略：先修现场 P0（公开文档 URL），再具名改代码，再工作区文稿，桌面以回归已有壳为主。
- 当前阶段重点：文档阅读路径交货；决策源迁到本目录。

## 2. 任务分组

| Epic | 目标 | 优先级 | 依赖 | 验收证据 |
|------|------|--------|------|----------|
| CAP-DOCS-SRC | opc-skills 主文档替代 phases | P0 | 无 | 本目录一类一份 |
| CAP-DOC-URL | 公开文档 URL 短答 | P0 | 文档决策 | TC-DOC-* + `read-public-doc` |
| CAP-CODE | 具名文件改代码走 ECS | P1 | 本增量合入 | 尚未写失败测试 |
| CAP-WSDOC | 工作区文稿起草/改节 | P1 | 改代码评测绿 | 旧 phases/03 思路并入本目录后再做 |
| CAP-DESK | 电脑使用保持可看可接管 | P1 | 已在 main | 既有 desktop 测试；本增量不改 |

## 3. 任务清单

| ID | 任务 | 影响模块 | 优先级 | 状态 | 退出条件 |
|----|------|----------|--------|------|----------|
| TASK-DOC-001 | 写全套 feature 文档 | `docs/openbot-agent-capabilities/` | P0 | done | 模板章节齐全、中文 |
| TASK-DOC-002 | 实现 page-read + thread 路径 | `src/page-read.ts` 等 | P0 | done | 测试绿、不创建 OH 会话 |
| TASK-DOC-003 | eval `read-public-doc` | `evals/` `eval-set` | P0 | done | 旧句曾用自编正文绿，已作废为真抓 |
| TASK-DOC-005 | 现场原句 + 七句门禁 | evals | P0 | done | 1–5、7 绿；6 保持绿 |
| TASK-DOC-004 | phases 替代声明 | `docs/phases/README.md` | P0 | done | 写明决策源已迁移 |
| TASK-CODE-001 | 具名改文件分发与评测 | thread / evals | P1 | pending | 另开从 main 拉的分支 |
| TASK-WSDOC-001 | 工作区 notes.md 起草 | 未定 | P1 | pending | 先把验收写进本目录新版本 |
| TASK-DESK-001 | 桌面回归（无工具条/放大） | desktop | P2 | pending | 不在本 PR 改代码 |

## 4. 执行顺序和阻塞

本 PR：TASK-DOC-001 → 002 → 003 → 004。其后任务必须从同步后的默认分支新开 `cursor/<name>-74e9`，禁止叠在 `cursor/local-oh-client-74e9`。

阻塞：部署（用户禁止）。无审核阻塞（用户已放弃）。

## 5. 验证映射

| 任务 ID | 需求 ID | 验证方式 | 证据路径 |
|---------|---------|----------|----------|
| TASK-DOC-001 | REQ-CAP-002 | 文档审查 | 本目录 |
| TASK-DOC-002 | REQ-DOC-001/003 | 单测 | `05-testing/test-report.md` |
| TASK-DOC-003 | REQ-DOC-002 | eval | `evals/chat-layer/cases/read-public-doc.json` |
| TASK-CODE-001 | REQ-CODE-001 | 未开始 | — |

## 6. 未解决问题

- CAP-CODE / CAP-WSDOC 的失败测试尚未按「先红后绿」写入。到点时改本 backlog 状态，并给 PRD 加版本，不新建散装阶段文件。
