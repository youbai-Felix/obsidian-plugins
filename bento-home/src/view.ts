import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type BentoHomePlugin from './main';
import { NoteSheet } from './sheet';
import { AddWidgetModal } from './picker';
import { enableDrag, enableResize } from './dnd';
import { applyCellLayout, computeCols } from './grid';
import { HOME_VIEW_TYPE } from './types';
import type { CardUI, Widget, WidgetHost, WidgetInstance } from './types';

export class HomeView extends ItemView {
  /** 主页不进入前进/后退历史 */
  navigation = false;
  editMode = false;

  private rootEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private clockBarEl!: HTMLElement;
  private clockInstance: WidgetInstance | null = null;
  private searchBarEl!: HTMLElement;
  private searchInstance: WidgetInstance | null = null;
  private leavesUnderEl: HTMLElement | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private cols = 4;
  private instances = new Map<string, WidgetInstance>();
  private ro: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private firstRender = true;
  private editActionEl: HTMLElement | null = null;
  private modifyTimer = 0;
  /** 防抖窗口内累积的变更文件：勾选待办会连写待办+日记两个文件，只保留最后一个
   *  会让待办组件的刷新被日记的 modify 吞掉（卡片永远不更新）——按集合防抖 */
  private pendingRefresh = new Set<TFile>();
  private titleROs: ResizeObserver[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: BentoHomePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return HOME_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Bento 主页';
  }

