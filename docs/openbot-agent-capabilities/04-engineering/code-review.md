# OpenBot 智能体能力 · Code Review 自审

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 实施前清单；diff 自审后回填 | opc-skills 要求合入前有 CR 记录 | 正式 PR 引用本文件 |
| v0.2 | 2026-10-01 | 对照 `origin/main...HEAD` 完成自审 | 测试已绿，准备合入 | 无密钥、无无关文件 |

## 1. 当前决策

- 当前采用的方案：主 Agent 自审 + 中文 Code PR。无生产发布，不要求 Release PR。
- 被拒绝的替代方案：未看 diff 就合入；把密钥或公网 IP 写进评测。
- 未解决问题：外部 reviewer 是否留言不影响用户已授权的合入（测绿即可）。

## 2. 环节核心内容

### 2.1 变更范围

- 功能文档：`docs/openbot-agent-capabilities/`
- 历史索引：`docs/phases/README.md` 替代声明
- 代码：`src/page-read.ts`、`src/chat-voice.ts`、`src/thread.ts`、`src/eval-set.ts`
- 评测/测试：`evals/chat-layer/cases/read-public-doc.json`、相关 `tests/`

### 2.2 自审清单（合入前必须全过）

| 项 | 结论 | 说明 |
|----|------|------|
| 无关文件/临时日志/生成物 | 通过 | 仅 docs、src、evals、tests |
| 密钥、PEM、session key、公网 IP | 通过 | 夹具为公开 github.com 路径；eval 禁止私钥 |
| 客户端直连内部子服务 | 通过 | 页只打本机 API |
| 文档路径创建 OH 会话 | 通过 | TC-DOC-004 `creates.length === 0`；死端口仍短答 |
| 抽取写死某一章 | 通过 | 改为 本章/本文/这篇 |
| 错误处理 | 通过 | TC-DOC-005 读不成 ≠ 超时套话 |
| 分层 | 通过 | `page-read` 只被主服务调用 |
| 需求追踪 | 通过 | REQ-DOC-* → TC-DOC-* / eval |

### 2.3 回滚

`git revert` 本 feature。无迁移。

## 3. 未解决问题

- 无。Code PR：https://github.com/BiuBiuHu/OpenBot/pull/8 。相对 main 的提交：`d6bdfef`（实现）、`b03522a`（文档与评测）。
