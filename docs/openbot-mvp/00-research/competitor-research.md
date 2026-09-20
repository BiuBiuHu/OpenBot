# OpenBot MVP 竞品与开源调研

## 0. 版本历史

| 版本 | 日期 | 变更内容 | 变更原因 | 影响 |
|------|------|----------|----------|------|
| v0.1 | 2026-09-20 | 初始调研 | opc-skills 编码前必须先查成熟方案 | 锁定 SSH 绑定 + 宿主机 HTTP worker，拒绝托管 Firecracker 伪装 |

## 1. 当前决策

- 当前采用：用户自有 Linux 主机 + 系统 `ssh`/`scp` 绑定 + 远端 stdlib Python worker（仅监听 127.0.0.1）+ 笔记本控制面通过 SSH 隧道访问 worker。
- 被拒绝：默认 Docker/Firecracker 沙箱、像素级 computer-use、把 OpenHands 编码控制台做成产品主隐喻。
- 调研日期：2026-09-20。

## 2. 产品隐喻对比

| 方案 | Computer 意味着什么 | 谁拥有主机 | Token | 来源 |
|------|---------------------|------------|-------|------|
| Grok Bot | 平台托管的持久云电脑 | 平台 | 订阅 | 公开产品隐喻，非像素对标 |
| OpenHands | 任务后端 / sandbox | 常常是你，但产品是编码控制台 | 多为 BYOK | [Runtime Architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime) |
| 本机 computer-use | 眼前这台笔记本 | 你 | BYOK | 行业通用 |
| **OpenBot** | **SSH 上的长期在线 Agent PC** | **你** | **BYOK** | 本仓库定位 |

OpenHands 可以挂远程机器，但产品语言是“这次编码任务跑在哪个 backend”。OpenBot 的语言是：**这台机器就是我的电脑**。

## 3. 开源技术方案

| 候选 | 来源 | 适用性 | 决策 |
|------|------|--------|------|
| 系统 `ssh`/`scp` | OpenSSH 官方客户端 | 用户已有密钥、ssh-agent、ProxyJump | **采纳**。不引入 paramiko/ssh2，避免第二套密钥语义。 |
| OpenHands Action Execution Server | [docs](https://docs.openhands.dev/openhands/usage/architecture/runtime)、[issue #2404](https://github.com/OpenHands/OpenHands/issues/2404) | 远端执行用 REST，不再把 SSH 当命令通道 | **借鉴协议形态**：worker 用 HTTP；**拒绝** Docker sandbox 作为 v0 默认，也拒绝宣称 EventStream 对等。OpenHands 已弃用 SSH 作为 runtime 通信，是因为他们要镜像无关沙箱；OpenBot 的差异化就是“SSH 就是绑定动作”。 |
| paramiko / node-ssh | PyPI / npm | 可编程 SSH | **拒绝**。2C4G 主机与用户本机都已有 OpenSSH；自研封装系统客户端成本更低。 |
| systemd --user / tmux / nohup | Linux 发行版 | 笔记本合盖后进程仍在 | **采纳**，按可用性降级。 |
| Fastify / Express | npm | 本地控制面 | **拒绝**。Node 22 内置 `http` + `fetch` 足够，零 runtime 依赖。 |
| OpenAI 官方 SDK | npm | BYOK chat | **拒绝引入 SDK**。只用 OpenAI-compatible `POST /chat/completions`，便于 Groq/vLLM/Ollama。 |
| Playwright 浏览器自动化 | Microsoft | 像素 computer-use | **v0 拒绝**。目标是无头 2C4G，不伪造 Grok 桌面。 |

## 4. 风险与诚实边界

- 不得声称 Firecracker 隔离或 Grok Bot 像素对等。
- Worker 以 SSH 用户身份运行，**不是沙箱**。危险命令靠控制面审批门，不是内核隔离。
- Worker 只绑 `127.0.0.1`，外网不可直连；隧道断开不影响已启动 job。

## 5. 未解决问题

- 多主机切换、团队 ACL、技能市场：明确不在本 feature。
