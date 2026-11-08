import type { Widget } from './types';
import { colSpanFor, rowSpanFor } from './grid';

interface DragOpts {
  cellEl: HTMLElement;
  gridEl: HTMLElement;
  onReorder(from: number, to: number): void;
}

function cellsOf(gridEl: HTMLElement): HTMLElement[] {
  return Array.from(gridEl.querySelectorAll<HTMLElement>(':scope > .bh-cell'));
}

/** 编辑模式：按住拖柄用指针事件拖拽换位（源卡片半透明 + 落点指示条） */
export function enableDrag({ cellEl, gridEl, onReorder }: DragOpts): void {
  const handle = cellEl.querySelector<HTMLElement>('.bh-drag-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e, cellEl, gridEl, onReorder);
  });
}

function computeTarget(cells: HTMLElement[], source: HTMLElement, x: number, y: number): number {
  const others = cells.filter((c) => c !== source);
  if (!others.length) return cells.indexOf(source);
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  let before = true;
  for (const c of others) {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 纵向距离加权：更容易落在同一行的左右侧
    const d = (cx - x) ** 2 + ((cy - y) * 1.6) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
      before = y < cy ? true : Math.abs(y - cy) <= r.height / 3 ? x < cx : false;
    }
  }
  if (!best) return cells.indexOf(source);
  const idx = cells.indexOf(best);
  return before ? idx : idx + 1;
}

function positionMarker(
  marker: HTMLElement,
  gridEl: HTMLElement,
  cells: HTMLElement[],
  target: number,
): void {
  if (cells.length < 2) {
    marker.style.display = 'none';
    return;
  }
  const before = target < cells.length;
  const ref = before ? cells[target] : cells[cells.length - 1];
  if (!ref) {
    marker.style.display = 'none';
    return;
  }
  const r = ref.getBoundingClientRect();
  const g = gridEl.getBoundingClientRect();
  marker.style.display = 'block';
  marker.style.left = `${(before ? r.left - 8 : r.right + 4) - g.left}px`;
  marker.style.top = `${r.top - g.top}px`;
  marker.style.width = '4px';
  marker.style.height = `${r.height}px`;
}

function startDrag(
  e: PointerEvent,
  cellEl: HTMLElement,
  gridEl: HTMLElement,
  onReorder: (from: number, to: number) => void,
): void {
  const cells = cellsOf(gridEl);
  const from = cells.indexOf(cellEl);
  if (from < 0) return;

  const rect = cellEl.getBoundingClientRect();
  const grabDx = e.clientX - rect.left;
  const grabDy = e.clientY - rect.top;

  const ghost = document.body.createEl('div', { cls: 'bh-ghost' });
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  // 双保险（不依赖样式表）：浮层与克隆卡全部 inline 强约束 + 裁剪，
  // 杜绝长文/图片内容把克隆卡撑出边界
  ghost.style.overflow = 'hidden';
  const card = cellEl.querySelector('.bh-card');
  if (card) {
    const clone = card.cloneNode(true) as HTMLElement;
    clone.style.height = `${rect.height}px`;
    clone.style.maxHeight = `${rect.height}px`;
    clone.style.overflow = 'hidden';
    // 克隆体内部再兜一层：body 也 inline 限高裁剪
    const body = clone.querySelector('.bh-card-body');
    if (body) {
      (body as HTMLElement).style.maxHeight = '100%';
      (body as HTMLElement).style.overflow = 'hidden';
    }
    // 拖动预览中的图片限高（防大图把视觉撑爆，即使被裁也保持构图）
    clone.querySelectorAll('img').forEach((img) => {
      (img as HTMLElement).style.maxHeight = '100px';
      (img as HTMLElement).style.objectFit = 'cover';
    });
    ghost.appendChild(clone);
  }
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;

  const marker = gridEl.createEl('div', { cls: 'bh-marker' });
  cellEl.addClass('bh-drag-source');
  document.body.addClass('bh-dragging-cursor');

  let target = from;
  let cancelled = false;

  const move = (ev: PointerEvent) => {
    ghost.style.left = `${ev.clientX - grabDx}px`;
    ghost.style.top = `${ev.clientY - grabDy}px`;
    target = computeTarget(cells, cellEl, ev.clientX, ev.clientY);
    positionMarker(marker, gridEl, cells, target);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', onKey, true);
    ghost.remove();
    marker.remove();
    cellEl.removeClass('bh-drag-source');
    document.body.removeClass('bh-dragging-cursor');
  };
  const finish = () => {
    cleanup();
    if (!cancelled && target !== from && target !== from + 1) onReorder(from, target);
  };
  const up = () => finish();
  const cancel = () => {
    cancelled = true;
    finish();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      cancelled = true;
      finish();
    }
  };

  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', onKey, true);
  move(e);
}

interface ResizeOpts {
  cellEl: HTMLElement;
  gridEl: HTMLElement;
  widget: Widget;
  getCols(): number;
  onCommit(id: string, patch: { colSpan?: number; rowSpan?: number }): void;
}

/** 编辑模式：右下角角柄拉伸，水平改列跨度、垂直改行跨度，实时预览 */
export function enableResize({ cellEl, gridEl, widget, getCols, onCommit }: ResizeOpts): void {
  const handle = cellEl.querySelector<HTMLElement>('.bh-resize-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const cols = getCols();
    const style = getComputedStyle(gridEl);
    const colWidths = (style.gridTemplateColumns || '').split(/\s+/).map((v) => parseFloat(v) || 0);
    const colW = colWidths.length ? colWidths.reduce((a, b) => a + b, 0) / colWidths.length : 300;
    const rowH = parseFloat(style.gridAutoRows) || 136;
    const gap = parseFloat(style.columnGap || style.gap) || 14;
    const rowUnit = rowH + gap;

    const startX = e.clientX;
    const startY = e.clientY;
    const startCol = colSpanFor(widget, cols);
    const startRow = rowSpanFor(widget);
    let cur = { c: startCol, r: startRow };

    const move = (ev: PointerEvent) => {
      const c = Math.max(1, Math.min(cols, Math.round(startCol + (ev.clientX - startX) / colW)));
      const r = Math.max(2, Math.min(12, Math.round(startRow + (ev.clientY - startY) / rowUnit)));
      if (c !== cur.c || r !== cur.r) {
        cur = { c, r };
        cellEl.style.gridColumn = `span ${Math.min(c, cols)}`;
        cellEl.style.gridRow = `span ${r}`;
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cleanup, true);
    };
    const up = () => {
      cleanup();
      if (cur.c !== startCol || cur.r !== startRow) {
        onCommit(widget.id, { colSpan: cur.c, rowSpan: cur.r });
      }
    };

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cleanup, true);
  });
}
