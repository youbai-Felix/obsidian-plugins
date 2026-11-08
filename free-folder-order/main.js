/* Free Folder Order v1.3 — Notion 风格拖拽排序 + 跨层级移动
 *
 * 交互：
 *  - 行的任意位置可拖；鼠标在目标行上半部 = 插到它前面，下半部 = 插到它后面
 *  - 指示线是横跨目标行整行宽度的蓝色粗横线，出现在行的上方或下方
 *  - 跨层级：拖到文件夹上悬停约 0.75s 自动展开，进入后再落到目标行旁边
 *    （落点在别的层级 = 自动移动过去并排到该位置）
 *  - 空文件夹悬停后整行高亮，松手 = 移入该文件夹
 *  - 根层级条目拖到列表空白处 = 移到根层级末尾
 *  - 文件浏览器内原生拖拽行为（移入高亮等）被接管屏蔽
 *
 * 数据: { orders: { "<父目录路径,根为空串>": ["子项名", ...] } }
 */
'use strict';

const { Plugin, Notice } = require('obsidian');

const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
const DWELL_MS = 900;   // 悬停多久后展开/进入
const MOVE_EPS = 6;     // 光标位移超过该值才算「移动」，并解除展开锁
const BAND = 0.3;       // 只认行的中央 40% 区域的悬停（避开上下边缘的对线操作）

