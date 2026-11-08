import { MarkdownRenderer, Notice, TFile, moment, setIcon } from 'obsidian';
import type { App, Component, EventRef } from 'obsidian';
import type BentoHomePlugin from './main';
import { appendTaskToDailyNote } from './dailyNote';
import { htmlToMarkdown, threeWayMerge } from './htmlToMd';
import { moveTask, normalizeTodoChecked, todoNotePathOf } from './widgets/Todo';

/**
 * minttr 式底部弹窗：点击卡片从底部升起，渲染正文并直接所见即所得编辑，
 * 也可跳转在 Obsidian 中打开。挂在主页 contentEl 下。
 */
export class NoteSheet {
  private static active: NoteSheet | null = null;

  private root!: HTMLElement;
  private maskEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private saveBtn!: HTMLElement;
  private dirty = false; // 是否有未保存的改动
  private originalMd = '';
  private closed = false;
  private modifyRef?: EventRef; // vault.on('modify') 的注销句柄
  private keyHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      void this.save();
    }
  };

  private constructor(
    private app: App,
    private component: Component,
    private file: TFile,
    private plugin: BentoHomePlugin,
  ) {}

  static open(
    app: App,
    component: Component,
    file: TFile,
    container: HTMLElement,
    plugin: BentoHomePlugin,
  ): NoteSheet {
    NoteSheet.active?.close(true);
    const sheet = new NoteSheet(app, component, file, plugin);
    sheet.mount(container);
    NoteSheet.active = sheet;
    return sheet;
  }

  static closeActive(): void {
    NoteSheet.active?.close();
  }

  private mount(container: HTMLElement): void {
    this.root = container.createDiv({ cls: 'bh-sheet-root' });
    this.maskEl = this.root.createDiv({ cls: 'bh-sheet-mask' });
    this.maskEl.addEventListener('click', () => this.close());

    this.panelEl = this.root.createDiv({ cls: 'bh-sheet' });
    this.panelEl.createDiv({ cls: 'bh-sheet-grip' });

    const head = this.panelEl.createDiv({ cls: 'bh-sheet-head' });
    const titleBox = head.createDiv({ cls: 'bh-sheet-titlebox' });
    titleBox.createDiv({ cls: 'bh-sheet-title' }).setText(this.file.basename);
    titleBox.createDiv({ cls: 'bh-sheet-meta' }).setText(moment(this.file.stat.mtime).fromNow());

    const actions = head.createDiv({ cls: 'bh-sheet-actions' });
    const openBtn = actions.createDiv({ cls: 'bh-sheet-btn', attr: { 'aria-label': '在 Obsidian 中打开' } });
    setIcon(openBtn, 'arrow-up-right');
    openBtn.addEventListener('click', () => {
      this.close();
      void this.app.workspace.getLeaf('tab').openFile(this.file);
    });
    const closeBtn = actions.createDiv({ cls: 'bh-sheet-btn', attr: { 'aria-label': '关闭' } });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.close());

    this.bodyEl = this.panelEl.createDiv({ cls: 'bh-sheet-body' });
    // 格式化快捷键：加粗/斜体/链接/缩进 + 回车=软换行（直接在正文上生效）
    this.bodyEl.addEventListener('keydown', (ev) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (ev.key === 'Enter' && !mod && !ev.shiftKey) {
        // 段落内一次回车 = 软换行（<br> → 还原为单换行）。
        // 不拦截的话 contenteditable 会创建块级元素，还原器把块间
        // 输出为空行分隔，导致"敲一次回车变空行"。列表内保持默认
        // （回车新建列表项）。想分段空行：按两次回车。
        const anchor = window.getSelection()?.anchorNode;
        const host = anchor instanceof Element ? anchor : anchor?.parentElement;
        if (!host?.closest('li')) {
          ev.preventDefault();
          document.execCommand('insertLineBreak');
        }
        return;
      }
      if (mod && !ev.shiftKey) {
        const k = ev.key.toLowerCase();
        if (k === 'b') {
          ev.preventDefault();
          ev.stopPropagation();
          document.execCommand('bold');
        } else if (k === 'i') {
          ev.preventDefault();
          ev.stopPropagation();
          document.execCommand('italic');
        } else if (k === 'k') {
          ev.preventDefault();
          ev.stopPropagation();
          const url = window.prompt('链接地址：');
          if (url) document.execCommand('createLink', false, url);
        }
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        document.execCommand(ev.shiftKey ? 'outdent' : 'indent');
      }
    });

    // 底部操作栏：默认 Done，有修改时变黑底 Save
    const foot = this.panelEl.createDiv({ cls: 'bh-sheet-foot' });
    this.saveBtn = foot.createDiv({ cls: 'bh-sheet-save', text: 'Done' });
    this.saveBtn.addEventListener('click', () => void this.save());

    // 交互监听只挂一次（挂在 bodyEl 上，跨 renderContent 重渲染复用）
    this.bodyEl.addEventListener('input', () => {
      this.dirty = true;
      this.updateSaveBtn();
    });
    this.mountCaretFallback();

    // 外部变更实时重同步：没编辑时（卡片勾选待办、flomo 追加等改了源文件），
    // 直接重新渲染，基线不过期——否则保存会把打开时的旧快照整篇写回，
    // 把卡片勾选/外部追加全部砸掉。编辑中则不动 DOM，由 save() 以磁盘为基线重合并
    this.modifyRef = this.app.vault.on('modify', (f) => {
      if (f === this.file && !this.dirty && !this.closed) void this.renderContent();
    });

    void this.renderContent();

    document.addEventListener('keydown', this.keyHandler, true);

    // 入场：先置于屏外再移除类名触发 transition
    this.root.addClass('is-entering');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.root.removeClass('is-entering'));
    });
  }

  private async renderContent(): Promise<void> {
    const content = await this.app.vault.cachedRead(this.file);
    if (this.closed) return;
    this.originalMd = content;
    this.dirty = false;
    this.updateSaveBtn();
    this.bodyEl.empty();
    this.bodyEl.addClass('is-preview');
    // 让 Obsidian 主题的代码块/引用/列表等样式正确应用
    this.bodyEl.addClass('markdown-rendered');
    await MarkdownRenderer.render(this.app, content, this.bodyEl, this.file.path, this.component);
    // 空代码块没有文本节点，contenteditable 里点击无处安放光标；
    // 塞一个 <br> 占位（不产生文本，保存时 textContent 为空，无污染）
    this.bodyEl.querySelectorAll('pre code').forEach((code) => {
      if (!code.textContent) code.appendChild(createEl('br'));
    });
    // 渲染即编辑：直接改正文，不显示原始 Markdown
    this.bodyEl.contentEditable = 'true';
    this.bodyEl.setAttribute('spellcheck', 'false');
    this.injectTodoPromote();
  }

  /**
   * 待办笔记预览：给分割线下方（历史区）的未完成任务行尾注入「拿回今天」
   * 按钮——勾选语义处处=完成，取回今天是独立操作（2026-11-02 用户定稿）。
   * 按钮带 .bh-sheet-act，htmlToMarkdown 还原时跳过，不会写进正文。
   */
  private injectTodoPromote(): void {
    if (this.file.path !== todoNotePathOf(this.plugin.store.data.settings)) return;
    let pastHr = false;
    for (const child of Array.from(this.bodyEl.children)) {
      if (child.tagName === 'HR') {
        pastHr = true;
        continue;
      }
      if (!pastHr || (child.tagName !== 'UL' && child.tagName !== 'OL')) continue;
      for (const li of Array.from(child.querySelectorAll<HTMLElement>(':scope > li.task-list-item'))) {
        const box = li.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
        if (!box || box.checked) continue; // 只给历史区未完成任务
        if (li.querySelector('.bh-sheet-act')) continue;
        const text = (li.textContent ?? '').trim();
        li.addClass('bh-has-act');
        const btn = li.createDiv({
          cls: 'bh-sheet-act',
          text: '拿回今天',
          attr: { contenteditable: 'false', 'aria-label': '移动到今天的待办' },
        });
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          void this.app.vault
            .process(this.file, (s) => moveTask(s, -1, text, 'today'))
            .catch((err) => {
              new Notice('移动待办失败');
              console.error('[bento-home] 移动待办失败：', err);
            });
        });
      }
    }
  }

  /** 空行光标兜底定位（挂一次，见 mount）。绝不改动 DOM 布局（不新增行）：
   * 1) 原生已定位成功 → 不干预；2) 点在空元素上 → 光标进入该空行；
   * 3) caretRangeFromPoint 给得出有效内部位置（如 <br> 后）→ 采用；
   * 4) 纯段落间隙 → 光标落上方块末尾。 */
  private mountCaretFallback(): void {
    this.bodyEl.addEventListener('click', (ev) => {
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel) return;
        const anchor = sel.anchorNode;
        if (anchor && anchor !== this.bodyEl && this.bodyEl.contains(anchor)) return; // 原生成功

        const target = ev.target as HTMLElement;
        const setCaret = (node: Node, offset: number) => {
          const range = document.createRange();
          range.setStart(node, offset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          this.bodyEl.focus();
        };

        // 空列表项/空段落：光标进入该空行
        const emptyEl = target.closest('li, p');
        if (emptyEl && !emptyEl.textContent) {
          setCaret(emptyEl, 0);
          return;
        }

        // caretRangeFromPoint 的有效内部位置（<br> 后等）
        const range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        if (
          range &&
          range.startContainer !== this.bodyEl &&
          this.bodyEl.contains(range.startContainer)
        ) {
          sel.removeAllRanges();
          sel.addRange(range);
          this.bodyEl.focus();
          return;
        }

        // 段落间隙：光标落上方块末尾（不新增任何行）
        let above: Element | null = null;
        for (const child of Array.from(this.bodyEl.children)) {
          const r = child.getBoundingClientRect();
          if (r.bottom <= ev.clientY) above = child;
          else break;
        }
        if (!above) return;
        const walker = document.createTreeWalker(above, NodeFilter.SHOW_TEXT);
        let last: Node | null = null;
        while (walker.nextNode()) last = walker.currentNode;
        if (last) setCaret(last, last.textContent?.length ?? 0);
        else setCaret(above, 0);
      }, 0);
    });
  }

  /** 按修改状态更新按钮：无改动显示 Done（灰），有改动显示 Save（黑） */
  private updateSaveBtn(): void {
    this.saveBtn.toggleClass('is-dirty', this.dirty);
    this.saveBtn.setText(this.dirty ? 'Save' : 'Done');
  }

  private async save(): Promise<void> {
    if (this.closed) return;
    // 原文开头/结尾的空行渲染时没有 DOM 节点（如日记模板首行空行 + 日行禁止
    // callout），直接还原会把它们吞掉——从基线把首尾空行补回
    const lead = this.originalMd.match(/^[ \t]*(?:\n[ \t]*)*/)?.[0] ?? '';
    const trail = this.originalMd.match(/[ \t]*(?:\n[ \t]*)+$/)?.[0] ?? '';
    const domMd = lead + htmlToMarkdown(this.bodyEl).replace(/\n$/, '') + trail;
    // 三方合并（base=打开时基线，mine=DOM 还原，theirs=当前磁盘）：打开后磁盘被
    // 外部改过（卡片勾选移位、flomo 追加等）时，用户没碰的行跟随磁盘版本，
    // 不再把过期快照整篇写回、也不把外部移位/新增的行当冲突丢弃。
    // 无外部变更时退化为原有的保样式合并（尾空格、tab 缩进不丢）
    const diskNow = await this.app.vault.read(this.file);
    let md = threeWayMerge(this.originalMd, domMd, diskNow);
    // 待办笔记：在 sheet 里勾选的任务与卡片勾选同等语义——
    // 线上被勾成 [x] 的行移到分割线下方顶部，新勾选的补写当天日记
    let newlyChecked: string[] = [];
    if (this.file.path === todoNotePathOf(this.plugin.store.data.settings)) {
      const r = normalizeTodoChecked(md, diskNow);
      md = r.content;
      newlyChecked = r.newlyChecked;
    }
    if (md === diskNow) {
      this.dirty = false;
      this.updateSaveBtn();
      return;
    }
    try {
      await this.app.vault.process(this.file, () => md);
      this.originalMd = md;
      this.dirty = false;
      this.updateSaveBtn();
      new Notice('已保存');
      if (newlyChecked.length && this.plugin.store.data.settings.todoDoneToDaily) {
        for (const text of newlyChecked) {
          try {
            await appendTaskToDailyNote(this.app, text.trim());
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            new Notice(`「${text.trim()}」追加到当天日记失败：${reason}`);
            console.error('[bento-home] 追加到当天日记失败：', err);
          }
        }
      }
    } catch (err) {
      new Notice('保存失败');
      console.error('[bento-home] 保存笔记失败：', err);
    }
  }

  close(immediate = false): void {
    if (this.closed) return;
    this.closed = true;
    if (NoteSheet.active === this) NoteSheet.active = null;
    if (this.modifyRef) this.app.vault.offref(this.modifyRef);
    document.removeEventListener('keydown', this.keyHandler, true);
    // 有改动先保存，再关闭
    const finalize = () => {
      if (immediate) {
        this.root.remove();
        return;
      }
      this.root.addClass('is-leaving');
      window.setTimeout(() => this.root.remove(), 300);
    };
    if (this.dirty) {
      void this.save().finally(finalize);
    } else {
      finalize();
    }
  }
}
