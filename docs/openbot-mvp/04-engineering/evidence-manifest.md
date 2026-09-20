# OpenBot MVP 证据清单

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始清单 | 实施前占位 | — |
| v0.2 | 2026-09-20 | 回填命令结果 | 验证完成 | 与 test-report 对齐 |

## 1. 当前结论

- 保存点：`8fea153` 脚手架；文档提交 `0690587`；本轮修复在后续 commit。
- 最小充分测试集：`npm test` → **9 passed**。
- 产品路径：localhost SSH `bind` → `run 'uname -a'` → CLI 退出后 worker `/health` 仍 ok。
- 未执行：真实公网 VPS、真实付费模型、SaaS 预发。

## 2. 证据表

| ID | 需求 ID | 命令或页面 | 结果 | 证据位置 | 未执行原因 |
|----|---------|------------|------|----------|------------|
| EV-001 | REQ-OPENBOT-008 | `npm install && npm run build` | 通过 | 本环境日志 | |
| EV-002 | REQ-OPENBOT-005 | `tests/approval.test.ts` | 通过 | npm test | |
| EV-003 | REQ-OPENBOT-007 | `tests/config.test.ts` | 通过 | npm test | |
| EV-004 | REQ-OPENBOT-003 | `tests/worker.test.ts` | 通过 | npm test | |
| EV-005 | REQ-OPENBOT-001/002/003 | localhost `:2222` bind + run | 通过 | test-report / integration-report | 公网 VPS 无 |
| EV-006 | REQ-OPENBOT-004 | 无 key `runAgentTurn` | 通过 | e2e-local | 不打真实供应商 |
| EV-007 | REQ-OPENBOT-006 | README/架构 | 通过 | 文档仅在拒绝句出现 Firecracker | |
| EV-008 | REQ-OPENBOT-003 | `GET /` 与 `/api/status` | 通过 | curl HTML + JSON | |

## 3. 环境

- 实验室主机：Cloud Agent workspace。
- 密钥：不写入本清单。
