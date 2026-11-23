import { Prec, StateField, Transaction, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, hoverTooltip, keymap, showTooltip, type Tooltip, type ViewUpdate } from '@codemirror/view';
import { CheckController, type Checker } from './check-controller';
import { inlineState, openIssue, setIssues } from './inline-state';
import type { Issue } from './protocol';
import { Review } from './review';

export interface InlineHost {
  client: Checker;
  automatic(): boolean;
  active(view: EditorView): boolean;
  file(view: EditorView): unknown;
  status(view: EditorView, message: string, notify: boolean): void;
  controllers: Map<EditorView, CheckController>;
}

function dismiss(view: EditorView): void {
  view.dispatch({ effects: openIssue.of(null) });
}

export function applySuggestion(view: EditorView, issue: Issue, replacement: string): boolean {
  const state = view.state.field(inlineState);
  if (!state.issues.includes(issue) || view.state.readOnly) return false;
  const review = new Review(view.state.doc.toString(), 0, view.state.doc.length);
  review.issues = [...state.issues];
  const change = review.replace(issue, replacement, review.snapshot);
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.text },
    effects: setIssues.of(review.issues),
    annotations: Transaction.userEvent.of('input.rast'),
  });
  view.focus();
  return true;
}

function suggestionTooltip(issue: Issue, focus = false): Tooltip {
  return {
    pos: issue.offset,
    end: issue.offset + issue.length,
    above: true,
    arrow: false,
    create(view) {
      const document = view.dom.ownerDocument;
      const dom = document.createElement('div');
      dom.className = 'rast-tooltip';
      dom.dir = 'auto';
      dom.setAttribute('role', 'dialog');
      dom.setAttribute('aria-label', 'ڕاست: Suggestions');
      const header = dom.appendChild(document.createElement('div'));
      header.className = 'rast-tooltip-header';
      const brand = header.appendChild(document.createElement('span'));
      brand.className = 'rast-tooltip-brand';
      brand.textContent = 'ڕاست';
      const close = header.appendChild(document.createElement('button'));
      close.className = 'rast-tooltip-close';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close suggestions');
      close.addEventListener('click', () => { dismiss(view); view.focus(); });
      const heading = dom.appendChild(document.createElement('div'));
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '3');
      heading.className = 'rast-tooltip-title';
      heading.textContent = issue.title || 'ڕاست';
      if (issue.description) {
        const description = dom.appendChild(document.createElement('p'));
        description.className = 'rast-tooltip-description';
        description.textContent = issue.description;
      }
      const choices = dom.appendChild(document.createElement('div'));
      choices.className = 'rast-replacements';
      for (const replacement of issue.replacements) {
        const button = choices.appendChild(document.createElement('button'));
        button.className = 'rast-replacement';
        button.textContent = replacement;
        button.dir = 'auto';
        button.setAttribute('aria-label', `Replace with ${replacement}`);
        button.addEventListener('click', () => applySuggestion(view, issue, replacement));
      }
      const footer = dom.appendChild(document.createElement('div'));
      footer.className = 'rast-tooltip-footer';
      const ignore = footer.appendChild(document.createElement('button'));
      ignore.textContent = 'Ignore';
      ignore.className = 'rast-ignore';
      ignore.addEventListener('click', () => {
        const current = view.state.field(inlineState).issues;
        if (!current.includes(issue)) return;
        view.dispatch({ effects: setIssues.of(current.filter(other => other !== issue)) });
        view.focus();
      });
      dom.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(view); view.focus(); }
      });
      // Keep mouse presses in the popup from moving the editor selection.
      dom.addEventListener('mousedown', event => event.stopPropagation());
      return { dom, mount: () => { if (focus) (dom.querySelector<HTMLButtonElement>('.rast-replacement') ?? ignore).focus(); } };
    },
  };
}

const pinnedTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    const selected = transaction.state.field(inlineState).selected;
    if (!selected) return null;
    return transaction.effects.some(effect => effect.is(openIssue)) ? suggestionTooltip(selected, true) : value;
  },
  provide: field => showTooltip.from(field),
});

export function showNextSuggestion(view: EditorView): boolean {
  const issues = view.state.field(inlineState).issues;
  if (!issues.length) return false;
  const pos = view.state.selection.main.head;
  const issue = issues.find(issue => issue.offset + issue.length > pos) ?? issues[0];
  view.dispatch({ effects: [openIssue.of(issue), EditorView.scrollIntoView(issue.offset)] });
  return true;
}

export function inlineExtension(host: InlineHost): Extension {
  const lifecycle = ViewPlugin.fromClass(class {
    controller: CheckController;
    private visibility = () => this.controller.refresh();
    constructor(readonly view: EditorView) {
      this.controller = new CheckController({
        text: () => view.state.doc.toString(),
        file: () => host.file(view),
        active: () => host.active(view) && view.dom.ownerDocument.visibilityState !== 'hidden',
        composing: () => view.composing,
        automatic: () => host.automatic(),
        publish: issues => view.dispatch({ effects: setIssues.of(issues) }),
        status: (message, notify) => host.status(view, message, notify),
      }, host.client);
      host.controllers.set(view, this.controller);
      view.dom.ownerDocument.addEventListener('visibilitychange', this.visibility);
      queueMicrotask(() => { if (host.controllers.has(view)) this.controller.refresh(); });
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.controller.cancel();
        // Dispatching during a CodeMirror update is forbidden; schedule after it.
        queueMicrotask(() => {
          if (host.controllers.has(this.view)) {
            this.controller.refresh();
            host.status(this.view, host.automatic() ? 'Waiting to check…' : 'Text changed · check again to refresh', false);
          }
        });
      }
    }
    destroy(): void { this.view.dom.ownerDocument.removeEventListener('visibilitychange', this.visibility); this.controller.destroy(); host.controllers.delete(this.view); }
  }, { eventHandlers: {
    compositionstart() { this.controller.cancel(); },
    compositionend() { this.controller.refresh(); },
  } });
  return [
    inlineState, pinnedTooltip, lifecycle,
    hoverTooltip((view, position, side) => {
      const state = view.state.field(inlineState);
      if (state.selected) return null;
      const issue = state.issues.find(issue => position >= issue.offset && position <= issue.offset + issue.length &&
        !(position === issue.offset && side < 0) && !(position === issue.offset + issue.length && side > 0));
      return issue ? suggestionTooltip(issue) : null;
    }, { hoverTime: 250, hideOnChange: true,
      hideOn: transaction => transaction.effects.some(effect => effect.is(setIssues) || effect.is(openIssue)) }),
    EditorView.domEventHandlers({
      click(event, view) {
        const target = event.target as Element | null;
        const mark = target?.closest?.('.rast-underline');
        if (!mark) {
          if (view.state.field(inlineState).selected) dismiss(view);
          return false;
        }
        const offset = Number(mark.getAttribute('data-rast-offset'));
        const issue = view.state.field(inlineState).issues.find(issue => issue.offset === offset);
        if (!issue) return false;
        view.dispatch({ effects: openIssue.of(issue) });
        return true;
      },
    }),
    Prec.high(keymap.of([{ key: 'Escape', run: view => {
      const open = view.state.field(inlineState).selected !== null;
      dismiss(view);
      return open;
    } }])),
  ];
}
