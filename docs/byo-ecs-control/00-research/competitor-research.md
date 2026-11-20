# 用户自带 ECS：项目现状与开源调研

## 0. 版本历史

| 版本 | 日期 | 变更 | 原因 | 影响 |
|---|---|---|---|---|
| v0.1 | 2026-11-20 | 核对现有源码及两个参考项目 | 用户要求在现有 UI 操作自己的 ECS | 首版聚焦命令、文件、长期任务；形成方案，未实施部署 |

## 1. 当前决策

保留 OpenBot UI、本地 Pi 主代理和远端 OpenHands；把 ECS 接入、远端任务持久化、审批和结果恢复做成完整闭环。借鉴开源项目的交互与服务拆分，不整体替换产品或新增第二套远端模型循环。

用户已选择首版为“聊天执行命令、读写文件、运行长期任务”。远程桌面、浏览器接管和多 Bot 编排不作为首版交付门禁。

## 2. 调研对象与证据

GitHub 上存在多个相似名称项目，不能把它们当作同一实现。本次检索日期为 2026-11-20。

| 项目 | 查阅来源 | 可借鉴 | 不适合照搬 |
|---|---|---|---|
| nickylin/OpenGrokBot | [README](https://github.com/nickylin/OpenGrokBot/blob/main/README.md)、[scheduler.ts](https://github.com/nickylin/OpenGrokBot/blob/main/src/scheduler.ts)、[browser.ts](https://github.com/nickylin/OpenGrokBot/blob/main/src/browser.ts) | 聊天、工具审批、共享工作区、独立记忆、MCP 扩展；浏览器工具和截图分层 | 默认 Agent 与调度器运行在本机。调度器依赖进程内 Set 和定时器，不提供我们的重启恢复保证；Computer 面板不能等同完整远程桌面 |
| milind-soni/OpenMausBot（原 OpenGrokBot） | [README](https://github.com/milind-soni/OpenMausBot/blob/main/README.md)、[BYO VPS](https://github.com/milind-soni/OpenMausBot/blob/main/docs/byo-vps.md)、[自托管](https://github.com/milind-soni/OpenMausBot/blob/main/docs/self-hosting.md)、[部署](https://github.com/milind-soni/OpenMausBot/blob/main/docs/deploy-vps.md) | UI → HTTP/SSE → Harness → Agent 的边界；设备配对；安装前检查；持久数据与服务分离；升级备份 | BYO VPS 模式只是把电脑放到 VPS，Agent 仍在本机；合盖继续工作需选完整服务远端部署。其 Docker/Cua/桌面及平台服务不必为本首版引入 |
| 当前 OpenBot | `src/server.ts`、`src/pi-kernel.ts`、`src/session-tools.ts`、`src/remote-agent.ts`、`src/a2a-adapter/`、`worker/worker.py` | 已有 SSH、UI 设置、远端工具转发和文件执行原语，改造成本最低 | 不能把现有探活成功、内存转发或旧测试当作持续任务已经产品化 |

OpenGrokBot 检索到的 main tree 为 `3ee82dfdbf9d8842b12414823e8277571e20ee9e`；README 标注 v0.6.1，许可证 MIT。OpenMausBot README 标注开源部分 Apache-2.0，enterprise 另有许可；其 VPS 文档提到 0.1.151/0.1.152 的界面问题。以上为查阅内容，不代表已安装或完成跨版本兼容验证。未做完整发布历史、Issue/PR 活跃度审计；若实际复用代码或依赖，应再锁定 release/commit 并核验许可证。

兼容成本：当前项目是 TypeScript + Node（package 要求 >=22.19.0）、原生 HTML/JS UI、Python worker。OpenGrokBot 要求 Node 20+，OpenMausBot README 要求 Node 24+ 且采用 React/Electron/独立 Harness；整仓迁移会扩大 UI、运行时及打包范围。本次只借鉴模式，无新增依赖。OpenHands 继续沿用项目既定方案，安装前重新锁定并核验 Python/Agent Server 版本；旧试装文档不能充当当前版本兼容证明。

## 3. 当前源码事实与缺口

检查基线：分支 `cursor/openbot-pi-kernel-74e9`，HEAD `08d8919`，包含用户已有未提交修改；结论针对当时工作区。

| 能力 | 已有实现 | 关键缺口 |
|---|---|---|
| UI 接入主机 | Settings → `/api/settings` → SSH 探测和隧道，`connect.ts` | 保存连接不等于安装远端运行时；目前连接逻辑还探测桌面。缺少版本、能力、主机身份与安装进度闭环 |
| 聊天调用远端 | Pi 从 agent card 注册工具，`sendA2aSkill` 发 A2A | 没卡就没有远端工具。普通 OpenHands health 成功不能证明聊天可执行。不能用旧 `runRemoteTask` 的 fallback 描述当前 Pi 工具路径 |
| A2A 适配 | `a2a-adapter/server.ts` 转发 OH | 监听随机本机端口，等待完成后才返回 Task；完成任务在 Map，缺少生产启动配置、持久任务、运行中查询及鉴权校验 |
| 线程恢复 | `server.ts` 有 threadConversations、piSessions、history | 内存状态；Pi 使用 `SessionManager.inMemory`。A2A Message contextId/taskId 为空，每次转发新建 OH conversation；重启和跨轮关联不完整 |
| 执行与文件 | worker 支持 jobs、日志偏移、文件 read/write/list | 主 UI 没有对应文件产品闭环；worker 的路径 resolve 不限制工作区，普通 OS 权限不是文件沙箱 |
| 长期任务 | worker 作业/日志落盘；OH 是远端执行后端 | 断网、关闭本机、远端进程重启是不同场景；worker 不会恢复 Python 线程，不能承诺任意命令断点续跑 |
| 审批 | 旧 worker 路径有 classifyCommand 和本机审批 | OH 创建 conversation 固定 `NeverConfirm`；本机 approvals Map 不是远端工具执行前的审批保障 |
| 隧道归属 | SSH 本地转发、loopback 服务 | `connect.ts` 会先探测已有本地 OH；只有 health 无法证明其属于选中 ECS，切换机器可能误用旧服务 |

其他需纳入实现验证的细节：worker 超时检测与阻塞 readline 耦合；取消只针对直接进程，存在子进程及状态覆盖风险。它可继续承接受控旧任务，但不应直接承担新远端任务控制面的可靠性保证。

## 4. 建议的交付顺序

1. 打通“设置一台 ECS → 能力真实可用 → 聊天创建文件并读回”的最小链路。
2. 在 ECS 持久化 task/thread/runtime 映射；先返回任务 ID，再异步观察；本机退出后重新连接恢复。
3. 把审批、取消、预算和不确定状态放在执行侧处理，验证不会重复产生副作用。
4. 提供任务详情、日志、文件查看和下载；之后再考虑远程浏览器、桌面、多机和定时任务。

## 5. 未解决问题

部署目标 ECS 的 OS、架构、资源、普通用户权限和网络可达性尚未核实；本次未连接任何真实主机。OpenHands 当前部署版本的暂停/审批/持久化 API 要在独立测试主机验证，不能凭名称猜测端点或直接改为自动通过。
