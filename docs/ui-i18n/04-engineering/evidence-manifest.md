# 界面国际化验证记录

日期：2026-11-21；范围：OpenBot 独立 UI，不涉及安派或远端 Runtime 部署。

## 自动验证
- TypeScript 构建通过；所有 UI 模块和内联脚本通过 TypeScript parser 语法检查。
- 国际化、私密信封、私密浏览器、聊天 UI：17 项通过。
- 设置、Bot 代理、桌面：18 项通过，包含新增 i18n.js / locales.js 路由和 JavaScript Content-Type 检查。
- 首次受限执行无法监听回环端口（EPERM）；获自动批准后以本地临时端口重跑通过，不属于产品失败。
- git diff --check 通过。未执行全仓与真实 ECS 任务；本次不改变任务协议或远端服务。

## 浏览器验证
使用独立无真实 SSH 目标的 3869 服务、专属浏览器任务空间；真实页面和组件，任务响应与私密表单使用明确合成数据。

- 首次自动模式读取浏览器语言；模拟 en-US→en、zh-TW→zh-CN、fr-FR→en，均符合约定。
- 手动 English 后刷新仍为英文；独立 /bot 入口沿用选择；另一标签切换中文后主页同步。
- 输入未发送草稿和合成密码后切换两种语言：输入 DOM 节点未重建、值保留、密码仍隐藏、操作请求计数为 0。
- 密码显示/隐藏正常，按钮翻译正确；合成 reason 保留原文。截图前清空演示输入。
- 真实主页任务卡使用合成 API 响应：运行状态实时中英文切换，卡片节点不变、任务操作请求计数为 0；结果“填写并继续”保持原文，不被词典翻译。
- 390px 两种语言均 scrollWidth=innerWidth=390。截图已查看：英文桌面、英文/中文手机、英文设置错误。
- 独立入口断开时显示本地化错误，草稿保留；连接测试页诊断状态切换后保持实际结果。
- 英文设置弹层内容较长，发现初始化按钮在视口外无法滚动点击；增加滚动后真实点击成功，未保存主机的错误显示为 “Save your server connection details first.”，按钮恢复可用。
- 模型输出、字段 label/reason、文件/网页内容及第三方原始诊断不做机器翻译。本机回复语言配置与 UI 偏好独立。

## 证据
- ../05-testing/evidence/english-desktop.png：真实组件的空白合成私密表单，不代表执行了远端任务。
- ../05-testing/evidence/english-mobile.png、chinese-mobile.png：390px 布局。
- ../05-testing/evidence/english-setup.png：可滚动设置弹层与初始化前置校验错误。
