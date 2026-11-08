# wechat-publish · Stephango 主题

「公众号发布」插件的 [stephango.com](https://stephango.com) 排版复刻主题。

> **状态（2026-11-09）：主题已移植进插件源码**，成为正式功能：
> [Vibe-coding-2026-0103/obsidian-wechat-publish](https://github.com/youbai-Felix/Vibe-coding-2026-0103/tree/main/obsidian-wechat-publish)
> ——`themes.ts` 的 `stephango` 主题对象 + `converter.ts` 的渲染分支，重建构建不再丢失。
>
> 历史：它最初（2026-11-07）以装机产物 main.js 补丁形式存在；2026-11-08 插件从源码
> 重建时被整体覆盖丢失；随后按本目录保留的设计参数在源码层重写。本目录不再提供
> patch 文件，只保留设计文档。

## 设计参数（Flexoki 纸墨配色）

| 元素 | 参数 |
|---|---|
| 正文 | 16px / 行高 1.5（stephango.com 原版保真，显著紧于其他主题的 1.85–1.9） |
| 配色 | 纸 `#FFFCF0` / 墨 `#100F0F` / muted `#6F6E69` / 发丝线 `#E6E4D9` / 米底 `#F2F0E5` |
| 标题 | 零装饰字号阶梯：h1 24px/-0.02em、h2 17px/-0.015em、h3 16px/-0.01em（字重 600） |
| 分割线 | `•••`（#B7B5AC，间距 margin-right 16px 等价字距） |
| 引用 | 2px 墨色左线 + 引文保持正色（不降灰） |
| 高亮 | `#F6E2A0` 实色底 + 700 字重（不用 `<mark>`，微信会剥） |
| 代码块 | 米纸底 `#F2F0E5` + 1px 发丝边框（非灰底） |
| 行内代码 | 米底胶囊 + 发丝边框（与代码块同族） |
| 链接 | 墨色下划线（其余主题走 accent 色） |
| 列表 | 悬挂缩进 + `.15rem 0` 项间缓冲垫（stephango.com 原样） |

微信兼容性沿用插件自身哲学：不用 `<mark>`/空 span 装饰、防广告插卡（卡内全行内元素）、
列表圆点用真实字符（粘贴安全）。
