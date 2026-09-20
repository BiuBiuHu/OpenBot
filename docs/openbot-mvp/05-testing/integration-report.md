# OpenBot MVP 联调报告

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始 | 研发后联调门禁 | — |
| v0.2 | 2026-09-20 | 回填 localhost SSH + Web | Bind/Persist/Remote 实验室闭环 | 客户端专项通过 |

## 1. 客户端范围判定

- 涉及 Web 遥控台：是。
- 移动 App / 小程序 / 桌面原生：否。
- 客户端专项门禁：**启用**，范围仅本机 Web + CLI。

## 2. 拓扑（实验室实测）

```text
node dist/cli.js  --ssh:2222-->  本机 sshd
bootstrap.sh     --> tmux session openbot-worker
worker.py        --> 127.0.0.1:3848
CLI/UI           --> 先探测 /health，localhost 则不开 -L
浏览器/curl      --> 控制面 127.0.0.1:3847
```

进程：sshd 一份、tmux worker 一份、控制面仅在 `serve` 期间一份。

## 3. 环境变量

- `OPENBOT_HOME=/tmp/openbot-lab-home`（与仓库隔离）
- 无 `OPENAI_API_KEY`
- 预发/生产 URL：不适用

## 4. 联调矩阵

| 客户端 | 环境 | 入口 | 命令 | 结果 | 证据 |
|--------|------|------|------|------|------|
| CLI | 实验室 SSH | bind/run/status | `node dist/cli.js` | 通过 | test-report v0.2 |
| Web | 实验室 | `GET /` | curl + e2e | 通过 | HTML 含 OpenBot / Run on host |
| Worker | 实验室 | `/health` `/v1/jobs` | curl + tests | 通过 | persist=tmux |
| SSH bind | 实验室 :2222 | init+bind | CLI | 通过 | 见失败修复表 |

## 5. 功能页验收

- 目标页：`http://127.0.0.1:3847/` 遥控台（不是空白壳）。
- 断言：title `OpenBot — your machine`、口号、Chat/Run。
- `/api/status`：`ok:true`，`persist:tmux`，`info.uname` 与 `openbot run 'uname -a'` 一致。

## 6. 失败归因

已修复项见测试报告 §3。当前无开放失败。

## 7. 不适用项

- 验证码登录、OAuth、Vercel、DB 迁移、iOS：不适用。
