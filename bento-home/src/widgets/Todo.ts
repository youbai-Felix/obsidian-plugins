import { Notice, TFile, moment, normalizePath, setIcon } from 'obsidian';
import { appendTaskToDailyNote, ensureFolders } from '../dailyNote';
import type { CardUI, WidgetDef, WidgetHost, WidgetInstance } from '../types';

interface Task {
  line: number;
  done: boolean;
  text: string;
  /** 线上=当天待办，线下=历史待办（位置即语义） */
  zone: 'today' | 'history';
}

function parseTasks(content: string): Task[] {
  const lines = content.split('\n');
  const hr = findDivider(lines);
  const tasks: Task[] = [];
  lines.forEach((raw, i) => {
    const m = raw.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) {
      tasks.push({
        line: i,
        done: m[1].toLowerCase() === 'x',
        text: m[2],
        zone: hr < 0 || i < hr ? 'today' : 'history',
      });
    }
  });
  return tasks;
}

/** 待办笔记的库内路径（去开头斜杠），卡片与 sheet 共用 */
export function todoNotePathOf(settings: { todoNotePath: string }): string {
  const p = normalizePath(settings.todoNotePath.trim());
  return p.startsWith('/') ? p.slice(1) : p;
}

function todoPath(host: WidgetHost): string {
  return todoNotePathOf(host.settings());
}

const DONE_RE = /^\s*[-*+]\s+\[x\]/i;
const OPEN_RE = /^\s*[-*+]\s+\[ \]/;
const HR_RE = /^\s*(-{3,}|\*{3,})\s*$/;

/**
 * `---` 分割线：线上=未完成任务区，线下顶部=今日完成簇（最新勾选的紧贴线下），
 * 再往下=历史记录（带旧时间戳的、用户的补丁待办等，只读保留）。卡片只显示
 * 未完成；完成的在 500ms 防抖刷新后从卡片消失（用户定稿：不追求立即消失）。
 */
function findDivider(lines: string[]): number {
  return lines.findIndex((l) => HR_RE.test(l));
}

/** 完成时间戳（历史格式）：勾选已不再追加，取消勾选时顺手剥掉老戳 */
const STAMP_RE = /\s*==[🟢🟠][^=]*==\s*$/;

/**
 * 新增待办的插入位置：线上（当天区）未完成区顶部——按创建时间降序，最新
 * 创建的在最上。搜索范围**限定在分割线上方**：归档后线上区可能为空（分割线
 * 顶到第 0 行），全文件搜索会把新任务插到线下历史区。线上没有未完成任务时
 * 放在分割线之前（守住线上区域）；文件里没有任务则放文件头。
 */
function insertOpenAt(lines: string[]): number {
  const hr = findDivider(lines);
  const upperEnd = hr >= 0 ? hr : lines.length;
  const firstOpen = lines.slice(0, upperEnd).findIndex((l) => OPEN_RE.test(l));
  if (firstOpen >= 0) return firstOpen;
  const firstDone = lines.slice(0, upperEnd).findIndex((l) => DONE_RE.test(l));
  if (firstDone >= 0) return firstDone;
  if (hr >= 0) {
    let at = hr;
    while (at > 0 && lines[at - 1].trim() === '') at--;
    return at;
  }
  return 0;
}

/**
 * 勾选/取消（2026-11-01 用户定稿）：翻转标记，不加完成时间戳——完成记录由当天
 * 日记的「今日事」承担。勾选后把该行移到 `---` 分割线**下方的顶部**（完成区
 * 最上面，最新完成的紧贴分割线）；无分割线时保持原位。
 */
function toggleTaskLine(content: string, line: number, done: boolean, text: string): string {
  const lines = content.split('\n');
  const at = locateTaskLine(lines, line, done ? ' ' : 'x', text);
  if (at < 0) return content;
  let updated = lines[at].replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]');
  if (!done) {
    lines[at] = updated.replace(STAMP_RE, '');
    return lines.join('\n');
  }
  lines.splice(at, 1);
  const hr = findDivider(lines);
  lines.splice(hr >= 0 ? hr + 1 : at, 0, updated.trim());
  return lines.join('\n');
}

