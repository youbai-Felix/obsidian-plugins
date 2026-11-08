import { TFile, moment, normalizePath } from 'obsidian';
import type { WidgetDef, WidgetHost, WidgetInstance } from '../types';

export const recentDef: WidgetDef = {
  type: 'recent',
  name: '最近编辑',
  icon: 'history',
  chrome: 'card',
  defaults: { colSpan: 2, rowSpan: 4 },
  create(host: WidgetHost, _widget, ui): WidgetInstance {
    ui.setTitle('最近编辑');
    ui.setIcon('history');
    // 不开 bodyScroll：让滚轮事件穿透给主页，鼠标放卡片上也能滚动页面

    let visible = 0; // 当前渲染条数，随卡片高度变化

    const render = () => {
      const body = ui.bodyEl;
      body.empty();
      // 忽略待办卡片关联的笔记（勾选/添加待办会频繁修改它，霸占最近编辑）
      const todoPath = normalizePath(host.settings().todoNotePath.trim()).replace(/^\//, '');
      const files = host.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path !== todoPath)
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, visible);

      for (const file of files) {
        const row = body.createDiv({ cls: 'bh-row' });
        row.createSpan({ cls: 'bh-row-title' }).setText(file.basename);
        row.createSpan({ cls: 'bh-row-time' }).setText(moment(file.stat.mtime).fromNow());
        row.addEventListener('click', (ev) => {
          // 按住 Cmd/Ctrl 点击 → 底部预览弹层（与笔记卡默认行为一致），不跳转
          if (ev.metaKey || ev.ctrlKey) host.openSheet(file);
          else host.openFile(file);
        });
      }
      if (!files.length) {
        body.createDiv({ cls: 'bh-hint', text: '仓库里还没有笔记' });
      }
    };

    // 根据卡片 body 高度自动决定显示条数，刚好填满不溢出（滚轮交给主页滚动）
    const measure = () => {
      const h = ui.bodyEl.clientHeight;
      if (h <= 0) return;
      const max = Math.max(3, Math.min(40, host.settings().recentCount));
      const next = Math.max(2, Math.min(max, Math.floor(h / 32)));
      if (next !== visible) {
        visible = next;
        render();
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(ui.bodyEl);
    measure();

    return {
      onVaultModify() {
        render();
      },
      destroy() {
        ro.disconnect();
      },
    };
  },
};
