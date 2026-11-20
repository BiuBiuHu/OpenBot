# Bot 插件证据清单

## 0. 版本历史
v0.1 / 2026-11-20：记录本地及 ECS 证据。

## 1. 摘要
实现并验证核心链路；安派仓库零修改。测试详情以 ../05-testing/test-report.md 为准。

## 2. 命令证据
- 远端默认 main 同步：0d5eb944；开发分支 codex/byo-ecs-control，保留原工作至 08d8919。
- 本地相关测试 42/42；proxy 测试 1/1。类型检查、diff 空白检查通过。
- 最小 runtime 通过 scripts/build-bot.mjs 从 6dd6f28 编译、打包、上传至独立版本目录。

## 3. 页面与 API
- /bot 空态及未连接提交拒绝：浏览器确认。
- 连接成功、taskId 接收、审批、恢复、完成、文件摘要：Ego Lite 验证。
- 页面截图：../05-testing/evidence/ecs-recovery.png。
- taskId：ffb0ff94-38fe-4750-a421-4c0d7e9d9c7c；关闭并重启本地主服务后仍同 ID。
- 文件摘要：5d064ca56e12278c5f27953a2cb7ee1e5a2a545f294db082f8d39120dd6be9c7。

## 4. 运行时
旧配置 SSH 可达；Linux/Node22.22.0；OH active；新增测试 runtime loopback3850，最终代码6dd6f28。真实 IP 和 token 只在私有本机配置/远端环境，不进入本清单。

## 5. 失败和复验
审批状态观察及原始推理字段问题已修复并回归，详见测试报告。未通过失败产物发布。

## 6. 未执行
长时间负载、整机重启、真多用户、生产发布、安派集成、下载、强杀后台进程。浏览器提示可升级，保持当前版本未执行升级。
