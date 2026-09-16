#!/bin/bash
# @dsh-external/dsh-stm32 构建脚本
#
# 本插件是**纯 ESM JavaScript**（lib/*.js），不需要 tsc —— 生成的骨架默认走 TypeScript，
# 但本机没有 DSH 源码 checkout（$DSH_CHECKOUT/packages + vendor/cordis 都不存在），
# tsc 路径不可用，因此改为直接维护 lib/。
#
# 本脚本只做两件事：
#   1. 确保依赖 junction 存在（lib/ 里的 `import '@deepseek-ai/dsh-tools'` 从包自身 node_modules 解析）
#   2. 语法校验 lib/ 下所有模块
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 依赖 junction ==="
node -e '
const fs = require("fs");
const path = require("path");
const link = path.resolve("node_modules/@deepseek-ai/dsh-tools");
if (fs.existsSync(path.join(link, "lib/index.js"))) { console.log("  ok (已存在)"); process.exit(0); }
const candidates = [
  path.join(process.env.APPDATA || "", "npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools"),
  path.join(process.env.USERPROFILE || "", "AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools"),
];
const target = candidates.find((p) => p && fs.existsSync(path.join(p, "lib/index.js")));
if (!target) { console.error("  ✗ 找不到 @deepseek-ai/dsh-tools；请设置 DSH_TOOLS_DIR 或手工建 junction"); process.exit(1); }
fs.mkdirSync(path.dirname(link), { recursive: true });
fs.rmSync(link, { recursive: true, force: true });
fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
console.log("  ok →", target);
'

echo "=== 语法校验 lib/ ==="
for f in lib/*.js; do
  node --check "$f"
  echo "  ok $f"
done

echo "=== 构建完成（无需 tsc） ==="
