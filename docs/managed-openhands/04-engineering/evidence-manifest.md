# 自动安装验证记录

## 版本与范围
2026-11-20；安装器从提交执行，首次候选 eaa4865，镜像与依赖锁修正后远端候选 dfe4db8，客户端锁摘要校验 be66835，最终内置文件操作自测 6a7cd4d。目标为既有测试 ECS 的隔离服务；不迁移现有任务。

## 本地验证
- `npm run build` 通过。
- `npx tsx --test tests/managed-openhands.test.ts tests/settings.test.ts tests/bot-proxy.test.ts tests/tunnel.test.ts`：15 项通过。
- `python3 tests/managed_installer_test.py`：4 项通过，涵盖首装/重复安装保留凭据、不重启、升级健康失败回滚、下载失败保留当前服务。
- 会话和 Origin 校验拒绝未授权安装请求；缺少主机返回可读错误；异步状态不含密钥；更换主机时不写入错误连接配置。

## 浏览器验证
独立临时配置、本地 3868 入口，避免触碰真实账号和任务历史。
- 真实 API：未保存主机时显示“请先保存 ECS 连接信息。”，按钮恢复可用。
- 模拟安装状态：一次点击只发送一个 POST，安装中按钮禁用，轮询后成功状态恢复；390px 视口无横向溢出。
- 截图：`../05-testing/evidence/setup-mobile.png`，使用模拟成功响应，不能替代实际 ECS 安装证据。
- 已重启本地 3857 开发入口，验证安装按钮及受保护状态接口均可用；远端原任务服务未重启。

## 实际环境发现与修复
- 默认主机镜像缺少锁定包；安装器改为显式公开镜像，失败回退官方源，不继承主机默认索引。
- 最新传递依赖导致镜像同步问题；改用已有 OpenHands 1.49.2 验证环境的版本约束，重新解析带哈希锁。
- 安装仍执行相同固定版本/哈希校验；没有放宽版本或跳过完整性检查。

## ECS 实测结果
- 四个核心包 1.49.2，完整依赖检查通过，锁摘要 `ddd0bbb205289b57b031eb57860eaa66bacc1c8e7bd4e083e91070c35240c83e`。
- 首装 `changed=true`；第二次 `changed=false` 且凭据不变；最终版本再次检查，进程 PID 不变。
- systemd enabled，服务用户 openbot-engine，凭据文件 0600，监听仅 127.0.0.1:18000。
- 受保护会话 API：无密钥 401，有密钥 200。旧 OpenHands 8000 健康检查仍为 200。
- 通过新引擎 `/api/bash/execute_bash_command`，在专用工作区写入、读取并删除临时文件：exit_code=0，stdout=OPENBOT_ENGINE_FILE_OK；命令同时断言执行用户为 openbot-engine。
- 该文件检查已加入安装器成功门槛；不调用模型、不产生模型费用。

## 未执行范围
未迁移已有 Bot Runtime、未重启已有真实任务、未用新引擎处理真实邮箱或购买。新安装服务仅作为隔离验证实例保留；本机原任务连接配置保持原状。

## 完整环境初始化补充验收（2026-11-21）

### 候选与依赖
完整安装从 d71e461 开始，9f7448c 补充 Python 引导和 Ubuntu AppArmor，73cccc6 修复 SDK 用量字段兼容，e6762a2 补充结束等待任务和补丁回滚，ceb7009 修复初始化后桌面重连。真实 UI 初始化与重复检查的 Runtime 来源为 ceb7009；后续文档提交不改变运行代码。

固定 Node 22.23.5、Chrome for Testing 158.0.8127.36；完整哈希见 runtime/desktop/assets.json。Python、桌面、字体和原生库由安装器准备，模型配置通过保护接口接收并经 SSH stdin 写入 0600 配置。

### 真实问题及修复
- Ubuntu 24.04 限制非特权 user namespace 导致 Chromium 启动失败；增加固定浏览器路径的 AppArmor 策略，保留 Chromium sandbox，不关闭系统全局限制。
- 首个模型任务因 OpenHands 1.49.2 直接访问缺失的 cache_creation_tokens 而失败。采用严格源码匹配、幂等的 getattr 默认值补丁，并记录前后文件摘要；上游问题：https://github.com/OpenHands/software-agent-sdk/issues/5326 。补丁保留真实用量，缺失字段按 0，异常源码拒绝修改。
- 首个失败任务 f1000937-002a-477f-a5aa-b14ebb32d506 已通过会话 API 清理并刷新为 interrupted，保留失败记录；未伪造成功。

### 业务闭环
- 文件任务 62c98267-1108-42f8-bdde-7b6ed76839a0：succeeded，创建 setup-smoke.txt 并读回 OPENBOT_SETUP_OK。SSH 独立复核属主 openbot-engine、权限 600、17 字节及实际内容。
- 私密网页任务 bdea86db-9d57-417c-8e29-5520dacbc8e9：succeeded，通过受限浏览器打开 example.com，读回 Example Domain 及正文首句；未索要凭据。
- 网页任务执行中刷新本地页面，重连恢复同一任务 ID 与完成结果，没有重复提交。
- 独立临时配置入口 3868，真实点击“初始化 / 检查远端电脑”：按钮执行中禁用，成功显示“电脑环境已就绪，任务服务和可视桌面已连接”，自动恢复桌面。
- 同一提交再次点击初始化：六个服务 MainPID 和令牌 SHA-256 与前一次完全一致，文件内容与三个历史任务仍保留。
- 截图 full-stack-completed.png 已人工查看，不含真实密钥；包含第一次失败的历史提示，以保留真实验证过程。full-stack-running.png 记录首次失败阶段，不代表成功验收。

### 自动检查
- TypeScript 构建通过。
- 相关 TypeScript 回归 39/39 通过。
- Python 安装器测试 9/9 通过，涵盖保留凭据、不重启、未结束任务拒绝、失败回滚、哈希错误拒绝与 SDK 可选字段。
- 扩展运行全仓测试 164 项：161 通过，3 项受本机环境限制失败。两项 worker 测试把本机 uname 硬编码为 Linux，而本机为 macOS；布局测试要求 /usr/bin/google-chrome-stable，该 Linux 路径本机不存在。未将此次全仓运行记为全通过；实际功能已通过上述 ECS 和浏览器验收。

既有用户任务服务和原连接配置保留。本次未测试真实邮箱登录、真实购买或迁移旧服务；完整初始化已验证于独立测试服务，不代表生产发布。
