# ECS computer-use 操作闭环验收

日期：2026-11-20。入口：http://127.0.0.1:3857/。模式：implementation-loop。
产品目标：ECS 是 Personal Agent 的手和脚，以目标系统实际完成与可核验回执为终点。

## 场景和结果

在当前首页提交自然语言目标，要求只用远端 browser_* 工具：打开模拟收件箱，阅读购买需求，进入模拟商店，选择蓝色笔记本、数量 2，提交不收费测试订单，从页面读取最终回执。

任务：0882d32a-94ea-4b7f-8b75-3ad5a9c644ac，最终状态 succeeded。
页面与独立后台回执一致：订单 DEMO-OPENBOT-001、蓝色笔记本 × 2、completed、simulated=true、charge=0。

完整分页读取的事件审计：browser_navigate 1 次、browser_get_state 7 次、browser_get_content 5 次、browser_click 5 次、browser_type 1 次，共 19 次浏览器动作；ObservationError 0。没有 terminal、file_editor 或直接请求工具。独立后台请求仅由验收脚本在操作后用于核对，不属于 Agent 执行流程。

截图：evidence/computer-use-completed.png，已查看；同屏展示首页结果与远端可见 Chromium 的订单页。
审计：evidence/browser-audit.json，已读完全部事件分页（nextPageId=null），不包含凭据或推理内容。

## 实现与环境

- runtime release-1297cf0，BOT_BROWSER_CDP_URL 连接 127.0.0.1:9322 的可见 Chromium，DISPLAY :1，与首页 VNC 画面一致。
- 浏览器独立 profile 保存在 ECS。模拟网页仅监听 127.0.0.1:3861，没有真实邮件、商家、发送或付款。
- 原 OpenHands/A2A 服务没有修改或重启；只升级独立 Bot 测试服务，并增加隔离浏览器/fixture 临时服务。
- 当前使用安装的 OpenHands 1.49.2 原生 BrowserToolSet；通过 DOM/交互元素观察与浏览器动作完成任务，使用过一次 include_screenshot=true 的状态读取，不宣称任意原生桌面自动化已实现。

## 本轮发现与修复

1. 原任务只启用终端/文件，新增浏览器工具的可选 CDP 参数，并同时支持独立 runtime 与本地配置入口。
2. 审批已提交但远端状态尚未更新时，首页会短暂重现旧审批。按 persisted decidedActionIds 显示「确认已提交 · 等待远端响应」，不再提供重复批准按钮；补充动作摘要帮助用户理解浏览器点击。
3. 扩大回归发现旧首页测试仍断言 /api/chat 与新增测试缺少 import，均修复后重新验证。

## 验证

54 项相关自动化测试通过，涵盖 runtime、代理、OH、settings、gateway、tunnel、A2A、Pi。tsc --noEmit、JS 语法检查、git diff --check 通过。真实首页完成上述 19 次浏览器动作及回执核验；此前首页的审批刷新、执行中关闭本地服务、无需刷新自动恢复、文件读回也已验收（见 homepage-integration.md）。

## 尚未完成的产品链路

真实邮箱/购物网站登录、验证码和人工接管协议；任务级授权与关键发送/付款门禁；跨任务长期记忆；生产安装和整机重启恢复；不同模型/复杂网站/长时运行的成功率与成本。当前逐动作确认适合验收，不等于面向用户的无人值守体验。不能把本报告称为真实邮件/真实购买功能已上线。

浏览器测试工具提示可升级，本轮未升级工具版本。
