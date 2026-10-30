const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const docsImagesDir = path.resolve(__dirname, '../docs/images');
fs.mkdirSync(docsImagesDir, { recursive: true });

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
  items.push(22);

  for (let i = 0; i < items.length; i++) {
    h += items[i];
    if (i < items.length - 1) h += 10;
  }
  return h + 10;
}

const browser = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function renderHtmlToPng(html, outPng, height) {
  return new Promise((resolve, reject) => {
    const tempHtml = outPng.replace(/\.png$/, '.temp.html');
    fs.writeFileSync(tempHtml, html, 'utf8');
    const child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      `--screenshot=${outPng}`,
      `--window-size=480,${height}`,
      '--hide-scrollbars',
      tempHtml
    ]);
    child.on('close', code => {
      fs.unlinkSync(tempHtml);
      if (code === 0) resolve();
      else reject(new Error('Render failed with code ' + code));
    });
  });
}

async function main() {
  // 1. Overview image (today usage)
  const htmlOverview = buildNativeWindowHtml({
    title: 'Token Monitor · 今日用量',
    heroCard: {
      label: '今日 TOKENS',
      value: '258,419,200',
      badge: '约 2.58 亿'
    },
    subCards: [
      { label: '已知费用', value: '$14.2850' },
      { label: '数据状态', value: '实时 (fresh)' }
    ],
    breakdownTitle: '热门调用模型分布',
    breakdownRows: [
      { name: 'claude-3-5-sonnet', percent: 65, value: '167,972,480' },
      { name: 'gemini-1.5-pro', percent: 25, value: '64,604,800' },
      { name: 'gpt-4o', percent: 10, value: '25,841,920' }
    ],
    footerTime: '更新于 11:30:00'
  });
  const heightOverview = calculateWindowHeight({ hasHero: true, hasSubCards: true, rowsCount: 3 });
  await renderHtmlToPng(htmlOverview, path.join(docsImagesDir, 'overview.png'), heightOverview);
  console.log('✅ Generated docs/images/overview.png');

  // 2. Models ranking image
  const htmlModels = buildNativeWindowHtml({
    title: 'Token Monitor · 模型消耗排行',
    heroCard: {
      label: '最高单模型消耗',
      value: '194,520,380',
      badge: 'claude-3-5-sonnet'
    },
    subCards: [
      { label: '活跃模型数', value: '5 种' },
      { label: '统计周期', value: '今日' }
    ],
    breakdownTitle: '热门调用模型 Top 5',
    breakdownRows: [
      { name: 'claude-3-5-sonnet', percent: 100, value: '194,520,380' },
      { name: 'gpt-4o', percent: 62, value: '120,600,000' },
      { name: 'gemini-1.5-pro', percent: 45, value: '87,534,100' },
      { name: 'deepseek-chat', percent: 28, value: '54,465,000' },
      { name: 'qwen-plus', percent: 12, value: '23,342,000' }
    ],
    footerTime: '更新于 11:32:00'
  });
  const heightModels = calculateWindowHeight({ hasHero: true, hasSubCards: true, rowsCount: 5 });
  await renderHtmlToPng(htmlModels, path.join(docsImagesDir, 'models.png'), heightModels);
  console.log('✅ Generated docs/images/models.png');
}

main().catch(console.error);
