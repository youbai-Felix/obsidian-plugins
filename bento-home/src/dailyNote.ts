import { App, TFile, moment, normalizePath } from 'obsidian';

export interface DailyNoteInfo {
  folder: string;
  format: string;
  template: string;
  path: string;
}

/** 读取 daily-notes 核心插件配置（无第三方依赖，读不到时用安全默认值） */
export function getDailyNoteInfo(app: App): DailyNoteInfo {
  const plugin = (app as unknown as {
    internalPlugins?: { getPluginById?: (id: string) => { instance?: { options?: Record<string, unknown> } } | undefined };
  }).internalPlugins?.getPluginById?.('daily-notes');
  const options = plugin?.instance?.options ?? {};
  const folder = typeof options.folder === 'string' ? options.folder : '';
  const format = typeof options.format === 'string' ? options.format : 'YYYY-MM-DD';
  const template = typeof options.template === 'string' ? options.template : '';
  const name = moment().format(format);
  let path = normalizePath(folder ? `${folder}/${name}` : name);
  // daily-notes 核心插件内部会补 .md；不补的话会创建无扩展名文件，Obsidian 将其当纯文本打开
  if (!path.endsWith('.md')) path += '.md';
  return { folder, format, template, path };
}

export function getDailyNote(app: App): TFile | null {
  const info = getDailyNoteInfo(app);
  const file = app.vault.getAbstractFileByPath(info.path);
  return file instanceof TFile ? file : null;
}

export async function getOrCreateDailyNote(app: App): Promise<TFile> {
  const existing = getDailyNote(app);
  if (existing) return existing;

  const info = getDailyNoteInfo(app);
  const dir = info.path.includes('/') ? info.path.slice(0, info.path.lastIndexOf('/')) : '';
  if (dir) await ensureFolders(app, dir);

  let content = '';
  if (info.template) {
    const tpl = app.vault.getAbstractFileByPath(normalizePath(info.template));
    if (tpl instanceof TFile) {
      const raw = await app.vault.read(tpl);
      content = raw
        .replace(/{{\s*date\s*}}/g, moment().format('YYYY-MM-DD'))
        .replace(/{{\s*time\s*}}/g, moment().format('HH:mm'))
        .replace(/{{\s*title\s*}}/g, moment().format(info.format));
    }
  }
  try {
    return await app.vault.create(info.path, content);
  } catch (err) {
    // 重启后索引未就绪等瞬态情况下 getDailyNote 可能漏查 → create 撞"已存在"，再查一次兜底
    const again = getDailyNote(app);
    if (again) return again;
    throw err;
  }
}

/** 「今日事」小节标题行：- **今日事**： */
const TODAY_SECTION_RE = /^\s*[-*+]\s+\*\*今日事\*\*/;
/** 小节子项（缩进列表行）；仅缩进+列表符 = 模板留下的空占位 */
const SUB_ITEM_RE = /^(\s*)[-*+]\s+/;
const EMPTY_SUB_RE = /^\s*[-*+]\s*$/;

/**
 * 把一条已完成待办追加到当天日记的「今日事」小节末尾：
 * - 小节不存在 → 文件末尾追加顶级列表项兜底
 * - 小节末尾是模板空占位子项 → 原地填入文本，不留空行
 * - 小节内已有同文本子项 → 跳过（反复勾选不重复写入）
 * 子项缩进跟随小节内第一个子项（日记模板为 tab），默认 \t。
 */
export async function appendTaskToDailyNote(app: App, text: string): Promise<void> {
  const file = await getOrCreateDailyNote(app);
  const insert = (s: string): string => {
    const lines = s.split('\n');
    const sec = lines.findIndex((l) => TODAY_SECTION_RE.test(l));
    if (sec < 0) {
      const base = s.replace(/\n+$/, '');
      return `${base}\n- ${text}\n`;
    }
    // 小节范围：标题行下方连续的缩进行（子项/续行），遇顶级行或空行止
    let end = sec + 1;
    while (end < lines.length && /^\s/.test(lines[end])) end++;
    const norm = (l: string) =>
      l
        .replace(/^\s*[-*+]\s*(\[[ xX]\]\s*)?/, '')
        .replace(/\s*==[^=]*==\s*$/, '')
        .trim();
    for (let i = sec + 1; i < end; i++) {
      if (norm(lines[i]) === text.trim()) return s;
    }
    const first = lines[sec + 1] ?? '';
    const m = first.match(SUB_ITEM_RE);
    const indent = m && m[1] ? m[1] : '\t';
    if (end - 1 > sec && EMPTY_SUB_RE.test(lines[end - 1])) {
      lines[end - 1] = `${indent}- ${text}`;
      return lines.join('\n');
    }
    lines.splice(end, 0, `${indent}- ${text}`);
    return lines.join('\n');
  };
  // 瞬态失败（重启后索引未就绪、并发写入等）重试一次
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await app.vault.process(file, insert);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr;
}

/** 逐级创建文件夹，已存在则跳过 */
export async function ensureFolders(app: App, folderPath: string): Promise<void> {
  if (!folderPath) return;
  let cur = '';
  for (const part of folderPath.split('/')) {
    cur = cur ? `${cur}/${part}` : part;
    if (app.vault.getAbstractFileByPath(cur)) continue;
    try {
      await app.vault.createFolder(cur);
    } catch {
      // 并发或已存在，忽略
    }
  }
}
