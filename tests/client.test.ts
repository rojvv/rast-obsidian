import './window';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RastClient, waitFor } from '../src/client';

class Socket {
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  closed = false;
  sent: string[] = [];
  mode: 'normal' | 'wrong-id' | 'stall' | 'bad-offset' = 'normal';
  constructor(open = true) { if (open) queueMicrotask(() => this.onopen?.()); }
  close(): void { this.closed = true; this.onclose?.(); }
  send(request: Uint8Array): void {
    const text = new TextDecoder().decode(request.subarray(16));
    this.sent.push(text);
    if (this.mode === 'stall') return;
    const matches = [...text.matchAll(/دەستپێ دەکات/gu)];
    const response = new Uint8Array(20 + matches.length * 3);
    response.set(request.subarray(0, 16));
    if (this.mode === 'wrong-id') response[0] ^= 255;
    const view = new DataView(response.buffer);
    view.setUint16(16, matches.length);
    for (const [i, match] of matches.entries()) {
      view.setUint16(20 + i * 3, this.mode === 'bad-offset' ? 65000 : match.index);
      view.setUint8(22 + i * 3, match[0].length);
    }
    queueMicrotask(() => this.onmessage?.({ data: response.buffer }));
  }
}
function setup(options: { saved?: string; status?: number; socket?: Socket } = {}) {
  let saved = options.saved ?? '';
  const requests: { url: string; method: string }[] = [];
  let socket: Socket;
  const client = new RastClient({ get: () => saved, set: async id => { saved = id; } }, async (url, method) => {
    requests.push({ url, method });
    return { status: method === 'GET' ? options.status ?? 200 : 200, text: 'fresh-session' };
  }, () => { socket = options.socket ?? new Socket(); return socket as unknown as WebSocket; });
  return { client, requests, get socket() { return socket!; }, get saved() { return saved; } };
}
async function collect(client: RastClient, text: string, signal = new AbortController().signal) {
  const issues = [];
  for await (const batch of client.check(text, signal)) issues.push(...batch);
  return issues;
}

test('binary requests use overlapping context and emit each issue exactly once at source offsets', async () => {
  const f = setup();
  const text = '🙂 '.repeat(127) + 'دەستپێ دەکات ' + 'word '.repeat(230) + 'دەستپێ دەکات';
  const issues = await collect(f.client, text);
  assert.deepEqual(issues.map(i => i.offset), [...text.matchAll(/دەستپێ دەکات/gu)].map(m => m.index));
  assert.equal(f.socket.sent.length, Math.ceil(Array.from(text).length / 256));
  assert.ok(f.socket.closed);
  assert.equal(f.saved, 'fresh-session');
});
test('expired sessions are recreated; server errors do not silently create a new session', async () => {
  const expired = setup({ saved: 'old', status: 404 });
  await collect(expired.client, 'دەق');
  assert.deepEqual(expired.requests.map(r => r.method), ['GET', 'POST']);
  const broken = setup({ saved: 'old', status: 503 });
  await assert.rejects(collect(broken.client, 'دەق'), /validate/);
  assert.equal(broken.requests.length, 1);
});
test('cancel during socket opening closes connection promptly', async () => {
  const socket = new Socket(false);
  const f = setup({ socket });
  const controller = new AbortController();
  const pending = collect(f.client, 'دەق', controller.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(socket.closed);
});
test('cancel while awaiting a reply stops processing and closes socket', async () => {
  const f = setup();
  const controller = new AbortController();
  // Set mode after construction, before opening runs.
  const originalSend = Socket.prototype.send;
  Socket.prototype.send = function() { controller.abort(); };
  try {
    await assert.rejects(collect(f.client, 'دەق', controller.signal));
    assert.ok(f.socket.closed);
  } finally { Socket.prototype.send = originalSend; }
});
test('invalid correlation IDs and ranges reject the check', async () => {
  for (const mode of ['wrong-id', 'bad-offset'] as const) {
    const originalSend = Socket.prototype.send;
    Socket.prototype.send = function(request) { this.mode = mode; originalSend.call(this, request); };
    try {
      const f = setup();
      await assert.rejects(collect(f.client, 'دەستپێ دەکات'), /Invalid/);
      assert.ok(f.socket.closed);
    } finally { Socket.prototype.send = originalSend; }
  }
});
test('empty, oversized and already canceled checks do not contact service', async () => {
  const f = setup();
  assert.deepEqual(await collect(f.client, '  '), []);
  await assert.rejects(collect(f.client, 'ک'.repeat(65536)), /shorter/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collect(f.client, 'دەق', controller.signal), { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
});
test('native HTTP waits have bounded timeout and cancellation', async () => {
  await assert.rejects(waitFor(new Promise(() => {}), new AbortController().signal, 5), /timed out/);
  const controller = new AbortController();
  const pending = waitFor(new Promise(() => {}), controller.signal, 10000);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('HTTP waits normalize non-Error rejections and preserve existing Errors', async () => {
  const signal = new AbortController().signal;
  for (const reason of ['Offline', null, { status: 503 }]) {
    await assert.rejects(waitFor(Promise.reject(reason), signal, 100), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.cause, reason);
      if (typeof reason === 'string') assert.equal(error.message, reason);
      return true;
    });
  }
  const original = new Error('Offline');
  await assert.rejects(waitFor(Promise.reject(original), signal, 100), error => error === original);
});
