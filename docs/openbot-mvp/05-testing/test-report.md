# OpenBot MVP 测试报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 占位，验证后回填 | 先有策略再跑 | 未跑项保持失败或 N/A |

## 1. 环境

- 仓库：`BiuBiuHu/OpenBot`
- 分支：`cursor/openbot-mvp-a7b3`
- 日期：2026-09-20
- 角色：实验室 Cloud Agent 主机，**不是**用户生产 VPS
- 账号/密钥：不记录

## 2. 命令与结果

| 用例 | 命令 | 结果 | 备注 |
|------|------|------|------|
| TC-INST-001 | `npm install && npm run build && node dist/cli.js help` | 待填 | |
| TC-APPR-* | `npx tsx --test tests/approval.test.ts` | 待填 | |
| TC-CFG-001 | `npx tsx --test tests/config.test.ts` | 待填 | |
| TC-REMOTE-001 / TC-PERSIST-001 | `npx tsx --test tests/worker.test.ts` | 待填 | |
| TC-BYOK-001 / TC-UI-001 | `npx tsx --test tests/e2e-local.test.ts` | 待填 | |
| 套件 | `npm test` | 待填 | 最小充分集 |

## 3. 失败项

- 无（回填时更新）。

## 4. 残余风险

- 未在用户真实 2C4G VPS 上 bind。
- 未用真实 OPENAI_API_KEY 走完整 tool-call。
