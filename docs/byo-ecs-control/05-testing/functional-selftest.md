# 修复后功能自测 — 2026-11-20

## 范围与环境

独立 Bot 入口 http://127.0.0.1:3857/bot，真实已配置 ECS，runtime release-6dd6f28。当前分支 codex/byo-ecs-control，前置修复 bb7ec4f。
保存点：/tmp/openbot-before-selftest-fix.patch；未修改安派或远端服务。

## 实际执行

| 场景 | 证据与结果 |
| --- | --- |
| 页面自动连接已有配置 | 显示「已连接 · 执行服务可用」，无需重新填写 |
| 页面自然语言创建任务 | 新 task 6856dc0b-1901-4b74-8041-1e115c9ba4bf |
| 审批实际终端动作 | 检查动作只等待 25 秒、写入/追加专用测试文件并读回；通过页面批准 |
| 执行中关闭本地服务 | 批准后状态 running，终止本地 3857 服务；ECS 独立完成任务 |
| 本地重启、刷新恢复 | 同一 task 恢复为 succeeded，未创建第二个任务 |
| 文件读写闭环 | 浏览列表并点击 qa-20261120-connection.txt，预览两行 QA_CONNECTION_OK / FILE_APPEND_OK |
| 内容核验 | SHA256 3d8231af3418c46bf17e4f34aed929d27c063ad42d33ec5c868c2d8ed9b4732d |
| 单独切断 SSH 隧道 | 终止本地 Bot 对应 ssh 子进程；页面正确显示中断并保留任务 |
| 恢复隧道 | 点击连接/恢复连接后成功；原两项任务状态保留 |
| 同请求重复提交 | API 使用原 requestId/threadId/goal/source，202 返回原 task id；没有新增任务 |
| 非法文件路径 | API 越界路径 400、缺失文件 404；页面 ../ 查询显示错误，改回根目录可正常读取 |

## 本轮发现并修复

断线时任务区提示错误但连接区仍显示「已连接」。修改 src/ui/bot.html：读任务失败时将 connected 置 false，并同步更新连接提示；服务重启导致旧页面凭据 403 时提示刷新。真实断开 SSH 后复验通过，不自动重试写入或审批。

## 自动化与检查

tunnel、bot-proxy、settings、bot-runtime、oh-client 共 41 项通过，tsc --noEmit 通过。UI 修改后再次跑 bot-proxy 通过，并完成以上真实浏览器复验。git diff --check 通过。
截图：evidence/connection-selftest.png（已查看）。

## 范围边界

本轮验证的是独立 Bot 主链路，不宣称旧聊天全部能力、暂停/拒绝分支、整机重启或数小时压力均已真实验收。25 秒任务用于验证异步执行和客户端断线后的持续运行机制。保留测试文件供用户检查；未清理或改动原 notes.md。浏览器提示可升级，本轮未升级。
