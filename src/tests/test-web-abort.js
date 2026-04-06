const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Mock infer module ---
// Replace infer before any module that depends on it (loop.js → infer.js) is loaded.

const inferModulePath = require.resolve('../core/infer');
let inferAborted = false;      // flag: was the mock infer aborted via signal?
let inferRunning = false;      // flag: is the mock infer currently yielding?
let inferResolveHang = null;   // call this to unblock the hanging infer

function installMockInfer() {
  inferAborted = false;
  inferRunning = false;
  inferResolveHang = null;

  require.cache[inferModulePath] = {
    id: inferModulePath,
    filename: inferModulePath,
    loaded: true,
    exports: {
      infer: async function* (_prompt, { signal } = {}) {
        inferRunning = true;
        try {
          // Yield a tool_call so loop doesn't implicitly stop
          yield { type: 'tool_call', id: 'tc_hang', name: 'wait', input: { seconds: 999 } };

          // Now hang — simulate a slow/long response
          await new Promise((resolve) => {
            inferResolveHang = resolve;
            if (signal) {
              signal.addEventListener('abort', () => {
                inferAborted = true;
                resolve();
              }, { once: true });
            }
          });

          // If aborted, stop yielding
          if (inferAborted) return;

          yield { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 } };
        } finally {
          inferRunning = false;
        }
      },
    },
  };

  // Clear cached modules that depend on infer
  delete require.cache[require.resolve('../core/loop')];
  // Clear the web module cache so it picks up the mocked loop → mocked infer
  const webModulePath = require.resolve('../web/index');
  delete require.cache[webModulePath];
  // Also clear agent modules that the web module imports
  try { delete require.cache[require.resolve('../agent/default')]; } catch {}
  try { delete require.cache[require.resolve('../agent/doc')]; } catch {}
}

function cleanupMockInfer() {
  delete require.cache[inferModulePath];
  delete require.cache[require.resolve('../core/loop')];
  try { delete require.cache[require.resolve('../web/index')]; } catch {}
  try { delete require.cache[require.resolve('../agent/default')]; } catch {}
  try { delete require.cache[require.resolve('../agent/doc')]; } catch {}
}

// --- HTTP helpers ---

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitUntil(fn, timeoutMs = 3000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timeout'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// --- Tests ---

describe('web abort', () => {
  let server;
  let port;
  let app, loops;
  const instanceName = '__test_abort_' + Date.now();
  const instancesRoot = path.join(__dirname, '../../instances');
  const instanceDir = path.join(instancesRoot, instanceName);

  before(async () => {
    installMockInfer();

    // Require web module (which will use mocked infer via mocked loop)
    const web = require('../web/index');
    app = web.app;
    loops = web.loops;

    // Start server on random port
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    port = server.address().port;

    // Create instance directory
    fs.mkdirSync(path.join(instanceDir, 'events'), { recursive: true });
  });

  after(async () => {
    // Unblock any hanging infer so loop can exit
    if (inferResolveHang) inferResolveHang();

    // Wait for loops to drain
    await new Promise(resolve => setTimeout(resolve, 200));

    // Close server
    await new Promise(resolve => server.close(resolve));

    // Clean up instance directory
    fs.rmSync(instanceDir, { recursive: true, force: true });

    cleanupMockInfer();
  });

  it('POST /api/events starts loop, DELETE /api/loop aborts it, infer receives abort signal', { timeout: 10000 }, async () => {
    // 1. POST a message — this starts the loop
    const postRes = await request(port, 'POST', `/api/events?instance=${instanceName}`, { content: 'hello' });
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postRes.body.ok, true);

    // 2. Wait until loop is running and infer is active
    await waitUntil(() => loops.has(instanceName) && inferRunning, 3000);
    assert.ok(loops.has(instanceName), 'Loop should be registered in loops Map');
    assert.ok(inferRunning, 'Mock infer should be running');

    // 3. Verify running=true via GET /api/events
    const eventsRes = await request(port, 'GET', `/api/events?instance=${instanceName}`);
    assert.strictEqual(eventsRes.body.running, true);

    // 4. DELETE /api/loop — abort! Should block until loop is fully stopped.
    const delRes = await request(port, 'DELETE', `/api/loop?instance=${instanceName}`);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.ok, true);

    // 5. DELETE awaits loop completion — loops Map should already be empty, no waitUntil needed
    assert.ok(!loops.has(instanceName), 'Loop should already be removed when DELETE returns');

    // 6. Verify infer received the abort signal
    assert.ok(inferAborted, 'Mock infer should have been aborted via signal');
    assert.ok(!inferRunning, 'Mock infer should no longer be running');

    // 7. Verify running=false via GET /api/events immediately
    const eventsRes2 = await request(port, 'GET', `/api/events?instance=${instanceName}`);
    assert.strictEqual(eventsRes2.body.running, false);
  });
});
