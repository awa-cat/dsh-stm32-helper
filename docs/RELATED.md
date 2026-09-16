# 相关项目与生态分工

本仓库只包含**自己写的代码与技能**。某些能力依赖第三方项目，按"引用而不内嵌"的原则处理，
以避免在无许可证的情况下二次分发他人代码。

## 与 embed-ai-tool 的关系

[embed-ai-tool](https://github.com/LeoKemp223/embed-ai-tool) 是一套面向 AI 编程助手的嵌入式
开发技能集（24 个技能：Keil / IAR / CMake / Makefile / PlatformIO / ESP-IDF 构建，烧录、
GDB / J-Link / OpenOCD 调试、串口、CAN / Modbus / VISA 协议调试等）。

**两者互补，不重叠**：

| 环节 | embed-ai-tool | 本仓库 |
|---|---|---|
| 外设配置（串口/GPIO/…） | ❌ 无（全仓库无 `cubemx` / `.ioc` 相关内容） | ✅ `stm32_ioc_set` |
| CubeMX 无头生成工程 | ❌ 无 | ✅ `stm32_generate` |
| 生成物越界改动保护 | ❌ 无 | ✅ `stm32_guard` |
| 已有工程的构建 / 烧录 / 调试 / 串口 / 静态分析 | ✅ 24 个技能 | 只做薄封装（`stm32_flash` / `stm32_serial`） |

它的价值在于"工程已经存在之后"的那一半；本仓库补的是"工程怎么被配置和生成出来"的那一半。

### 为什么不把它内嵌进来

上游仓库**没有 LICENSE 文件**，即默认"保留所有权利"。把它复制进本仓库再发布，等于在无授权
的情况下二次分发他人代码。因此本仓库**不包含**也不建议这样做。

### 想同时用两者

请直接从上游安装，并把目录指向 DSH 的用户级技能根：

```powershell
git clone https://github.com/LeoKemp223/embed-ai-tool.git
$dst = "$env:USERPROFILE\.dsh\skills"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item .\embed-ai-tool\shared -Destination $dst -Recurse -Force
'build-keil','flash-keil','serial-monitor','memory-analysis','static-analysis','workflow' |
  ForEach-Object { Copy-Item ".\embed-ai-tool\skills\$_" -Destination $dst -Recurse -Force }
```

两点注意：

1. **`shared/` 必须一起装**。上游每个脚本都用自身位置反推依赖
   （`_SKILLS_DIR.parent / "shared"`），只复制 `skills/*` 会导致所有脚本 `ImportError`。
2. **它的 Keil 自动探测在本机不生效**。上游只探测 `C:\Keil_v5`、`C:\Keil`、`D:\Keil_v5`、
   `D:\Keil` 与环境变量 `KEIL_ROOT` / `MDK_ROOT`；若 Keil 装在
   `%LOCALAPPDATA%\Keil_v5`，需要显式喂一次路径：

   ```powershell
   python "$dst\build-keil\scripts\keil_builder.py" --detect `
     --uv4 "$env:LOCALAPPDATA\Keil_v5\UV4\UV4.exe" --save-config
   ```

   固化后写入 `%USERPROFILE%\.em_skill.json`，之后无需再传。

## 其他可参考的项目

- [`@amethystluna/embedded-workbench`](https://github.com/AmethystLuna/embedded-workbench) —
  DSH 插件，固件技能 + 验证纪律（FreeRTOS / Keil / HardFault / 状态机）。
- `stm32-codex-skill`、`embedded-ai-workspace` 等同类"板卡手册 → CubeMX 工程 → 编译产物"尝试。

本仓库的取态是：**外设配置与生成这一层自己做（生态里没有），工程存在之后的工具层复用现成的。**
