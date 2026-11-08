import { App, TFile, prepareFuzzySearch, prepareSimpleSearch } from 'obsidian';

/** 搜索候选（自 vault 文件构建） */
export interface NoteCandidate {
  path: string;
  basename: string;
  extension: string;
  aliases: string[];
  mtime: number;
}

export interface NoteMatch {
  path: string;
  file: TFile;
  title: string;
  folder: string;
  extension: string;
  /** 评分高于文件名的别名（命中别名时展示） */
  alias?: string;
  /** 正文命中的上下文片段（全文搜索命中时展示） */
  snippet?: string;
  score: number;
}

/** 可作为笔记/文档打开的扩展名（非 md 文件交给 Obsidian 自己的查看器） */
export const SEARCHABLE = new Set([
  'md', 'canvas', 'base', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp3', 'm4a', 'mp4', 'epub',
]);

/** frontmatter aliases → 字符串数组 */
function aliasesOf(app: App, file: TFile): string[] {
  if (file.extension !== 'md') return [];
  const raw = app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function buildCandidates(app: App): NoteCandidate[] {
  return app.vault.getFiles().map((file) => ({
    path: file.path,
    basename: file.basename,
    extension: file.extension,
    aliases: aliasesOf(app, file),
    mtime: file.stat.mtime,
  }));
}

/**
 * 文件名/别名/路径匹配：文件名 > 别名 > 路径兜底；
 * 精确名置顶、前缀加分、最近打开加权、md 微调。
 */
function matchNames(app: App, query: string, limit: number): NoteMatch[] {
  const q = query.trim();
  if (!q) return [];
  const fuzzy = prepareFuzzySearch(q);
  const lower = q.toLowerCase();
  const recent: string[] =
    (app.workspace as unknown as { getLastOpenFiles?: () => string[] }).getLastOpenFiles?.() ?? [];
  const recentRank = new Map(recent.map((path, index) => [path, index]));
  const fileByPath = new Map(app.vault.getFiles().map((f) => [f.path, f]));
  const matches: NoteMatch[] = [];

  for (const file of buildCandidates(app)) {
    if (!SEARCHABLE.has(file.extension)) continue;
    let best = -Infinity;
    let alias: string | undefined;
    const name = fuzzy(file.basename);
    if (name) best = name.score + 2;
    for (const candidate of file.aliases) {
      const hit = fuzzy(candidate);
      if (hit && hit.score + 1.5 > best) {
        best = hit.score + 1.5;
        alias = candidate;
      }
    }
    if (best === -Infinity) {
      const path = fuzzy(file.path);
      if (!path) continue;
      best = path.score;
    }
    if (file.basename.toLowerCase() === lower) best += 100;
    else if (file.basename.toLowerCase().startsWith(lower)) best += 1;
    const rank = recentRank.get(file.path);
    if (rank !== undefined) best += Math.max(0, 1 - rank / 20);
    if (file.extension === 'md') best += 0.1;
    const slash = file.path.lastIndexOf('/');
    const real = fileByPath.get(file.path);
    if (!real) continue;
    matches.push({
      path: file.path,
      file: real,
      title: file.basename,
      folder: slash > 0 ? file.path.slice(0, slash) : '',
      extension: file.extension,
      score: best,
      ...(alias && alias !== file.basename ? { alias } : {}),
    });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** 提取命中关键词周围的上下文片段（去掉换行，前后加省略号） */
function makeSnippet(content: string, query: string): string {
  const word = query.trim().split(/\s+/)[0] || '';
  if (!word) return '';
  const idx = content.toLowerCase().indexOf(word.toLowerCase());
  if (idx < 0) return content.slice(0, 80).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + word.length + 80);
  return (
    (start > 0 ? '…' : '') +
    content.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < content.length ? '…' : '')
  );
}

/** 正文全文搜索：遍历 md 文件，cachedRead + 简单子串匹配（分批并行、命中即停） */
async function matchContent(app: App, query: string, limit: number): Promise<NoteMatch[]> {
  const matcher = prepareSimpleSearch(query);
  const files = app.vault.getMarkdownFiles();
  const out: NoteMatch[] = [];
  const BATCH = 40;
  for (let i = 0; i < files.length && out.length < limit; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const hits = await Promise.all(
      batch.map(async (file) => {
        const content = await app.vault.cachedRead(file);
        const hit = matcher(content);
        return hit ? { file, content, score: hit.score } : null;
      }),
    );
    for (const h of hits) {
      if (!h) continue;
      const slash = h.file.path.lastIndexOf('/');
      out.push({
        path: h.file.path,
        file: h.file,
        title: h.file.basename,
        folder: slash > 0 ? h.file.path.slice(0, slash) : '',
        extension: h.file.extension,
        snippet: makeSnippet(h.content, query),
        score: h.score,
      });
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * 合并搜索：文件名/别名命中优先，正文命中补足（带上下文片段）。
 * 文件名命中足够时不触发正文遍历，保证标题搜索的即时性。
 */
export async function rankNotes(
  app: App,
  query: string,
  limit: number,
): Promise<NoteMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const names = matchNames(app, q, limit);
  let content: NoteMatch[] = [];
  if (names.length < limit) {
    content = await matchContent(app, q, limit - names.length);
  }
  const seen = new Set(names.map((n) => n.path));
  const merged = [...names];
  for (const c of content) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    merged.push(c);
  }
  return merged.slice(0, limit);
}

/** 查询词 → 合法笔记文件名 */
export function noteNameFromQuery(query: string): string {
  return query
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** 按扩展名给出 lucide 图标 */
export function iconForExtension(ext: string): string {
  switch (ext) {
    case 'md':
      return 'file-text';
    case 'canvas':
      return 'layout-dashboard';
    case 'base':
      return 'table';
    case 'pdf':
    case 'epub':
      return 'book-open';
    case 'mp3':
    case 'm4a':
      return 'music';
    case 'mp4':
      return 'film';
    default:
      return ext.match(/png|jpe?g|webp|gif|svg/) ? 'image' : 'file';
  }
}
