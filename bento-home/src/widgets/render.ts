import { App, Component, MarkdownRenderer, TFile } from 'obsidian';

interface CacheEntry {
  mtime: number;
  el: HTMLElement;
}

const cache = new Map<string, CacheEntry>();

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? content.slice(m[0].length) : content;
}

/** 截断到段落边界，避免把语法块切一半 */
export function cutForPreview(content: string, maxChars: number): string {
  const s = content.replace(/^\s+/, '');
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const paragraph = cut.lastIndexOf('\n\n');
  const line = cut.lastIndexOf('\n');
  const at = paragraph > maxChars * 0.4 ? paragraph : line > maxChars * 0.4 ? line : maxChars;
  return cut.slice(0, at).trimEnd();
}

/** 内容超出可视高度时才加底部渐隐遮罩（双重 rAF 等布局稳定后判断） */
function applyOverflow(el: HTMLElement): void {
  const check = () => {
    const overflow = el.scrollHeight > el.clientHeight + 2;
    el.toggleClass('is-overflow', overflow);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(check));
}

/**
 * 渲染笔记摘要预览。按 (path, mtime) 缓存渲染结果，
 * 同一篇笔记被多张卡片引用时克隆节点避免互相抢走。
 */
export async function renderNotePreview(
  app: App,
  file: TFile,
  container: HTMLElement,
  component: Component,
  opts: { chars?: number } = {},
): Promise<void> {
  const chars = opts.chars ?? 1200;
  const cached = cache.get(file.path);
  if (cached && cached.mtime === file.stat.mtime) {
    const el = cached.el.isConnected ? (cached.el.cloneNode(true) as HTMLElement) : cached.el;
    container.appendChild(el);
    applyOverflow(el);
    return;
  }

  const raw = await app.vault.cachedRead(file);
  const md = cutForPreview(stripFrontmatter(raw), chars);
  const el = container.createDiv({ cls: 'bh-preview-md' });
  if (md) {
    await MarkdownRenderer.render(app, md, el, file.path, component);
  } else {
    el.createDiv({ cls: 'bh-hint', text: '这篇笔记还没有内容' });
  }
  cache.set(file.path, { mtime: file.stat.mtime, el });
  // 等待读取期间若卡片被重绘，需要重新挂载
  if (!el.isConnected) container.appendChild(el);
  applyOverflow(el);
}
