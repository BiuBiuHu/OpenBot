# Linux computer-use 复用决策（2026-11-20）

## 结论

继续使用现有 OpenHands Agent Server + BrowserToolSet + ECS 可见 Chromium/CDP，不换运行时。我们已经复用开源浏览器执行能力；独立 Bot 层负责任务、授权、断线恢复和宿主集成。当前实际短板是反复批准只读观察，而非 Linux 浏览器控制不可用。

## 对比

| 项目 | 与本项目的关系 | 决策 |
| --- | --- | --- |
| OpenHands Software Agent SDK / BrowserToolSet | 已部署 1.49.2，直接支持浏览器导航、点击、输入、页面读取与截图；当前 Linux ECS 已完成真实浏览器模拟下单 | 继续复用，不升级已验证版本 |
| browser-use/browser-use | 专注 AI 浏览器代理，MIT；与现有 BrowserToolSet 的 browser-use 集成方向一致 | 继续沿现有适配层复用，不再并行引入第二套 Agent 循环；不能把上游最新版本与 ECS 已安装实现视为完全相同 |
| browserbase/stagehand | TypeScript 网页交互/提取 SDK，MIT；可作为固定网站流程适配候选 | 当前不会弥补主要产品缺口，暂不引入第二套浏览器控制层 |
| trycua/cua | 明确支持 Linux 的桌面驱动、隔离执行环境和评测体系；范围超出网页 | 保留原生桌面/视觉操作候选，暂不迁移。组件许可不同，不能把整仓当作统一 MIT；Spaces 为 source-available，采用时需按组件审查 |

## 兼容性、维护与成本

本轮核对官方 README/源码，三个候选仓库均有近期维护内容和活跃 Issues/PR；未将星数当成熟度指标，也未对未安装候选宣称完成实测。Browser-use/Python 与现有 ECS 最接近，Stagehand 会增加 Node 浏览器控制层，Cua 会增加桌面驱动/环境管理与集成验证。均不应进入未来安派客户端依赖。

更换只有在具体场景暴露能力缺口时进行：原生应用/画布无法用页面元素操作，或重复任务成功率/成本达不到要求。当前先减少无副作用页面观察的人工确认，保留点击、输入、导航、终端与外部提交的明确审批。

## 本轮继续实施

新增每任务可选「自动观察页面」策略，仅自动批准 browser_get_state、browser_get_content、browser_list_tabs；旧任务和未显式选择者仍逐动作确认。自动决定先持久化，失联不重复发送；凭据读取、导航、点击、输入、滚动、脚本和未知工具均不自动放行。这不是完整任务级无人值守授权，而是先移除确定的只读交互阻力。

保存点：2103132 和 /tmp/openbot-before-browser-policy.patch，沿用同一已授权功能分支，不修改安派仓库。

## 官方资料

- https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-tools/openhands/tools/browser_use/definition.py
- https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-tools/openhands/tools/browser_use/impl.py
- https://github.com/browser-use/browser-use
- https://github.com/browserbase/stagehand
- https://github.com/trycua/cua

## 用户后续决策：默认自主执行

用户明确要求取消逐动作审批，因此以上「仅自动观察」交互方案已被替代。沿用现有开源执行栈，默认让 Agent 自主决定浏览器、文件和命令操作，保留暂停、恢复及持久化防重放。无需更换 Linux computer-use 框架。
