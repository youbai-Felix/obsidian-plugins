/**
 * 把 Obsidian MarkdownRenderer 渲染出的 HTML 还原成 Markdown。
 * 用于 contenteditable 所见即所得编辑后保存。
 * 覆盖常见元素：标题、段落、粗体/斜体/删除/高亮、列表（含任务）、引用、
 * 代码、链接（外部/内部/标签）、图片、分隔线、callout。
 */

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function inlineText(el: Element): string {
  let out = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? '';
    else if (isElement(child)) out += inline(child);
  });
  return out;
}

function inline(el: Element): string {
  const tag = el.tagName;
  switch (tag) {
    case 'STRONG':
    case 'B':
      return `**${inlineText(el)}**`;
    case 'EM':
    case 'I':
      return `*${inlineText(el)}*`;
    case 'DEL':
    case 'S':
      return `~~${inlineText(el)}~~`;
    case 'MARK':
      return `==${inlineText(el)}==`;
    case 'CODE':
      return `\`${el.textContent ?? ''}\``;
    case 'BR':
      return '\n';
    case 'SPAN':
      // Obsidian 内嵌图片/媒体：SPAN.internal-embed 的 src 属性就是 wiki 链接目标
      if (el.classList.contains('internal-embed')) {
        const src = el.getAttribute('src') ?? '';
        if (src) {
          const img = el.querySelector('img');
          if (img) {
            // 恢复尺寸参数：Obsidian 渲染 |宽格式的嵌入时 img 有 width/ style
            const w = img.getAttribute('width') ?? img.style?.width?.replace(/[^\\d]/g, '') ?? '';
            const n = parseInt(w, 10);
            return n > 0 ? `![[${src}|${n}]]` : `![[${src}]]`;
          }
          return `![[${src}]]`; // 非图片内嵌（PDF 等也是 embed 格式）
        }
      }
      return inlineText(el);
    case 'A':
      return anchor(el);
    case 'IMG':
      return image(el);
    default:
      return inlineText(el);
  }
}

function anchor(el: Element): string {
  const text = inlineText(el).trim();
  const href = el.getAttribute('href') ?? '';
  // 内部链接 [[...]]
  if (el.classList.contains('internal-link')) {
    const target = el.getAttribute('data-href') || href;
    const name = decodeURIComponent(target.split('#')[0]);
    return `[[${name}]]`;
  }
  // 标签 #tag
  if (el.classList.contains('tag')) {
    return `#${href.replace(/^#/, '')}`;
  }
  if (!href) return text;
  if (href === text) return text; // 裸链接
  return `[${text}](${href})`;
}

function image(el: Element): string {
  const src = el.getAttribute('src') ?? '';
  const alt = el.getAttribute('alt') ?? '';
  if (src.startsWith('app://') || src.startsWith('vault')) {
    // 剥 query 参数（Obsidian 的 app:// URL 带 ?时间戳）
    const clean = src.split('?')[0];
    const name = decodeURIComponent(clean.split('/').pop() ?? '');
    return `![[${name}]]`;
  }
  return `![${alt}](${src})`;
}

function listItemContent(li: Element, indent: number): string {
  let text = '';
  let nested = '';
  li.childNodes.forEach((child) => {
    if (isElement(child) && child.tagName === 'INPUT' && (child as HTMLInputElement).type === 'checkbox') {
      return;
    }
    // sheet 注入的「拿回今天」按钮是 UI 不是内容，还原时跳过
    if (isElement(child) && child.classList.contains('bh-sheet-act')) {
      return;
    }
    if (isElement(child) && (child.tagName === 'UL' || child.tagName === 'OL')) {
      // 嵌套列表：递归并缩进 4 空格（与 Obsidian 默认一致）
      nested += list(child, indent + 4);
      return;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
      return;
    }
    if (isElement(child)) {
      text += inline(child);
    }
  });
  // list() 的返回以换行结尾；只去尾部换行（不能 trim 头部——会吃掉嵌套首行的缩进），
  // 避免外层再拼 \n 时产生空行打断列表
  const nestedText = nested.replace(/\n+$/, '');
  return text.trim() + (nestedText ? '\n' + nestedText : '');
}

