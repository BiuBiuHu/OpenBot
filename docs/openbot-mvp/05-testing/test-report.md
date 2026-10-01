# OpenBot MVP 测试报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 占位 | 先有策略再跑 | — |
| v0.2 | 2026-09-20 | 回填实验室结果 | `npm test` 9/9；localhost SSH bind 跑通 | Code PR 可评审 |
| v0.3 | 2026-09-22 | Phase 1 OH adapter | `npm test` 19/19；tsc 通过 | mock HTTP，无真实 ECS |
| v0.4 | 2026-10-01 | 本机客户端同一线程 | `npm test` 28/28；tsc 通过 | mock HTTP，无真实 ECS |

## 1. 环境

- 仓库：`BiuBiuHu/OpenBot`
- 分支：`cursor/openbot-mvp-a7b3`
- 日期：2026-09-20
- 角色：Cloud Agent 实验室主机（hostname `cursor`），**不是**用户生产公网 VPS
- SSH 实验室：本机 `sshd` 监听 `127.0.0.1:2222`，密钥 `~/.ssh/openbot_e2e`（不入库）
- 账号/密钥：不记录

## 2. 命令与结果

| 用例 | 命令 | 结果 | 备注 |
|------|------|------|------|
| TC-INST-001 | `npm install && npm run build && node dist/cli.js help` | **通过** | help 含 bind/serve/run |
| TC-APPR-001/002 | `npx tsx --test tests/approval.test.ts` | **通过** | |
| TC-CFG-001 | `npx tsx --test tests/config.test.ts` | **通过** | config mode 0600 |
| TC-REMOTE-001 / TC-PERSIST-001 | `npx tsx --test tests/worker.test.ts` | **通过** | worker `uname -a` 含 Linux；job 断轮询后仍在 |
| TC-BYOK-001 / TC-UI-001 / `/api/run` | `npx tsx --test tests/e2e-local.test.ts` | **通过** | 无 key 聊天失败；GET `/` 含口号 |
| 套件 | `npm test` | **通过 9/9** | 最小充分集 |
| TC-OH-001..007 | `npx tsx --test tests/oh-client.test.ts` | **通过** | 本地 mock Agent Server，无 ECS |
| 套件（Phase 1） | `npx tsc --noEmit && npm test` | **通过 19/19** | 2026-09-22 |
| TC-BIND-001 | `OPENBOT_HOME=/tmp/openbot-lab-home node dist/cli.js bind` | **通过** | persist=`tmux` |
| TC-REMOTE 产品路径 | `node dist/cli.js run 'uname -a'` | **通过** | `Linux cursor 6.12.94+ … x86_64` exit=0 job=`1915c4e56ba6` |
| TC-PERSIST 产品路径 | CLI 退出后 `curl 127.0.0.1:3848/health` | **通过** | `{"ok": true, "role": "openbot-worker"}`；job 文件仍在 |
| 功能页 | `GET http://127.0.0.1:3847/` 与 `/api/status` | **通过** | HTML 为遥控台；status 含 persist tmux 与远端 uname |
| 功能页交互 | 浏览器 Run on host → `uname -a` | **通过**（修 UI 后） | 录像 `/opt/cursor/artifacts/openbot_ui_run_uname_on_host.mp4` |

## 3. 失败项与修复

| 问题 | 归因 | 修复 |
|------|------|------|
| `/api/run` SSE `res.text()` 挂起 | 控制面未 `res.end()` | `streamSse` finally end |
| `scp` subsystem request failed | 自定义 sshd 无 SFTP | 改为 `ssh cat >` 管道 |
| `cp same file` | 远端 `~` 被单引号字面化，后又与 WORKER_HOME 同路径 | 解析 `$HOME` 绝对路径；bootstrap 跳过同文件 cp |
| tunnel `3848 already in use` | localhost SSH 时 worker 已占本地端口 | `ensureWorkerAccess` 先探测再决定是否开隧道 |

## 4. 残余风险

- 未在用户真实公网 2C4G VPS 上 bind（实验室等价：本机 SSH + tmux worker）。
- 未用真实 `OPENAI_API_KEY` 走完整 tool-call（无 key 路径已测）。
- persist 本环境落到 **tmux**（无可用 systemd --user session）；systemd 路径仍在 bootstrap 中优先尝试。
