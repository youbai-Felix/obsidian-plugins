import esbuild from "esbuild";
import { copyFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
// 产物直接输出到 vault 的插件目录，配合 hot-reload 插件实现保存即重载
const outDir = path.resolve(root, "../../../.obsidian/plugins/bento-home");

const prod = process.argv[2] === "--production";
const watch = process.argv[2] === "--watch";

await mkdir(outDir, { recursive: true });
await copyFile(path.join(root, "manifest.json"), path.join(outDir, "manifest.json"));
await copyFile(path.join(root, "styles.css"), path.join(outDir, "styles.css"));
// 树影视频素材（源自 minttr 的 leaves.webm，经对比度增强重编码为 leaves-boost.webm）
try {
  await copyFile(path.join(root, "leaves-boost.webm"), path.join(outDir, "leaves.webm"));
} catch {
  console.warn("[bento-home] 未找到 leaves-boost.webm，跳过");
}

const ctx = await esbuild.context({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  platform: "node",
  logLevel: "info",
  outfile: path.join(outDir, "main.js"),
  // 构建时间戳：保证每次构建内容必变，触发 hot-reload 全量重载（连带刷新 styles.css）
  banner: { js: `/* bento-home build: ${new Date().toISOString()} */` },
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
});

if (watch) {
  await ctx.watch();
  console.log("[bento-home] watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
