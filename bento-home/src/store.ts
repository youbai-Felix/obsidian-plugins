import type BentoHomePlugin from './main';
import type { HomeData, HomeSettings, Widget } from './types';

export const DEFAULT_SETTINGS: HomeSettings = {
  openOnStartup: true,
  greetingName: '',
  todoNotePath: 'ToDo List.md',
  todoDoneToDaily: true,
  recentCount: 40,
};

function defaultWidgets(): Widget[] {
  // 双半刻度：colSpan 半列（~150px），rowSpan 半行（69px，最小 2 = 1 整行）
  return [
    { id: 'seed-daily', type: 'daily', colSpan: 2, rowSpan: 2 },
    { id: 'seed-recent', type: 'recent', colSpan: 2, rowSpan: 4 },
    { id: 'seed-todo', type: 'todo', colSpan: 4, rowSpan: 4 },
  ];
}

export function newWidgetId(): string {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 主页配置：读写插件 data.json，防抖持久化，变更时通知视图重绘 */
export class HomeStore {
  data: HomeData;
  private saveTimer: number | null = null;
  private listeners = new Set<() => void>();

  constructor(private plugin: BentoHomePlugin) {
    this.data = {
      version: 1,
      widgets: defaultWidgets(),
      settings: { ...DEFAULT_SETTINGS },
      lastTodoDay: '',
    };
  }

  async load(): Promise<void> {
    try {
      const raw = (await this.plugin.loadData()) as Partial<HomeData> | null;
      if (!raw || typeof raw !== 'object') return;
      let widgets = Array.isArray(raw.widgets)
        ? raw.widgets.filter(
            (w): w is Widget =>
              !!w &&
              typeof w.id === 'string' &&
              typeof w.type === 'string' &&
              typeof w.colSpan === 'number' &&
              w.type !== 'search' && // 搜索栏已固定顶部
              w.type !== 'clock', // 时钟已固定顶部，历史卡片一律丢弃
          )
        : defaultWidgets();
      // v1 → v2：行刻度从整行(138px)改为半行(69px)，旧行高 ×2
      const version = typeof raw.version === 'number' ? raw.version : 1;
      if (version < 2) {
        widgets = widgets.map((w) => ({ ...w, rowSpan: (w.rowSpan || 1) * 2 }));
      }
      // v2 → v3：列刻度从整列(~300px)改为半列(~150px)，旧列宽 ×2
      if (version < 3) {
        widgets = widgets.map((w) => ({ ...w, colSpan: (w.colSpan || 1) * 2 }));
      }
      this.data = {
        version: 3,
        widgets,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        lastTodoDay: typeof raw.lastTodoDay === 'string' ? raw.lastTodoDay : '',
      };
    } catch (err) {
      console.error('[bento-home] 读取配置失败：', err);
    }
  }

  mutate(fn: (data: HomeData) => void): void {
    fn(this.data);
    this.scheduleSave();
    this.emit();
  }

  updateSettings(patch: Partial<HomeSettings>): void {
    this.mutate((d) => {
      d.settings = { ...d.settings, ...patch };
    });
  }

  addWidget(w: Widget): void {
    this.mutate((d) => {
      d.widgets.push(w);
    });
  }

  removeWidget(id: string): void {
    this.mutate((d) => {
      d.widgets = d.widgets.filter((w) => w.id !== id);
    });
  }

  /** to 为“当前数组语义”的插入位置（源仍占位时），内部换算为移除后的下标 */
  moveWidget(from: number, to: number): void {
    if (from === to || from === to - 1) return;
    this.mutate((d) => {
      const [w] = d.widgets.splice(from, 1);
      if (w) d.widgets.splice(to > from ? to - 1 : to, 0, w);
    });
  }

  patchWidget(id: string, patch: Partial<Widget>): void {
    this.mutate((d) => {
      const w = d.widgets.find((x) => x.id === id);
      if (w) Object.assign(w, patch);
    });
  }

  hasNote(path: string): boolean {
    return this.data.widgets.some((w) => w.type === 'note-card' && w.path === path);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb();
      } catch (err) {
        console.error('[bento-home] 视图刷新回调出错：', err);
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveData(this.data);
    }, 250);
  }
}
