'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Helper: Quick WebSocket client for test
function createTestWsClient(port, path = '/') {
  const key = crypto.randomBytes(16).toString('base64');
  const req = http.request({
    port,
    host: '127.0.0.1',
    path,
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Version': 13,
      'Sec-WebSocket-Key': key
    }
  });

  return new Promise((resolve, reject) => {
    req.on('upgrade', (res, socket) => {
      // Simple frame reader & sender
      const client = {
        socket,
        messages: [],
        callbacks: [],
        send(obj) {
          const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
          const payload = Buffer.from(str, 'utf8');
          const mask = crypto.randomBytes(4);
          const buf = Buffer.alloc(6 + payload.length);
          buf[0] = 0x81;
          buf[1] = 0x80 | payload.length; // assuming < 126
          mask.copy(buf, 2);
          for (let i = 0; i < payload.length; i++) {
            buf[6 + i] = payload[i] ^ mask[i % 4];
          }
          socket.write(buf);
        },
        waitNextMessage(timeout = 3000) {
          if (client.messages.length > 0) {
            return Promise.resolve(client.messages.shift());
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Timeout waiting for message')), timeout);
            client.callbacks.push(msg => {
              clearTimeout(timer);
              res(msg);
            });
          });
        },
        close() {
          socket.end();
        }
      };

      let buf = Buffer.alloc(0);
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const b1 = buf[1];
          const hasMask = (b1 & 0x80) !== 0;
          let len = b1 & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            offset = 10;
          }
          if (hasMask) offset += 4;
          if (buf.length < offset + len) return;
          const payload = buf.subarray(offset, offset + len);
          buf = buf.subarray(offset + len);
          const text = payload.toString('utf8');
          if (client.callbacks.length > 0) {
            client.callbacks.shift()(text);
          } else {
            client.messages.push(text);
          }
        }
      });

      resolve(client);
    });
    req.on('error', reject);
    req.end();
  });
}

// Helper: Quick WebSocket server for test
function createTestWsServer(port) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const clients = new Set();
  const messages = [];
  const callbacks = [];

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const client = {
      socket,
      send(obj) {
        const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
        const payload = Buffer.from(str, 'utf8');
        const buf = Buffer.alloc(2 + payload.length);
        buf[0] = 0x81;
        buf[1] = payload.length; // assuming < 126
        payload.copy(buf, 2);
        socket.write(buf);
      }
    };
    clients.add(client);

    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b1 = buf[1];
        const hasMask = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let headerLen = 2;

        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          headerLen = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) return;
          payloadLen = Number(buf.readBigUInt64BE(2));
          headerLen = 10;
        }

        if (hasMask) headerLen += 4;
        if (buf.length < headerLen + payloadLen) return;

        let payload = buf.subarray(headerLen, headerLen + payloadLen);
        if (hasMask) {
          const maskKey = buf.subarray(headerLen - 4, headerLen);
          const unmasked = Buffer.alloc(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
          payload = unmasked;
        }

        buf = buf.subarray(headerLen + payloadLen);
        const msg = payload.toString('utf8');
        if (callbacks.length > 0) {
          callbacks.shift()(msg);
        } else {
          messages.push(msg);
        }
      }
    });

    socket.on('close', () => clients.delete(client));
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        clients,
        broadcast(obj) {
          for (const c of clients) c.send(obj);
        },
        waitNextMessage(timeout = 3000) {
          if (messages.length > 0) return Promise.resolve(messages.shift());
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Timeout waiting message on server')), timeout);
            callbacks.push(msg => {
              clearTimeout(timer);
              res(msg);
            });
          });
        },
        close() {
          for (const c of clients) c.socket.end();
          return new Promise(r => server.close(r));
        }
      });
    });
  });
}

