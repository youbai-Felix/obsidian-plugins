# Move Footer to Ribbon

把 Obsidian（1.15+）左下角的**仓库切换 / 帮助 / 设置**三个按钮收进左侧
功能区（ribbon）竖条底部，界面更干净。

## 为什么不简单挪 DOM / 纯 CSS

1.15 里这三个入口行为异构且命令通道不可靠：

- 设置齿轮/帮助各开**独立 Electron 窗口**（命令 `app:open-settings` 等
  `executeCommandById` 返回 true 却不开窗，不可用）
- 仓库切换器开就地 `.menu` 下拉，弹菜单前会**校验自身布局**——
  `display:none` 的按钮上派发指针无效，必须移出屏幕（`left:-9999px`）
  而非隐藏
- 跨容器移动节点纯 CSS 做不到，搬走原节点又会废掉 vault 菜单锚定

## 实现要点

- 不搬原节点：在 ribbon 的 `.side-dock-settings` 原生槽位（1.15 默认为空）
  建 3 个**代理按钮**（克隆原按钮 svg + 补 aria-label），点击把
  `pointerdown/mousedown/pointerup/mouseup/click` **全序列**转发给原按钮
  （switcher 只认 mousedown，帮助/设置认 click，全序列不会双开窗口）
- 无坐标激活会错位菜单锚定：用按钮 rect 中心兜底派发
- **菜单钉住**：仓库菜单打开期间 body 挂 `mfr-pin` 类，CSS 镜像 Minimal
  的 ribbon `:hover` 展开规则，鼠标移到菜单上竖条不缩回；用
  MutationObserver 盯 `.menu` 挂载/移除（后台窗口 rAF 会被 Chromium
  暂停，不能用 rAF 等菜单），500ms 没等到就撤岗防止误钉无关菜单
- 兼容 Minimal 主题：其 `--ribbon-vertical-expand` 机制会把
  `position:fixed; height:100%` 的 ribbon 底部顶出窗口 40px，已用
  `height:auto!important` 修正（styles.css）

## 安装

把整个 `move-footer-to-ribbon` 文件夹放进 `<你的库>/.obsidian/plugins/`，
设置 → 第三方插件 → 启用。仅桌面端（isDesktopOnly）。
