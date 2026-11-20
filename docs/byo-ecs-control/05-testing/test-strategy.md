# Bot 插件测试策略

## 0. 版本历史
v0.1 / 2026-11-20：独立接口闭环验证。

## 1. 范围
必测：鉴权、task 幂等、远端状态持久化/重启恢复、文件路径边界、真实执行审批、UI 断线恢复。相邻回归：OH client、Settings、A2A。无关搜索/桌面不扩大回归。安派仓库和生产不发布。

## 2. 系统与用例
- REQ-ECS-001：只读 SSH 检查既有主机、Node、OH health；浏览器连接真实 runtime identity，错令牌不得读取。
- REQ-ECS-002/003：自然语言任务真实写 notes.md、读回；远端文件与 HTTP preview 内容相同。mock 文本不能作为此项完成证据。
- REQ-ECS-004：提交 taskId 后退出本地进程，远端继续；新本地进程恢复同 ID。另测试运行时重启不重复创建 OH conversation。
- REQ-ECS-005：AlwaysConfirm 到等待状态，允许真实测试命令，拒绝另一个动作并核对无副作用；旧 revision 不可批准新动作。
- REQ-ECS-006：相同 requestId 重试只一次 create，不同正文冲突；提交不确定时不自动重做；暂停语义与取消进程分开。
- REQ-ECS-007：工作区目录/文本预览、1 MiB 上限、../ 和符号链接越界；下载后置，不能标全部完成。

## 3. 执行顺序与证据
`tsx --test tests/bot-runtime.test.ts` → OH/Settings/A2A 相邻回归 → tsc → 浏览器错误/正常状态 → 测试 ECS 实际文件/任务证据。日志只记录状态、ID、内容摘要，不记录 token。失败定位到 UI/proxy/runtime/OH/SSH，不以 health 替代完整执行。
