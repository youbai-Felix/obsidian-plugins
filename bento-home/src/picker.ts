import { App, FuzzySuggestModal, TFile, setIcon } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import type BentoHomePlugin from './main';
import { newWidgetId } from './store';
import { widgetCatalog, widgetRegistry } from './widgets';
import type { CatalogEntry } from './widgets';

/** 第一步：选择组件类型 */
export class AddWidgetModal extends FuzzySuggestModal<CatalogEntry> {
  constructor(app: App, private plugin: BentoHomePlugin) {
    super(app);
    this.setPlaceholder('选择要添加到主页的组件…');
  }

  getItems(): CatalogEntry[] {
    return widgetCatalog;
  }

  getItemText(item: CatalogEntry): string {
    return item.name;
  }

  renderSuggestion(item: FuzzyMatch<CatalogEntry>, el: HTMLElement): void {
    el.empty();
    const entry = item.item;
    const row = el.createDiv({ cls: 'bh-suggest-row' });
    setIcon(row.createSpan({ cls: 'bh-suggest-icon' }), entry.icon);
    const main = row.createDiv({ cls: 'bh-suggest-main' });
    main.createDiv({ cls: 'bh-suggest-name', text: entry.name });
    main.createDiv({ cls: 'bh-suggest-desc', text: entry.desc });
  }

  onChooseItem(item: CatalogEntry): void {
    if (item.type === 'note-card') {
      new NotePickerModal(this.app, this.plugin).open();
      return;
    }
    const def = widgetRegistry[item.type];
    this.plugin.store.addWidget({
      id: newWidgetId(),
      type: item.type,
      colSpan: def.defaults.colSpan,
      rowSpan: def.defaults.rowSpan,
    });
  }
}

/** 第二步（笔记卡片）：模糊搜索选择笔记 */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: BentoHomePlugin) {
    super(app);
    this.setPlaceholder('搜索要置顶到主页的笔记…');
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement): void {
    el.empty();
    const file = item.item;
    el.createDiv({ cls: 'bh-suggest-name', text: file.basename });
    el.createDiv({ cls: 'bh-suggest-desc', text: file.parent?.path ?? '/' });
  }

  onChooseItem(file: TFile): void {
    this.plugin.addNoteToHome(file.path);
  }
}
