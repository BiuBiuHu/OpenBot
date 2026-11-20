# 独立 Bot 测试报告

## 0. 版本历史
v0.1 / 2026-11-20：本地回归与真实 ECS 闭环。

## 1. 当前结论
用户要求的核心垂直链路已通过实际 ECS 测试：独立页面连接 → 自然语言任务 → 执行前批准 → 写入/追加/读回 notes.md → 退出本地主服务 → 重连原 taskId → 完成结果与文件预览。

## 2. 自动化
- `tsx --test tests/bot-runtime.test.ts tests/oh-client.test.ts tests/settings.test.ts tests/a2a-adapter.test.ts`：42/42 通过。
- `tsx --test tests/bot-proxy.test.ts`：1/1 通过，覆盖无会话拒绝、跨 Origin 拒绝、无连接错误及入口。
- `tsc --noEmit`、`git diff --check`：通过。
- `node scripts/build-bot.mjs <commit>`：从已提交来源生成无需 npm 安装的最小 ECS runtime。

## 3. 真实环境与证据
沿用 ~/.openbot 配置中用户之前的测试 ECS，Linux + Node 22.22.0；既有 openhands-agent-server active，未修改/重启其服务。独立服务 openbot-byo-ecs-test，端口 3850 只监听 loopback，目录 /opt/openbot-byo-ecs-test。源候选 009bc63 → 修复 2198c8b → 最终运行时 6dd6f28；后续提交只有 UI 入口链接、测试或文档时不改变远端执行代码。

本地入口 http://127.0.0.1:3857/bot，经动态 SSH 端口连接。浏览器 Ego Lite（macOS）。图见 evidence/ecs-recovery.png。

任务 `ffb0ff94-38fe-4750-a421-4c0d7e9d9c7c`：目标为等待 20 秒后创建 notes.md、追加中文第二行并读回。批准前核对实际工具命令，仅在测试工作区写入。随后停止本地主服务；远端文件仍生成，且任务继续等待下一条检查命令的审批。重启本地主服务，原任务恢复；核对后批准只读 ls/wc，任务最终 succeeded。两次审批均为本次测试明确授权范围内的工具动作。

文件：58 bytes，2 行；SHA256 `5d064ca56e12278c5f27953a2cb7ee1e5a2a545f294db082f8d39120dd6be9c7`。远端检查与页面预览内容一致。升级并重启独立 runtime 后同任务仍可查询，未创建第二条任务。

## 4. 失败与修复
- 初次最小打包缺少 esModuleInterop：补齐构建参数，已脚本化，未使用失败产物部署。
- 客户端重启时浏览器抢先加载空页：等待服务启动后重新访问，非任务丢失。
- observer 原先遇 waiting_approval 停止观察，无法跟踪批准后的异步切换及后续检查动作：保持观察、过滤已收到 ObservationEvent 的动作，补回归。
- 原始 ActionEvent 含内部推理字段：接口改为仅映射工具、动作参数、摘要及 ID，测试确保不输出 reasoning。
- 审批响应不确定：在发出前保存已决定 actionId，刷新不能重复批准同一动作。

## 5. 需求追踪与未执行
001/002/003/004：真实 ECS 证据；005：真实允许 + 自动化旧版本/重复批准保护，真实拒绝副作用尚未执行；006：本地幂等和未知提交不重放通过，暂停/恢复实际 OH 路径未单独完成破坏性/子进程测试；007：真实预览与自动化路径边界通过，下载未实现。

20 秒等待验证的是断线独立执行机制，不是数小时压力测试。未验证 ECS 整机重启、真实宕机中途恢复任意 shell、长时间网络中断压力、多用户隔离。当前服务为 systemd transient 测试单元，未配置整机重启自动安装/启动。旧 OH 使用 root，不声称有 shell 沙箱。没有部署安派或任何生产产品入口。