class FreeFolderOrder extends Plugin {
  async onload() {
    this.data = (await this.loadData()) || { orders: {} };
    if (!this.data.orders) this.data.orders = {};
    if (!this.data.rules) this.data.rules = {};

    this.draggedPath = null;
    this.dropAtRoot = false;
    this.hoverPath = null;
    this.hoverSince = 0;
    this.lastX = null;
    this.lastY = null;
    this.expandLock = false;
    this.dropIntoPath = null;
    this.dropIntoRow = null;
    this._initTimer = null;

    this.indicatorEl = document.createElement('div');
    this.indicatorEl.className = 'ffo-indicator';
    document.body.appendChild(this.indicatorEl);

    this.app.workspace.onLayoutReady(() => this.patchViews());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.debouncedPatch()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.debouncedPatch()));

    // 右键文件夹 → 排序规则子菜单
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source) => {
        if (!source || !source.startsWith('file-explorer') || !file || !file.children) return;
        menu.addItem((item) => {
          item.setTitle('排序规则').setIcon('list-ordered');
          const key = file.path && file.path !== '/' ? file.path : '';
          const current = this.data.rules[key];
          const opts = [
            ['', '默认（跟随全局 / 拖拽自定义）'],
            ['alphabetical', '名称 A→Z'],
            ['alphabeticalReverse', '名称 Z→A'],
            ['byCreatedTime', '创建时间 旧→新'],
            ['byCreatedTimeReverse', '创建时间 新→旧'],
            ['byModifiedTime', '修改时间 旧→新'],
            ['byModifiedTimeReverse', '修改时间 新→旧'],
          ];
          const sub = typeof item.setSubmenu === 'function' ? item.setSubmenu() : null;
          for (const [val, label] of opts) {
            const title = (current === val || (!current && !val)) ? '✓ ' + label : label;
            const add = (mi) => mi.setTitle(title).onClick(() => this.setFolderRule(key, val));
            if (sub) sub.addItem(add);
            else menu.addItem(add);
          }
        });
      })
    );

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.onDelete(file)));

    this.registerDomEvent(window, 'dragstart', (e) => this.onDragStart(e), true);
    this.registerDomEvent(window, 'dragover', (e) => this.onDragOver(e), true);
    this.registerDomEvent(window, 'drop', (e) => this.onDrop(e), true);
    this.registerDomEvent(window, 'dragend', () => this.finishDrag(), true);

    this.addCommand({
      id: 'reset-order',
      name: '清除全部自定义排序',
      callback: () => {
        this.data.orders = {};
        this.save();
        this.requestSortAll();
        new Notice('已清除全部自定义排序，恢复默认');
      },
    });
    this.addCommand({
      id: 'reapply-order',
      name: '重新应用自定义排序',
      callback: () => this.requestSortAll(),
    });
  }

  onunload() {
    this.indicatorEl.remove();
    this.clearDropInto();
    for (const view of this.getExplorerViews()) {
      if (view.__ffoOrigSort) {
        view.getSortedFolderItems = view.__ffoOrigSort;
        delete view.__ffoOrigSort;
        delete view.__ffoPatched;
        view.requestSort && view.requestSort();
      }
    }
  }

  save() {
    this.saveData(this.data).catch(() => {});
  }

  setFolderRule(key, val) {
    if (val) this.data.rules[key] = val;
    else delete this.data.rules[key];
    this.save();
    this.requestSortAll();
    new Notice(val ? '已设置排序规则：' + key : '已恢复默认排序', 1500);
  }

  getExplorerViews() {
    return this.app.workspace
      .getLeavesOfType('file-explorer')
      .map((l) => l.view)
      .filter((v) => v && typeof v.getSortedFolderItems === 'function');
  }

  debouncedPatch() {
    clearTimeout(this._initTimer);
    this._initTimer = setTimeout(() => this.patchViews(), 500);
  }

  /* ---------- 接管排序出口 ---------- */

  patchViews() {
    for (const view of this.getExplorerViews()) {
      if (view.__ffoPatched) continue;
      view.__ffoPatched = true;
      view.__ffoOrigSort = view.getSortedFolderItems.bind(view);
      view.getSortedFolderItems = (folder) => {
        // 根目录的 TFolder.path 是 '/'，统一归一为空串
        const key = folder && folder.path && folder.path !== '/' ? folder.path : '';
        const rule = this.data.rules[key];
        let items;
        if (rule) {
          // 该文件夹设有排序规则：临时借用 Obsidian 原生比较器（规则优先于拖拽顺序）
          const prev = view.sortOrder;
          view.sortOrder = rule;
          items = view.__ffoOrigSort(folder);
          view.sortOrder = prev;
          // Obsidian 原生语义：子文件夹恒按名称升序。这里增强——名称倒序规则同时倒序子文件夹
          if (rule === 'alphabeticalReverse') {
            let k = 0;
            while (k < items.length && items[k].file && items[k].file.children) k++;
            items = items.slice(0, k).reverse().concat(items.slice(k));
          }
        } else {
          items = view.__ffoOrigSort(folder);
          const order = this.data.orders[key];
          if (order && order.length && items.length >= 2) {
            const rank = new Map();
            order.forEach((n, i) => rank.set(n, i));
            items = items
              .map((it, i) => ({ it, i, r: rank.has(it.file.name) ? rank.get(it.file.name) : 1e9 + i }))
              .sort((a, b) => a.r - b.r)
              .map((x) => x.it);
          }
        }
        return items;
      };
    }
  }

  requestSortAll() {
    for (const view of this.getExplorerViews()) view.requestSort && view.requestSort();
  }

  /* ---------- 坐标命中检测（绕过拖拽 overlay） ---------- */

  rowFromPoint(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!(el instanceof Element)) continue;
      if (!el.closest('.nav-files-container')) continue; // 只认文件浏览器内的元素
      const row = el.classList.contains('tree-item-self') ? el : el.closest('.tree-item-self');
      if (row) return row;
    }
    return null;
  }

  rowPath(row) {
    if (!row) return null;
    return row.dataset.path || (row.closest('.tree-item') && row.closest('.tree-item').dataset.path) || null;
  }

  inExplorerPoint(x, y) {
    return document.elementsFromPoint(x, y).some(
      (el) => el instanceof Element && !!el.closest('.nav-files-container')
    );
  }

  isFolderRow(row) {
    return !!(row.querySelector('.collapse-icon') || row.classList.contains('mod-collapsible'));
  }

  isCollapsed(row) {
    const item = row.closest('.tree-item');
    return !!(item && item.classList.contains('is-collapsed'));
  }

  hitTest(e) {
    const row = this.rowFromPoint(e.clientX, e.clientY);
    if (!row) return null;
    const path = this.rowPath(row);
    if (!path) return null;
    const rect = row.getBoundingClientRect();
    const zone = e.clientY < (rect.top + rect.bottom) / 2 ? 'before' : 'after';
    return { row, path, zone, rect };
  }

  rootRows() {
    const rows = [];
    for (const view of this.getExplorerViews()) {
      view.containerEl.querySelectorAll('.tree-item-self').forEach((r) => {
        const p = this.rowPath(r);
        if (p && !p.includes('/')) rows.push(r);
      });
    }
    return rows;
  }

  expandFolder(path) {
    for (const view of this.getExplorerViews()) {
      const it = view.fileItems && view.fileItems[path];
      if (it && typeof it.setCollapsed === 'function') {
        try { it.setCollapsed(false, true); } catch (err) { /* 忽略 */ }
      }
    }
  }

  // 清掉 Obsidian 原生的「拖拽悬停 750ms 自动展开」定时器
  // （dragManager 在 window 捕获阶段注册得比插件早，stopPropagation 拦不到，
  //  只能每次接管 dragover 时把它挂在视图上的 mouseoverExpandTimeout 清除）
  suppressNativeExpand() {
    for (const view of this.getExplorerViews()) {
      if (view.mouseoverExpandTimeout != null) {
        try { (view.win || window).clearTimeout(view.mouseoverExpandTimeout); } catch (err) { /* 忽略 */ }
        view.mouseoverExpandTimeout = null;
      }
    }
  }

  /* ---------- 指示线与悬停状态 ---------- */

  positionIndicator(hit) {
    const ind = this.indicatorEl;
    if (!hit) { ind.style.display = 'none'; return; }
    const top = hit.zone === 'before' ? hit.rect.top - 2 : hit.rect.bottom - 1;
    ind.style.display = 'block';
    ind.style.left = hit.rect.left + 'px';
    ind.style.top = top + 'px';
    ind.style.width = hit.rect.width + 'px';
  }

  hideIndicator() {
    this.indicatorEl.style.display = 'none';
  }

  setDropInto(row, path) {
    this.clearDropInto();
    this.dropIntoPath = path;
    this.dropIntoRow = row;
    row.classList.add('ffo-drop-into');
  }

  clearDropInto() {
    if (this.dropIntoRow) {
      this.dropIntoRow.classList.remove('ffo-drop-into');
      this.dropIntoRow = null;
    }
    this.dropIntoPath = null;
  }

  /* ---------- 拖拽处理 ---------- */

  onDragStart(e) {
    if (!(e.target instanceof Element)) return;
    const row = e.target.closest('.tree-item-self');
    this.draggedPath = this.rowPath(row);
    this.dropAtRoot = false;
    this.hoverPath = null;
    this.hoverSince = 0;
    this.lastX = null;
    this.lastY = null;
    this.expandLock = false;
    this.clearDropInto();
  }

  onDragOver(e) {
    if (!this.draggedPath) return;
    const hit = this.hitTest(e);

    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      this.suppressNativeExpand();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      // 光标真正移动了：刷新静止计时并解除展开锁
      const moved =
        this.lastX == null ||
        Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY) > MOVE_EPS;
      if (moved) {
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.hoverSince = Date.now();
        this.expandLock = false;
      }

      if (hit.path !== this.hoverPath) {
        this.clearDropInto();
        this.hoverPath = hit.path;
        this.hoverSince = Date.now();
      }

      // 悬停文件夹：光标静止 0.9s 且位于行中央区域才展开（有空子项）
      // 或进入「移入」模式（空文件夹）；展开后上锁，防止连锁展开
      if (hit.path !== this.draggedPath && !this.expandLock && this.isFolderRow(hit.row)) {
        const inBand =
          e.clientY > hit.rect.top + hit.rect.height * BAND &&
          e.clientY < hit.rect.bottom - hit.rect.height * BAND;
        const file = this.app.vault.getAbstractFileByPath(hit.path);
        if (file && file.children && inBand && Date.now() - this.hoverSince >= DWELL_MS) {
          if (file.children.length === 0) {
            if (!this.dropIntoPath) this.setDropInto(hit.row, hit.path);
          } else if (this.isCollapsed(hit.row)) {
            this.expandFolder(hit.path);
            this.expandLock = true; // 展开后须移动光标才可再触发展开
          }
        }
      }

      if (this.dropIntoPath) {
        this.hideIndicator(); // 空文件夹「移入」模式：整行高亮代替横线
      } else {
        this.positionIndicator(hit);
      }
      this.dropAtRoot = false;
      return;
    }

    if (this.inExplorerPoint(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      this.suppressNativeExpand();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      this.dropAtRoot = true;
      const rows = this.rootRows();
      const last = rows[rows.length - 1];
      if (last) {
        const rect = last.getBoundingClientRect();
        this.positionIndicator({ row: last, path: this.rowPath(last), zone: 'after', rect });
      }
      return;
    }

    this.hideIndicator();
  }

  onDrop(e) {
    if (!this.draggedPath) return;
    const dragged = this.draggedPath;
    const hit = this.hitTest(e);

    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropIntoPath && hit.path === this.dropIntoPath) {
        this.applyMove(dragged, null, null, this.dropIntoPath);
      } else if (dragged !== hit.path) {
        this.applyReorderOrMove(dragged, hit.path, hit.zone);
      }
      this.finishDrag();
      return;
    }

    if (this.dropAtRoot && this.inExplorerPoint(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      this.applyReorderOrMove(dragged, null, 'append');
    }
    this.finishDrag();
  }

  applyReorderOrMove(dragged, targetPath, zone) {
    const targetParent = targetPath ? parentOf(targetPath) : '';
    if (targetParent === parentOf(dragged)) {
      this.applyReorder(dragged, targetPath, zone);
    } else {
      this.applyMove(dragged, targetPath, zone, null);
    }
  }

  async applyMove(dragged, targetPath, zone, intoFolder) {
    const file = this.app.vault.getAbstractFileByPath(dragged);
    if (!file) return;
    const destFolder = intoFolder != null ? intoFolder : targetPath ? parentOf(targetPath) : '';
    if (destFolder === dragged || destFolder.startsWith(dragged + '/')) {
      new Notice('不能移动到文件夹自身内部', 1500);
      return;
    }
    const newPath = (destFolder ? destFolder + '/' : '') + baseOf(dragged);
    if (newPath === dragged) return;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice('目标位置已有同名项：' + baseOf(dragged), 2000);
      return;
    }
    // 移动（onRename 会同步迁移 orders 到新层级末尾）
    await this.app.fileManager.renameFile(file, newPath);
    if (targetPath || zone === 'append') {
      this.applyReorder(dragged, targetPath, zone); // 再调整到精确位置
    } else {
      this.requestSortAll();
    }
  }

  applyReorder(dragged, targetPath, zone) {
    const targetParent = targetPath ? parentOf(targetPath) : '';
    if (targetPath && (dragged === targetPath || targetParent == null)) return;
    if (targetParent === dragged || (targetParent || '').startsWith(dragged + '/')) return;

    const folder =
      targetParent === '' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(targetParent);
    if (!folder || !folder.children) return;

    // 基底 = 当前显示顺序（补丁后的 getSortedFolderItems 输出）
    const view0 = this.getExplorerViews()[0];
    let base = view0
      ? view0.getSortedFolderItems(folder).map((it) => it.file.name)
      : folder.children.map((c) => c.name);

    const dn = baseOf(dragged);
    if (zone !== 'append') {
      const tn = baseOf(targetPath);
      const i = base.indexOf(dn);
      if (i >= 0) base.splice(i, 1);
      let at = base.indexOf(tn);
      if (at < 0) { base.push(tn); at = base.length - 1; }
      base.splice(zone === 'before' ? at : at + 1, 0, dn);
    } else {
      const i = base.indexOf(dn);
      if (i >= 0) base.splice(i, 1);
      base.push(dn);
    }

    this.data.orders[targetParent] = base;
    this.save();
    this.requestSortAll();
  }

  finishDrag() {
    this.draggedPath = null;
    this.dropAtRoot = false;
    this.hoverPath = null;
    this.hoverSince = 0;
    this.lastX = null;
    this.lastY = null;
    this.expandLock = false;
    this.clearDropInto();
    this.hideIndicator();
    this.cleanupDragVisuals();
    // 延迟补刀：dragManager 自己的收尾路径可能在我们的清理之后又挂上/残留，50ms 后再扫一遍
    setTimeout(() => this.cleanupDragVisuals(), 50);
  }

  // 替 Obsidian 补齐拖拽收尾（它的事件流被本插件接管后时常跑不完整）
  // 残留症状：光标手形(is-grabbing)、文件夹红色/灰色悬停块(is-being-dragged-over)
  cleanupDragVisuals() {
    document.body.classList.remove('is-grabbing');
    // 扫荡式摘类：不依赖 dragManager 内部的元素引用（重渲染后引用会失效）
    document
      .querySelectorAll('.is-being-dragged, .is-being-dragged-over, .is-active-drop')
      .forEach((el) => el.classList.remove('is-being-dragged', 'is-being-dragged-over', 'is-active-drop'));
    try {
      const dm = this.app.dragManager;
      if (dm) {
        if (dm.ghostEl) { dm.ghostEl.detach && dm.ghostEl.detach(); dm.ghostEl = null; }
        dm.dragStart = null;
        dm.draggable = null;
        if (dm.updateSource) dm.updateSource(null, '');
        if (dm.updateHover) dm.updateHover(null, '');
        dm.hoverEl = null;
        dm.hoverClass = '';
        if (dm.removeOverlay) dm.removeOverlay();
      }
    } catch (err) { /* 忽略 */ }
  }

  /* ---------- vault 事件同步 ---------- */

  onRename(file, oldPath) {
    const o = this.data.orders;
    const oldParent = parentOf(oldPath);
    const newParent = parentOf(file.path);
    const oldName = baseOf(oldPath);
    const newName = baseOf(file.path);

    if (o[oldParent]) o[oldParent] = o[oldParent].map((n) => (n === oldName ? newName : n));
    if (oldParent !== newParent) {
      if (o[oldParent]) o[oldParent] = o[oldParent].filter((n) => n !== newName);
      (o[newParent] = o[newParent] || []).push(newName);
    }
    if (file.children) {
      for (const k of Object.keys(o)) {
        if (k.startsWith(oldPath + '/')) {
          o[file.path + '/' + k.slice(oldPath.length + 1)] = o[k];
          delete o[k];
        }
      }
    }
    // 文件夹重命名：迁移排序规则键
    if (this.data.rules) {
      const r = this.data.rules;
      if (r[oldPath] !== undefined) { r[file.path] = r[oldPath]; delete r[oldPath]; }
      for (const k of Object.keys(r)) {
        if (k.startsWith(oldPath + '/')) {
          r[file.path + '/' + k.slice(oldPath.length + 1)] = r[k];
          delete r[k];
        }
      }
    }
    this.save();
    this.requestSortAll();
  }

  onDelete(file) {
    const o = this.data.orders;
    const p = parentOf(file.path);
    const name = baseOf(file.path);
    if (o[p]) o[p] = o[p].filter((n) => n !== name);
    for (const k of Object.keys(o)) {
      if (k.startsWith(file.path + '/')) delete o[k];
    }
    if (this.data.rules) {
      const r = this.data.rules;
      delete r[file.path];
      for (const k of Object.keys(r)) {
        if (k.startsWith(file.path + '/')) delete r[k];
      }
    }
    this.save();
  }
}

module.exports = FreeFolderOrder;
