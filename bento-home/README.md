# Bento 主页（bento-home）

一个常驻的 Obsidian 可视化主页：Bento 网格布局，自由增删、拖拽、缩放卡片，
置顶常用笔记并显示摘要预览，集成待办、搜索、每日笔记与最近编辑。

视觉参考 [my.minttr.com](https://my.minttr.com)：暖奶油纸卡风格 + 树影动效
（`leaves.webm` 实拍影层，`mix-blend-mode: multiply` 全屏叠加）。

## 特性

- **Bento 网格**：卡片可拖动换位、缩放宽高（半行半列双刻度），编辑模式一键调布局
- **笔记卡片**：置顶常用笔记，摘要实时同步；点击从底部弹层打开，所见即所得编辑，保存时与外部修改三方合并
- **待办清单**：直接读写指定笔记（默认 `ToDo List.md`）；`---` 线上为当天区、线下为历史区，勾选即完成并归档，跨天自动滚动归档；完成可写入当天日记
- **搜索**：文件名/别名/路径加权评分（移植自 [qiaomu-home](https://github.com/joeseesun/qiaomu-home) 的 rankNotes）+ 正文全文搜索；回车打开，＋号按输入新建
- **每日笔记 / 最近编辑 / 时钟问候**
- **入口**：侧栏图标、命令面板、文件右键「添加到 Bento 主页」（含 Notebook Navigator 文件列表右键）；快捷键可绑定「打开主页」
- 主页激活时自动隐藏状态栏等周边 UI，全屏沉浸

## 使用

- **打开主页**：左侧栏 🏠 图标 / 命令面板「Bento 主页：打开主页」；默认启动 Obsidian 时自动打开（可在设置关闭）
- **拖动换位**：鼠标悬停卡片，左上角浮现拖柄 ⠿，按住即可拖动换位（无需进入编辑模式）
- **编辑布局**：视图右上角 ✏️ 按钮 → 出现缩放柄/删除按钮；再点 ✓ 退出
- **添加卡片**：右上角 ＋ 或编辑模式里的空状态按钮；也可以在文件上**右键 → 添加到 Bento 主页**，或用命令「添加当前笔记到主页」
- **卡片大小**：编辑模式下拖右下角角柄——横向改宽度（1~全列）、纵向改高度（1~6 行）；笔记卡片会显示摘要预览（单行简短版、多行完整版）
- **组件**：
  - 笔记卡片：点击打开笔记，摘要实时同步
  - 待办清单：直接勾选/新增，读写设置里指定的笔记（默认 `ToDo List.md`）
  - 搜索：模糊搜索并回车打开；输入内容后点 ＋ 可按输入内容快速新建笔记
  - 每日笔记：跟随核心「日记」插件的文件夹/格式设置，一键打开或创建
  - 最近编辑 / 时钟问候

## 安装

本插件未上架社区市场，手动安装：

1. 下载本目录（`bento-home/`，为合集仓库的一个子目录）
2. 把 `manifest.json`、`styles.css` 和构建出的 `main.js` 放进
   `<你的库>/.obsidian/plugins/bento-home/`
3. 设置 → 第三方插件 → 启用「Bento 主页」

也可以从源码构建（见下）。

## 树影素材（版权说明）

主页的树影动效素材 `leaves.webm` 源自 [my.minttr.com](https://my.minttr.com)
（经对比度增强 + 乒乓式无缝循环重编码：正向+倒放拼接，循环点帧差 0.05%）。
**素材版权归 minttr，仅供个人使用，不能随本仓库再分发**，因此被
`.gitignore` 排除。

没有这个文件时插件功能完全不受影响，只是没有树影层。如需该效果，请自备
一段树叶光影视频，重命名为 `leaves.webm` 放到插件目录或仓库根目录。

## 开发

```bash
npm install
npm run dev        # watch 模式，配合 hot-reload 插件保存即重载
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建（压缩、无 sourcemap）
```

注意：`esbuild.config.mjs` 的产物默认输出到 `../../../.obsidian/plugins/bento-home/`
（即假设本目录位于 vault 的 `.plugin-dev/obsidian-plugins/bento-home/`，实现
「保存即热重载」）。独立克隆使用时请自行修改 outDir。

- 构建带**时间戳 banner**：纯改样式也会触发产物变化，保证 hot-reload 全量重载
- 修改样式：改 `styles.css` 后重新 `npm run build` 即可

### 目录结构

```
src/
  main.ts            # 插件入口、设置
  view.ts            # 主页视图（网格、树影层、刷新调度）
  grid.ts / dnd.ts   # 网格布局计算 / 拖拽
  store.ts           # data.json 防抖持久化（v3 带数据迁移）
  sheet.ts           # 底部弹层（contenteditable 所见即所得编辑）
  htmlToMd.ts        # DOM → Markdown 还原 + 行级三方合并
  searchCore.ts      # 搜索评分（移植自 qiaomu-home）
  dailyNote.ts       # 每日笔记 / 完成任务写日记
  picker.ts          # 卡片选择器
  widgets/           # 笔记卡 / 待办 / 搜索 / 每日 / 最近编辑 / 时钟
styles.css           # minttr 风格样式
```

## 致谢

- 视觉风格与树影动效灵感来自 [my.minttr.com](https://my.minttr.com)（未开源）
- 搜索评分逻辑（rankNotes）移植自 [joeseesun/qiaomu-home](https://github.com/joeseesun/qiaomu-home)

## License

[MIT](../LICENSE)
