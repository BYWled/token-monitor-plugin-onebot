'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const EventEmitter = require('node:events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// -------------------------------------------------------------
// RFC-6455 WebSocket Implementation (Zero external dependencies)
// -------------------------------------------------------------

function encodeWsFrame(data, { opcode = 0x1, mask = false } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const length = payload.length;
  let headerLength = 2;
  if (length > 65535) headerLength += 8;
  else if (length > 125) headerLength += 2;
  if (mask) headerLength += 4;

  const buffer = Buffer.alloc(headerLength + length);
  buffer[0] = 0x80 | (opcode & 0x0f); // FIN + Opcode

  let offset = 1;
  const maskBit = mask ? 0x80 : 0x00;

  if (length > 65535) {
    buffer[offset++] = maskBit | 127;
    buffer.writeBigUInt64BE(BigInt(length), offset);
    offset += 8;
  } else if (length > 125) {
    buffer[offset++] = maskBit | 126;
    buffer.writeUInt16BE(length, offset);
    offset += 2;
  } else {
    buffer[offset++] = maskBit | length;
  }

  if (mask) {
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(buffer, offset);
    offset += 4;
    for (let i = 0; i < length; i++) {
      buffer[offset + i] = payload[i] ^ maskKey[i % 4];
    }
  } else {
    payload.copy(buffer, offset);
  }

  return buffer;
}

class WsParser extends EventEmitter {
  constructor() {
    super();
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._parse();
  }

  _parse() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const hasMask = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let headerLen = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        headerLen = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        headerLen = 10;
      }

      if (hasMask) headerLen += 4;
      if (this.buffer.length < headerLen + payloadLen) return;

      let payload = this.buffer.subarray(headerLen, headerLen + payloadLen);
      if (hasMask) {
        const maskKey = this.buffer.subarray(headerLen - 4, headerLen);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      this.buffer = this.buffer.subarray(headerLen + payloadLen);
      this.emit('frame', { fin, opcode, payload });
    }
  }
}

class WsConnection extends EventEmitter {
  constructor(socket, { isServer = false, remoteAddress = '' } = {}) {
    super();
    this.socket = socket;
    this.isServer = isServer;
    this.remoteAddress = remoteAddress || socket.remoteAddress || 'unknown';
    this.parser = new WsParser();
    this.closed = false;

    this.parser.on('frame', ({ opcode, payload }) => {
      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x2) {
        this.emit('message', payload);
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.sendFrame(payload, 0xa); // Respond with Pong
      }
    });

    this.socket.on('data', chunk => this.parser.push(chunk));
    this.socket.on('close', () => {
      this.closed = true;
      this.emit('close');
    });
    this.socket.on('error', err => this.emit('error', err));
  }

  send(data) {
    if (this.closed || !this.socket.writable) return false;
    const frame = encodeWsFrame(data, { opcode: 0x1, mask: !this.isServer });
    return this.socket.write(frame);
  }

  sendFrame(payload, opcode) {
    if (this.closed || !this.socket.writable) return false;
    const frame = encodeWsFrame(payload, { opcode, mask: !this.isServer });
    return this.socket.write(frame);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeWsFrame(Buffer.alloc(0), { opcode: 0x8, mask: !this.isServer }));
      this.socket.end();
    } catch {}
  }
}

// -------------------------------------------------------------
// Plugin Backend Core Implementation
// -------------------------------------------------------------

