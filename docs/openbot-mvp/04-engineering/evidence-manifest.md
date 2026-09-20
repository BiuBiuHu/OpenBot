# OpenBot MVP 证据清单

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始清单 | 实施前占位，验证后回填 | 未执行项必须写原因 |

## 1. 当前结论

- 保存点：`8fea153`（脚手架）、后续提交见 git log。
- 最小充分测试集：`tests/approval.test.ts` `tests/config.test.ts` `tests/worker.test.ts` `tests/e2e-local.test.ts`。
- 未执行的升级项：真实公网 VPS、真实付费模型调用、SaaS 预发。原因：本产品是本地安装，本环境无用户主机/key。

## 2. 证据表

| ID | 需求 ID | 命令或页面 | 结果 | 证据位置 | 未执行原因 |
|----|---------|------------|------|----------|------------|
| EV-001 | REQ-OPENBOT-008 | `npm install && npm run build` | 待跑 | 本文件回填 | |
| EV-002 | REQ-OPENBOT-005 | `npx tsx --test tests/approval.test.ts` | 待跑 | test-report | |
| EV-003 | REQ-OPENBOT-007 | `npx tsx --test tests/config.test.ts` | 待跑 | test-report | |
| EV-004 | REQ-OPENBOT-003 | `npx tsx --test tests/worker.test.ts` | 待跑 | test-report | |
| EV-005 | REQ-OPENBOT-001/002/003 | 本机 SSH bind 或 worker 直连 e2e | 待跑 | integration-report | 若无 sshd 则只跑 worker 直连 |
| EV-006 | REQ-OPENBOT-004 | 无 key 聊天错误 | 待跑 | e2e-local | 不打真实供应商 |
| EV-007 | REQ-OPENBOT-006 | README/架构审阅 | 待跑 | code-review | |
| EV-008 | — | 功能页 `/` | 待跑 | 截图或 HTTP GET | 无浏览器时用 curl HTML |

## 3. 环境

- 实验室主机：本 Cloud Agent workspace，非用户生产 VPS。
- 密钥：不写入本清单。
