import './window';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckController, type Checker } from '../src/check-controller';
import type { Issue } from '../src/protocol';
const issue: Issue = { offset: 0, length: 4, title: 'هەڵە', description: '', replacements: ['ڕاست'] };
function fixture(client: Checker, automatic = false) {
  const state = { text: '🙂 هەڵە', file: 'a.md', active: true, composing: false, automatic, issues: [] as Issue[], messages: [] as string[] };
  const controller = new CheckController({
    text: () => state.text, file: () => state.file, active: () => state.active,
    composing: () => state.composing, automatic: () => state.automatic,
    publish: issues => { state.issues = issues; }, status: message => { state.messages.push(message); },
  }, client, 5);
  return { controller, state };
}
const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));

test('selection results are translated from UTF-16 offsets to document positions', async () => {
  let sent = '';
  const f = fixture({ async *check(text) { sent = text; yield [issue]; } });
  await f.controller.run({ from: 3, to: 7 });
  assert.equal(sent, 'هەڵە');
  assert.equal(f.state.issues[0].offset, 3);
  f.controller.destroy();
});
test('automatic checking is opt-in, debounced, and limited to the active editor', async () => {
  let calls = 0;
  const f = fixture({ async *check() { calls++; yield []; } });
  f.controller.refresh(); await pause(); assert.equal(calls, 0);
  f.state.automatic = true;
  f.controller.refresh(); f.controller.refresh(); f.controller.refresh();
  await pause(); assert.equal(calls, 1);
  f.state.active = false;
  f.controller.refresh(); await pause(); assert.equal(calls, 1);
  f.controller.destroy();
});
test('document edits, file changes, canceled requests and destruction reject late replies', async () => {
  for (const change of ['edit', 'file', 'cancel', 'destroy'] as const) {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ async *check() { await barrier; yield [issue]; } });
    const pending = f.controller.run();
    if (change === 'edit') f.state.text = 'changed';
    if (change === 'file') f.state.file = 'b.md';
    if (change === 'cancel') f.controller.cancel();
    if (change === 'destroy') f.controller.destroy();
    release(); await pending;
    assert.deepEqual(f.state.issues, [], change);
    f.controller.destroy();
  }
});
test('partial results are discarded after a network failure; retry succeeds', async () => {
  let failing = true;
  const f = fixture({ async *check() { yield [issue]; if (failing) throw new Error('Offline'); } });
  await f.controller.run();
  assert.deepEqual(f.state.issues, []);
  assert.equal(f.state.messages.at(-1), 'Offline');
  failing = false;
  await f.controller.run();
  assert.equal(f.state.issues.length, 1);
  f.controller.destroy();
});
test('composition and destroyed editors never start automatic requests', async () => {
  let calls = 0;
  const f = fixture({ async *check() { calls++; yield []; } }, true);
  f.state.composing = true;
  f.controller.refresh(); await pause(); assert.equal(calls, 0);
  f.state.composing = false;
  f.controller.refresh(); f.controller.destroy();
  await pause(); assert.equal(calls, 0);
});
