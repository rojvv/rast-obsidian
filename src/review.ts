import type { Issue } from './protocol';

/** Offsets are UTF-16, matching both the Rast protocol and Obsidian's editor. */
export class Review {
  issues: Issue[] = [];
  constructor(public snapshot: string, readonly start: number, public end: number) {}
  get text(): string { return this.snapshot.slice(this.start, this.end); }
  matches(current: string): boolean { return current === this.snapshot; }

  replace(issue: Issue, replacement: string, current: string): { from: number; to: number; text: string } {
    if (!this.matches(current) || !this.issues.includes(issue)) throw new Error('The note changed. Open a new check before applying suggestions.');
    const from = this.start + issue.offset;
    const to = from + issue.length;
    if (issue.offset < 0 || issue.length <= 0 || to > this.end) throw new Error('Invalid correction range.');
    const delta = replacement.length - issue.length;
    this.snapshot = current.slice(0, from) + replacement + current.slice(to);
    this.end += delta;
    this.issues = this.issues.filter(other => other.offset + other.length <= issue.offset || other.offset >= issue.offset + issue.length)
      .map(other => other.offset >= issue.offset + issue.length ? { ...other, offset: other.offset + delta } : other);
    return { from, to, text: replacement };
  }
}
