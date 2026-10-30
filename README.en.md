# OneBot Gateway for Token Monitor (onebot-monitor)

A desktop plugin providing OneBot (v11) protocol gateway capabilities for Token Monitor, enabling cross-platform token usage queries, native dark-themed card rendering, scheduled daily reports, and threshold alert subscriptions.

[Release v1.0.0](https://github.com/BYWled/token-monitor-plugin-onebot/releases) · [License: GPL-3.0](LICENSE) · [GitHub Repository](https://github.com/BYWled/token-monitor-plugin-onebot) · [Gitee Mirror](https://gitee.com/BYWled/token-monitor-plugin-onebot) · [GitCode Mirror](https://gitcode.com/BYWled/token-monitor-plugin-onebot)

![Token Monitor Daily Usage Card](docs/images/overview.png)

## Compatibility

- **Token Monitor**: Any version supporting desktop plugins (`tmApi: 1`, e.g. `>= 0.80.0`)
- **Platforms**: Windows (x64 / arm64), macOS (Apple Silicon / Intel), Linux (x64)
- **Runtime**: Built with native Node.js standard libraries and pure RFC-6455 WebSocket protocol. **Zero external npm dependencies**. Image card rendering utilizes the system-installed Chrome, Edge, or Chromium browser (available by default on desktop systems).

## Install

### Method 1: Install from `.tmplugin` package (Recommended)

1. Download the latest `onebot-monitor-1.0.0.tmplugin` package from [GitHub Releases](https://github.com/BYWled/token-monitor-plugin-onebot/releases/tag/v1.0.0).
2. Open Token Monitor, navigate to **Settings ➜ Plugins ➜ Installed**.
3. Click the top-right **More actions ➜ Import package**, and select the downloaded `onebot-monitor-1.0.0.tmplugin` file.
4. Review the package warning and permissions. Choose **“Trust, install and enable”** to run it, or **“Install only”** to keep it disabled.
5. The plugin specifies `defaults.background: true`, so the setup prompt automatically pre-checks "Background execution" to ensure ongoing message listening and scheduled pushes when minimized.

### Method 2: Import from Source Folder

1. Clone or download this repository locally:
   ```sh
   git clone https://github.com/BYWled/token-monitor-plugin-onebot.git
   ```
2. Open Token Monitor **Settings ➜ Plugins ➜ Installed ➜ More actions ➜ Import folder**.
3. Select the repository root folder (or `onebot-monitor` subfolder), then click **“Trust, install and enable”**.

## Usage

### Commands Quick Reference (Admin Only)

Send commands in a private chat or group where an admin QQ is present:

| Command | Alias | Description | Example |
| :--- | :--- | :--- | :--- |
| `/token [image\|text]` | `/用量` | Query today's tokens & costs. Append `图` or `文` for explicit format | `/token`, `/token 图`, `/token 文` |
| `/month [image\|text]` | `/本月` | Query month-to-date token usage and estimated costs | `/month`, `/month 图` |
| `/models [image\|text]` | `/模型` | Query Top 5 model usage ranking for today | `/models`, `/models 图` |
| `/limits` | `/额度` | Query provider quotas and remaining limits | `/limits` |
| `/status [image\|text]` | `/状态` | View connection status, active subscriptions, and admin settings | `/status` |
| `/sub` | `/订阅` | Subscribe current chat to daily reports and threshold alerts | `/sub` |
| `/unsub` | `/退订` | Unsubscribe current chat from all push notifications | `/unsub` |
| `/help` | `/帮助` | Display bot command help | `/help` |

![Token Monitor Models Ranking Card](docs/images/models.png)

### Views & Surface Layout

- **Main Page View**: Displays a dedicated gateway dashboard in Token Monitor's main view, showing live WebSocket connection status, current subscribers list, and operational logs.
- **Narrow Sidebar & Floating Window Adaptive**: Powered by CSS Container Queries and ResizeObserver, the UI seamlessly collapses into a compact single-column flow in narrow panes.

## Configuration

Configure the gateway in Token Monitor via **Settings ➜ Plugins ➜ OneBot Gateway**:

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **Reply Format** | Select | `image` | Choose between `image` (Card), `text` (Plain text), or `both` |
| **Connection Mode** | Select | `forward` | `forward` (WS Client) or `reverse` (WS Server) |
| **Forward WS URL** | String | `ws://127.0.0.1:3001` | Server URL for forward mode (NapCat / LLOneBot / Lagrange) |
| **Reverse WS Port** | Number | `8080` | Local TCP port for reverse WS server (range 1024-65535) |
| **Access Token** | String | *(empty)* | Optional OneBot authorization token |
| **Admin QQ IDs** | String | *(empty)* | Comma-separated admin QQ numbers allowed to run commands |
| **Auto Daily Report** | Boolean | `true` | Send daily summary report automatically |
| **Daily Report Time** | String | `22:00` | Scheduled time in 24-hour format (e.g. `22:00` or `09:30`) |
| **Auto Alert** | Boolean | `true` | Send proactive alert when threshold is exceeded |
| **Token Alert Threshold** | Number | `1000000` | Daily token threshold for alert (up to 100 billion, `0` to disable) |
| **Cost Alert Threshold (USD)** | Number | `5` | Daily cost threshold in USD (`0` to disable) |

## Data and access

In accordance with Token Monitor's plugin publishing reference (`plugin-publishing-reference`), this plugin discloses the following data and runtime access behaviors:

- **Local files**: The plugin persists configuration and subscribers list in `subscriptions.json` within its assigned `dataDirectory`. Temporary HTML files generated for card screenshots are deleted immediately after capture. **It never reads, modifies, or accesses any user workspace files, git repositories, or sensitive credentials**.
- **Network services**: Network activity is strictly confined to local loopback (`127.0.0.1`) or the user-configured OneBot server via WebSocket. **It never transmits any token usage, cost data, or chat contents to any remote third-party cloud service or analytics platform**.
- **Subprocesses**: When rendering image cards, the plugin spawns the local system-installed Chromium binary with `--headless=new` for instant offline screenshotting. The child process terminates immediately after rendering.
- **Credentials**: Any configured OneBot Access Token is stored in Token Monitor's local preferences and memory for RFC-6455 handshake validation only, and is never broadcast.

## Updates

- **Releases**: Official builds and artifacts are published on [GitHub Releases](https://github.com/BYWled/token-monitor-plugin-onebot/releases).
- **Updating**: Import the newer `onebot-monitor-<version>.tmplugin` to perform an atomic update. All existing settings, admin lists, and subscriptions (`subscriptions.json`) are preserved.
- **Rollback**: To roll back, re-import the previous `.tmplugin`. Code is reverted without altering local subscription state.

## License and credits

- **License**: [GNU General Public License v3.0 (GPL-3.0)](LICENSE)
- **Author**: BYWled
- **Repository**: [token-monitor-plugin-onebot](https://github.com/BYWled/token-monitor-plugin-onebot)
- **Special Thanks**:
  - [Token Monitor](https://github.com/Javis603/token-monitor) for the excellent desktop AI coding monitor
  - OneBot community & NapCat / LLOneBot / Lagrange developers
