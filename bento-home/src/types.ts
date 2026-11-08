import type { App, Component, TFile } from 'obsidian';

export const HOME_VIEW_TYPE = 'bento-home';

export type WidgetType = 'note-card' | 'clock' | 'search' | 'daily' | 'recent' | 'todo';

export interface Widget {
  id: string;
  type: WidgetType;
  /** 占据的列数，1..当前网格列数 */
  colSpan: number;
  /** 占据的行数，1..6 */
  rowSpan: number;
  /** note-card 专用：笔记路径 */
  path?: string;
}

export interface HomeSettings {
  openOnStartup: boolean;
  greetingName: string;
  todoNotePath: string;
  /** 待办勾选完成后，自动追加到当天日记的「今日事」小节 */
  todoDoneToDaily: boolean;
  recentCount: number;
}

export interface HomeData {
  version: number;
  /** 数组顺序即网格排布顺序（order + span 模型） */
  widgets: Widget[];
  settings: HomeSettings;
  /** 待办跨天归档已处理到的日期（YYYY-MM-DD）：与今天不同则把线上未完成待办移到历史 */
  lastTodoDay: string;
}

/** 组件实例：由视图持有，负责清理定时器与响应文件变更 */
export interface WidgetInstance {
  destroy(): void;
  onVaultModify?(file: TFile): void;
}

/** 视图提供给组件的卡片操作接口 */
export interface CardUI {
  cardEl: HTMLElement;
  headEl: HTMLElement | null;
  bodyEl: HTMLElement;
  setTitle(text: string): void;
  setIcon(icon: string): void;
  setMeta(text: string): void;
  setMetaEl(el: HTMLElement): void;
  setClickable(v: boolean): void;
  bodyScroll(v: boolean): void;
}

/** 视图提供给组件的宿主环境 */
export interface WidgetHost {
  app: App;
  component: Component;
  editMode(): boolean;
  openFile(file: TFile): void;
  /** 点击置顶卡片：以底部弹窗打开（可预览/编辑/跳转） */
  openSheet(file: TFile): void;
  settings(): HomeSettings;
  refresh(): void;
  /** 待办跨天归档的日期戳（存 data.json） */
  todoDayStamp(): string;
  setTodoDayStamp(day: string): void;
}

export interface WidgetDef {
  type: WidgetType;
  name: string;
  icon: string;
  /** card：带标题栏的卡片；plain：无底色的通透样式（时钟） */
  chrome: 'card' | 'plain';
  defaults: { colSpan: number; rowSpan: number };
  create(host: WidgetHost, widget: Widget, ui: CardUI): WidgetInstance;
}