async function runTests() {
  console.log('=== Running Token Monitor OneBot Plugin Test Suite ===\n');

  // 1. Verify Manifest
  console.log('[Test 1] Verifying manifest.json compliance...');
  const manifestPath = path.resolve(__dirname, '../onebot-monitor/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.strictEqual(manifest.tmApi, 1, 'tmApi must be 1');
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{1,39}$/, 'id must be lowercase alphanumeric-kebab');
  assert.ok(manifest.version, 'version must exist');
  assert.ok(manifest.files.includes('ui.mjs'), 'files must include ui.mjs');
  assert.ok(manifest.files.includes('backend.cjs'), 'files must include backend.cjs');
  assert.ok(manifest.files.includes('style.css'), 'files must include style.css');
  assert.strictEqual(manifest.background, true, 'background must be true');
  assert.strictEqual(manifest.views.length, 1, 'views should be declared');
  assert.strictEqual(manifest.settings.version, 1, 'settings schema version must be 1');
  const tokenThresholdField = manifest.settings.fields.find(f => f.id === 'tokenAlertThreshold');
  assert.ok(tokenThresholdField, 'tokenAlertThreshold field must exist');
  assert.strictEqual(tokenThresholdField.max, 100000000000, 'tokenAlertThreshold max should be 100 billion');
  const replyFormatField = manifest.settings.fields.find(f => f.id === 'replyFormat');
  assert.ok(replyFormatField, 'replyFormat field must exist');
  assert.strictEqual(replyFormatField.type, 'select');
  console.log('✅ Manifest validation passed (including 100-billion token limit & replyFormat)!\n');

  // 2. Verify .tmplugin package
  console.log('[Test 2] Verifying onebot-monitor.tmplugin package...');
  const pkgPath = path.resolve(__dirname, '../onebot-monitor.tmplugin');
  assert.ok(fs.existsSync(pkgPath), 'tmplugin package file must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.format, 2, 'Package format must be 2');
  assert.strictEqual(pkg.manifest.id, manifest.id);
  assert.ok(pkg.files['ui.mjs'], 'Decoded ui.mjs exists in package');
  assert.ok(pkg.files['backend.cjs'], 'Decoded backend.cjs exists in package');
  assert.ok(pkg.files['style.css'], 'Decoded style.css exists in package');
  console.log('✅ .tmplugin package integrity verified!\n');

  // 3. Test Backend in Reverse WebSocket Server Mode
  console.log('[Test 3] Testing Backend in Reverse WebSocket Server Mode...');
  const testDataDir = path.resolve(__dirname, '../scratch-test-data');
  fs.mkdirSync(testDataDir, { recursive: true });

  const mockSettings = {
    replyFormat: 'text',
    connectionMode: 'reverse',
    serverPort: 18088,
    accessToken: '',
    adminIds: '10001,10002',
    autoDailyReport: true,
    dailyReportTime: '22:00',
    autoAlert: true,
    tokenAlertThreshold: 5000000000,
    costAlertThreshold: 10
  };

  const mockHost = {
    async call(method, args) {
      if (method === 'settings.get') {
        return { values: { ...mockSettings }, revision: 1, schemaVersion: 1 };
      }
      if (method === 'data.query') {
        if (args.resource === 'usage') {
          return {
            availability: 'available',
            freshness: { state: 'fresh' },
            rows: [{
              totalTokens: 250000000,
              cost: { knownUsd: 12.3456, currency: 'USD' },
              requests: 142
            }]
          };
        }
        if (args.resource === 'models') {
          return {
            availability: 'available',
            rows: [
              { model: 'claude-3-7-sonnet', totalTokens: 120000 },
              { model: 'gpt-4o', totalTokens: 68888 }
            ]
          };
        }
        if (args.resource === 'limits') {
          return {
            availability: 'available',
            rows: [
              { provider: 'Anthropic', limit: 1000000, remaining: 811112 }
            ]
          };
        }
      }
      return null;
    }
  };

  const published = [];
  const backendModule = require('../onebot-monitor/backend.cjs');
  const backend = await backendModule.activate({
    dataDirectory: testDataDir,
    host: mockHost,
    publish: val => published.push(val),
    log: msg => console.log('   [Backend Log]', msg)
  });

  // Give server 100ms to bind port
  await new Promise(r => setTimeout(r, 200));

  console.log('   Connecting mock OneBot client to reverse WS port 18088...');
  const client = await createTestWsClient(18088);
  console.log('   Mock client connected!');

  // Send /help command
  console.log('   Sending /help command from admin 10001...');
  client.send({
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    raw_message: '/help'
  });
  let msgReply = await client.waitNextMessage();
  let parsedReply = JSON.parse(msgReply);
  assert.strictEqual(parsedReply.action, 'send_msg');
  assert.ok(parsedReply.params.message.includes('Token Monitor 机器人指令列表'));
  console.log('   ✅ /help response verified!');

  // Send /token command
  console.log('   Sending /token command from admin 10001...');
  client.send({
    post_type: 'message',
    message_type: 'group',
    group_id: 888999,
    user_id: 10001,
    raw_message: '/token'
  });
  msgReply = await client.waitNextMessage();
  parsedReply = JSON.parse(msgReply);
  assert.strictEqual(parsedReply.action, 'send_msg');
  assert.strictEqual(parsedReply.params.group_id, 888999);
  assert.ok(parsedReply.params.message.includes('250,000,000'));
  assert.ok(parsedReply.params.message.includes('2.50 亿'));
  console.log('   ✅ /token response verified (received 250,000,000 tokens / 2.50 亿)!');

  // Test Image output via /token 图
  console.log('   Sending /token 图 command for image output...');
  client.send({
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    raw_message: '/token 图'
  });
  msgReply = await client.waitNextMessage(8000);
  parsedReply = JSON.parse(msgReply);
  assert.strictEqual(parsedReply.action, 'send_msg');
  assert.ok(parsedReply.params.message.includes('[CQ:image,file=base64://') || parsedReply.params.message.includes('250,000,000'), 'Should return image or fallback to text');
  console.log('   ✅ /token 图 response verified!');

  // Test Unauthorized User rejection
  console.log('   Sending /token command from non-admin 99999...');
  client.send({
    post_type: 'message',
    message_type: 'private',
    user_id: 99999,
    raw_message: '/token'
  });
  msgReply = await client.waitNextMessage();
  parsedReply = JSON.parse(msgReply);
  assert.ok(parsedReply.params.message.includes('权限不足'));
  console.log('   ✅ Non-admin permission rejection verified!');

  // Test /sub subscription
  console.log('   Sending /sub command from admin 10001 in group 888999...');
  client.send({
    post_type: 'message',
    message_type: 'group',
    group_id: 888999,
    user_id: 10001,
    raw_message: '/sub'
  });
  msgReply = await client.waitNextMessage();
  parsedReply = JSON.parse(msgReply);
  assert.ok(parsedReply.params.message.includes('订阅成功'));
  console.log('   ✅ Group subscription confirmed!');

  // Test triggerDailyReport through UI call
  console.log('   Calling triggerDailyReport via UI backend.call...');
  const reportRes = await backend.call('triggerDailyReport');
  assert.strictEqual(reportRes.count, 1, 'Should broadcast to 1 subscribed group');
  msgReply = await client.waitNextMessage();
  parsedReply = JSON.parse(msgReply);
  assert.ok(parsedReply.params.message.includes('每日汇总') || parsedReply.params.message.includes('手动推送测试'));
  console.log('   ✅ Daily report broadcast received by subscriber!');

  // Test UI calls
  const subs = await backend.call('getSubscriptions');
  assert.strictEqual(subs.length, 1);
  const status = await backend.call('getStatus');
  assert.strictEqual(status.online, true);
  assert.strictEqual(status.connectedClients, 1);
  console.log('   ✅ UI getStatus and getSubscriptions verified!');

  // Test /unsub
  console.log('   Sending /unsub command...');
  client.send({
    post_type: 'message',
    message_type: 'group',
    group_id: 888999,
    user_id: 10001,
    raw_message: '/unsub'
  });
  msgReply = await client.waitNextMessage();
  parsedReply = JSON.parse(msgReply);
  assert.ok(parsedReply.params.message.includes('已取消订阅'));
  console.log('   ✅ Group unsubscription confirmed!');

  // Close client & backend
  client.close();
  backend.dispose();
  console.log('✅ Reverse WS Server test passed!\n');

  // 4. Test Backend in Forward WebSocket Client Mode
  console.log('[Test 4] Testing Backend in Forward WebSocket Client Mode...');
  const mockServerPort = 19099;
  const mockOneBotServer = await createTestWsServer(mockServerPort);
  console.log(`   Mock OneBot Server listening on port ${mockServerPort}...`);

  mockSettings.connectionMode = 'forward';
  mockSettings.wsUrl = `ws://127.0.0.1:${mockServerPort}`;

  const backendForward = await backendModule.activate({
    dataDirectory: testDataDir,
    host: mockHost,
    publish: val => published.push(val),
    log: msg => console.log('   [Forward Log]', msg)
  });

  // Give 200ms to establish forward connection
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(mockOneBotServer.clients.size, 1, 'Backend should have connected to Mock OneBot Server');
  console.log('   ✅ Forward connection established successfully!');

  // Mock server sends a message to backend
  console.log('   Mock server sending message /status to backend...');
  mockOneBotServer.broadcast({
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    raw_message: '/status'
  });

  const forwardReply = await mockOneBotServer.waitNextMessage();
  const parsedForwardReply = JSON.parse(forwardReply);
  assert.strictEqual(parsedForwardReply.action, 'send_msg');
  assert.ok(parsedForwardReply.params.message.includes('Token Monitor 监控状态'));
  console.log('   ✅ Forward mode reply verified!');

  // Clean up
  backendForward.dispose();
  await mockOneBotServer.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
  console.log('✅ Forward WS Client test passed!\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! The plugin is fully ready for deployment.');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
