import type { WidgetType } from '../types';
import type { WidgetDef } from '../types';
import { noteCardDef } from './NoteCard';
import { clockDef } from './ClockGreeting';
import { searchDef } from './Search';
import { dailyDef } from './Daily';
import { recentDef } from './Recent';
import { todoDef } from './Todo';

export const widgetRegistry: Record<WidgetType, WidgetDef> = {
  'note-card': noteCardDef,
  clock: clockDef,
  search: searchDef,
  daily: dailyDef,
  recent: recentDef,
  todo: todoDef,
};

export interface CatalogEntry {
  type: WidgetType;
  name: string;
  icon: string;
  desc: string;
}

/** 「添加卡片」弹窗里的目录顺序（搜索、时钟已固定顶部，不再作为可添加卡片） */
export const widgetCatalog: CatalogEntry[] = [
  { type: 'note-card', name: '笔记卡片', icon: 'file-text', desc: '置顶一篇常用笔记，显示摘要预览' },
  { type: 'todo', name: '待办清单', icon: 'list-checks', desc: '在主页勾选、添加待办（读写指定笔记）' },
  { type: 'daily', name: '每日笔记', icon: 'calendar-check', desc: '打开或创建今天的 Daily Note' },
  { type: 'recent', name: '最近编辑', icon: 'history', desc: '显示最近编辑过的笔记' },
];
