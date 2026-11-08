import type { Widget } from './types';

/** 按容器宽度计算网格半列数：每整列约 300px，结果取偶数半列——
 *  奇数半列会让整列宽（span 2/4/6）的卡片排不齐、网格不居中 */
export function computeCols(width: number): number {
  if (width <= 0) return 8;
  const fullCols = Math.max(2, Math.min(6, Math.floor(width / 300)));
  return fullCols * 2;
}

export function colSpanFor(w: Widget, cols: number): number {
  // 半列刻度：1 = 半列（约 150px）
  return Math.max(1, Math.min(w.colSpan || 1, cols));
}

export function rowSpanFor(w: Widget): number {
  // 半行刻度（--bh-row = 69px）：2~12——最小高 1 整行（138px），最高约 6 整行
  return Math.max(2, Math.min(w.rowSpan || 2, 12));
}

export function applyCellLayout(cell: HTMLElement, w: Widget, cols: number): void {
  cell.style.gridColumn = `span ${colSpanFor(w, cols)}`;
  cell.style.gridRow = `span ${rowSpanFor(w)}`;
}
