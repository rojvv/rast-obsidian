import { decodeKurdishText } from "./encoding";
import { type Issue, parseDescription } from "./protocol";

/** Rast's binary error-list protocol, shared with ../app/elist.
 * The description dictionary belongs to a WebSocket, including canceled replies.
 */
export class ErrorDecoder {
  private dictionary: string[] = [];

  decode(bytes: Uint8Array): Issue[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 0;
    const byte = () => view.getUint8(cursor++);
    const short = () => {
      const value = view.getUint16(cursor);
      cursor += 2;
      return value;
    };
    const count = short();
    const detailCount = short();
    const issues: Issue[] = Array.from({ length: count }, () => ({
      offset: short(),
      length: byte(),
      title: "",
      description: "",
      replacements: [],
    }));
    const headers = Array.from({ length: detailCount }, () => ({
      title: byte(),
      description: byte(),
      count: short(),
    }));
    const readText = (key: number): string => {
      if (key) {
        const cached = this.dictionary[key - 1];
        if (cached === undefined) throw new Error("Invalid error dictionary");
        return cached;
      }
      const end = bytes.indexOf(2, cursor);
      if (end < cursor) throw new Error("Unterminated error text");
      const text = decodeKurdishText(bytes.subarray(cursor, end));
      cursor = end + 1;
      if (!this.dictionary.includes(text)) {
        if (this.dictionary.length > 127) this.dictionary.shift();
        this.dictionary.push(text);
      }
      return text;
    };
    for (const header of headers) {
      const title = readText(header.title);
      const detail = parseDescription(readText(header.description));
      for (let i = 0; i < header.count; ++i) {
        const issue = issues[short()];
        if (!issue) throw new Error("Invalid error index");
        Object.assign(issue, { title, ...detail });
      }
    }
    return issues;
  }
}
