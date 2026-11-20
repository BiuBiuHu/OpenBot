# 用户指定首页功能验收 — 2026-11-20

实际入口：http://127.0.0.1:3857/ 。本轮所有聊天提交均在首页完成，没有用 /bot 替代。

## 发现与修复

1. 首页显示 OH ok，但模型回复没有远端能力：本地 8010 隧道错误地固定转发远端 8000，绕过已有 8010 A2A 适配服务。新增 openhands.remotePort / OH_REMOTE_PORT，默认仍为 8000，当前私有配置明确使用 8010。
2. A2A 服务不提供 /health，连接状态误报：仅 /health 返回 404 时进一步验证非空 agent card。该检查代表网关可用，不冒充下游执行验证。
3. 命令/文件工具把成功结果压为「做完了」，模型无法回复实际输出：保留有长度限制的结果正文，并要求结果缺失时继续做只读核验，不再次征询用户或重复写入。

保存点：9e02900 + /tmp/openbot-before-homepage-fix.patch；Pi 原有用户修改另存 /tmp/openbot-pi-before-homepage-result.ts。私有配置有 before-homepage-port-fix 备份，未改变主机/私钥/远端服务，未修改安派。

## 真实页面操作与证据

- 首页发送 pwd 和 uname -s，复现能力缺失并完成归因。
- 修复后首页执行专用 qa-homepage-20261120.txt 文件写入、追加；独立 SSH 验证内容 HOME_CHAT_OK / FILE_READBACK_OK。
- 首页只读核验返回实际目录 /opt/openbot-byo-ecs-test/workspace、Linux 和上述两行内容。
- 最终完整回归：从首页一次提交创建 qa-homepage-final.txt、写入 HOME_FINAL_OK、追加 READ_WRITE_OK、读回并自行核验。首页直接给出文件路径、两行内容和 28 字节，未要求用户再次推动。
- 独立 SSH 检查文件：两行内容与页面一致，28 字节；SHA256 b64ac64f738a73fce469e9fea972350298c2667a5f5e5628f9375c1699db9562。
- 截图 evidence/homepage-selftest.png 已查看，保留首页最终结果供用户检查。

## 自动化

gateway-connection、settings、a2a-adapter、oh-client、tunnel、pi-kernel 共 46 项通过；新增 gateway 404/card 分支和独立远端端口配置检查，增强 A2A 测试验证模型上下文收到真实文件/命令结果。tsc --noEmit、git diff --check 通过。

## 验收边界

本轮首页连接、真实命令、文件写入/追加/读回通过。首页仍走现有 Pi/A2A 聊天链路；持久任务 API、审批与断线恢复界面仍在 /bot，本轮不宣称已接入首页。首页聊天刷新后的恢复、长任务、暂停/拒绝、浏览器操作与整机重启未作本轮验收。远端桌面可显示，但没有用桌面操作代替命令证据。
