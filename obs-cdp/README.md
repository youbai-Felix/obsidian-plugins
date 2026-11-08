# obs-cdp — Obsidian CDP 调试助手

通过 Chrome DevTools Protocol 连接 Obsidian（Electron）做自动化验证的
Deno 单文件小工具。Obsidian 需以调试口启动：

```bash
open -a Obsidian --args --remote-debugging-port=9223
```

## 用法

```bash
# 执行 JS：表达式写在文件里（须为 IIFE 形式，返回值打印到 stdout）
deno run -A cdp.ts eval expr.js

# 全窗截图
deno run -A cdp.ts shot out.png

# 移动鼠标到 (x,y) 触发/解除 hover 后截图
deno run -A cdp.ts hovershot <x> <y> out.png

# 仅移动鼠标
deno run -A cdp.ts move <x> <y>

# 可信级鼠标点击（完整 press/release 序列）
deno run -A cdp.ts click <x> <y>

# 点击左缘 ribbon 区域：先进 10px 悬停带等展开再点（模拟真实轨迹），
# 冷态 ribbon 仅 10px 宽且 overflow:hidden，直接瞬移永不触发 hover
deno run -A cdp.ts clickribbon <x> <y>
```

## 内置防御

- 多 vault 窗口：按 `app://obsidian.md` URL 过滤 target，再逐个试探
  `typeof app !== "undefined"` 挑活连接（渲染器闪崩自愈会留下 app
  永久 undefined 的僵尸 target）
- 截图别用 clip + `getBoundingClientRect` 的 CSS 值：高 DPR（如 2.4）
  下会偏到左上，全窗截图更稳