exports.activate = async context => {
  const { dataDirectory, host, publish, log } = context;

  const subscriptionsFile = path.join(dataDirectory, 'subscriptions.json');
  let subscriptions = [];
  let serverInstance = null;
  let clientConn = null;
  let reconnectTimer = null;
  let tickerTimer = null;
  let isDisposed = false;

  // Runtime metrics & states
  const serverClients = new Set();
  const logs = [];
  let currentSettings = {
    replyFormat: 'image',
    connectionMode: 'forward',
    wsUrl: 'ws://127.0.0.1:3001',
    serverPort: 8080,
    accessToken: '',
    adminIds: '',
    autoDailyReport: true,
    dailyReportTime: '22:00',
    autoAlert: true,
    tokenAlertThreshold: 1000000,
    costAlertThreshold: 5
  };

  let lastDailyReportDate = '';
  let lastAlertDate = '';
  let lastEventTime = null;
  let totalReceivedMessages = 0;
  let totalSentMessages = 0;
  let latestUsageSnapshot = null;

  function appendLog(level, msg) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const entry = { time, level, message: String(msg) };
    logs.push(entry);
    if (logs.length > 100) logs.shift();
    log(`[${level.toUpperCase()}] ${msg}`);
    broadcastStatus();
  }

  async function loadSubscriptions() {
    try {
      const data = await fs.readFile(subscriptionsFile, 'utf8');
      subscriptions = JSON.parse(data);
      if (!Array.isArray(subscriptions)) subscriptions = [];
    } catch {
      subscriptions = [];
    }
  }

  async function saveSubscriptions() {
    try {
      await fs.writeFile(subscriptionsFile, JSON.stringify(subscriptions, null, 2), 'utf8');
    } catch (err) {
      appendLog('error', `保存订阅配置失败: ${err.message}`);
    }
  }

  async function refreshSettings() {
    try {
      const stored = await host.call('settings.get');
      if (stored && stored.values) {
        currentSettings = { ...currentSettings, ...stored.values };
      }
    } catch (err) {
      // Use defaults if host call is not ready
    }
  }

  function getAdminList() {
    return String(currentSettings.adminIds || '')
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function isAdmin(userId) {
    const admins = getAdminList();
    if (admins.length === 0) return true; // If no admin specified, allow for convenience or initial setup
    return admins.includes(String(userId));
  }

  function broadcastStatus() {
    const isOnline = currentSettings.connectionMode === 'forward'
      ? Boolean(clientConn && !clientConn.closed)
      : serverClients.size > 0;

    const statusPayload = {
      online: isOnline,
      mode: currentSettings.connectionMode,
      target: currentSettings.connectionMode === 'forward' ? currentSettings.wsUrl : `Port ${currentSettings.serverPort}`,
      connectedClients: currentSettings.connectionMode === 'forward' ? (isOnline ? 1 : 0) : serverClients.size,
      subscriberCount: subscriptions.length,
      todayTokens: latestUsageSnapshot?.totalTokens ?? 0,
      todayCost: latestUsageSnapshot?.knownUsd ?? null,
      totalReceived: totalReceivedMessages,
      totalSent: totalSentMessages,
      lastEventTime,
      adminCount: getAdminList().length,
      recentLogs: logs.slice(-25)
    };
    publish(statusPayload);
  }

  // Send an action to active OneBot client(s)
  function sendOneBotAction(action, params = {}) {
    const payload = JSON.stringify({
      action,
      params,
      echo: `tm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    });

    let sentCount = 0;
    if (currentSettings.connectionMode === 'forward' && clientConn && !clientConn.closed) {
      if (clientConn.send(payload)) sentCount++;
    } else {
      for (const conn of serverClients) {
        if (!conn.closed && conn.send(payload)) sentCount++;
      }
    }
    if (sentCount > 0) totalSentMessages += sentCount;
    return sentCount > 0;
  }

  function sendOneBotMessage(targetType, targetId, message) {
    return sendOneBotAction('send_msg', {
      message_type: targetType === 'group' ? 'group' : 'private',
      group_id: targetType === 'group' ? Number(targetId) : undefined,
      user_id: targetType === 'private' ? Number(targetId) : undefined,
      message
    });
  }

  // -------------------------------------------------------------
  // Card HTML & Image Generator (Headless Browser / Canvas)
  // -------------------------------------------------------------

  function findBrowser() {
    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
      ];
      for (const c of candidates) {
        if (require('node:fs').existsSync(c)) return c;
      }
    } else if (process.platform === 'darwin') {
      const candidates = [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ];
      for (const c of candidates) {
        if (require('node:fs').existsSync(c)) return c;
      }
    } else {
      const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
      for (const c of candidates) {
        if (require('node:fs').existsSync(c)) return c;
      }
    }
    return null;
  }

  function buildNativeWindowHtml({
    title,
    heroCard = null,
    subCards = [],
    cards = [],
    breakdownTitle = '',
    breakdownRows = [],
    footerTime = ''
  }) {
    let effectiveHero = heroCard;
    let effectiveSub = subCards.length > 0 ? subCards : cards;

    // Fallback: if heroCard is null but cards are given, if first card is highlighted or 3 cards given, elevate first
    if (!effectiveHero && effectiveSub.length > 0) {
      if (effectiveSub[0].highlight || effectiveSub.length === 3) {
        const first = effectiveSub[0];
        effectiveHero = {
          label: first.label,
          value: first.value,
          badge: first.badge || ''
        };
        effectiveSub = effectiveSub.slice(1);
      }
    }

    let heroHtml = '';
    if (effectiveHero) {
      heroHtml = `
        <div class="dash-hero-card">
          <div class="dash-hero-top">
            <span class="dash-hero-label">${effectiveHero.label}</span>
            ${effectiveHero.badge ? `<span class="dash-hero-badge">${effectiveHero.badge}</span>` : ''}
          </div>
          <div class="dash-hero-body">
            <span class="dash-hero-val">${effectiveHero.value}</span>
          </div>
        </div>
      `;
    }

    let subCardsHtml = '';
    if (effectiveSub.length > 0) {
      const items = effectiveSub.map(c => `
        <div class="dash-card">
          <div class="dash-card-k">${c.label}</div>
          <div class="dash-card-v ${c.highlight ? 'highlight' : ''}">${c.value}</div>
        </div>
      `).join('');
      subCardsHtml = `<div class="dash-sub-cards cols-${effectiveSub.length}">${items}</div>`;
    }

    let breakdownHtml = '';
    if (breakdownRows.length > 0) {
      const colors = ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#34d399'];
      const rowsHtml = breakdownRows.map((r, i) => `
        <div class="dash-bd-row">
          <span class="dash-bd-name">${r.name}</span>
          <div class="dash-bd-bar-bg">
            <div class="dash-bd-bar-fill" style="width: ${r.percent}%; background: ${colors[i % colors.length]};"></div>
          </div>
          <span class="dash-bd-val">${r.value}</span>
          <span class="dash-bd-pct">${r.percent}%</span>
        </div>
      `).join('');

      breakdownHtml = `
        <div class="dash-breakdown-col">
          <div class="dash-breakdown-title">${breakdownTitle}</div>
          ${rowsHtml}
        </div>
      `;
    }

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    color-scheme: dark;
    --glass-rgb: 24, 28, 35;
    --overlay-rgb: 255, 255, 255;
    --line: rgba(255, 255, 255, 0.08);
    --text: #eef5fb;
    --text-muted: #94a3b8;
    --blue: #38bdf8;
    --green: #4ade80;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    margin: 0;
    padding: 0;
    width: 480px;
    background: rgb(var(--glass-rgb));
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: var(--text);
    overflow: hidden;
  }
  .window-wrap {
    width: 480px;
    background: rgb(var(--glass-rgb));
    display: flex;
    flex-direction: column;
  }
  .dash-header {
    height: 38px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    background: rgba(var(--overlay-rgb), 0.02);
  }
  .dash-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dash-logo-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--blue);
    box-shadow: 0 0 6px rgba(56, 189, 248, 0.5);
  }
  .dash-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 38px;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .dash-controls-dots {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ctrl-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .ctrl-dot.red { background: #f87171; }
  .ctrl-dot.yellow { background: #fbbf24; }
  .ctrl-dot.green { background: #4ade80; }

  .dash-pane {
    padding: 12px 14px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Hero Card for Tokens */
  .dash-hero-card {
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px;
    background: rgba(var(--overlay-rgb), 0.03);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dash-hero-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dash-hero-label {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.65;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    line-height: 16px;
  }
  .dash-hero-badge {
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    padding: 1px 8px;
    border-radius: 12px;
    background: rgba(56, 189, 248, 0.12);
    color: var(--blue);
    border: 1px solid rgba(56, 189, 248, 0.25);
  }
  .dash-hero-body {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .dash-hero-val {
    font-size: 26px;
    font-weight: 700;
    line-height: 32px;
    color: var(--blue);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }

  /* Sub Cards */
  .dash-sub-cards {
    display: grid;
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px;
    background: rgba(var(--overlay-rgb), 0.03);
    overflow: hidden;
  }
  .dash-sub-cards.cols-1 { grid-template-columns: minmax(0, 1fr); }
  .dash-sub-cards.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-sub-cards.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

  .dash-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px;
    border-right: 1px solid rgba(var(--overlay-rgb), 0.06);
  }
  .dash-card:last-child {
    border-right: none;
  }
  .dash-card-k {
    font-size: 10px;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dash-card-v {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dash-card-v.highlight {
    color: var(--blue);
  }

  .dash-breakdown-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid rgba(var(--overlay-rgb), 0.08);
    border-radius: 8px;
    background: rgba(var(--overlay-rgb), 0.03);
    padding: 10px 14px;
  }
  .dash-breakdown-title {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 16px;
  }
  .dash-bd-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    height: 20px;
    line-height: 20px;
  }
  .dash-bd-name {
    width: 120px;
    display: flex;
    align-items: center;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
  }
  .dash-bd-bar-bg {
    flex: 1;
    height: 4px;
    background: rgba(var(--overlay-rgb), 0.06);
    border-radius: 2px;
    overflow: hidden;
  }
  .dash-bd-bar-fill {
    height: 100%;
    border-radius: 2px;
  }
  .dash-bd-val {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
    text-align: right;
    font-size: 11px;
    min-width: 65px;
  }
  .dash-bd-pct {
    width: 36px;
    font-variant-numeric: tabular-nums;
    opacity: 0.55;
    text-align: right;
    font-size: 10px;
  }

  .dash-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    line-height: 18px;
    color: var(--text-muted);
    padding-top: 2px;
  }
  .dash-status-dot {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: #4ade80;
  }
  .dash-status-dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
  }
</style>
</head>
<body>
<div class="window-wrap">
  <header class="dash-header">
    <div class="dash-header-left">
      <span class="dash-logo-dot"></span>
      <div class="dash-title">${title}</div>
    </div>
    <div class="dash-controls-dots">
      <span class="ctrl-dot red"></span>
      <span class="ctrl-dot yellow"></span>
      <span class="ctrl-dot green"></span>
    </div>
  </header>
  <div class="dash-pane">
    ${heroHtml}
    ${subCardsHtml}
    ${breakdownHtml}
    <div class="dash-footer">
      <span class="dash-status-dot">数据采集正常</span>
      <span>${footerTime || new Date().toLocaleString('zh-CN')}</span>
    </div>
  </div>
</div>
</body>
</html>`;
  }

  function calculateWindowHeight(optionsOrHasCards = true, rowsCount = 0) {
    let hasHero = false;
    let hasSubCards = false;
    let rCount = 0;

    if (typeof optionsOrHasCards === 'object' && optionsOrHasCards !== null) {
      hasHero = Boolean(optionsOrHasCards.hasHero);
      hasSubCards = Boolean(optionsOrHasCards.hasSubCards);
      rCount = Number(optionsOrHasCards.rowsCount || 0);
    } else {
      hasHero = Boolean(optionsOrHasCards);
      hasSubCards = true;
      rCount = Number(rowsCount || 0);
    }

    let h = 38 + 26;
    const items = [];
    if (hasHero) items.push(68);
    if (hasSubCards) items.push(57);
    if (rCount > 0) items.push(36 + (rCount * 26));
    items.push(22); // footer

    for (let i = 0; i < items.length; i++) {
      h += items[i];
      if (i < items.length - 1) h += 10;
    }
    return h + 10;
  }

  async function renderCardToPngBase64(html, height = 240) {
    const browser = findBrowser();
    if (!browser) return null;

    const tempDir = path.join(dataDirectory, 'temp-render');
    await fs.mkdir(tempDir, { recursive: true });
    const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempHtml = path.join(tempDir, `${id}.html`);
    const tempPng = path.join(tempDir, `${id}.png`);

    await fs.writeFile(tempHtml, html, 'utf8');

    return new Promise(resolve => {
      const child = spawn(browser, [
        '--headless=new',
        '--disable-gpu',
        `--screenshot=${tempPng}`,
        `--window-size=480,${height}`,
        '--hide-scrollbars',
        tempHtml
      ]);

      const timer = setTimeout(() => {
        child.kill();
        cleanup();
        resolve(null);
      }, 5000);

      function cleanup() {
        fs.unlink(tempHtml).catch(() => {});
        fs.unlink(tempPng).catch(() => {});
      }

      child.on('close', async code => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            const buf = await fs.readFile(tempPng);
            cleanup();
            resolve(buf.toString('base64'));
            return;
          } catch {}
        }
        cleanup();
        resolve(null);
      });

      child.on('error', () => {
        clearTimeout(timer);
        cleanup();
        resolve(null);
      });
    });
  }

  // -------------------------------------------------------------
  // Command & Query Processing
  // -------------------------------------------------------------

  function formatTokens(num) {
    if (num === null || num === undefined) return '0';
    const n = Number(num);
    const formatted = n.toLocaleString('en-US');
    if (n >= 100000000) {
      return `${formatted} (约 ${(n / 100000000).toFixed(2)} 亿)`;
    } else if (n >= 10000) {
      return `${formatted} (约 ${(n / 10000).toFixed(2)} 万)`;
    }
    return formatted;
  }

  function formatUsd(usd) {
    if (usd === null || usd === undefined) return '未知';
    return `$${Number(usd).toFixed(4)}`;
  }

  async function handleQueryCommand(type, formatOverride = null) {
    const wantedFormat = formatOverride || currentSettings.replyFormat || 'image';
    const nowTimeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    try {
      if (type === 'today' || type === 'token') {
        const result = await host.call('data.query', { resource: 'usage', period: 'today' });
        if (result.availability !== 'available') {
          return `📊【Token Monitor 今日用量】\n⚠️ 数据当前不可用 (${result.availability})`;
        }
        const row = result.rows?.[0] || {};
        const total = row.totalTokens ?? 0;
        const cost = row.cost?.knownUsd ?? null;
        const freshness = result.freshness?.state || 'fresh';

        latestUsageSnapshot = { totalTokens: total, knownUsd: cost };
        broadcastStatus();

        const textReply = `📊【Token Monitor 今日用量】\n` +
          `• 累计 Tokens：${formatTokens(total)}\n` +
          `• 已知费用：${formatUsd(cost)}\n` +
          `• 数据新鲜度：${freshness === 'fresh' ? '最新 (fresh)' : freshness}\n` +
          `• 采集时间：${nowTimeStr}`;

        if (wantedFormat === 'text') return textReply;

        // Fetch top models to display in breakdown
        let breakdownRows = [];
        try {
          const modelsRes = await host.call('data.query', {
            resource: 'models',
            period: 'today',
            sort: { field: 'totalTokens', direction: 'desc' },
            page: { limit: 5 }
          });
          if (modelsRes.availability === 'available' && Array.isArray(modelsRes.rows)) {
            const maxVal = Math.max(...modelsRes.rows.map(r => r.totalTokens || 1), 1);
            breakdownRows = modelsRes.rows.map(r => ({
              name: r.model || r.id || '未知模型',
              value: formatTokens(r.totalTokens),
              percent: Math.round(((r.totalTokens || 0) / maxVal) * 100)
            }));
          }
        } catch {}

        const totalNum = Number(total || 0);
        const badge = totalNum >= 100000000
          ? `约 ${(totalNum / 100000000).toFixed(2)} 亿`
          : totalNum >= 10000
          ? `约 ${(totalNum / 10000).toFixed(2)} 万`
          : '';

        const heroCard = {
          label: '今日 TOKENS',
          value: totalNum.toLocaleString('en-US'),
          badge
        };

        const subCards = [
          { label: '已知费用', value: formatUsd(cost) },
          { label: '数据状态', value: freshness === 'fresh' ? '实时 (fresh)' : freshness }
        ];

        const cardHtml = buildNativeWindowHtml({
          title: 'Token Monitor · 今日用量',
          heroCard,
          subCards,
          breakdownTitle: breakdownRows.length > 0 ? '热门调用模型分布' : '',
          breakdownRows,
          footerTime: `更新于 ${nowTimeStr}`
        });

        const targetHeight = calculateWindowHeight({
          hasHero: true,
          hasSubCards: true,
          rowsCount: breakdownRows.length
        });
        const base64 = await renderCardToPngBase64(cardHtml, targetHeight);
        if (base64) {
          const imgCq = `[CQ:image,file=base64://${base64}]`;
          return wantedFormat === 'both' ? `${textReply}\n${imgCq}` : imgCq;
        }
        return textReply;
      }

      if (type === 'month') {
        const result = await host.call('data.query', { resource: 'usage', period: 'month' });
        if (result.availability !== 'available') {
          return `📅【Token Monitor 本月汇总】\n⚠️ 数据当前不可用 (${result.availability})`;
        }
        const row = result.rows?.[0] || {};
        const textReply = `📅【Token Monitor 本月汇总】\n` +
          `• 本月总 Tokens：${formatTokens(row.totalTokens)}\n` +
          `• 本月已知费用：${formatUsd(row.cost?.knownUsd)}\n` +
          `• 统计周期：自然月`;

        if (wantedFormat === 'text') return textReply;

        const totalNum = Number(row.totalTokens || 0);
        const badge = totalNum >= 100000000
          ? `约 ${(totalNum / 100000000).toFixed(2)} 亿`
          : totalNum >= 10000
          ? `约 ${(totalNum / 10000).toFixed(2)} 万`
          : '';

        const heroCard = {
          label: '本月 TOKENS',
          value: totalNum.toLocaleString('en-US'),
          badge
        };

        const subCards = [
          { label: '已知费用', value: formatUsd(row.cost?.knownUsd) },
          { label: '统计周期', value: '自然月' }
        ];

        const cardHtml = buildNativeWindowHtml({
          title: 'Token Monitor · 本月汇总',
          heroCard,
          subCards,
          footerTime: `统计于 ${nowTimeStr}`
        });

        const targetHeight = calculateWindowHeight({
          hasHero: true,
          hasSubCards: true,
          rowsCount: 0
        });
        const base64 = await renderCardToPngBase64(cardHtml, targetHeight);
        if (base64) {
          const imgCq = `[CQ:image,file=base64://${base64}]`;
          return wantedFormat === 'both' ? `${textReply}\n${imgCq}` : imgCq;
        }
        return textReply;
      }

      if (type === 'models') {
        const result = await host.call('data.query', {
          resource: 'models',
          period: 'today',
          sort: { field: 'totalTokens', direction: 'desc' },
          page: { limit: 5 }
        });
        if (result.availability !== 'available' || !result.rows?.length) {
          return `🤖【今日模型消耗排行】\n暂无今日模型消耗数据或尚未采集。`;
        }
        let textReply = `🤖【今日模型消耗排行 Top 5】\n`;
        result.rows.forEach((r, idx) => {
          textReply += `${idx + 1}. ${r.model || r.id || '未知模型'}: ${formatTokens(r.totalTokens)} Tokens\n`;
        });
        textReply = textReply.trim();

        if (wantedFormat === 'text') return textReply;

        const maxVal = Math.max(...result.rows.map(r => r.totalTokens || 1), 1);
        const breakdownRows = result.rows.map(r => ({
          name: r.model || r.id || '未知模型',
          value: formatTokens(r.totalTokens),
          percent: Math.round(((r.totalTokens || 0) / maxVal) * 100)
        }));

        const topModel = result.rows[0];
        const topTokens = Number(topModel?.totalTokens || 0);
        const heroCard = {
          label: '最高单模型消耗',
          value: topTokens.toLocaleString('en-US'),
          badge: topModel?.model || topModel?.id || ''
        };

        const subCards = [
          { label: '调用模型数', value: `${result.rows.length} 种` },
          { label: '统计周期', value: '今日' }
        ];

        const cardHtml = buildNativeWindowHtml({
          title: 'Token Monitor · 模型消耗排行',
          heroCard,
          subCards,
          breakdownTitle: '热门调用模型 Top 5',
          breakdownRows,
          footerTime: `更新于 ${nowTimeStr}`
        });

        const targetHeight = calculateWindowHeight({
          hasHero: true,
          hasSubCards: true,
          rowsCount: breakdownRows.length
        });
        const base64 = await renderCardToPngBase64(cardHtml, targetHeight);
        if (base64) {
          const imgCq = `[CQ:image,file=base64://${base64}]`;
          return wantedFormat === 'both' ? `${textReply}\n${imgCq}` : imgCq;
        }
        return textReply;
      }

      if (type === 'limits') {
        const result = await host.call('data.query', { resource: 'limits' });
        if (result.availability !== 'available' || !result.rows?.length) {
          return `💳【服务商额度与限额】\n未检测到限额规则或未配置账户。`;
        }
        let textReply = `💳【服务商额度与限额】\n`;
        result.rows.slice(0, 5).forEach(r => {
          textReply += `• ${r.provider || r.accountId || '账户'}: 限额 ${formatTokens(r.limit)} / 剩余 ${formatTokens(r.remaining)}\n`;
        });
        return textReply.trim();
      }

      if (type === 'status') {
        const isOnline = currentSettings.connectionMode === 'forward'
          ? Boolean(clientConn && !clientConn.closed)
          : serverClients.size > 0;
        const textReply = `🖥️【Token Monitor 监控状态】\n` +
          `• OneBot 连接：${isOnline ? '🟢 已连接' : '🔴 未连接'}\n` +
          `• 连接模式：${currentSettings.connectionMode === 'forward' ? '正向 WS' : '反向 WS 服务端'}\n` +
          `• 输出格式：${currentSettings.replyFormat === 'image' ? '图片卡片' : currentSettings.replyFormat === 'both' ? '图文并茂' : '纯文本'}\n` +
          `• 订阅会话数：${subscriptions.length} 个\n` +
          `• 定时日报：${currentSettings.autoDailyReport ? `已开启 (${currentSettings.dailyReportTime})` : '已关闭'}\n` +
          `• 阈值告警：${currentSettings.autoAlert ? `已开启 (>${formatTokens(currentSettings.tokenAlertThreshold)} Tokens)` : '已关闭'}\n` +
          `• 管理员数量：${getAdminList().length} 人`;

        if (wantedFormat === 'text') return textReply;

        const heroCard = {
          label: 'ONEBOT 连接状态',
          value: isOnline ? '在线 🟢' : '未连接 🔴',
          badge: currentSettings.connectionMode === 'forward' ? '正向 WS 客户端' : '反向 WS 服务端'
        };

        const subCards = [
          { label: '已订阅会话', value: `${subscriptions.length} 个` },
          { label: '管理员数量', value: `${getAdminList().length} 人` }
        ];

        const cardHtml = buildNativeWindowHtml({
          title: 'Token Monitor · 监控状态',
          heroCard,
          subCards,
          footerTime: `检查于 ${nowTimeStr}`
        });

        const targetHeight = calculateWindowHeight({
          hasHero: true,
          hasSubCards: true,
          rowsCount: 0
        });
        const base64 = await renderCardToPngBase64(cardHtml, targetHeight);
        if (base64) {
          const imgCq = `[CQ:image,file=base64://${base64}]`;
          return wantedFormat === 'both' ? `${textReply}\n${imgCq}` : imgCq;
        }
        return textReply;
      }

      if (type === 'help') {
        return `🤖【Token Monitor 机器人指令列表】\n` +
          `🔹 /token [图|文] - 查询今日 Token 消耗与费用\n` +
          `🔹 /month [图|文] - 查询本月 Token 消耗汇总\n` +
          `🔹 /models [图|文] - 查询今日模型消耗排行榜\n` +
          `🔹 /limits - 查询模型服务商额度限制\n` +
          `🔹 /status [图|文] - 查看插件与连接运行状态\n` +
          `🔹 /sub - 订阅当前群/私聊的日报与告警\n` +
          `🔹 /unsub - 取消当前会话的所有订阅\n` +
          `🔹 /help - 显示帮助说明\n` +
          `💡 提示：支持追加 [图] 或 [文] 参数（如 /token 图）临时指定返回格式。所有指令仅限管理员执行。`;
      }
    } catch (err) {
      return `❌ 执行失败: ${err.message}`;
    }
    return null;
  }

  // Parse and handle incoming OneBot event
  async function handleOneBotEvent(dataStr) {
    lastEventTime = Date.now();
    let event;
    try {
      event = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (event.post_type === 'meta_event') {
      if (event.meta_event_type === 'lifecycle') {
        appendLog('info', `收到 OneBot 生命周期事件: ${event.sub_type}`);
      }
      return;
    }

    if (event.post_type !== 'message') return;

    totalReceivedMessages++;
    const isGroup = event.message_type === 'group';
    const targetType = isGroup ? 'group' : 'private';
    const targetId = isGroup ? event.group_id : event.user_id;
    const userId = event.user_id;

    // Extract command text
    let text = '';
    if (typeof event.message === 'string') {
      text = event.message;
    } else if (Array.isArray(event.message)) {
      text = event.message
        .filter(seg => seg.type === 'text')
        .map(seg => seg.data?.text || '')
        .join('');
    } else {
      text = String(event.raw_message || '');
    }

    // Clean CQ codes e.g. [CQ:at,qq=...]
    text = text.replace(/\[CQ:[^\]]+\]/g, '').trim();

    if (!text.startsWith('/') && !['用量', '本月', '模型', '额度', '状态', '帮助', '订阅', '退订'].includes(text)) {
      return;
    }

    const rawCmd = text.startsWith('/') ? text.slice(1).trim() : text.trim();
    const parts = rawCmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const formatArg = (parts[1] || '').toLowerCase();

    let targetFormat = null;
    if (['图', 'pic', 'img', 'image'].includes(formatArg)) targetFormat = 'image';
    else if (['文', 'txt', 'text'].includes(formatArg)) targetFormat = 'text';
    else if (['图文', 'both'].includes(formatArg)) targetFormat = 'both';

    appendLog('info', `收到来自 ${isGroup ? `群 ${event.group_id}` : `私聊 ${userId}`} 的指令: ${text}`);

    // Admin Verification (User Requirement: 仅管理员模式)
    if (!isAdmin(userId)) {
      appendLog('warn', `用户 ${userId} 尝试执行指令但无管理员权限`);
      if (!isGroup) {
        sendOneBotMessage(targetType, targetId, '⚠️ 权限不足：Token Monitor 指令仅限配置的管理员 QQ 执行。');
      }
      return;
    }

    // Command Dispatch
    if (['token', 'today', '用量'].includes(command)) {
      const reply = await handleQueryCommand('today', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['month', '本月'].includes(command)) {
      const reply = await handleQueryCommand('month', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['models', 'model', '模型'].includes(command)) {
      const reply = await handleQueryCommand('models', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['limits', 'limit', '额度'].includes(command)) {
      const reply = await handleQueryCommand('limits', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['status', '状态'].includes(command)) {
      const reply = await handleQueryCommand('status', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['help', '帮助', 'tm'].includes(command)) {
      const reply = await handleQueryCommand('help', targetFormat);
      sendOneBotMessage(targetType, targetId, reply);
    } else if (['sub', '订阅'].includes(command)) {
      const subKey = `${targetType}_${targetId}`;
      const existing = subscriptions.find(s => s.id === subKey);
      if (!existing) {
        subscriptions.push({
          id: subKey,
          type: targetType,
          targetId,
          name: isGroup ? `群聊 ${targetId}` : `私聊 ${targetId}`,
          daily: true,
          alert: true,
          createdAt: new Date().toISOString()
        });
        await saveSubscriptions();
        appendLog('info', `新订阅已添加: ${subKey}`);
        sendOneBotMessage(targetType, targetId, '✅ 订阅成功！当前会话已开启 Token Monitor 每日用量日报与超额告警。');
      } else {
        sendOneBotMessage(targetType, targetId, 'ℹ️ 当前会话已在订阅列表中，无需重复订阅。');
      }
      broadcastStatus();
    } else if (['unsub', '退订', '取消订阅'].includes(command)) {
      const subKey = `${targetType}_${targetId}`;
      const index = subscriptions.findIndex(s => s.id === subKey);
      if (index !== -1) {
        subscriptions.splice(index, 1);
        await saveSubscriptions();
        appendLog('info', `订阅已移除: ${subKey}`);
        sendOneBotMessage(targetType, targetId, '🚫 已取消订阅 Token Monitor 推送服务。');
      } else {
        sendOneBotMessage(targetType, targetId, 'ℹ️ 当前会话未订阅任何通知。');
      }
      broadcastStatus();
    }
  }

  // -------------------------------------------------------------
  // Scheduled Daily Reports & Threshold Alert Engine
  // -------------------------------------------------------------

  async function checkDailyReportAndAlerts() {
    if (isDisposed) return;
    await refreshSettings();

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 1. Daily Report Check
    if (currentSettings.autoDailyReport && subscriptions.length > 0) {
      if (currentTimeStr === currentSettings.dailyReportTime && lastDailyReportDate !== todayStr) {
        lastDailyReportDate = todayStr;
        appendLog('info', `触发每日定时用量汇总推送 (${currentTimeStr})`);
        const report = await handleQueryCommand('today');
        for (const sub of subscriptions) {
          if (sub.daily !== false) {
            sendOneBotMessage(sub.type, sub.targetId, `📢【Token Monitor 每日汇总】\n${report}`);
          }
        }
      }
    }

    // 2. Threshold Alert Check
    if (currentSettings.autoAlert && subscriptions.length > 0) {
      try {
        const result = await host.call('data.query', { resource: 'usage', period: 'today' });
        if (result.availability === 'available') {
          const row = result.rows?.[0] || {};
          const totalTokens = row.totalTokens ?? 0;
          const knownUsd = row.cost?.knownUsd ?? 0;

          latestUsageSnapshot = { totalTokens, knownUsd };

          const tokenExceeded = currentSettings.tokenAlertThreshold > 0 && totalTokens >= currentSettings.tokenAlertThreshold;
          const costExceeded = currentSettings.costAlertThreshold > 0 && knownUsd >= currentSettings.costAlertThreshold;

          if ((tokenExceeded || costExceeded) && lastAlertDate !== todayStr) {
            lastAlertDate = todayStr;
            appendLog('warn', `今日用量超出告警阈值: Tokens=${totalTokens}, Cost=$${knownUsd}`);
            let alertMsg = `⚠️【Token Monitor 用量告警】\n` +
              `今日使用已超出设定阈值！\n` +
              `• 当前 Tokens: ${formatTokens(totalTokens)} (阈值: ${formatTokens(currentSettings.tokenAlertThreshold)})\n` +
              `• 当前费用: ${formatUsd(knownUsd)} (阈值: $${currentSettings.costAlertThreshold})\n` +
              `请及时核对 API 客户端用量。`;
            for (const sub of subscriptions) {
              if (sub.alert !== false) {
                sendOneBotMessage(sub.type, sub.targetId, alertMsg);
              }
            }
          }
        }
      } catch (err) {
        // Suppress background poll errors
      }
    }
  }

  // -------------------------------------------------------------
  // WebSocket Server / Client Lifecycle
  // -------------------------------------------------------------

  function stopConnections() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (clientConn) {
      clientConn.close();
      clientConn = null;
    }
    for (const conn of serverClients) {
      conn.close();
    }
    serverClients.clear();

    if (serverInstance) {
      try {
        serverInstance.close();
      } catch {}
      serverInstance = null;
    }
  }

  function startForwardClient() {
    stopConnections();
    if (isDisposed) return;

    let targetUrl;
    try {
      targetUrl = new URL(currentSettings.wsUrl || 'ws://127.0.0.1:3001');
    } catch (err) {
      appendLog('error', `无效的 WebSocket 地址: ${currentSettings.wsUrl}`);
      return;
    }

    const isSecure = targetUrl.protocol === 'wss:';
    const clientModule = isSecure ? https : http;
    const port = targetUrl.port || (isSecure ? 443 : 80);
    const hostHeader = targetUrl.host;
    const secKey = crypto.randomBytes(16).toString('base64');

    const headers = {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Version': 13,
      'Sec-WebSocket-Key': secKey,
      'Host': hostHeader
    };
    if (currentSettings.accessToken) {
      headers['Authorization'] = `Bearer ${currentSettings.accessToken}`;
    }

    appendLog('info', `正在连接 OneBot 服务端: ${targetUrl.href}...`);

    let req;
    try {
      req = clientModule.request({
        protocol: isSecure ? 'https:' : 'http:',
        hostname: targetUrl.hostname,
        port,
        path: targetUrl.pathname + targetUrl.search,
        headers
      });
    } catch (err) {
      appendLog('error', `建立请求失败: ${err.message}`);
      scheduleReconnect();
      return;
    }

    req.on('upgrade', (res, socket) => {
      appendLog('info', `✅ 成功建立 OneBot 正向 WebSocket 连接 (${targetUrl.href})`);
      clientConn = new WsConnection(socket, { isServer: false, remoteAddress: targetUrl.hostname });
      clientConn.on('message', handleOneBotEvent);
      clientConn.on('close', () => {
        appendLog('warn', 'OneBot WebSocket 连接断开，准备重连...');
        clientConn = null;
        broadcastStatus();
        scheduleReconnect();
      });
      clientConn.on('error', err => {
        appendLog('error', `WebSocket 错误: ${err.message}`);
      });
      broadcastStatus();
    });

    req.on('error', err => {
      appendLog('error', `连接 OneBot 服务端失败: ${err.message}`);
      broadcastStatus();
      scheduleReconnect();
    });

    req.end();
  }

  function scheduleReconnect() {
    if (isDisposed || reconnectTimer || currentSettings.connectionMode !== 'forward') return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isDisposed && currentSettings.connectionMode === 'forward') {
        startForwardClient();
      }
    }, 5000);
  }

  function startReverseServer() {
    stopConnections();
    if (isDisposed) return;

    const port = currentSettings.serverPort || 8080;
    serverInstance = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Token Monitor OneBot Reverse WebSocket Server');
    });

    serverInstance.on('upgrade', (req, socket, head) => {
      // Validate Authorization token if configured
      if (currentSettings.accessToken) {
        const authHeader = req.headers['authorization'] || '';
        const tokenMatch = authHeader.replace(/^Bearer\s+/i, '').trim();
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const queryToken = urlObj.searchParams.get('access_token');

        if (tokenMatch !== currentSettings.accessToken && queryToken !== currentSettings.accessToken) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          appendLog('warn', `拒绝未经授权的 OneBot 连接请求 (IP: ${socket.remoteAddress})`);
          return;
        }
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );

      const conn = new WsConnection(socket, { isServer: true, remoteAddress: socket.remoteAddress });
      serverClients.add(conn);
      appendLog('info', `✅ OneBot 客户端反向连接成功 (来自: ${socket.remoteAddress})`);
      broadcastStatus();

      conn.on('message', handleOneBotEvent);
      conn.on('close', () => {
        serverClients.delete(conn);
        appendLog('warn', `OneBot 客户端断开连接 (${socket.remoteAddress})`);
        broadcastStatus();
      });
      conn.on('error', err => {
        serverClients.delete(conn);
        appendLog('error', `客户端连接异常: ${err.message}`);
        broadcastStatus();
      });
    });

    serverInstance.on('error', err => {
      appendLog('error', `反向 WS 服务端启动失败: ${err.message}`);
      broadcastStatus();
    });

    serverInstance.listen(port, '0.0.0.0', () => {
      appendLog('info', `✅ 反向 WebSocket 服务端已在端口 ${port} 启动监听`);
      broadcastStatus();
    });
  }

  function applyConnectionMode() {
    if (currentSettings.connectionMode === 'reverse') {
      startReverseServer();
    } else {
      startForwardClient();
    }
  }

  // -------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------

  await loadSubscriptions();
  await refreshSettings();
  applyConnectionMode();

  // Run scheduled checks every 30 seconds
  tickerTimer = setInterval(checkDailyReportAndAlerts, 30000);

  // Initial usage fetch
  try {
    const initUsage = await host.call('data.query', { resource: 'usage', period: 'today' });
    if (initUsage.availability === 'available') {
      latestUsageSnapshot = {
        totalTokens: initUsage.rows?.[0]?.totalTokens ?? 0,
        knownUsd: initUsage.rows?.[0]?.cost?.knownUsd ?? null
      };
    }
  } catch {}

  appendLog('info', 'OneBot 机器人网关插件已就绪');

  // -------------------------------------------------------------
  // Public Interface for UI / Host
  // -------------------------------------------------------------

  return {
    async call(method, value) {
      if (method === 'getStatus') {
        await refreshSettings();
        const isOnline = currentSettings.connectionMode === 'forward'
          ? Boolean(clientConn && !clientConn.closed)
          : serverClients.size > 0;
        return {
          online: isOnline,
          mode: currentSettings.connectionMode,
          target: currentSettings.connectionMode === 'forward' ? currentSettings.wsUrl : `Port ${currentSettings.serverPort}`,
          connectedClients: currentSettings.connectionMode === 'forward' ? (isOnline ? 1 : 0) : serverClients.size,
          subscriberCount: subscriptions.length,
          todayTokens: latestUsageSnapshot?.totalTokens ?? 0,
          todayCost: latestUsageSnapshot?.knownUsd ?? null,
          totalReceived: totalReceivedMessages,
          totalSent: totalSentMessages,
          lastEventTime,
          adminCount: getAdminList().length,
          recentLogs: logs.slice(-25)
        };
      }

      if (method === 'getLogs') {
        return logs;
      }

      if (method === 'getSubscriptions') {
        return subscriptions;
      }

      if (method === 'addSubscription') {
        const { type, targetId, name } = value || {};
        if (!type || !targetId) throw new Error('缺少必要参数: type 和 targetId');
        const subKey = `${type}_${targetId}`;
        const existing = subscriptions.find(s => s.id === subKey);
        if (existing) throw new Error('该会话已在订阅列表中');
        const item = {
          id: subKey,
          type,
          targetId: Number(targetId),
          name: name || (type === 'group' ? `群 ${targetId}` : `用户 ${targetId}`),
          daily: true,
          alert: true,
          createdAt: new Date().toISOString()
        };
        subscriptions.push(item);
        await saveSubscriptions();
        appendLog('info', `手动添加订阅: ${subKey} (${item.name})`);
        broadcastStatus();
        return item;
      }

      if (method === 'removeSubscription') {
        const { id } = value || {};
        const idx = subscriptions.findIndex(s => s.id === id);
        if (idx !== -1) {
          const removed = subscriptions.splice(idx, 1)[0];
          await saveSubscriptions();
          appendLog('info', `手动移除订阅: ${id}`);
          broadcastStatus();
          return removed;
        }
        throw new Error('未找到该订阅项');
      }

      if (method === 'sendTestMessage') {
        const { targetType, targetId, message } = value || {};
        if (!targetType || !targetId || !message) throw new Error('参数不完整');
        const success = sendOneBotMessage(targetType, targetId, message);
        if (!success) throw new Error('发送失败：当前未建立 OneBot 连接或消息发送超时');
        appendLog('info', `发送测试消息至 ${targetType === 'group' ? '群' : '私聊'} ${targetId}`);
        return { success: true };
      }

      if (method === 'testQuery') {
        const report = await handleQueryCommand('today');
        return { report };
      }

      if (method === 'triggerDailyReport') {
        const report = await handleQueryCommand('today');
        let count = 0;
        for (const sub of subscriptions) {
          if (sendOneBotMessage(sub.type, sub.targetId, `📢【Token Monitor 手动推送测试】\n${report}`)) {
            count++;
          }
        }
        appendLog('info', `手动触发每日汇总，已发送给 ${count} 个订阅目标`);
        return { count };
      }

      if (method === 'restartConnection') {
        await refreshSettings();
        applyConnectionMode();
        appendLog('info', '已重新加载配置并重置 OneBot 连接');
        return { success: true };
      }

      throw new Error(`未知的操作指令: ${method}`);
    },

    update(context) {
      // Called when host source or background demand updates
      void refreshSettings().then(() => {
        broadcastStatus();
      });
    },

    dispose() {
      isDisposed = true;
      if (tickerTimer) {
        clearInterval(tickerTimer);
        tickerTimer = null;
      }
      stopConnections();
      appendLog('info', 'OneBot 插件后端服务已安全停止');
    }
  };
};
