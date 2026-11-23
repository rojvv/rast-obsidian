import type { Issue } from './protocol';
import { MAX_TEXT_LENGTH } from './protocol';

export interface CheckPort {
  text(): string;
  file(): unknown;
  active(): boolean;
  composing(): boolean;
  automatic(): boolean;
  publish(issues: Issue[]): void;
  status(message: string, notify: boolean): void;
}
export interface Checker {
  check(text: string, signal: AbortSignal): AsyncIterable<Issue[]>;
}

/** One lifecycle per editor; stale, canceled and switched-file replies never publish. */
export class CheckController {
  private request?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private file: unknown;
  constructor(private port: CheckPort, private client: Checker, private delay = 650) {
    this.file = port.file();
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.request?.abort();
    this.request = undefined;
  }
  refresh(clear = false): void {
    this.cancel();
    const changedFile = this.file !== this.port.file();
    this.file = this.port.file();
    if (clear || changedFile) this.port.publish([]);
    if (this.destroyed || !this.port.active() || !this.port.automatic()) return;
    this.timer = setTimeout(() => { void this.run(); }, this.delay);
  }
  async run(range?: { from: number; to: number }, notify = false): Promise<void> {
    this.cancel();
    if (this.destroyed || !this.port.active() || this.port.composing()) return;
    const snapshot = this.port.text();
    const file = this.port.file();
    const from = range?.from ?? 0;
    const to = range?.to ?? snapshot.length;
    const text = snapshot.slice(from, to);
    this.port.publish([]);
    if (!text.trim()) { this.port.status('No text to check', notify); return; }
    if (text.length > MAX_TEXT_LENGTH) {
      this.port.status('Select a shorter passage (maximum 65,535 UTF-16 units)', notify);
      return;
    }
    const request = this.request = new AbortController();
    const valid = () => !this.destroyed && !request.signal.aborted && this.request === request &&
      this.port.active() && this.port.file() === file && this.port.text() === snapshot;
    this.port.status('Checking…', false);
    try {
      const issues: Issue[] = [];
      for await (const batch of this.client.check(text, request.signal)) {
        if (!valid()) return;
        issues.push(...batch.map(issue => ({ ...issue, offset: issue.offset + from })));
      }
      if (!valid()) return;
      this.port.publish(issues);
      this.port.status(issues.length ? `${issues.length} suggestion${issues.length === 1 ? '' : 's'} · hover or tap an underline` : 'No issues found', notify);
    } catch (error) {
      if (!valid()) return;
      this.port.status(error instanceof Error ? error.message : 'Could not check text. Try again.', notify);
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
  destroy(): void { this.destroyed = true; this.cancel(); }
}
