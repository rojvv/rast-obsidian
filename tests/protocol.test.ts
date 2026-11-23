import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorDecoder } from '../src/decoder';
import { decodeKurdishText } from '../src/encoding';
import { encodingTable } from '../src/encoding-table';
import { parseDescription, textChunks } from '../src/protocol';

function encode(text: string): number[] {
  const footer: string[] = [];
  const body = text.split('').map(char => {
    const index = encodingTable.indexOf(char.charCodeAt(0));
    if (index < 0) { footer.push(char); return 0; }
    return index;
  });
  return [0, ...body, ...(footer.length ? [1, ...new TextEncoder().encode(footer.join(''))] : [])];
}
function packet(cached = false): Uint8Array {
  return new Uint8Array([0, 1, 0, 1, 0, 3, 4, cached ? 1 : 0, cached ? 2 : 0, 0, 1,
    ...(cached ? [] : [...encode('هەڵە'), 2, ...encode('دەق [ڕاست، دروست]'), 2]), 0, 0]);
}
test('service descriptions extract Kurdish suggestions only at the end', () => {
  assert.deepEqual(parseDescription('دەق [ڕاست، دروست]'), { description: 'دەق', replacements: ['ڕاست', 'دروست'] });
  assert.deepEqual(parseDescription('[دەق] تاقیکردنەوە'), { description: '[دەق] تاقیکردنەوە', replacements: [] });
});
test('chunk ownership covers source exactly, preserving emoji and overlapping sentence context', () => {
  const text = '🙂 '.repeat(127) + 'دەستپێ دەکات، کە ' + 'word '.repeat(230);
  const chunks = [...textChunks(text)];
  assert.equal(chunks.map(c => text.slice(c.start, c.end)).join(''), text);
  assert.equal(chunks[0].end, 383);
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk.text).length <= 512);
    assert.equal(/[\uD800-\uDFFF]/u.test(chunk.text), false);
    assert.equal(text.slice(chunk.offset, chunk.offset + chunk.text.length), chunk.text);
  }
  assert.ok(chunks[0].text.includes('دەستپێ دەکات، کە'));
  assert.ok(chunks[1].text.includes('دەستپێ دەکات، کە'));
});
test('binary decoder preserves dictionary across replies and supports subarray frames', () => {
  const decoder = new ErrorDecoder();
  const bytes = new Uint8Array(16 + packet().length);
  bytes.set(packet(), 16);
  const expected = [{ offset: 3, length: 4, title: 'هەڵە', description: 'دەق', replacements: ['ڕاست', 'دروست'] }];
  assert.deepEqual(decoder.decode(bytes.subarray(16)), expected);
  assert.deepEqual(decoder.decode(packet(true)), expected);
});
test('malformed frames fail closed', () => {
  assert.throws(() => new ErrorDecoder().decode(packet(true)));
  assert.throws(() => new ErrorDecoder().decode(packet().slice(0, -3)));
  assert.throws(() => new ErrorDecoder().decode(new Uint8Array([0, 1])));
});
test('k8 compatibility footer preserves unmapped characters and supplementary Unicode', () => {
  const text = 'ڕاست 🙂 日本語';
  assert.equal(decodeKurdishText(new Uint8Array(encode(text))), text);
  assert.throws(() => decodeKurdishText(new Uint8Array([0, 0])));
  assert.throws(() => decodeKurdishText(new Uint8Array([3, 4])));
});
