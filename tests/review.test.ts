import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Review } from '../src/review';
import type { Issue } from '../src/protocol';
const issue = (offset: number, length: number): Issue => ({ offset, length, title: '', description: '', replacements: [] });

test('selection corrections preserve surrounding Markdown and rebase following UTF-16 positions', () => {
  const source = '# Title\n🙂 هەڵە هەڵە\n`code`';
  const start = source.indexOf('هەڵە');
  const end = source.indexOf('\n`');
  const review = new Review(source, start, end);
  const first = issue(0, 4);
  review.issues = [first, issue(5, 4)];
  assert.deepEqual(review.replace(first, 'ڕاستە', source), { from: start, to: start + 4, text: 'ڕاستە' });
  assert.equal(review.snapshot, '# Title\n🙂 ڕاستە هەڵە\n`code`');
  assert.equal(review.issues[0].offset, 6);
  review.replace(review.issues[0], 'ڕاست', review.snapshot);
  assert.equal(review.snapshot, '# Title\n🙂 ڕاستە ڕاست\n`code`');
  assert.equal(review.end, end + 1);
});
test('external edits anywhere in the note prevent a stale correction', () => {
  const review = new Review('before word after', 7, 11);
  const target = issue(0, 4);
  review.issues = [target];
  assert.throws(() => review.replace(target, 'new', 'BEFORE word after'), /note changed/);
  assert.equal(review.snapshot, 'before word after');
});
test('a replacement removes overlapping suggestions but retains adjacent ones', () => {
  const review = new Review('abcdefghij', 0, 10);
  const target = issue(2, 4);
  review.issues = [issue(0, 2), issue(1, 2), target, issue(4, 4), issue(6, 4)];
  review.replace(target, 'X', review.snapshot);
  assert.deepEqual(review.issues.map(i => [i.offset, i.length]), [[0, 2], [3, 4]]);
  assert.throws(() => review.replace(target, 'Y', review.snapshot));
});
