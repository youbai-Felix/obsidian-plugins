# Stephango Theme Toggle

在笔记右上角（编辑/更多按钮左侧）添加 [stephango.com](https://stephango.com)
同款的明暗模式胶囊切换开关。

## 特性

- 设计原样复刻 stephango.com/styles.css：36×20 胶囊边框 + 18×18 mask 滑块
  （亮色＝太阳居左 / 暗色＝月亮滑右 / hover＝accent 色）
- 颜色全部用 Obsidian 语义变量（`--background-modifier-border` /
  `--text-muted` / `hsl(--accent-h/s/l)`…），适配任意主题配色
- 视觉状态纯 CSS 驱动 `body.theme-dark`，JS 只调 `app.changeTheme`
- 监听 `active-leaf-change` / `layout-change`，每个 markdown 标签页都有

## 实现要点（踩过的坑）

- **`app.changeTheme` 竞态**：两次调用间隔 <1.5s 时第二次会被静默吞掉。
  修法＝applying 守卫 + 生效校验（调用后轮询 body class 至多 2s，
  未翻转重试 3 次）
- 注入点 `.view-actions` 的 firstChild；popout 窗口不注入（已知局限）

## 安装

把整个 `stephango-theme-toggle` 文件夹放进 `<你的库>/.obsidian/plugins/`，
设置 → 第三方插件 → 启用。
