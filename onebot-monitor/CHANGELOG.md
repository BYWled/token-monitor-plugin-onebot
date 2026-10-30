# Changelog

本项目的所有关键更改都将记录在此文件中。

## [1.0.0] - 2026-10-30

#### ✨ Features (新特性)
- **onebot**: 支持 OneBot (v11) 协议的正向与反向 WebSocket 双向通信，兼容 NapCat、LLOneBot、Lagrange、go-cqhttp、OpenShamrock 等主流 OneBot 框架。
- **render**: 采用无依赖纯 Node.js 的无头 Chromium 截图引擎，1:1 精确复刻 Token Monitor 原生暗黑桌面窗口风格，支持毛玻璃暗底、窗口控制按钮与模型调用彩色条形图分布。
- **hero-card**: 独创 Token 核心指标 Hero 全宽卡片，大字号 Tabular-nums 字体，并在右上角配备自适应万/亿中文单位胶囊徽标，从容应对千亿级大数字展示，彻底杜绝数据被截断省略。
- **multi-format**: 支持三种消息返回格式（图片卡片 `image`、纯文本 `text`、图文兼备 `both`），既可在全局配置中指定默认偏好，也可在指令中通过 `/token 图` 或 `/token 文` 即时切换。
- **push & alert**: 支持群聊与私聊的会话订阅管理（`/sub`、`/unsub`），支持每日定时日报推送（默认 22:00）以及 Token 用量/费用超额主动告警。
- **security**: 内置严格的管理员 QQ 白名单鉴权保护，杜绝非授权用户在群聊中触发指令查询，防止敏感调用信息泄露；支持可选 OneBot Access Token 鉴权。

#### 💄 UI/UX (界面与交互)
- **responsive**: 插件设置面板针对极窄侧边栏与小悬浮窗进行了深度优化，基于 `@container` 与 `ResizeObserver` 实现紧凑响应式流式布局。
- **box-model**: 精密测算 DOM 各层行高与内边距，增加防压边呼吸边距，彻底解决底部状态信息截断与多余留黑问题。
- **dashboard**: 内置直观的可视化仪表盘，实时呈现网关连接状态、在线模式、已订阅会话列表与运行日志。