/**
 * 行号定位：卡片刷新有 500ms 防抖，快速连勾时后续任务手里的行号可能已漂移——
 * 期望行的文本+状态对不上时，按「文本 + 状态」全文重定位，防错写别的行。
 */
function locateTaskLine(lines: string[], line: number, expect: ' ' | 'x', text: string): number {
  const TASK_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
  const m = lines[line]?.match(TASK_RE);
  if (m && m[1] === expect && m[2] === text) return line;
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(TASK_RE);
    if (mm && mm[1] === expect && mm[2] === text) return i;
  }
  return -1;
}

/**
 * 行内小按钮：当天 ↔ 历史互转。目标为 history → 移到分割线下方顶部（保持 [ ]）；
 * 目标为 today → 移到线上当天区顶部（insertOpenAt 位置）。
 * 卡片按钮与 sheet 的「拿回今天」按钮共用（sheet 传 line=-1 按文本定位）。
 */
export function moveTask(content: string, line: number, text: string, to: 'today' | 'history'): string {
  const lines = content.split('\n');
  const at = locateTaskLine(lines, line, ' ', text);
  if (at < 0) return content;
  const moved = lines[at].trim();
  lines.splice(at, 1);
  const hr = findDivider(lines);
  if (to === 'history') {
    if (hr < 0) return content; // 无分割线没有历史区，不动
    lines.splice(hr + 1, 0, moved);
  } else {
    lines.splice(insertOpenAt(lines), 0, moved);
  }
  return lines.join('\n');
}

/**
 * 跨天归档：把线上（当天区）遗留的未完成待办移到分割线下方顶部——
 * 过了当天，昨天没做完的自动进历史，当天区清空等新任务。无变化返回 null。
 */
function rolloverExpired(content: string): string | null {
  const lines = content.split('\n');
  const hr = findDivider(lines);
  if (hr < 0) return null;
  const expired: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < hr; i++) {
    if (OPEN_RE.test(lines[i])) expired.push(lines[i].trim());
    else rest.push(lines[i]);
  }
  if (!expired.length) return null;
  while (rest.length && rest[rest.length - 1].trim() === '') rest.pop();
  const tail = lines.slice(hr + 1);
  while (tail.length && tail[0].trim() === '') tail.shift();
  return [...rest, lines[hr], ...expired, ...tail].join('\n');
}

/**
 * sheet 保存待办笔记后的规范化（勾选语义处处=完成，2026-11-02 用户定稿）：
 * - 被勾成 [x] 且保存前磁盘上还是 [ ] 的行 → 记入 newlyChecked（补写当天日记），
 *   无论原在线上还是线下；线上勾选的移到分割线下方顶部，线下勾选的
 *   冒泡到线下顶部（新完成贴线）
 * - 历史待办「拿回今天」走预览页按钮（moveTask），不经此处
 */
export function normalizeTodoChecked(
  content: string,
  diskBefore: string,
): { content: string; newlyChecked: string[] } {
  const lines = content.split('\n');
  const hr = findDivider(lines);
  if (hr < 0) return { content, newlyChecked: [] };
  // 比对/输出统一剥掉尾部 ==…== 完成戳：Obsidian 渲染器把 ==🟢时间== 解析成
  // 绿色高亮并吃掉 emoji，sheet 往返后戳必然残缺，带戳比对会把老完成项
  // 误判成新勾选（错误提升/重复日记）
  const bare = (s: string) => s.replace(/\s*==[^=]*==\s*$/, '').trim();
  const beforeDone = new Set<string>();
  for (const l of diskBefore.split('\n')) {
    const m = l.match(/^\s*[-*+]\s+\[x\]\s+(.*)$/i);
    if (m) beforeDone.add(bare(m[1]));
  }
  const newlyChecked: string[] = [];
  const upperDone: string[] = // 线上勾选 → 移到线下顶部
    [];
  const bubbled: string[] = // 线下新勾选 → 冒泡到线下顶部
    [];
  const upper: string[] = [];
  for (let i = 0; i < hr; i++) {
    const m = lines[i].match(/^\s*[-*+]\s+\[x\]\s+(.*)$/i);
    if (m) {
      upperDone.push(lines[i].trim());
      if (!beforeDone.has(bare(m[1]))) newlyChecked.push(bare(m[1]));
    } else upper.push(lines[i]);
  }
  const lower: string[] = [];
  for (let i = hr + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*[-*+]\s+\[x\]\s+(.*)$/i);
    if (m && !beforeDone.has(bare(m[1]))) {
      bubbled.push(lines[i].trim());
      newlyChecked.push(bare(m[1]));
    } else lower.push(lines[i]);
  }
  if (!upperDone.length && !bubbled.length) return { content, newlyChecked };
  while (upper.length && upper[upper.length - 1].trim() === '') upper.pop();
  // 渲染器在 --- 与列表之间会补空行（还原时带回来），滤掉线下区开头的空行
  const tail = lower;
  while (tail.length && tail[0].trim() === '') tail.shift();
  const out = [...upper, lines[hr], ...upperDone, ...bubbled, ...tail];
  return { content: out.join('\n'), newlyChecked };
}

