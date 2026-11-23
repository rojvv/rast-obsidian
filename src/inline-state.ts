import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Issue } from './protocol';

export const setIssues = StateEffect.define<readonly Issue[]>();
export const openIssue = StateEffect.define<Issue | null>();
export interface InlineState {
  issues: readonly Issue[];
  selected: Issue | null;
  marks: DecorationSet;
}
export const inlineState = StateField.define<InlineState>({
  create: () => ({ issues: [], selected: null, marks: Decoration.none }),
  update(value, transaction) {
    let issues = transaction.docChanged ? [] : value.issues;
    let selected = transaction.docChanged || transaction.selection ? null : value.selected;
    for (const effect of transaction.effects) {
      if (effect.is(setIssues)) { issues = effect.value; selected = null; }
      if (effect.is(openIssue)) selected = effect.value;
    }
    issues = issues.filter(issue => Number.isInteger(issue.offset) && issue.offset >= 0 && issue.length > 0 &&
      issue.offset + issue.length <= transaction.newDoc.length);
    if (selected && !issues.includes(selected)) selected = null;
    if (issues.length === value.issues.length && issues.every((issue, i) => issue === value.issues[i])) {
      return { ...value, selected };
    }
    return {
      issues, selected,
      marks: Decoration.set(issues.map(issue => Decoration.mark({
        class: 'rast-underline',
        attributes: { 'data-rast-offset': String(issue.offset) },
      }).range(issue.offset, issue.offset + issue.length)), true),
    };
  },
  provide: field => EditorView.decorations.from(field, state => state.marks),
});
