export function activate(ctx) {
  return {
    mount(container, context) {
      container.classList.add('onebot-plugin-root');

      // State
      let closed = false;
      let unsubscribeBackend = null;
      let resizeObserver = null;
      let statusData = {
        online: false,
        mode: 'forward',
        target: 'ws://127.0.0.1:3001',
        connectedClients: 0,
        subscriberCount: 0,
        todayTokens: 0,
        todayCost: null,
        totalReceived: 0,
        totalSent: 0,
        lastEventTime: null,
        adminCount: 0,
        recentLogs: []
      };
      let subscriptionsList = [];

      // Create Container Structure
      const root = document.createElement('div');
      root.className = 'onebot-wrapper';

      // 1. Header
      const header = document.createElement('header');
      header.className = 'onebot-header';
      header.innerHTML = `
        <div class="header-left">
          <div class="logo-box">
            <span class="logo-icon">🤖</span>
            <div class="title-wrap">
              <h2 class="title">OneBot 机器人网关</h2>
              <p class="subtitle">Token Monitor 外部信息订阅与指令交互服务</p>
            </div>
          </div>
        </div>
        <div class="header-right">
          <div class="status-tags-row">
            <span class="status-pill offline" id="status-pill">
              <span class="dot"></span>
              <span class="status-text">未连接</span>
            </span>
            <span class="mode-badge" id="mode-badge">正向 WS</span>
          </div>
          <div class="header-btns-row">
            <button class="btn btn-secondary btn-header" id="btn-reconnect" title="重新连接或重载配置">🔄 重连</button>
            <button class="btn btn-secondary btn-header" id="btn-refresh" title="刷新状态">⚡ 刷新</button>
          </div>
        </div>
      `;
      root.appendChild(header);

      // 2. Metrics Grid (Responsive Cards)
      const metricsGrid = document.createElement('div');
      metricsGrid.className = 'metrics-grid';
      metricsGrid.innerHTML = `
        <div class="metric-card">
          <div class="metric-label">连接状态</div>
          <div class="metric-value" id="val-connection">离线</div>
          <div class="metric-hint" id="val-target" title="连接地址或监听端口">目标: ws://127.0.0.1:3001</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">活跃订阅数</div>
          <div class="metric-value highlight" id="val-subscribers">0</div>
          <div class="metric-hint" id="val-admin-count">管理员: 0 个</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">今日 Tokens 消耗</div>
          <div class="metric-value" id="val-tokens" title="今日累计消耗 Tokens">0</div>
          <div class="metric-hint" id="val-cost">费用: 统计中</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">消息吞吐量</div>
          <div class="metric-value" id="val-throughput">0 / 0</div>
          <div class="metric-hint">已接收 / 已发送</div>
        </div>
      `;
      root.appendChild(metricsGrid);

      // 3. Main Content Columns
      const mainRow = document.createElement('div');
      mainRow.className = 'main-row';

      // Left Column: Operations & Subscribers
      const leftCol = document.createElement('div');
      leftCol.className = 'col-left';

      // Card: Quick Actions
      const actionsCard = document.createElement('div');
      actionsCard.className = 'panel-card';
      actionsCard.innerHTML = `
        <div class="card-header">
          <h3 class="card-title">🚀 快捷调试与交互</h3>
        </div>
        <div class="card-body">
          <div class="form-row">
            <label class="form-label">测试目标类型</label>
            <div class="radio-group">
              <label><input type="radio" name="targetType" value="group" checked> QQ 群聊</label>
              <label><input type="radio" name="targetType" value="private"> 私聊 QQ</label>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label">目标群号 / QQ 号</label>
            <input type="number" id="test-target-id" class="input-text" placeholder="例如: 123456789">
          </div>
          <div class="form-row">
            <label class="form-label">消息内容</label>
            <input type="text" id="test-message" class="input-text" value="这是一条来自 Token Monitor 的测试消息" placeholder="输入要发送的消息">
          </div>
          <div class="action-buttons">
            <button class="btn btn-primary" id="btn-send-test">📤 发送测试消息</button>
            <button class="btn btn-secondary" id="btn-test-query">📊 模拟今日用量查询</button>
            <button class="btn btn-secondary" id="btn-trigger-daily">📢 立即广播今日日报</button>
          </div>
          <div class="feedback-area" id="action-feedback" style="display:none;"></div>
        </div>
      `;
      leftCol.appendChild(actionsCard);

      // Card: Subscribers Management (Card/List Based Layout)
      const subsCard = document.createElement('div');
      subsCard.className = 'panel-card';
      subsCard.innerHTML = `
        <div class="card-header flex-between">
          <h3 class="card-title">📋 订阅目标管理</h3>
          <span class="badge" id="sub-count-badge">0 个目标</span>
        </div>
        <div class="card-body">
          <div class="add-sub-box">
            <div class="add-sub-row-1">
              <select id="new-sub-type" class="input-select">
                <option value="group">QQ 群</option>
                <option value="private">私聊 QQ</option>
              </select>
              <input type="number" id="new-sub-id" class="input-text" placeholder="群号/QQ号">
            </div>
            <div class="add-sub-row-2">
              <input type="text" id="new-sub-name" class="input-text" placeholder="备注名(可选)">
              <button class="btn btn-secondary" id="btn-add-sub">➕ 添加订阅</button>
            </div>
          </div>
          <div class="subs-list-container" id="subs-list-container">
            <div class="empty-state">加载中...</div>
          </div>
        </div>
      `;
      leftCol.appendChild(subsCard);

      // Right Column: Commands Reference & Live Console
      const rightCol = document.createElement('div');
      rightCol.className = 'col-right';

      // Card: Commands
      const cmdCard = document.createElement('div');
      cmdCard.className = 'panel-card';
      cmdCard.innerHTML = `
        <div class="card-header">
          <h3 class="card-title">📖 OneBot 指令速查 (仅管理员可用)</h3>
        </div>
        <div class="card-body">
          <ul class="cmd-list">
            <li class="cmd-item">
              <span class="cmd-tag"><code>/token</code> 或 <code>/用量</code></span>
              <span class="cmd-desc">查询今日 Token 消耗与已知费用</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/month</code> 或 <code>/本月</code></span>
              <span class="cmd-desc">查询本自然月累计消耗汇总</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/models</code> 或 <code>/模型</code></span>
              <span class="cmd-desc">查询今日模型消耗排行榜 Top 5</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/limits</code> 或 <code>/额度</code></span>
              <span class="cmd-desc">查询各平台配额与剩余额度</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/status</code> 或 <code>/状态</code></span>
              <span class="cmd-desc">查询 Token Monitor 采集与连接健康度</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/sub</code> 或 <code>/订阅</code></span>
              <span class="cmd-desc">在当前群聊/私聊中开启日报与超额告警</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/unsub</code> 或 <code>/退订</code></span>
              <span class="cmd-desc">取消当前会话的所有订阅推送</span>
            </li>
            <li class="cmd-item">
              <span class="cmd-tag"><code>/help</code> 或 <code>/帮助</code></span>
              <span class="cmd-desc">显示机器人使用帮助指南</span>
            </li>
          </ul>
          <div class="hint-box">
            💡 <strong>安全说明：</strong>为保障 API 隐私，所有查询与配置指令均受管理员白名单限制。请在 <strong>设置 ➜ 插件 ➜ OneBot 机器人</strong> 中配置管理员 QQ 账号。
          </div>
        </div>
      `;
      rightCol.appendChild(cmdCard);

      // Card: Live Log Console
      const logCard = document.createElement('div');
      logCard.className = 'panel-card log-panel';
      logCard.innerHTML = `
        <div class="card-header flex-between">
          <h3 class="card-title">💻 运行日志</h3>
          <button class="btn btn-xs" id="btn-clear-log">清屏</button>
        </div>
        <div class="card-body console-body">
          <pre class="console-output" id="log-console"></pre>
        </div>
      `;
      rightCol.appendChild(logCard);

      mainRow.appendChild(leftCol);
      mainRow.appendChild(rightCol);
      root.appendChild(mainRow);
      container.appendChild(root);

      // Responsive Size Watcher (ResizeObserver)
      function updateResponsiveClasses(width) {
        if (!width) return;
        root.classList.toggle('is-narrow', width <= 620);
        root.classList.toggle('is-compact', width <= 420);
        root.classList.toggle('is-mini', width <= 300);
      }

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
          for (const entry of entries) {
            const w = entry.contentRect.width;
            updateResponsiveClasses(w);
          }
        });
        resizeObserver.observe(container);
      }
      updateResponsiveClasses(container.clientWidth);

      // DOM References
      const statusPill = root.querySelector('#status-pill');
      const modeBadge = root.querySelector('#mode-badge');
      const valConnection = root.querySelector('#val-connection');
      const valTarget = root.querySelector('#val-target');
      const valSubscribers = root.querySelector('#val-subscribers');
      const valAdminCount = root.querySelector('#val-admin-count');
      const valTokens = root.querySelector('#val-tokens');
      const valCost = root.querySelector('#val-cost');
      const valThroughput = root.querySelector('#val-throughput');
      const logConsole = root.querySelector('#log-console');
      const subsListContainer = root.querySelector('#subs-list-container');
      const subCountBadge = root.querySelector('#sub-count-badge');
      const actionFeedback = root.querySelector('#action-feedback');

      // Format Large Token Counts (Supports Billions/Millions cleanly)
      function formatDisplayTokens(num) {
        if (num === null || num === undefined) return '0';
        const n = Number(num);
        if (n >= 100000000) {
          return `${(n / 100000000).toFixed(2)} 亿`;
        }
        if (n >= 10000) {
          return `${(n / 10000).toFixed(2)} 万`;
        }
        return n.toLocaleString('en-US');
      }

      function showFeedback(text, isError = false) {
        actionFeedback.style.display = 'block';
        actionFeedback.className = isError ? 'feedback-area error' : 'feedback-area success';
        actionFeedback.textContent = text;
        setTimeout(() => {
          if (!closed) actionFeedback.style.display = 'none';
        }, 6000);
      }

      function updateStatusDisplay(data) {
        if (closed || !data) return;
        statusData = { ...statusData, ...data };

        // Status Pill & Mode
        if (statusData.online) {
          statusPill.className = 'status-pill online';
          statusPill.querySelector('.status-text').textContent = statusData.mode === 'forward' ? '已连接' : '客户端在线';
          valConnection.textContent = '在线 🟢';
        } else {
          statusPill.className = 'status-pill offline';
          statusPill.querySelector('.status-text').textContent = statusData.mode === 'forward' ? '未连接' : '等待连接';
          valConnection.textContent = statusData.mode === 'forward' ? '重连中 🔴' : '监听中 🟡';
        }

        modeBadge.textContent = statusData.mode === 'forward' ? '正向 WS' : '反向 WS';
        valTarget.textContent = `目标: ${statusData.target}`;
        valTarget.title = String(statusData.target);

        // Metrics
        valSubscribers.textContent = String(statusData.subscriberCount || 0);
        valAdminCount.textContent = `管理员: ${statusData.adminCount || 0} 个`;
        valTokens.textContent = formatDisplayTokens(statusData.todayTokens);
        valTokens.title = `精确总数: ${Number(statusData.todayTokens || 0).toLocaleString('en-US')} Tokens`;

        valCost.textContent = `费用: ${statusData.todayCost !== null ? '$' + Number(statusData.todayCost).toFixed(4) : '未知'}`;
        valThroughput.textContent = `${statusData.totalReceived || 0} / ${statusData.totalSent || 0}`;

        // Logs
        if (Array.isArray(statusData.recentLogs)) {
          renderLogs(statusData.recentLogs);
        }
      }

      function renderLogs(logs) {
        logConsole.textContent = logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
        logConsole.scrollTop = logConsole.scrollHeight;
      }

      async function refreshSubscribers() {
        try {
          const list = await ctx.backend.call('getSubscriptions');
          subscriptionsList = Array.isArray(list) ? list : [];
          subCountBadge.textContent = `${subscriptionsList.length} 个目标`;

          if (subscriptionsList.length === 0) {
            subsListContainer.innerHTML = `
              <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>暂无订阅目标</p>
                <span class="empty-hint">发送 <code>/sub</code> 自动订阅，或在上方添加</span>
              </div>
            `;
            return;
          }

          subsListContainer.innerHTML = '';
          subscriptionsList.forEach(item => {
            const card = document.createElement('div');
            card.className = 'sub-item-card';
            card.innerHTML = `
              <div class="sub-item-top">
                <div class="sub-item-info">
                  <span class="type-tag ${item.type}">${item.type === 'group' ? 'QQ 群' : '私聊'}</span>
                  <code class="sub-target-code">${item.targetId}</code>
                  <span class="sub-target-name">${item.name || '-'}</span>
                </div>
                <button class="btn btn-danger btn-xs btn-remove" data-id="${item.id}" title="移除此订阅">移除</button>
              </div>
              <div class="sub-item-bottom">
                <div class="sub-tags-wrap">
                  <span class="sub-tag">每日日报</span>
                  <span class="sub-tag">超额告警</span>
                </div>
                <span class="sub-time">${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
              </div>
            `;
            card.querySelector('.btn-remove').onclick = async () => {
              try {
                await ctx.backend.call('removeSubscription', { id: item.id });
                showFeedback(`已成功移除订阅: ${item.id}`);
                await refreshSubscribers();
              } catch (err) {
                showFeedback(err.message, true);
              }
            };
            subsListContainer.appendChild(card);
          });
        } catch (err) {
          subsListContainer.innerHTML = `<div class="empty-state error">读取订阅失败: ${err.message}</div>`;
        }
      }

      async function refreshAll() {
        try {
          const res = await ctx.backend.call('getStatus');
          updateStatusDisplay(res);
          await refreshSubscribers();
        } catch (err) {
          showFeedback(`刷新状态失败: ${err.message}`, true);
        }
      }

      // Event Listeners
      root.querySelector('#btn-refresh').onclick = refreshAll;

      root.querySelector('#btn-reconnect').onclick = async () => {
        try {
          await ctx.backend.call('restartConnection');
          showFeedback('已触发重新连接');
          await refreshAll();
        } catch (err) {
          showFeedback(err.message, true);
        }
      };

      root.querySelector('#btn-send-test').onclick = async () => {
        const typeEl = root.querySelector('input[name="targetType"]:checked');
        const targetType = typeEl ? typeEl.value : 'group';
        const targetId = root.querySelector('#test-target-id').value.trim();
        const message = root.querySelector('#test-message').value.trim();

        if (!targetId || !message) {
          showFeedback('请填写目标 ID 与消息内容', true);
          return;
        }

        try {
          await ctx.backend.call('sendTestMessage', { targetType, targetId, message });
          showFeedback(`✅ 测试消息已成功通过 OneBot 发送至 ${targetType === 'group' ? '群' : 'QQ'} ${targetId}`);
        } catch (err) {
          showFeedback(`发送失败: ${err.message}`, true);
        }
      };

      root.querySelector('#btn-test-query').onclick = async () => {
        try {
          const res = await ctx.backend.call('testQuery');
          showFeedback(res.report || '查询成功');
        } catch (err) {
          showFeedback(`查询失败: ${err.message}`, true);
        }
      };

      root.querySelector('#btn-trigger-daily').onclick = async () => {
        try {
          const res = await ctx.backend.call('triggerDailyReport');
          showFeedback(`✅ 每日日报已成功推送给 ${res.count} 个活跃订阅目标`);
        } catch (err) {
          showFeedback(`广播失败: ${err.message}`, true);
        }
      };

      root.querySelector('#btn-add-sub').onclick = async () => {
        const type = root.querySelector('#new-sub-type').value;
        const targetId = root.querySelector('#new-sub-id').value.trim();
        const name = root.querySelector('#new-sub-name').value.trim();

        if (!targetId) {
          showFeedback('请填写群号或 QQ 号', true);
          return;
        }

        try {
          await ctx.backend.call('addSubscription', { type, targetId, name });
          showFeedback(`✅ 订阅已添加: ${type === 'group' ? '群' : '私聊'} ${targetId}`);
          root.querySelector('#new-sub-id').value = '';
          root.querySelector('#new-sub-name').value = '';
          await refreshSubscribers();
        } catch (err) {
          showFeedback(err.message, true);
        }
      };

      root.querySelector('#btn-clear-log').onclick = () => {
        logConsole.textContent = '';
      };

      // Subscribe to live backend publications
      if (ctx.backend?.subscribe) {
        unsubscribeBackend = ctx.backend.subscribe(data => {
          if (!closed && data) {
            updateStatusDisplay(data);
          }
        });
      }

      // Initial load
      void refreshAll();

      return {
        update(nextContext) {
          if (nextContext.width) {
            updateResponsiveClasses(nextContext.width);
          }
        },
        dispose() {
          closed = true;
          if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
          }
          if (unsubscribeBackend) {
            unsubscribeBackend();
            unsubscribeBackend = null;
          }
          container.replaceChildren();
        }
      };
    }
  };
}
