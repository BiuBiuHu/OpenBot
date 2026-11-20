# Personal Agent：以完成操作为终点

用户定位（2026-11-20）：ECS 是 Personal Agent 的手和脚，异步替用户完成读邮件、购买物品等任务。安派是未来入口与组织层，本仓库拥有独立执行能力。

## 产品闭环

目标 -> 理解任务与授权范围 -> 选择连接器/API 或 computer-use -> 执行并观察 -> 遇到登录/验证码/关键提交请求接管 -> 恢复原任务 -> 核对目标系统结果 -> 交付可追溯回执。

命令成功、网页打开、模型说完成，都不能单独作为用户任务完成的证据。邮件任务至少核对目标邮件和提取结果；购物任务区分候选、购物车、订单提交与付款，核对订单号、商品、数量和金额。结果不明时先查询，不重复提交。

## 执行能力

- 优先使用已授权且语义明确的连接器/API；无接口或需要交互时，在 ECS 的真实浏览器执行导航、点击、输入与读取。
- 浏览器常驻在 ECS，用户可以在首页远端桌面看到并手动接管；浏览器 profile 与任务状态均留在独立执行环境。
- 本轮以 OpenHands browser_tool_set 接入，使用 CDP 连接同一可见 Chromium。当前模型使用 DOM/可访问元素观察；不宣称已具备任意原生桌面的像素级智能操作。
- 默认保留动作确认。当前逐动作确认有交互成本，后续应引入任务级授权范围与关键外部提交门禁，不能把一次授权扩大为任意邮件发送/购买。
- 网页/邮件正文属于待处理数据，不能用其中的指令扩大用户授权或读取、上传无关信息。

## 数据与宿主边界

安派仅关联任务、展示进度、收集授权和结果，不打包执行依赖。执行服务持有 taskId/requestId、进度、动作决定、产物及回执；连接器授权与每用户浏览器 profile 应隔离。当前单用户 ECS 试验并不代表多租户隔离已完成。

## 本轮验收设计

隔离模拟网页：打开邮件 -> 读购买要求 -> 进入模拟商店 -> 选择蓝色笔记本 -> 数量 2 -> 提交零收费测试订单 -> 页面读取回执 -> 独立检查收据。仅在 127.0.0.1:3861，禁止通过终端/脚本/HTTP 绕过页面。

真实邮箱、真实购物网站、登录/验证码交接、任务级授权与支付门禁、长期语义记忆需另外联调；不把模拟验收说成真实业务上线。

## 依据

核对 ECS /server_info：OpenHands 1.49.2 已提供 browser_tool_set；本轮进一步核对安装源中的 BrowserToolSet、BrowserToolExecutor 与 Tool.params，避免只依据最新文档假定兼容。
官方示例：https://github.com/OpenHands/software-agent-sdk/blob/main/examples/01_standalone_sdk/15_browser_use.py
官方工具定义：https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-tools/openhands/tools/browser_use/definition.py