function list(el: Element, indent = 0): string {
  const pad = ' '.repeat(indent);
  const ordered = el.tagName === 'OL';
  let out = '';
  let i = 1;
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'LI') continue;
    const isTask = child.classList.contains('task-list-item');
    const box = child.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
    const content = listItemContent(child, indent);
    const marker = isTask ? (box?.checked ? '- [x]' : '- [ ]') : ordered ? `${i}.` : '-';
    out += `${pad}${marker} ${content}\n`;
    i++;
  }
  return out;
}

function quote(el: Element): string {
  const inner = blocks(el).trim();
  const lines = inner.split('\n').map((l) => `> ${l}`).join('\n');
  return lines;
}

function codeBlock(el: Element): string {
  const lang = el.getAttribute('data-language') || '';
  const code = el.textContent ?? '';
  // 空代码块还原成紧凑的 ```\n```（与常见原文一致，避免中间多出空行）
  const bodyText = code === '' ? '' : `\n${code}`;
  return `\`\`\`${lang}${bodyText}\n\`\`\``;
}

function callout(el: Element): string {
  const type = el.getAttribute('data-callout') || 'note';
  const title = el.querySelector('.callout-title-inner')?.textContent?.trim() ?? '';
  const contentEl = el.querySelector('.callout-content');
  let out = `> [!${type}]${title ? ` ${title}` : ''}`;
  if (contentEl) {
    const inner = blocks(contentEl).trim();
    out += '\n' + inner.split('\n').map((l) => `> ${l}`).join('\n');
  }
  return out;
}

type BlockKind = 'para' | 'list' | 'code' | 'heading' | 'quote' | 'hr' | 'raw';

interface BlockOut {
  kind: BlockKind;
  /** 块的 Markdown 文本，不含尾空行；块间分隔由 blocks() 统一决定 */
  text: string;
}

/** 这些块可以直接中断列表，无需空行分隔（紧凑写出，保持与原文一致） */
function canFollowListTightly(kind: BlockKind): boolean {
  return kind === 'code' || kind === 'heading' || kind === 'hr';
}

function block(el: Element): BlockOut | null {
  const tag = el.tagName;
  switch (tag) {
    case 'H1':
      return { kind: 'heading', text: `# ${inlineText(el)}` };
    case 'H2':
      return { kind: 'heading', text: `## ${inlineText(el)}` };
    case 'H3':
      return { kind: 'heading', text: `### ${inlineText(el)}` };
    case 'H4':
      return { kind: 'heading', text: `#### ${inlineText(el)}` };
    case 'H5':
      return { kind: 'heading', text: `##### ${inlineText(el)}` };
    case 'H6':
      return { kind: 'heading', text: `###### ${inlineText(el)}` };
    case 'P':
      // 去掉段末尾随换行：contenteditable 光标停在段末时 Chromium 会补一个
      // 不可见的占位 <br>，它与真实换行无法从 DOM 区分，按换行还原会多出空行。
      // 段中的 <br>（真实换行/空行）不受影响。
      return { kind: 'para', text: inlineText(el).replace(/\n+$/, '').trimEnd() };
    case 'UL':
    case 'OL':
      return { kind: 'list', text: list(el).replace(/\n+$/, '') };
    case 'BLOCKQUOTE':
      return { kind: 'quote', text: quote(el) };
    case 'PRE':
      return { kind: 'code', text: codeBlock(el) };
    case 'HR':
      return { kind: 'hr', text: '---' };
    case 'DIV':
      if (el.classList.contains('callout')) {
        return { kind: 'quote', text: callout(el) };
      }
      return { kind: 'raw', text: blocks(el).trim() };
    default:
      // 未知容器：递归处理子块，保守按空行分隔
      return { kind: 'raw', text: blocks(el).trim() };
  }
}

function blocks(el: Element): string {
  const parts: BlockOut[] = [];
  for (const child of Array.from(el.children)) {
    const out = block(child);
    if (out && out.text.trim()) parts.push(out);
  }
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const prev = parts[i - 1];
      const cur = parts[i];
      // 列表后跟代码块/标题/分隔线：单换行紧凑；其余（如列表后跟段落，
      // 段落会被视为列表延续）保持空行分隔
      result += prev.kind === 'list' && canFollowListTightly(cur.kind) ? '\n' : '\n\n';
    }
    result += parts[i].text;
  }
  return result;
}

/** 入口：渲染容器 → Markdown 文本 */
export function htmlToMarkdown(root: Element): string {
  return blocks(root).trim() + '\n';
}

