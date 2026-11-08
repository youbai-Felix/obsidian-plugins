# wechat-publish · Stephango 主题补丁

给 Obsidian 第三方插件「公众号发布」（wechat-publish v1.0.0，作者 游白）
增加 **Stephango 主题**的补丁。本目录只提供 `stephango-theme.patch`
（diff）与说明，**不含插件本体**——插件文件版权属原作者，请自行安装原版。

## 主题长什么样（Flexoki 纸墨配色）

| 元素 | 参数 |
|---|---|
| 正文 | 16px / 行高 1.5（插件其他主题 1.85–1.9，此处按 stephango.com 保真 1.5） |
| 配色 | 纸 `#FFFCF0` / 墨 `#100F0F` / muted `#6F6E69` / 发丝线 `#E6E4D9` / 米底 `#F2F0E5` |
| 标题 | 零装饰字号阶梯：h1 24px/-0.02em、h2 17px/-0.015em、h3 16px（字重 600） |
| 分割线 | `•••`（#B7B5AC，字距用 margin-right 16px 等价） |
| 引用 | 2px 黑色左线 + 正色不降灰 |
| 高亮 | `#F6E2A0` 实色底 |
| 代码块 | 纸底 + 1px 发丝边框（非灰底） |
| 链接 | 墨色下划线 |

微信编辑器兼容性沿用插件自身哲学：不用 `<mark>`/空 span 装饰（会被微信剥）、
防广告插卡（卡片内全行内元素）、安卓 600 字重缺失顾虑（用 700 派）。

## 打补丁

```bash
# 1. 进插件目录，先备份原版（补丁基线 = v1.0.0 的 main.js）
cd <你的库>/.obsidian/plugins/wechat-publish
cp main.js main.js.bak-stephango

# 2. 应用补丁
patch main.js < stephango-theme.patch

# 3. 语法自检
node --check main.js

# 4. 重载插件：禁用再启用，或重启 Obsidian
```

然后在插件设置的主题列表里选「Stephango」即可（主题对象注册进
`themes` 后设置面板自动生成按钮，无需改面板）。

## 补丁原理

- 1 个主题对象（调色板 + 字号/行高/间距/`bulletChar` 等字段）注册进
  `const themes = {}`
- 11 处 `theme.name === "Stephango"` 特判分支：
  `renderHeading / renderHr / renderBlockquote / renderHighlight /
  renderInlineCode / renderCodeBlock / renderOrderedList / renderBold /
  renderInlineToken.link` 等
- 所有主题导出都包整篇背景 section（`t.background`），新主题自动获得纸色底

## ⚠️ 插件更新会覆盖补丁

wechat-publish 更新会整个替换 `main.js`，补丁随之丢失。更新后按上面流程
对**新版本**重打；若原版代码有变动导致 patch 拒绝套用，参考上表参数手工
重建各特判分支（约 +4.4KB）。
