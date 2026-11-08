import { App, TFile, setIcon } from 'obsidian';
import { ensureFolders } from '../dailyNote';
import type { WidgetDef, WidgetHost, WidgetInstance } from '../types';
import { iconForExtension, noteNameFromQuery, rankNotes } from '../searchCore';

/** 依照 vault 的“新文件默认位置”设置计算落点，并避免重名 */
export async function createNewNote(app: App, title: string): Promise<TFile> {
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  const base = noteNameFromQuery(title) || '未命名';

  let folderPath = '';
  const loc = vault.getConfig?.('newFileLocation');
  if (loc === 'folder') {
    const configured = vault.getConfig?.('newFileFolderPath');
    folderPath = typeof configured === 'string' ? configured : '';
  } else if (loc === 'current') {
    folderPath = app.workspace.getActiveFile()?.parent?.path ?? '';
  }

  let name = base;
  let path = folderPath ? `${folderPath}/${name}.md` : `${name}.md`;
  let n = 1;
  while (app.vault.getAbstractFileByPath(path)) {
    n += 1;
    name = `${base} ${n}`;
    path = folderPath ? `${folderPath}/${name}.md` : `${name}.md`;
  }

  if (folderPath) await ensureFolders(app, folderPath);
  return app.vault.create(path, '');
}

const MAX_RESULTS = 14;

export const searchDef: WidgetDef = {
  type: 'search',
  name: '搜索',
  icon: 'search',
  chrome: 'plain',
  defaults: { colSpan: 2, rowSpan: 1 },
  create(host: WidgetHost, _widget, ui): WidgetInstance {
    const wrap = ui.bodyEl.createDiv({ cls: 'bh-search' });

    // minttr 式搜索框：胶囊 + 左侧图标 + 右侧新建（固定尺寸，见 styles.css）
    const field = wrap.createDiv({ cls: 'bh-search-field' });
    const iconEl = field.createSpan({ cls: 'bh-search-field-icon' });
    setIcon(iconEl, 'search');
    const inputEl = field.createEl('input', {
      type: 'text',
      cls: 'bh-search-input',
      attr: { placeholder: '搜索笔记：标题、正文或别名…', spellcheck: 'false' },
    });
    const newBtn = field.createEl('button', {
      cls: 'bh-search-new',
      attr: { 'aria-label': '新建笔记（按输入内容命名）' },
    });
    setIcon(newBtn, 'plus');
    // 结果浮层挂在搜索条内部（field 为定位锚点），从条下方贴着弹出
    const listEl = field.createDiv({ cls: 'bh-search-list' });

    type Row =
      | { kind: 'file'; file: TFile; alias?: string; ext: string; snippet?: string }
      | { kind: 'create'; title: string };
    let rows: Row[] = [];
    let selected = 0;
    let searchSeq = 0; // 异步竞态守卫：只采用最后一次请求的结果

    const highlight = () => {
      listEl.querySelectorAll('.bh-row').forEach((el, i) => el.toggleClass('is-active', i === selected));
    };

    const runSearch = async () => {
      const seq = ++searchSeq;
      const q = inputEl.value.trim();
      listEl.empty();
      selected = 0;
      if (!q) {
        rows = [];
        return;
      }
      const matches = await rankNotes(host.app, q, MAX_RESULTS);
      if (seq !== searchSeq) return; // 过期结果，丢弃
      rows = matches.map((m) => ({
        kind: 'file' as const,
        file: m.file,
        alias: m.alias,
        ext: m.extension,
        snippet: m.snippet,
      }));
      // 搜索即创建：结果之后固定跟随一条“新建”
      rows.push({ kind: 'create', title: noteNameFromQuery(q) });

      rows.forEach((row, i) => {
        if (row.kind === 'create') {
          const el = listEl.createDiv({ cls: 'bh-row bh-row-create' });
          const icon = el.createSpan({ cls: 'bh-row-icon' });
          setIcon(icon, 'plus');
          el.createSpan({ cls: 'bh-row-title' }).setText(`新建笔记「${row.title}」`);
          el.createSpan({ cls: 'bh-row-path' }).setText('回车创建');
          el.addEventListener('click', () => void createAndOpen(row.title));
          return;
        }
        const el = listEl.createDiv({ cls: 'bh-row' });
        const icon = el.createSpan({ cls: 'bh-row-icon' });
        setIcon(icon, iconForExtension(row.ext));
        const titleBox = el.createSpan({ cls: 'bh-row-title' });
        titleBox.setText(row.file.basename);
        if (row.alias) {
          el.createSpan({ cls: 'bh-row-alias' }).setText(`别名：${row.alias}`);
        } else if (row.snippet) {
          // 正文命中：展示上下文片段（全文搜索）
          el.createSpan({ cls: 'bh-row-snippet' }).setText(row.snippet);
        } else {
          el.createSpan({ cls: 'bh-row-path' }).setText(row.file.parent?.path ?? '/');
        }
        if (row.ext !== 'md') {
          const chip = el.createSpan({ cls: 'bh-row-ext' });
          chip.setText(row.ext.toUpperCase());
        }
        el.addEventListener('click', () => host.openFile(row.file));
        el.addEventListener('pointerenter', () => {
          selected = i;
          highlight();
        });
      });
      highlight();
    };

    const createAndOpen = async (title: string) => {
      try {
        const file = await createNewNote(host.app, title);
        host.openFile(file);
      } catch (err) {
        console.error('[bento-home] 新建笔记失败：', err);
      }
    };

    const activate = () => {
      const row = rows[selected];
      if (!row) return;
      if (row.kind === 'create') void createAndOpen(row.title);
      else host.openFile(row.file);
    };

    let searchTimer = 0;
    inputEl.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(runSearch, 120);
    });
    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (rows.length) {
          selected = (selected + 1) % rows.length;
          highlight();
        }
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (rows.length) {
          selected = (selected - 1 + rows.length) % rows.length;
          highlight();
        }
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        activate();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        inputEl.value = '';
        runSearch();
        inputEl.blur();
      }
    });

    newBtn.addEventListener('click', async () => {
      const title = inputEl.value.trim();
      await createAndOpen(title || '未命名');
    });

    return { destroy() {} };
  },
};
