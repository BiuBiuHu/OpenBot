# ECS 连接误报修复（2026-11-20）

模式：bugfix-fast-path。沿用本 feature 修复授权，不涉及安派仓库或远端部署。
保存点：387020e；已有工作区差异备份 /tmp/openbot-before-connection-fix.patch，保留用户改动。

## 复现与根因

本地 3857 首页显示 OH down；独立入口已有配置，但 POST /api/bot/connect 返回 503。
SSH 实际可登录，远端 openhands-agent-server 和 openbot-byo-ecs-test 都 active。
openLocalForward 仅等待固定 600ms，进程仍存活就当作连接完成；认证尚未完成时调用服务导致 fetch failed。
此外，旧聊天入口本机 OH_SESSION_API_KEY 缺失，Bot runtime 的远端凭据则正常。

## 修复

- src/tunnel.ts 等待本地转发端口真正监听；监听就绪后仍由调用方验证服务与 Bot identity。
- SSH 退出或超时会拒绝并清理子进程；没有重试任何任务提交或审批。
- 从用户指定 ECS 现有私有配置恢复旧入口 session key 到 ~/.openbot/.env；原文件已私有备份。密钥不输出、不进仓库，主机/SSH 私钥保持原样。
- 重启本地 3857 测试入口，远端服务未重启、未更新。

## 回归证据

- 修复前 connect 503；修复后 connect 200，execution.ok=true。
- 首页 /api/status ready=true、openhands.ok=true、hasSessionKey=true；真实浏览器首页显示 OH ok。
- 真实浏览器 /bot 显示「已连接 · 执行服务可用」和原任务 ffb0ff94 已完成。
- GET tasks 返回原 task id ffb0ff94-38fe-4750-a421-4c0d7e9d9c7c；GET file notes.md 返回原两行内容。没有新增执行任务。
- tests/tunnel.test.ts 模拟 1.4 秒 SSH 认证延迟，验证不能提前 ready；验证 SSH 认证失败正确报错。
- tunnel、bot-proxy、settings、bot-runtime、oh-client 合计 41 个测试通过；tsc --noEmit 与 git diff --check 通过。

## 边界

本轮验证连接恢复、原任务/文件读取，没有重新执行有副作用的聊天命令，也未覆盖机器重启、数小时压力或新网络中断。
本地其他端口的旧进程未重启；本次验收入口为 http://127.0.0.1:3857/ 和 /bot。
