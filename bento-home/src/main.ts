import { Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { HomeStore, newWidgetId } from './store';
import { HomeView } from './view';
import { HOME_VIEW_TYPE } from './types';
import { widgetRegistry } from './widgets';

/** lucide home 图标（注入 NN 菜单用；svg-icon 类名确保与原生菜单图标同样式对齐） */
const HOME_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-home"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

/** NN 菜单里的定位锚点：插入到「在默认应用中打开」之后（中英文都认） */
const NN_ANCHOR_RE = /在默认应用中打开|open in default app/i;

export default class BentoHomePlugin extends Plugin {
  store!: HomeStore;
  widgetDefs = widgetRegistry;

  async onload(): Promise<void> {
    this.store = new HomeStore(this);
    await this.store.load();

    this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));

    // 主页激活时隐藏状态栏字数统计（显示的是上一篇笔记的残留统计，无意义）
    const syncHomeActive = () => {
      document.body.toggleClass('bh-home-active', !!this.app.workspace.getActiveViewOfType(HomeView));
    };
    this.registerEvent(this.app.workspace.on('active-leaf-change', syncHomeActive));
    this.app.workspace.onLayoutReady(syncHomeActive);

    this.addRibbonIcon('home', '打开 Bento 主页', () => void this.activateView());

    this.addCommand({
      id: 'open',
      name: '打开主页',
      // 默认 Ctrl+A 全局回到主页（可在 设置 → 快捷键 中修改）
      hotkeys: [{ modifiers: ['Ctrl'], key: 'a' }],
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: 'toggle-edit',
      name: '切换编辑布局',
      checkCallback: (checking) => {
        const view = this.activeHomeView();
        if (!view) return false;
        if (!checking) view.toggleEdit();
        return true;
      },
    });

    this.addCommand({
      id: 'add-current',
      name: '添加当前笔记到主页',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.addNoteToHome(file.path);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) =>
            item
              .setTitle('添加到 Bento 主页')
              .setIcon('home')
              .onClick(() => this.addNoteToHome(file.path)),
          );
        }
      }),
    );

    // 编辑器正文右键菜单：当前笔记添加到主页
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, _editor, info) => {
        const file = info?.file;
        if (!file || file.extension !== 'md') return;
        menu.addItem((item) =>
          item
            .setTitle('添加到 Bento 主页')
            .setIcon('home')
            .onClick(() => this.addNoteToHome(file.path)),
        );
      }),
    );

    this.setupNotebookNavigatorMenu();

    this.addSettingTab(new BentoHomeSettingTab(this.app, this));

    // 启动自动打开；也覆盖 hot-reload 重载场景（layoutReady 已触发过）
    if (this.store.data.settings.openOnStartup) {
      const open = () => {
        if (!this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE).length) void this.activateView();
      };
      if (this.app.workspace.layoutReady) open();
      else this.app.workspace.onLayoutReady(open);
    }

    // 主页常驻：被关闭（关标签/关闭全部/关闭所在弹出窗口）后立即重建，不可被关闭。
    // 延迟到下一个 tick，避免在 layout-change 事件分发中改动布局
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.unloading || !this.app.workspace.layoutReady) return;
        if (this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE).length) return;
        window.setTimeout(() => {
          if (this.unloading || this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE).length) return;
          const leaf = this.app.workspace.getLeaf('tab');
          void leaf.setViewState({ type: HOME_VIEW_TYPE, active: false });
        }, 0);
      }),
    );
  }

  /**
   * Notebook Navigator 的文件列表右键是它自建的菜单（不走 Obsidian 的
   * file-menu 事件），标准入口注入不进去。这里用 DOM 方式适配：
   * 右键落在 NN 的文件行（.nn-file，路径存于最近 [data-path] 祖先）时
   * 记下路径；菜单挂载后把「添加到 Bento 主页」注入到菜单顶部。
   */
  private setupNotebookNavigatorMenu(): void {
    let pendingPath: string | null = null;

    this.registerDomEvent(
      document,
      'contextmenu',
      (ev) => {
        const target = ev.target as HTMLElement | null;
        const row = target?.closest?.('.nn-file');
        if (!row) {
          pendingPath = null;
          return;
        }
        const path = row.closest('[data-path]')?.getAttribute('data-path');
        pendingPath = path && path.endsWith('.md') ? path : null;
      },
      { capture: true },
    );

    const observer = new MutationObserver(() => {
      if (!pendingPath) return;
      const menu = document.querySelector(':scope > .menu, body > .menu');
      if (!menu || menu.querySelector('.bh-nn-add')) return;
      const path = pendingPath;
      pendingPath = null;
      const item = createEl('div', { cls: 'menu-item tappable bh-nn-add' });
      item.createDiv({ cls: 'menu-item-icon' }).innerHTML = HOME_ICON_SVG;
      item.createDiv({ cls: 'menu-item-text', text: '添加到 Bento 主页' });
      item.addEventListener('click', () => {
        menu.remove();
        this.addNoteToHome(path);
      });
      // Obsidian 1.14 菜单 hover 背景不是 :hover，而是 Menu 组件给自家条目
      // JS 加 .selected 类（.menu-item:not(.is-label):not(.is-disabled).selected）。
      // 裸注入的项没人接线 → 自己挂 mouseenter/leave 切换，补齐灰色背景
      item.addEventListener('mouseenter', () => {
        menu.querySelectorAll('.menu-item.selected').forEach((el) => el.removeClass('selected'));
        item.addClass('selected');
      });
      item.addEventListener('mouseleave', () => item.removeClass('selected'));
      // 插到「在默认应用中打开」之后；找不到锚点则退到菜单顶部
      const anchor = Array.from(menu.querySelectorAll('.menu-item')).find((el) =>
        NN_ANCHOR_RE.test(el.textContent ?? ''),
      );
      if (anchor && anchor.nextElementSibling) {
        anchor.nextElementSibling.before(item);
      } else if (anchor) {
        anchor.after(item);
      } else {
        menu.prepend(item);
      }
    });
    observer.observe(document.body, { childList: true });
    this.register(() => observer.disconnect());
  }

  private unloading = false;

  onunload(): void {
    // 先立旗再摘叶子：detach 触发的 layout-change 不能把常驻保活又拉起主页
    this.unloading = true;
    document.body.removeClass('bh-home-active');
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
      leaf.detach();
    }
  }

  activeHomeView(): HomeView | null {
    const leaf = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)[0];
    return leaf && leaf.view instanceof HomeView ? leaf.view : null;
  }

  addNoteToHome(path: string): void {
    if (this.store.hasNote(path)) {
      new Notice('这篇笔记已经在主页上了');
      return;
    }
    this.store.addWidget({ id: newWidgetId(), type: 'note-card', colSpan: 1, rowSpan: 2, path });
    new Notice('已添加到主页');
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(HOME_VIEW_TYPE)[0];
    if (!leaf) {
      // 接管当前叶子，取代 ToDo List 等文件成为入口页
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
    }
    // setActiveLeaf 直接激活（revealLeaf 单独用在某些布局下不够可靠）
    workspace.setActiveLeaf(leaf, { focus: true });
    await workspace.revealLeaf(leaf);
  }
}

class BentoHomeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BentoHomePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.store.data.settings;

    new Setting(containerEl)
      .setName('启动时打开主页')
      .setDesc('打开 Obsidian 时自动进入 Bento 主页')
      .addToggle((toggle) =>
        toggle.setValue(s.openOnStartup).onChange((v) => this.apply({ openOnStartup: v })),
      );

    new Setting(containerEl)
      .setName('问候称呼')
      .setDesc('显示在问候语里，如「早上好，小明」；留空则只显示问候语')
      .addText((text) =>
        text.setPlaceholder('你的名字').setValue(s.greetingName).onChange((v) => this.apply({ greetingName: v })),
      );

    const todoSetting = new Setting(containerEl)
      .setName('待办笔记')
      .setDesc('待办组件读写的笔记，如 ToDo List.md')
      .addText((text) => {
        text.setPlaceholder('ToDo List.md').setValue(this.plugin.store.data.settings.todoNotePath);
        text.onChange((v) => {
          this.apply({ todoNotePath: v });
          validateTodoDesc();
        });
      });
    const validateTodoDesc = () => {
      const desc = todoSetting.descEl;
      const p = normalizePath(this.plugin.store.data.settings.todoNotePath.trim()).replace(/^\//, '');
      const ok = !p || this.app.vault.getAbstractFileByPath(p) instanceof TFile;
      desc.setText(ok ? '待办组件读写的笔记，如 ToDo List.md' : `⚠️ 未找到笔记「${p}」，待办组件会提示创建`);
    };
    validateTodoDesc();

    new Setting(containerEl)
      .setName('完成待办写入当天日记')
      .setDesc('在主页勾选完成待办时，自动追加到当天日记的「今日事」列表；日记不存在时按日记模板创建')
      .addToggle((toggle) =>
        toggle.setValue(s.todoDoneToDaily).onChange((v) => this.apply({ todoDoneToDaily: v })),
      );

    new Setting(containerEl)
      .setName('最近编辑最多条数')
      .setDesc('「最近编辑」组件最多显示的笔记条数；实际按卡片大小自动决定，小卡片显示得少')
      .addSlider((slider) =>
        slider
          .setLimits(3, 40, 1)
          .setValue(s.recentCount)
          .setDynamicTooltip()
          .onChange((v) => this.apply({ recentCount: v })),
      );
  }

  private apply(patch: Parameters<HomeStore['updateSettings']>[0]): void {
    this.plugin.store.updateSettings(patch);
  }
}