/**
 * 行级三方合并：渲染还原（next）会丢失原文的尾随空格、tab 缩进等"空白风格"
 * （HTML 渲染时行尾空白即被丢弃）。此函数把 next 与原文 base 逐行对齐：
 * 内容等价（忽略 tab/4空格差异与行尾空白）的行保留 base 原文，
 * 仅真正变化的行采用 next——未编辑的部分保持字节级不动。
 */
export function mergePreservingOriginal(base: string, next: string): string {
  const A = base.split('\n');
  const B = next.split('\n');
  const normA = A.map(normLine);
  const normB = B.map(normLine);
  const n = A.length;
  const m = B.length;

  // LCS 长度表（倒序 DP；笔记行数规模下 O(n·m) 足够）
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        normA[i] === normB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (normA[i] === normB[j]) {
      out.push(A[i]); // 等价：保留原文（含尾空格/tab）
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++; // 原文行被删除
    } else {
      out.push(B[j]); // 新增/改写行
      j++;
    }
  }
  while (j < m) {
    out.push(B[j]);
    j++;
  }
  return out.join('\n');
}

function normLine(line: string): string {
  return line.replace(/\t/g, '    ').trimEnd();
}

/** LCS 对齐：a[i] 匹配到 b 的行号（未匹配为 null，保序） */
function lcsAlign(a: string[], b: string[]): (number | null)[] {
  const n = a.length;
  const m = b.length;
  const na = a.map(normLine);
  const nb = b.map(normLine);
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const map: (number | null)[] = new Array(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      map[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return map;
}

/**
 * 真三方行合并：把 mine 相对 base 的改动重放到 theirs 上。
 * base=sheet 打开时的基线，mine=DOM 还原（用户编辑），theirs=当前磁盘（外部改动，
 * 如卡片勾选移位、flomo 追加）。用户没碰的行跟随磁盘版本（保留原字节），
 * 用户改过的行以 mine 为准——避免把过期快照整篇写回砸掉外部改动，
 * 或把外部移位/新增的行当冲突丢弃。
 */
export function threeWayMerge(base: string, mine: string, theirs: string): string {
  if (theirs === base) return mergePreservingOriginal(base, mine);
  if (mine === base) return theirs;
  const A = base.split('\n');
  const B = mine.split('\n');
  const C = theirs.split('\n');

  // 1) base→mine 的编辑块：对齐游标之间的间隙 = 替换区间
  const ab = lcsAlign(A, B);
  const hunks: { bStart: number; bEnd: number; lines: string[] }[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && ab[i] === j) {
      i++;
      j++;
      continue;
    }
    const bStart = i;
    const mStart = j;
    // 前进到下一个对齐点；任一侧到末尾则剩余全部并入当前块（尾部删除/追加）
    while (i < A.length && j < B.length && ab[i] !== j) {
      const next = ab[i];
      if (next === null || next <= j) i++;
      else j++;
    }
    if (i === A.length || j === B.length) {
      i = A.length;
      j = B.length;
    }
    hunks.push({ bStart, bEnd: i, lines: B.slice(mStart, j) });
  }
  if (!hunks.length) return mergePreservingOriginal(theirs, mine);

  // 2) base↔theirs 对齐，把编辑块定位到 theirs 的行区间后重放
  const ac = lcsAlign(A, C);
  const out: string[] = [];
  let cursor = 0;
  for (const h of hunks) {
    let tStart = -1;
    let tEnd = -1;
    let lastBefore: number | null = null;
    for (let k = 0; k < h.bStart; k++) {
      const t = ac[k];
      if (t !== null) lastBefore = t;
    }
    for (let k = h.bStart; k < h.bEnd && k < ac.length; k++) {
      const t = ac[k];
      if (t !== null) {
        if (tStart < 0 || t < tStart) tStart = t;
        if (t + 1 > tEnd) tEnd = t + 1;
      }
    }
    if (tStart < 0) {
      tStart = lastBefore === null ? 0 : lastBefore + 1;
      tEnd = tStart;
    }
    if (tStart < cursor) tStart = cursor;
    if (tEnd < tStart) tEnd = tStart;
    out.push(...C.slice(cursor, tStart), ...h.lines);
    cursor = tEnd;
  }
  out.push(...C.slice(cursor));
  return out.join('\n');
}
