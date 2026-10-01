# OpenBot 智能体能力 · 测试报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-10-01 | 占位 | 先有主文档 | — |
| v0.2 | 2026-10-01 | 回填 94 绿与现场 `/api/chat` | 合入门禁 | 测绿，可合 `main` |

## 1. 当前决策

- 当前采用的方案：`npm test` 为合入门禁。
- 被拒绝的替代方案：只跑 tsc；未测文档句就标绿。
- 未解决问题：无失败项。

## 2. 环节核心内容

- 环境：本地 Node 22，工作区 `/workspace`，分支 `cursor/openbot-agent-capabilities-74e9`。
- 账号：无。
- 版本：文档提交 `b03522a` + 本回填。
- 用例：`05-testing/test-cases.json` 的 TC-DOC-001–006、EVAL-read-public-doc、TC-EVAL-001。
- 命令与结果：
  - `npx tsc --noEmit`：通过。
  - 定向测试 27 pass。
  - `npm test`：94 pass / 0 fail。
  - 真抓 chapter3 + `POST /api/chat`：shown「我看过了」+「用户记忆和知识库」，无超时套话。
- 失败项：无。
- 未执行：预发、生产、真 ECS、浏览器像素。
- 密钥：夹具与报告不含私钥或公网 IPv4。

## 3. 需求追踪结果

| 需求 ID | 用例 | 结果 |
|---------|------|------|
| REQ-DOC-001 | TC-DOC-001/004、EVAL、`/api/chat` | 通过 |
| REQ-DOC-002 | TC-DOC-005、EVAL | 通过 |
| REQ-DOC-003 | TC-DOC-002/006、真 raw 抓取 | 通过 |
| REQ-CAP-001 | `/` 仍 `#box`、无 mode | 通过 |
| REQ-CAP-004 | 简体短答 | 通过 |
| REQ-CHAT-001 | 旧 chat-layer 仍在 suite 且绿 | 通过 |

## 4. 未解决问题

- 无。