export const todoDef: WidgetDef = {
  type: 'todo',
  name: '待办清单',
  icon: 'list-checks',
  chrome: 'card',
  defaults: { colSpan: 4, rowSpan: 4 },
  create(host: WidgetHost, _widget, ui: CardUI): WidgetInstance {
    ui.setTitle('待办');
    ui.setIcon('list-checks');
    // 不开 bodyScroll：滚轮事件穿透给主页

    let tasks: Task[] = [];
    let visible = 0; // 当天区按卡片高度自适应的显示条数
    let todoFile: TFile | null = null;

    const render = () => {
      const body = ui.bodyEl;
      // 整卡重绘会重建输入框：记录焦点与未提交文本，重绘后恢复——
      // 回车添加后不打断输入，外部修改文件时也不丢正在打的字
      const prevInput = body.querySelector<HTMLInputElement>('input.bh-input-ghost');
      const prevValue = prevInput?.value ?? '';
      const refocus = !!prevInput && document.activeElement === prevInput;
      body.empty();

      if (!todoFile) {
        ui.setMeta('');
        const path = todoPath(host);
        const miss = body.createDiv({ cls: 'bh-todo-missing' });
        miss.createDiv({ cls: 'bh-hint', text: `未找到笔记「${path}」` });
        const btn = miss.createEl('button', { cls: 'bh-btn bh-btn-sm', text: '创建它' });
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          if (dir) await ensureFolders(host.app, dir);
          await host.app.vault.create(path, '');
          void load();
        });
        return;
      }

      // 点击待办卡片内容（除勾选框、输入框外的区域）→ 预览待办笔记
      body.addEventListener('click', (e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (todoFile) host.openSheet(todoFile);
      });

      const todayOpen = tasks.filter((t) => !t.done && t.zone === 'today').length;
      ui.setMeta(`${todayOpen} 项待办`);

      const addRow = body.createDiv({ cls: 'bh-todo-add' });
      const inputEl = addRow.createEl('input', {
        type: 'text',
        cls: 'bh-input bh-input-ghost',
        attr: { placeholder: '添加待办，回车确认…', spellcheck: 'false' },
      });
      if (prevValue) inputEl.value = prevValue;
      if (refocus) {
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
      inputEl.addEventListener('keydown', async (ev) => {
        if (ev.key !== 'Enter') return;
        const text = inputEl.value.trim();
        if (!text || !todoFile) return;
        inputEl.value = '';
        try {
          await host.app.vault.process(todoFile, (s) => {
            const lines = s.split('\n');
            // 新任务插入未完成区末尾（分割线上方）：文件序靠后 → 卡片倒序显示在最上
            const at = insertOpenAt(lines);
            lines.splice(at, 0, `- [ ] ${text}`);
            return lines.join('\n');
          });
        } catch (err) {
          new Notice('写入待办失败');
          console.error('[bento-home] 写入待办失败：', err);
        }
      });

      const list = body.createDiv({ cls: 'bh-tasks' });
      // 当天区：只显示线上未完成任务，按文件序显示——线上按创建时间降序
      // （新任务插在最前，见 insertOpenAt），因此卡片上最新创建的在最上方。
      // 历史待办不在卡片显示（2026-11-02 用户定稿）：空了就空白，
      // 历史待办去预览页勾选取回（见 normalizeTodoChecked 的 promotion）
      const todayTasks = tasks.filter((t) => !t.done && t.zone === 'today');
      const shown = todayTasks.slice(0, visible);
      for (const task of shown) {
        const row = list.createDiv({ cls: 'bh-task' });
        const box = row.createEl('input', { type: 'checkbox', cls: 'bh-task-box' });
        row.createSpan({ cls: 'bh-task-text' }).setText(task.text);
        // 右侧小按钮：移到历史待办
        const demote = row.createDiv({ cls: 'bh-task-act', attr: { 'aria-label': '移到历史待办' } });
        setIcon(demote, 'archive');
        demote.addEventListener('click', (ev) => {
          ev.stopPropagation(); // 不触发卡片点击预览
          if (!todoFile) return;
          void host.app.vault
            .process(todoFile, (s) => moveTask(s, task.line, task.text, 'history'))
            .catch((err) => {
              new Notice('移动待办失败');
              console.error('[bento-home] 移动待办失败：', err);
            });
        });
        box.addEventListener('change', async () => {
          if (!todoFile) return;
          try {
            await host.app.vault.process(todoFile, (s) =>
              toggleTaskLine(s, task.line, box.checked, task.text),
            );
          } catch (err) {
            new Notice('更新待办失败');
            console.error('[bento-home] 更新待办失败：', err);
            return;
          }
          // 勾选完成 → 追加到当天日记「今日事」（开关可关；失败只提示，不影响待办本身）。
          // 卡片上该行留在原地由 500ms 防抖的文件刷新移除（用户定稿：不追求立即消失）
          if (box.checked && host.settings().todoDoneToDaily) {
            try {
              await appendTaskToDailyNote(host.app, task.text.trim());
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              new Notice(`「${task.text.trim()}」追加到当天日记失败：${reason}`);
              console.error('[bento-home] 追加到当天日记失败：', err);
            }
          }
        });
      }
      // 历史待办不在卡片显示（2026-11-02 用户定稿）——取回去预览页勾选
    };

    // 根据卡片高度自适应显示条数（顶部输入框约占 40px）
    const measure = () => {
      const h = ui.bodyEl.clientHeight;
      if (h <= 0) return;
      const next = Math.max(2, Math.min(100, Math.floor((h - 40) / 30)));
      if (next !== visible) {
        visible = next;
        render();
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(ui.bodyEl);

    /** 跨天归档：日期戳与今天不同 → 线上未完成待办移到历史区，然后盖章 */
    const ensureDay = async (): Promise<void> => {
      if (!todoFile) return;
      const today = moment().format('YYYY-MM-DD');
      if (host.todoDayStamp() === today) return;
      try {
        await host.app.vault.process(todoFile, (s) => rolloverExpired(s) ?? s);
      } catch (err) {
        console.error('[bento-home] 跨天归档待办失败：', err);
        return; // 不盖章，下次再试
      }
      host.setTodoDayStamp(today);
    };

    const load = async () => {
      const f = host.app.vault.getAbstractFileByPath(todoPath(host));
      if (f instanceof TFile) {
        todoFile = f;
        await ensureDay();
        const content = await host.app.vault.cachedRead(f);
        if (!ui.bodyEl.isConnected) return;
        tasks = parseTasks(content);
      } else {
        todoFile = null;
        tasks = [];
      }
      if (ui.bodyEl.isConnected) {
        render();
        measure();
      }
    };

    void load();
    // 每分钟检查一次跨天（Obsidian 常开过夜时，0 点后自动归档昨天的待办）
    const dayTimer = window.setInterval(() => void load(), 60_000);

    return {
      onVaultModify(file: TFile) {
        if (file.path === todoPath(host)) void load();
      },
      destroy() {
        ro.disconnect();
        window.clearInterval(dayTimer);
      },
    };
  },
};
