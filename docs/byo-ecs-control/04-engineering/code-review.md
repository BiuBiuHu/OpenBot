# Bot 插件本地自审

## 0. 版本历史
v0.1 / 2026-11-20：实现与实际联调后的自审。

## 1. 当前决策
仅本仓库改动；原用户 Pi/A2A/锁文件改动保留，没有纳入本次功能提交。新 runtime 与 UI 分离，安派未来只调用接口。

## 2. 已核对
- main 同步后开 feature 分支；原分支提交 fast-forward 保留，未提交改动有 stash 保存点。
- 所有 runtime API 带 token，UI proxy 要求本机会话与同源；动态 SSH 隧道避免误用已有端口，保存 instanceId 拒绝错机。
- 任务先落盘再返回；幂等请求冲突 409；不确定 create 先查原 conversation，绝不盲目重发。
- 审批使用 AlwaysConfirm，与实际 OH respond_to_confirmation 契约核对；不再额外重复 run。actionId 决定先落盘，防止网络失败导致重复批准。
- 浏览器结果使用 textContent；不输出原始模型思考；服务凭证未进 Git。
- 文件读取只允许工作区、拒绝 ../ 和符号链接逃逸、单文件 1 MiB。
- runtime 包仅 Node 内置库与本项目 OH client/events，无 Pi/UI/安派依赖。

## 3. 限制
单进程 JSON store 为单用户场景；不是多节点数据库。任务队列串行，暂停任务占队列；无删除/强杀子进程语义。文件 API 防越界不是任意 shell 沙箱。历史大任务只展示前 100 项，API 有 offset 但 UI 尚无翻页。旧 /api/chat 与新 /bot 暂独立，不宣称原聊天线程已经迁移为持久任务。

## 4. 结论
核心独立测试链路可用；不作为多租户或生产发布核销。测试与限制见测试报告。
