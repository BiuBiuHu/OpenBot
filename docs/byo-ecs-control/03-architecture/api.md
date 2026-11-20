# Bot API v1

## 0. 版本历史
v0.1 / 2026-11-20：独立于页面和安派仓库的接口。

## 1. 当前决策
单用户设备服务，以 Bearer 服务 token 鉴权，所有 /v1 端点均需认证；只监听 loopback，通过 SSH 到达。将来安派服务端接入时新增设备身份/授权通道，不在手机包中存放此 token。

## 2. 接口
| 方法 | 路径 | 行为 |
|---|---|---|
| GET | /v1/identity | apiVersion、instanceId、capabilities、执行服务健康 |
| POST | /v1/tasks | {requestId,threadId,goal,source?}，202 返回已落盘 task |
| GET | /v1/tasks?threadId=&offset= | 100 项分页，nextOffset |
| GET | /v1/tasks/:id | 查询状态、revision、结果；重连恢复使用 |
| POST | /v1/tasks/:id/approval | {revision,accept}，仅批准当前待审批版本 |
| POST | /v1/tasks/:id/pause | {revision}，请求 OH 暂停，不承诺杀死所有子进程 |
| POST | /v1/tasks/:id/resume | {revision}，恢复已明确暂停任务 |
| POST | /v1/tasks/:id/refresh | {revision}，对账未知或暂停状态，无新建 |
| GET | /v1/files?path= | 工作区相对路径目录列表 |
| GET | /v1/file?path= | 最大 1 MiB 内容、大小、sha256 |

source 可用 {kind:"openbot"} 或未来 {kind:"anpai",referenceId:"日程 ID"}，仅关联元数据，不授予权限。自然语言写文件通过任务执行，不新增无审批文件写接口。

相同 requestId 与相同输入返回原任务；同 ID 不同输入 409。401 未认证、403 越界、404 不存在、409 状态冲突、413 超限、503 运行时不可用。客户端失联和任务失败严格分开。没有事件 SSE 承诺：首版轮询快照，revision 可供未来客户端避免旧值覆盖新值。

## 3. 未解决问题
多租户、跨设备授权、产物下载、调度、事件订阅未纳入当前 v1 功能集合。不要根据预留 source 推断已经接入安派。

### Optional browser observation policy

`POST /tasks` accepts `observationPolicy: "confirm_all" | "auto_browser_reads"` (default `confirm_all`). The homepage exposes an unchecked per-task opt-in. Only exact `browser_get_state`, `browser_get_content`, and `browser_list_tabs` action schemas qualify; mixed batches and unknown parameters require confirmation. Navigation, clicks, typing, scripts, storage and terminal commands remain manual. This is permission to observe the connected browser, not unrestricted task authorization.

The policy is immutable under an existing `requestId`. Returned tasks retain `observationPolicy` and `autoApprovedActionIds` across restarts. Decisions are persisted before delivery; an uncertain delivery pauses and cannot be automatically replayed. The homepage displays the count of automatically authorized observations.

### Autonomous execution (supersedes the initial UI policy above)

Following the user's explicit product decision, new submissions default to `observationPolicy: "autonomous"`. The homepage sends this policy and removes per-action approval controls for autonomous tasks. The ECS observer durably authorizes all proposed tools, including navigation, terminal and file edits; the model still chooses the actions. Existing explicit policies remain supported for API consumers. `POST /tasks/:id/autonomy` with the current revision changes an existing unfinished task to autonomous mode without recreating the conversation. It does not clear uncertain-delivery errors or resume a deliberately paused task.

`POST /tasks/:id/cancel` is allowed only while queued, before any conversation creation. Running tasks use pause/resume. Cancellation retains an interrupted record. Automatic decisions retain the same persist-before-delivery/no-replay behavior, including after disconnect/restart. Login challenges and requests for human input remain task results; no bypass is implemented.
