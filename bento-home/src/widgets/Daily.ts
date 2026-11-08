import { TFile, moment } from 'obsidian';
import { getDailyNote, getDailyNoteInfo, getOrCreateDailyNote } from '../dailyNote';
import { renderNotePreview } from './render';
import type { WidgetDef, WidgetHost, WidgetInstance } from '../types';

export const dailyDef: WidgetDef = {
  type: 'daily',
  name: '每日笔记',
  icon: 'calendar-check',
  chrome: 'card',
  defaults: { colSpan: 2, rowSpan: 2 },
  create(host: WidgetHost, _widget, ui): WidgetInstance {
    let busy = false;

    const render = () => {
      ui.bodyEl.empty();
      ui.setTitle(`今日笔记 · ${moment().format('M月D日')}`);
      ui.setIcon('calendar-check');

      const info = getDailyNoteInfo(host.app);
      const file = getDailyNote(host.app);
      const chip = createSpan({ cls: `bh-chip${file ? ' is-ready' : ''}` });
      chip.setText(file ? '已创建' : '待创建');
      ui.setMetaEl(chip);
      ui.setClickable(!host.editMode());

      if (file instanceof TFile) {
        void renderNotePreview(host.app, file, ui.bodyEl, host.component, { chars: 500 });
      }
      void info;
    };

    render();

    if (!host.editMode()) {
      ui.cardEl.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        try {
          const file = await getOrCreateDailyNote(host.app);
          host.openSheet(file); // 底部弹窗预览 + 编辑
        } catch (err) {
          console.error('[bento-home] 打开每日笔记失败：', err);
        } finally {
          busy = false;
        }
      });
    }

    return {
      onVaultModify(file: TFile) {
        if (file.path === getDailyNoteInfo(host.app).path) render();
      },
      destroy() {},
    };
  },
};
