import { TFile, moment, setIcon } from 'obsidian';
import type { CardUI, Widget, WidgetDef, WidgetHost, WidgetInstance } from '../types';
import { rowSpanFor } from '../grid';
import { renderNotePreview } from './render';

function basename(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

export const noteCardDef: WidgetDef = {
  type: 'note-card',
  name: '笔记卡片',
  icon: 'file-text',
  chrome: 'card',
  defaults: { colSpan: 2, rowSpan: 4 },
  create(host: WidgetHost, widget: Widget, ui: CardUI): WidgetInstance {
    const render = () => {
      ui.bodyEl.empty();
      ui.bodyEl.removeClass('is-missing');
      const path = widget.path ?? '';
      ui.setTitle(basename(path) || '未指定笔记');
      ui.setIcon('file-text');

      const file = host.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        ui.setMeta('未找到文件');
        ui.setClickable(false);
        ui.bodyEl.addClass('is-missing');
        ui.bodyEl.createDiv({
          cls: 'bh-missing',
          text: '文件不存在或已被移动，可在编辑模式下删除此卡片',
        });
        return;
      }

      ui.setMeta(moment(file.stat.mtime).fromNow());
      ui.setClickable(!host.editMode());
      // 摘要预览：矮卡（半行刻度 <4，即不到 2 整行）显示简短预览，高卡显示完整摘要
      const span = rowSpanFor(widget);
      void renderNotePreview(host.app, file, ui.bodyEl, host.component, {
        chars: span >= 4 ? 1200 : 260,
      });
    };

    render();

    if (!host.editMode()) {
      ui.cardEl.addEventListener('click', () => {
        const file = host.app.vault.getAbstractFileByPath(widget.path ?? '');
        // minttr 式交互：点卡片弹底部弹窗（可编辑/可跳转），不直接跳转
        if (file instanceof TFile) host.openSheet(file);
      });
    }

    return {
      onVaultModify(file: TFile) {
        if (file.path === widget.path) render();
      },
      destroy() {},
    };
  },
};

export function setNoteIcon(el: HTMLElement, file: TFile): void {
  // 预留：将来按 frontmatter / 扩展名换图标，目前统一文件图标
  setIcon(el, 'file-text');
  void file;
}
