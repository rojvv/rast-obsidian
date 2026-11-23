import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { inlineExtension, applySuggestion, showNextSuggestion, type InlineHost } from '../src/inline';
import { inlineState, setIssues } from '../src/inline-state';
import type { Issue } from '../src/protocol';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const win = dom.window;
for (const key of ['window', 'document', 'MutationObserver', 'HTMLElement', 'Node', 'Window', 'getComputedStyle'] as const) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? win : win[key], configurable: true });
}
Object.defineProperty(globalThis, 'requestAnimationFrame', { value: win.requestAnimationFrame.bind(win), configurable: true });
Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: win.cancelAnimationFrame.bind(win), configurable: true });
// jsdom has no layout engine; provide deterministic editor geometry.
const rect = { x: 0, y: 0, left: 0, right: 200, top: 0, bottom: 20, width: 200, height: 20, toJSON: () => ({}) };
win.Range.prototype.getBoundingClientRect = () => rect;
win.Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
after(() => win.close());
const issue = (offset: number): Issue => ({ offset, length: 4, title: 'هەڵە', description: 'دەق', replacements: ['ڕاستە'] });
function editor(text = '🙂 هەڵە هەڵە') {
  const host: InlineHost = {
    client: { async *check() { yield []; } }, automatic: () => false, active: () => true, file: () => 'a.md',
    status: () => {}, controllers: new Map(),
  };
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [history(), inlineExtension(host)] }) });
  return { view, host };
}

test('underlines do not mutate Markdown and disappear immediately on an unrelated edit', () => {
  const { view } = editor();
  try {
    const original = view.state.doc.toString();
    view.dispatch({ effects: setIssues.of([issue(3), issue(8)]) });
    assert.equal(view.dom.querySelectorAll('.rast-underline').length, 2);
    assert.equal(view.state.doc.toString(), original);
    view.dispatch({ changes: { from: 0, insert: '#' } });
    assert.equal(view.dom.querySelectorAll('.rast-underline').length, 0);
  } finally { view.destroy(); }
});
test('inline replacement rebases remaining issues, rejects stale buttons and supports native undo/redo', () => {
  const { view } = editor();
  try {
    const first = issue(3);
    view.dispatch({ effects: setIssues.of([first, issue(8)]) });
    assert.equal(applySuggestion(view, first, 'ڕاستە'), true);
    assert.equal(view.state.doc.toString(), '🙂 ڕاستە هەڵە');
    assert.equal(view.state.field(inlineState).issues[0].offset, 9);
    assert.equal(applySuggestion(view, first, 'bad'), false);
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), '🙂 هەڵە هەڵە');
    assert.equal(view.state.field(inlineState).issues.length, 0);
    assert.equal(redo(view), true);
    assert.equal(view.state.doc.toString(), '🙂 ڕاستە هەڵە');
  } finally { view.destroy(); }
});
test('tap/click opens a popup and choosing a replacement updates the editor', () => {
  const { view } = editor();
  try {
    view.dispatch({ effects: setIssues.of([issue(3)]) });
    view.dom.querySelector('.rast-underline')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const popup = view.dom.querySelector('.rast-tooltip');
    assert.ok(popup);
    assert.ok(popup.textContent?.includes('دەق'));
    popup.querySelector<HTMLButtonElement>('.rast-replacement')!.click();
    assert.equal(view.state.doc.toString(), '🙂 ڕاستە هەڵە');
    assert.equal(view.dom.querySelector('.rast-tooltip'), null);
  } finally { view.destroy(); }
});
test('keyboard command focuses suggestions; Ignore preserves document; destroy cleans lifecycle', () => {
  const { view, host } = editor();
  const original = view.state.doc.toString();
  view.dispatch({ effects: setIssues.of([issue(3)]) });
  assert.equal(showNextSuggestion(view), true);
  const popup = view.dom.querySelector('.rast-tooltip')!;
  assert.ok(popup.contains(document.activeElement));
  const ignore = [...popup.querySelectorAll('button')].find(button => button.textContent === 'Ignore')!;
  ignore.click();
  assert.equal(view.state.doc.toString(), original);
  assert.equal(view.state.field(inlineState).issues.length, 0);
  view.destroy();
  assert.equal(host.controllers.size, 0);
});

test('hover shows suggestions without moving focus, and an edit closes the popup', async () => {
  const { view } = editor();
  try {
    view.dispatch({ effects: setIssues.of([issue(3)]) });
    view.posAtCoords = () => 4;
    view.coordsAtPos = () => rect;
    view.dom.querySelector('.rast-underline')!.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    await new Promise(resolve => setTimeout(resolve, 300));
    const popup = view.dom.querySelector('.rast-tooltip');
    assert.ok(popup);
    assert.equal(popup.contains(document.activeElement), false);
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    assert.equal(view.dom.querySelector('.rast-tooltip'), null);
  } finally { view.destroy(); }
});
