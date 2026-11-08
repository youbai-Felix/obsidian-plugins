# Obsidian CSS 片段

拷进 `<你的库>/.obsidian/snippets/`，设置 → 外观 → CSS 片段里开启。

## stephango排版.css

[stephango.com](https://stephango.com) 排版复刻（for Minimal 9.x /
Obsidian 1.14+），参数逆向自网站原版 styles.css：

- 系统字体栈（Inter/IBM Plex Sans，零 webfont）、流体正文字号
- 层级映射：笔记标题 ↔ 网站 h1，`#`一级 ↔ h2，`##` ↔ h3，`###` ↔ h4
- 标题字号阶梯与负字距（-0.02em / -0.015em）、发丝线分割等细节

## 中文字体片段（5 个）

正文字体一键切换，**同一时间只开一个**：

| 片段 | 字体 |
|---|---|
| `霞鹜文楷.css` | LXGW WenKai（开源，手写感） |
| `仓耳今楷.css` | 仓耳今楷01（试用；商用需仓耳授权），含合成粗体描边增强 |
| `方正悠宋.css` | 方正悠宋 |
| `方正聚珍新仿.css` | 方正聚珍新仿 |
| `方正兰亭圆.css` | 方正兰亭圆 |

> 方正系字体需本机已安装；片段只设 `--font-text-override` 与标题字重，
> 不内嵌字体文件。商用注意字库授权。

## 界面微调（2 个）

- `zen-隐藏左侧边框.css`：去边框的沉浸观感
- `hide-excalidraw-toolbar.css`：隐藏 Excalidraw 工具条（快捷键党）
