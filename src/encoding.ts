import { encodingTable } from './encoding-table';

/** Binary k8 v0 decoding. The footer carries UTF-8 for unmapped UTF-16 units. */
export function decodeKurdishText(bytes: Uint8Array): string {
  if (bytes[0] !== 0) throw new Error('Unsupported k8 version');
  const separator = bytes.indexOf(1, 1);
  const body = bytes.subarray(1, separator < 0 ? bytes.length : separator);
  const footer = separator < 0 ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(separator + 1));
  let cursor = 0;
  const units = Array.from(body, (value) => {
    if (value === 0) {
      if (cursor >= footer.length) throw new Error('Missing k8 footer');
      return footer.charCodeAt(cursor++);
    }
    const unit = encodingTable[value];
    if (unit === undefined) throw new Error('Invalid k8 character');
    return unit;
  });
  if (cursor !== footer.length) throw new Error('Invalid k8 footer');
  return units.map(unit => String.fromCharCode(unit)).join('');
}
