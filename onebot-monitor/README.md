<h1 align="center">token-monitor-plugin-onebot</h1>

<p align="center">
	为 Token Monitor 提供基于 OneBot (v11) 协议的机器人网关支持，实现跨平台 Token 用量查询、原生风格暗黑卡片渲染、定时日报推送与超额告警订阅服务。
</p>

<p align="center">
	<a href="https://github.com/BYWled/token-monitor-plugin-onebot"><img src="https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge" alt="version" /></a>
	<a href="https://github.com/BYWled/token-monitor-plugin-onebot"><img src="https://img.shields.io/github/stars/BYWled/token-monitor-plugin-onebot?style=for-the-badge&logo=github" alt="GitHub Stars" /></a>
	<a href="https://github.com/BYWled/token-monitor-plugin-onebot/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge" alt="GPLv3 License" /></a>
</p>

<p align="center">
	<a href="https://gitee.com/BYWled/token-monitor-plugin-onebot"><img src="https://img.shields.io/badge/Gitee-代码镜像-C71D23?style=for-the-badge&logo=gitee&logoColor=white" alt="Gitee Mirror" /></a>
</p>

<p align="center">
	<a href="https://github.com/BYWled/token-monitor-plugin-onebot">GitHub</a> ·
	<a href="https://gitee.com/BYWled/token-monitor-plugin-onebot">Gitee</a>
</p>

本插件为 **Token Monitor**（AI 编码用量与费用监控工具）提供即时通信机器人网关能力，接入标准 OneBot (v11) 协议。支持在 QQ 群聊或私聊中随时查询实时 Token 消耗、月度用量、模型分布排行；支持定时自动推送每日汇总日报，并在用量超额时主动告警。

> 版本：**1.0.0**

## ✨ 特性

- **🖼️ 原生暗黑桌面卡片渲染**：
  - **1:1 原生风格复刻**：深度复刻 Token Monitor 暗黑半透明毛玻璃、macOS 红黄绿三色控制按钮与调用状态呼吸灯。
  - **核心指标 Hero 卡片**：Token 数据独占顶部全宽行，采用 `26px` 等宽数字（Tabular-nums）高亮显示，并配备自适应万/亿中文单位胶囊徽标。从容应对百亿、千亿级大数字展示，彻底杜绝数据被截断省略。
  - **模型占比彩色条形图**：直观展示今日调用 Top 5 模型的占比与精确消耗量。
  - **精准盒模型计算**：无头 Chromium 动态精准测算实际视图高度与呼吸间距，杜绝底部截断与大片留黑。
- **💬 多样化返回形式（图片 / 纯文本 / 图文兼备）**：
  - 支持在设置中配置默认输出格式（`图片卡片` / `纯文本` / `图文兼备`）。
  - 聊天中支持在指令后追加 `图` 或 `文` 即时指定（如 `/token 图`、`/token 文`）。
- **🔄 双通信模式（正向 / 反向 WebSocket）**：
  - **正向 WS 客户端**：主动连接至 NapCat、LLOneBot、Lagrange、go-cqhttp、OpenShamrock 等 OneBot 服务端。
  - **反向 WS 服务端**：在本地指定端口启动 WebSocket 监听服务，等待 OneBot 客户端反向接入。
- **⏰ 全自动定时日报与超额预警推送**：
  - **每日定时日报**：每日固定时间（默认 22:00）自动在已订阅的群或私聊推送用量日报。
  - **Token / 费用超额告警**：今日 Token 消耗（支持设置高达百亿阈值）或费用超标时，主动向订阅者推送高优先级预警。
- **🛡️ 安全白名单鉴权**：
  - 仅限配置的管理员 QQ（Admin IDs）执行查询和管理指令，防止群聊信息泄露；支持可选 OneBot Access Token 密钥校验。
- **📱 响应式面板适配**：
  - 基于 CSS Container Queries 与 ResizeObserver，即使在极窄的侧边栏或小悬浮窗中也能自动折叠成紧凑单列，排版舒适易读。

## 📦 兼容性与运行环境

