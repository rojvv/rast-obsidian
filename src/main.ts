import { MarkdownView, Notice, Plugin, PluginSettingTab, Setting, editorInfoField, requestUrl, type Editor } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { RastClient } from './client';
import { inlineExtension, showNextSuggestion } from './inline';
import { openIssue, setIssues } from './inline-state';
import type { CheckController } from './check-controller';

export default class RastPlugin extends Plugin {
  client!: RastClient;
  controllers = new Map<EditorView, CheckController>();
  automatic = false;
  private sessionId = '';
  private statusEl!: HTMLElement;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (saved && typeof saved === 'object') {
      if ('sessionId' in saved && typeof saved.sessionId === 'string') this.sessionId = saved.sessionId;
      if ('automatic' in saved) this.automatic = saved.automatic === true;
    }
    this.client = new RastClient({
      get: () => this.sessionId,
      set: async id => { this.sessionId = id; await this.persist(); },
    }, async (url, method) => {
      const response = await requestUrl({ url, method, throw: false });
      return { status: response.status, text: response.text };
    });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText('ڕاست: Ready');
    this.registerEditorExtension(inlineExtension({
      client: this.client,
      controllers: this.controllers,
      automatic: () => this.automatic,
      active: view => this.isActive(view),
      file: view => view.state.field(editorInfoField, false)?.file,
      status: (view, message, notify) => {
        if (!this.isActive(view)) return;
        this.statusEl.setText(`ڕاست: ${message}`);
        if (notify) new Notice(`ڕاست: ${message}`);
      },
    }));
    this.addSettingTab(new RastSettings(this));
    this.addCommand({ id: 'check-note', name: 'Check current note', editorCallback: editor => this.check(editor, false) });
    this.addCommand({ id: 'check-selection', name: 'Check selected text', editorCheckCallback: (checking, editor) => {
      if (!editor.somethingSelected()) return false;
      if (!checking) this.check(editor, true);
      return true;
    } });
    this.addCommand({ id: 'show-suggestions', name: 'Show suggestions at cursor or next issue', editorCallback: editor => {
      const view = this.findView(editor);
      if (!view || !showNextSuggestion(view)) new Notice('ڕاست: No suggestions. Check this note first.');
    } });
    this.addCommand({ id: 'clear-suggestions', name: 'Cancel check and clear suggestions', callback: () => {
      for (const [view, controller] of this.controllers) {
        controller.cancel();
        view.dispatch({ effects: setIssues.of([]) });
      }
      this.statusEl.setText('ڕاست: Cleared');
    } });
    this.addRibbonIcon('spell-check', 'ڕاست: Check Kurdish text', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== 'source') { new Notice('Open a Markdown note in editing mode to use ڕاست.'); return; }
      this.check(view.editor, view.editor.somethingSelected());
    });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      menu.addItem(item => item.setTitle('ڕاست: Check Kurdish text').setIcon('spell-check')
        .onClick(() => this.check(editor, editor.somethingSelected())));
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
    this.registerDomEvent(document, 'visibilitychange', () => this.refresh());
  }

  private isActive(view: EditorView): boolean {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const info = view.state.field(editorInfoField, false);
    return !!active && active.getMode() === 'source' && info?.editor === active.editor && !!info.file;
  }
  private findView(editor: Editor): EditorView | undefined {
    return [...this.controllers.keys()].find(view => view.state.field(editorInfoField, false)?.editor === editor);
  }
  private check(editor: Editor, selection: boolean): void {
    const view = this.findView(editor);
    if (!view) { new Notice('ڕاست: Open this note in Live Preview or Source mode.'); return; }
    if (selection && editor.listSelections().length !== 1) { new Notice('Select one continuous passage to check.'); return; }
    const range = selection ? { from: editor.posToOffset(editor.getCursor('from')), to: editor.posToOffset(editor.getCursor('to')) } : undefined;
    void this.controllers.get(view)?.run(range, true);
  }
  refresh(clear = false): void {
    for (const [view, controller] of this.controllers) {
      view.dispatch({ effects: openIssue.of(null) });
      controller.refresh(clear);
    }
    this.statusEl.setText(this.automatic ? 'ڕاست: Automatic checking on' : 'ڕاست: Ready');
  }
  async setAutomatic(enabled: boolean): Promise<void> {
    this.automatic = enabled;
    await this.persist();
    this.refresh(true);
  }
  private persist(): Promise<void> { return this.saveData({ sessionId: this.sessionId, automatic: this.automatic }); }
  onunload(): void {
    for (const controller of this.controllers.values()) controller.destroy();
    this.controllers.clear();
  }
}

class RastSettings extends PluginSettingTab {
  constructor(private plugin: RastPlugin) { super(plugin.app, plugin); }
  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl('p', { text: 'ڕاست checks Kurdish text using wsbapp-ku.rast.krd. Running a check sends the current note or selection, including Markdown, properties, and code in that range. Suggestions appear as underlines; hover or tap to review them.' });
    new Setting(this.containerEl)
      .setName('Check automatically while typing')
      .setDesc('Send the active note to Rast after a 650 ms typing pause and when switching notes. Requires internet. Off by default; manual commands send text only when invoked.')
      .addToggle(toggle => toggle.setValue(this.plugin.automatic).onChange(async enabled => { await this.plugin.setAutomatic(enabled); }));
    this.containerEl.createEl('p', { text: 'Keyboard users: run “Show suggestions at cursor or next issue” to focus the popup. Escape closes it. Replacements support normal Undo. The plugin saves only this setting and a service session ID.' });
  }
}
