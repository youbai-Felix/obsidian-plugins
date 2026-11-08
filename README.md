# obsidian-plugins

我的 Obsidian 插件与配套工具合集。每个插件一个目录，自带 README，互不耦合。

## 插件

| 插件 | 说明 |
|---|---|
| [bento-home/](bento-home/) | **Bento 主页**：常驻可视化主页——Bento 网格布局、笔记卡（底部弹层所见即所得编辑）、待办分区归档、加权搜索、每日笔记、最近编辑（TypeScript 源码工程） |
| [free-folder-order/](free-folder-order/) | **Free Folder Order**：文件浏览器 Notion 式拖拽排序，跨层级悬停展开移动，per-folder 排序规则 |
| [move-footer-to-ribbon/](move-footer-to-ribbon/) | 把左下角的仓库切换/帮助/设置收进左侧功能区竖条底部（Obsidian 1.15+ 代理按钮方案） |
| [stephango-theme-toggle/](stephango-theme-toggle/) | 笔记右上角的 [stephango.com](https://stephango.com) 风格明暗模式切换开关 |

## 配套

| 目录 | 说明 |
|---|---|
| [snippets/](snippets/) | CSS 片段：stephango.com 排版复刻、中文字体栈、界面微调 |
| [obs-cdp/](obs-cdp/) | Obsidian CDP 调试助手（Deno：eval / 截图 / 合成鼠标输入） |
| [wechat-publish-stephango/](wechat-publish-stephango/) | 「公众号发布」插件 Stephango 主题设计参数（实现已进[插件源码](https://github.com/youbai-Felix/Vibe-coding-2026-0103/tree/main/obsidian-wechat-publish)） |

公众号相关的独立插件见 [wechat-publish](https://github.com/youbai-Felix/wechat-publish)；
更多 AI 结对编程项目见 [Vibe-coding-2026-0103](https://github.com/youbai-Felix/Vibe-coding-2026-0103)。

## 同步方式

- `bento-home/` 是**活源码**（TypeScript 工程，esbuild 产物直接输出到 vault 的
  `.obsidian/plugins/bento-home/` 实现热重载）——在本目录开发、在本仓库提交
- 其余小插件与 snippets 的使用位置在 `.obsidian/plugins/`、`.obsidian/snippets/`，
  本仓库存放其快照：改动后运行 `./sync.sh` 刷新再提交

## License

[MIT](LICENSE)