- **Token Monitor**：`>= 1.0.0` (兼容 `tmApi: 1`)
- **运行平台**：Windows / macOS / Linux
- **依赖环境**：内置标准 Node.js 原生模块与 RFC-6455 WebSocket 协议驱动，**零 npm 外部第三方依赖**。
  - *注：图片卡片渲染依赖系统中已安装的 Chrome / Edge / Chromium 浏览器（主流桌面系统均自带，插件会自动探测寻径）。*

## 🛠️ 安装与启用步骤

### 方法一：通过 `.tmplugin` 单文件安装（推荐）

1. 在 [GitHub Releases](https://github.com/BYWled/token-monitor-plugin-onebot/releases) 下载最新发布的 `onebot-monitor.tmplugin` 安装包。
2. 打开 **Token Monitor** 客户端。
3. 点击左下角 **设置 (Settings)** ➜ **插件 (Plugins)** ➜ **已安装 (Installed)**。
4. 点击右上角 **更多操作 (More actions)** ➜ **导入插件包 (Import package)**，选择下载的 `onebot-monitor.tmplugin`。
5. 在弹出的权限安全提示框中，选择 **信任、安装并启用 (Trust, install and enable)**。
6. 勾选需要挂载的界面位置（默认推荐勾选 **主页面 (Main Page)**）。

### 方法二：从源码文件夹直接导入

1. 克隆或下载本仓库代码到本地。
2. 打开 **Token Monitor ➜ 设置 ➜ 插件 ➜ 已安装 ➜ 更多操作**。
3. 选择 **导入文件夹 (Import folder)**，选择本仓库的 `onebot-monitor` 文件夹。
4. 点击 **信任、安装并启用** 即可。

> [!IMPORTANT]
> 安装后请在插件列表中确认已勾选 **后台运行 (Background execution)**，这样即使 Token Monitor 最小化到系统托盘，后台依然能持续接收消息和定时推送日报！

## 🎮 指令说明（仅管理员）

| 指令 | 别名 | 作用说明 | 格式示例 |
| :--- | :--- | :--- | :--- |
| `/token [图\|文]` | `/用量` | 查询今日 Token 消耗与已知费用，支持附加 `图` 或 `文` | `/token`、`/token 图`、`/token 文` |
| `/month [图\|文]` | `/本月` | 查询自然月累计 Token 与已知费用汇总 | `/month`、`/month 图` |
| `/models [图\|文]` | `/模型` | 查询今日主要调用的模型消耗排行 Top 5 | `/models`、`/models 图` |
| `/limits` | `/额度` | 查询各服务商配额限制与剩余额度 | `/limits` |
| `/status [图\|文]` | `/状态` | 查看插件连接状态、订阅数与管理员配置 | `/status` |
| `/sub` | `/订阅` | 为当前群聊或私聊开启每日日报与超额告警推送 | `/sub` |
| `/unsub` | `/退订` | 取消当前会话的所有订阅推送 | `/unsub` |
| `/help` | `/帮助` | 显示机器人指令帮助说明 | `/help` |

## 🔧 配置项说明

可以在 Token Monitor 的 **设置 ➜ 插件 ➜ OneBot 机器人网关** 中进行配置：

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| **消息返回格式** | 下拉选择 | `图片卡片` | 可选 `image` (图片卡片)、`text` (纯文本) 或 `both` (图文兼备) |
| **OneBot 连接模式** | 下拉选择 | `正向 WebSocket 客户端` | 可选 `forward` (正向 WS) 或 `reverse` (反向 WS 服务端) |
| **正向 WS 服务端地址** | 文本 | `ws://127.0.0.1:3001` | OneBot 服务端监听地址 (正向模式生效) |
| **反向 WS 监听端口** | 数字 | `8080` | 本地反向 WebSocket 监听端口 (反向模式生效，范围 1024-65535) |
| **访问令牌 (Access Token)** | 文本 | *(留空)* | OneBot 鉴权密钥 (如有请填写) |
| **管理员 QQ 账号** | 文本 | *(留空)* | 允许触发指令的管理员 QQ，多个用逗号隔开 (如 `10001,10002`) |
| **开启每日定时日报** | 开关 | `开启` | 开启后每日按时向订阅会话推送用量汇总 |
| **定时日报时间 (HH:mm)** | 文本 | `22:00` | 每日汇总时间 (24小时制，例如 `22:00` 或 `09:30`) |
| **开启用量超额告警** | 开关 | `开启` | 开启后超出阈值自动推送告警 |
| **Token 告警阈值** | 数字 | `1000000` | 今日 Tokens 超过此值主动告警，支持到百亿级 (设为 0 关闭) |
| **费用告警阈值 (USD)** | 数字 | `5` | 今日已知费用超过此金额主动告警 (设为 0 关闭) |

## 📱 与常见 OneBot 框架连接指南

### 1. NapCat / LLOneBot (推荐)
- **正向 WS**：在 NapCat WebUI 中开启「正向 WebSocket」，设置端口为 `3001`。在 Token Monitor 插件中连接模式选择「正向 WebSocket 客户端」，地址填写 `ws://127.0.0.1:3001`。
- **反向 WS**：Token Monitor 插件模式选择「反向 WS 服务端」（端口 `8080`）。在 NapCat 中添加反向 WebSocket，地址填写 `ws://127.0.0.1:8080`。

### 2. Lagrange / go-cqhttp / OpenShamrock
- 在其配置文件中开启正向 WebSocket 服务或反向 WS 地址指向本地端口即可完成双向通讯。

## 🔒 数据与权限声明 (Data & Access)

依据 Token Monitor 插件规范要求，本插件对本地访问与网络权限作出如下披露：
- **本地存储**：在 Token Monitor 的插件专有数据目录（`dataDirectory`）下维护 `subscriptions.json`（持久化保存已订阅的群聊/私聊目标）与渲染用临时 HTML 模版（生成 PNG 后立即删除）。
- **网络通信**：仅在本地回环地址（`127.0.0.1`）或用户指定的局域网/远程 OneBot 服务端进行 WebSocket 协议通信，**绝不向任何第三方或云端传输任何用量数据、Token 密钥或聊天内容**。
- **本地子进程**：生成图片卡片时，使用本地已安装的 Chromium 核心无头浏览器进行即时离线渲染与截图，执行完毕后进程立即退出，无后台残留。
- **凭据与鉴权**：配置中的 Access Token 仅用于与用户指定的 OneBot 客户端/服务端进行 RFC-6455 鉴权握手，严格保存在本地。

## 💡 常见问题 (FAQ)

**Q：为什么发送指令没有反应？**  
A：
1. 请检查 Token Monitor 插件设置中的 **管理员 QQ 账号** 是否已正确填入您的 QQ 账号（未在白名单中的账号发送指令将被静默或警告拒绝）。  
2. 确认 Token Monitor 中已勾选 **后台运行 (Background execution)**，避免窗口最小化时 Node 进程休眠。  
3. 检查 OneBot 框架（如 NapCat）控制台日志，确认 WebSocket 是否正常连接。

**Q：图片生成失败或卡顿？**  
A：图片卡片生成依赖系统中安装的 Chrome / Edge 浏览器，若系统环境未检测到浏览器，插件会自动平滑回退为纯文本回复，不影响正常使用。

## 📝 更新日志

详细的更新历史记录请参阅 [CHANGELOG.md](./CHANGELOG.md)。

## 📄 开源许可与致谢

- 本项目基于 **[GNU General Public License v3.0 (GPL-3.0)](./LICENSE)** 协议开源。
- 感谢 **[Token Monitor](https://github.com/Javis603/token-monitor)** 提供优秀的 AI 编码监控工具与插件体系扩展能力。
- 感谢 **OneBot** 社区与 NapCat / LLOneBot / Lagrange 等协议实现项目的辛勤付出。

---

**开发者**: BYWled  
**仓库**: `token-monitor-plugin-onebot`  

萌新编写，部分借助了AI的力量，若有纰漏，还望海涵QwQ
