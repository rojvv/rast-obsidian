export const MAX_TEXT_LENGTH = 0xffff;
export const API_URL = "https://wsbapp-ku.rast.krd/";

export interface Issue {
  offset: number;
  length: number;
  title: string;
  description: string;
  replacements: string[];
}
export function parseDescription(value: string) {
  const match = /\s*\[([^\[\]\r\n]+)\]\s*$/u.exec(value);
  const replacements =
    match?.[1].split("،").map((s) => s.trim()).filter(Boolean) ?? [];
  return {
    description: replacements.length
      ? value.slice(0, match!.index).trimEnd()
      : value,
    replacements,
  };
}

// Match ../app/client/rast_client.ts: each 256-code-point piece owns its
// warnings; up to 128 code points on either side provide context only.
export function* textChunks(text: string) {
  const points = Array.from(text);
  const offsets = [0];
  for (const point of points) offsets.push(offsets.at(-1)! + point.length);
  const boundary = /[\s\p{P}]/u;

  for (let start = 0; start < points.length; start += 256) {
    const end = Math.min(start + 256, points.length);
    let contextStart = Math.max(0, start - 128);
    let contextEnd = Math.min(points.length, end + 128);
    // Avoid introducing partial words at the outer edges of the context.
    while (
      contextStart < start && !boundary.test(points[contextStart - 1] ?? " ")
    ) {
      contextStart++;
    }
    while (contextEnd > end && !boundary.test(points[contextEnd] ?? " ")) {
      contextEnd--;
    }
    yield {
      text: text.slice(offsets[contextStart], offsets[contextEnd]),
      offset: offsets[contextStart],
      start: offsets[start],
      end: offsets[end],
    };
  }
}
