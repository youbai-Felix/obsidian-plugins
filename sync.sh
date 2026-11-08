#!/bin/bash
# 从 vault 实际位置刷新本仓库的快照副本（源目录才是使用中的版本）。
# 用法：改了插件/snippets 后在仓库根跑 ./sync.sh，git diff 检查无误再提交。
set -euo pipefail
cd "$(dirname "$0")"
VAULT="$(cd ../.. && pwd)"          # .plugin-dev/obsidian-plugins → vault 根
PLUGINS="$VAULT/.obsidian/plugins"

# bento-home/ 是活源码（在本仓库内开发），不走快照同步。

# 快照同步小插件（排除本机数据 data.json）
for p in free-folder-order move-footer-to-ribbon stephango-theme-toggle; do
  rsync -a --exclude data.json --exclude .DS_Store "$PLUGINS/$p/" "$p/"
done

# CSS snippets
rsync -a --exclude .DS_Store "$VAULT/.obsidian/snippets/" snippets/

# wechat-publish Stephango 主题补丁 diff（原版备份 vs 补丁版）
diff -u \
  --label 'main.js（wechat-publish v1.0.0 原版）' \
  --label 'main.js（Stephango 主题补丁版）' \
  "$PLUGINS/wechat-publish/main.js.bak-stephango" "$PLUGINS/wechat-publish/main.js" \
  > wechat-publish-stephango/stephango-theme.patch || true

# obs-cdp 工具（源在 ~/.zcode/tmp，tmp 会被清理，以仓库为准以后改这里）
# 若仓库版本更新，反向同步：cp obs-cdp/cdp.ts ~/.zcode/tmp/obs-cdp/cdp.ts

echo "已刷新。git diff 检查后提交。"