  getIcon(): string {
    return 'home';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('bh-content');

    // 树影层：minttr 同款——压在卡片上方（multiply 混合、pointer-events none）
    const leavesSrc = this.app.vault.adapter.getResourcePath(
      `${this.plugin.manifest.dir ?? '.obsidian/plugins/bento-home'}/leaves.webm`,
    );
    const createLeafVideo = (cls: string) => {
      const v = document.createElement('video');
      v.className = cls;
      v.autoplay = true;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      v.setAttribute('disablepictureinpicture', '');
      v.src = leavesSrc;
      void v.play().catch(() => {});
      return v;
    };
    this.leavesUnderEl = this.contentEl.createDiv({ cls: 'bh-leaves-over' });
    this.leavesUnderEl.appendChild(createLeafVideo('bh-leaves'));

    this.rootEl = this.contentEl.createDiv({ cls: 'bh-root' });
    this.clockBarEl = this.rootEl.createDiv({ cls: 'bh-clock-bar' });
    this.searchBarEl = this.rootEl.createDiv({ cls: 'bh-search-bar' });
    this.gridEl = this.rootEl.createDiv({ cls: 'bh-grid' });

    this.addAction('plus', '添加卡片', () => this.openAddModal());
    this.editActionEl = this.addAction('pencil', '编辑布局', () => this.toggleEdit());

    this.unsubscribe = this.plugin.store.onChange(() => this.renderGrid());

    // 文件变更 → 通知相关组件刷新（待办/最近/卡片预览实时同步）
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) this.scheduleVaultRefresh(file);
      }),
    );
    // 源文件被删除 → 对应的置顶卡片自动移除 + 最近编辑等组件刷新
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (!(file instanceof TFile)) return;
        const has = this.plugin.store.data.widgets.some(
          (w) => w.type === 'note-card' && w.path === file.path,
        );
        if (has) {
          this.plugin.store.mutate((d) => {
            d.widgets = d.widgets.filter((w) => !(w.type === 'note-card' && w.path === file.path));
          });
          new Notice('笔记已删除，主页卡片已移除');
        } else {
          // 非置顶卡片的删除也要触发重绘，让最近编辑等组件同步移除引用
          this.renderGrid();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        let touched = false;
        this.plugin.store.mutate((d) => {
          for (const w of d.widgets) {
            if (w.type === 'note-card' && w.path === oldPath && file instanceof TFile) {
              w.path = file.path;
              touched = true;
            }
          }
        });
        if (!touched) this.renderGrid();
      }),
    );

    this.ro = new ResizeObserver(() => this.handleGridResize());
    this.ro.observe(this.gridEl);

    this.renderGrid();
  }

  async onClose(): Promise<void> {
    NoteSheet.closeActive();
    this.videoEl?.pause();
    this.videoEl = null;
    this.leavesUnderEl?.querySelectorAll('video').forEach((v) => (v as HTMLVideoElement).pause());
    this.leavesUnderEl = null;
    window.clearTimeout(this.modifyTimer);
    this.pendingRefresh.clear();
    this.ro?.disconnect();
    this.ro = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      this.clockInstance?.destroy();
    } catch {
      // 忽略
    }
    this.clockInstance = null;
    try {
      this.searchInstance?.destroy();
    } catch {
      // 忽略
    }
    this.searchInstance = null;
    for (const inst of this.instances.values()) {
      try {
        inst.destroy();
      } catch (err) {
        console.error('[bento-home] 组件销毁出错：', err);
      }
    }
    this.instances.clear();
  }

  toggleEdit(): void {
    this.setEditMode(!this.editMode);
  }

  setEditMode(edit: boolean): void {
    this.editMode = edit;
    if (this.editActionEl) {
      setIcon(this.editActionEl, edit ? 'check' : 'pencil');
      this.editActionEl.setAttribute('aria-label', edit ? '完成编辑' : '编辑布局');
    }
    this.renderGrid();
  }

  openAddModal(): void {
    new AddWidgetModal(this.app, this.plugin).open();
  }

  private scheduleVaultRefresh(file: TFile): void {
    this.pendingRefresh.add(file);
    window.clearTimeout(this.modifyTimer);
    this.modifyTimer = window.setTimeout(() => {
      const files = [...this.pendingRefresh];
      this.pendingRefresh.clear();
      for (const f of files) {
        for (const inst of this.instances.values()) {
          try {
            inst.onVaultModify?.(f);
          } catch (err) {
            console.error('[bento-home] 组件刷新出错：', err);
          }
        }
      }
    }, 500);
  }

  private handleGridResize(): void {
    const next = computeCols(this.gridEl.clientWidth);
    if (next === this.cols) return;
    this.cols = next;
    this.gridEl.style.setProperty('--bh-cols', String(next));
    // 只更新跨度，不整页重绘（避免打断时钟/输入框）
    const widgets = this.plugin.store.data.widgets;
    this.gridEl.querySelectorAll<HTMLElement>(':scope > .bh-cell').forEach((cell, i) => {
      const w = widgets[i];
      if (w) applyCellLayout(cell, w, this.cols);
    });
  }

  private host(): WidgetHost {
    return {
      app: this.app,
      component: this,
      editMode: () => this.editMode,
      openFile: (file) => {
        void this.app.workspace.getLeaf('tab').openFile(file);
      },
      openSheet: (file) => {
        NoteSheet.open(this.app, this, file, this.contentEl, this.plugin);
      },
      settings: () => this.plugin.store.data.settings,
      refresh: () => this.renderGrid(),
      todoDayStamp: () => this.plugin.store.data.lastTodoDay,
      setTodoDayStamp: (day) => {
        this.plugin.store.mutate((d) => {
          d.lastTodoDay = day;
        });
      },
    };
  }

  /** 顶部固定时钟问候：不参与网格，常驻渲染（主页头部） */
  private renderClockBar(): void {
    try {
      this.clockInstance?.destroy();
    } catch {
      // 忽略
    }
    this.clockInstance = null;
    this.clockBarEl.empty();

    const def = this.plugin.widgetDefs['clock'];
    if (!def) return;

    const ui: CardUI = {
      cardEl: this.clockBarEl,
      headEl: null,
      bodyEl: this.clockBarEl,
      setTitle: () => {},
      setIcon: () => {},
      setMeta: () => {},
      setMetaEl: () => {},
      setClickable: () => {},
      bodyScroll: () => {},
    };
    const widget: Widget = { id: 'fixed-clock', type: 'clock', colSpan: 2, rowSpan: 1 };
    try {
      this.clockInstance = def.create(this.host(), widget, ui);
    } catch (err) {
      console.error('[bento-home] 顶部时钟渲染失败：', err);
    }
  }

  /** 顶部固定搜索栏：不参与网格，常驻渲染 */
  private renderSearchBar(): void {
    try {
      this.searchInstance?.destroy();
    } catch {
      // 忽略
    }
    this.searchInstance = null;
    this.searchBarEl.empty();

    const def = this.plugin.widgetDefs['search'];
    if (!def) return;

    const ui: CardUI = {
      cardEl: this.searchBarEl,
      headEl: null,
      bodyEl: this.searchBarEl,
      setTitle: () => {},
      setIcon: () => {},
      setMeta: () => {},
      setMetaEl: () => {},
      setClickable: () => {},
      bodyScroll: () => {},
    };
    const widget: Widget = { id: 'fixed-search', type: 'search', colSpan: 2, rowSpan: 1 };
    try {
      this.searchInstance = def.create(this.host(), widget, ui);
    } catch (err) {
      console.error('[bento-home] 顶部搜索栏渲染失败：', err);
    }
  }

  renderGrid(): void {
    for (const inst of this.instances.values()) {
      try {
        inst.destroy();
      } catch {
        // 销毁失败不阻塞重绘
      }
    }
    this.instances.clear();
    // 上一轮的标题溢出观察器全部断开（对应 DOM 已重建）
    for (const ro of this.titleROs) ro.disconnect();
    this.titleROs = [];

    this.renderClockBar();
    this.renderSearchBar();

    this.gridEl.empty();
    this.gridEl.toggleClass('is-edit', this.editMode);
    this.gridEl.style.setProperty('--bh-cols', String(this.cols));

    const widgets = this.plugin.store.data.widgets;

    if (!widgets.length) {
      this.renderEmptyState();
      return;
    }

    const host = this.host();
    widgets.forEach((widget, i) => {
      // 时钟、搜索已固定在顶部，不进入网格
      if (widget.type === 'search' || widget.type === 'clock') return;
      const def = this.plugin.widgetDefs[widget.type];
      if (!def) return;
      const cellEl = this.gridEl.createDiv({
        cls: 'bh-cell' + (widget.type === 'note-card' ? ' bh-cell-note' : ''),
      });
      applyCellLayout(cellEl, widget, this.cols);
      if (this.firstRender) cellEl.style.setProperty('--bh-i', String(i));

      const cardEl = cellEl.createDiv({ cls: 'bh-card' });
      let headEl: HTMLElement | null = null;
      let iconEl: HTMLElement | null = null;
      let titleEl: HTMLElement | null = null;
      let metaEl: HTMLElement | null = null;

      if (def.chrome === 'card') {
        cardEl.addClass('is-chrome');
        headEl = cardEl.createDiv({ cls: 'bh-card-head' });
        iconEl = headEl.createSpan({ cls: 'bh-card-icon' });
        titleEl = headEl.createSpan({ cls: 'bh-card-title' });
        metaEl = headEl.createSpan({ cls: 'bh-card-meta' });
        setIcon(iconEl, def.icon);
        titleEl.setText(def.name);

        if (this.editMode) {
          const del = headEl.createSpan({ cls: 'bh-del', attr: { 'aria-label': '删除卡片' } });
          setIcon(del, 'x');
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            this.plugin.store.removeWidget(widget.id);
          });
        }
      } else {
        cardEl.addClass('is-plain');
      }

      // 标题长于可用宽度（省略号生效）时隐藏 meta（编辑时间等），给标题让位。
      // 带滞后阈值防抖动：临界宽度下"显示→挤溢出→隐藏→不溢出→显示"会无限循环；
      // 隐藏后仅当标题余量足以同时容纳 meta（记录的宽度+间隙+缓冲）才恢复，稳定不振荡。
      let metaHidden = false;
      let metaW = 0;
      const syncTitleMeta = () => {
        if (!titleEl || !metaEl) return;
        const need = titleEl.scrollWidth;
        const have = titleEl.clientWidth;
        if (!metaHidden) {
          if (need > have + 1) {
            metaW = metaEl.offsetWidth || metaW;
            metaEl.style.display = 'none';
            metaHidden = true;
          }
        } else if (need <= have - metaW - 12) {
          metaEl.style.display = '';
          metaHidden = false;
        }
      };
      syncTitleMeta();
      if (titleEl) {
        const ro = new ResizeObserver(syncTitleMeta);
        ro.observe(titleEl);
        this.titleROs.push(ro);
      }

      const bodyEl = cardEl.createDiv({ cls: 'bh-card-body' });
      const ui: CardUI = {
        cardEl,
        headEl,
        bodyEl,
        setTitle: (t) => {
          titleEl?.setText(t);
          syncTitleMeta();
        },
        setIcon: (ic) => iconEl && setIcon(iconEl, ic),
        setMeta: (t) => {
          if (!metaEl) return;
          metaEl.empty();
          metaEl.setText(t);
        },
        setMetaEl: (el) => {
          if (!metaEl) return;
          metaEl.empty();
          metaEl.appendChild(el);
        },
        setClickable: (v) => cardEl.toggleClass('is-clickable', v),
        bodyScroll: (v) => bodyEl.toggleClass('is-scroll', v),
      };

      try {
        const inst = def.create(host, widget, ui);
        this.instances.set(widget.id, inst);
      } catch (err) {
        console.error('[bento-home] 组件渲染失败：', widget.type, err);
      }

      // 拖动换位：非编辑模式下卡片 hover 即浮现拖柄、可直接拖动；编辑模式拖柄常显
      const dragHandle = cellEl.createDiv({
        cls: 'bh-drag-handle' + (this.editMode ? '' : ' is-ghost'),
        attr: { 'aria-label': '拖拽移动' },
      });
      setIcon(dragHandle, 'grip');
      enableDrag({
        cellEl,
        gridEl: this.gridEl,
        onReorder: (from, to) => this.plugin.store.moveWidget(from, to),
      });

      if (this.editMode) {
        cellEl.addClass('is-editing');
        cellEl.createDiv({ cls: 'bh-resize-handle', attr: { 'aria-label': '调整大小' } });
        enableResize({
          cellEl,
          gridEl: this.gridEl,
          widget,
          getCols: () => this.cols,
          onCommit: (id, patch) => this.plugin.store.patchWidget(id, patch),
        });
      }
    });

    if (this.firstRender) {
      this.gridEl.addClass('bh-anim');
      this.firstRender = false;
    }
  }

  private renderEmptyState(): void {
    const empty = this.gridEl.createDiv({ cls: 'bh-empty' });
    setIcon(empty.createDiv({ cls: 'bh-empty-icon' }), 'layout-dashboard');
    empty.createDiv({
      cls: 'bh-empty-text',
      text: this.editMode ? '主页空空的，添加第一张卡片吧' : '主页空空的',
    });
    const btn = empty.createEl('button', { cls: 'bh-btn', text: '添加卡片' });
    btn.addEventListener('click', () => this.openAddModal());
  }
}
