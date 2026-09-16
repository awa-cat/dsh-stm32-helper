---
name: stm32-cubemx-headless
description: 无头驱动 STM32CubeMX 配置外设并生成工程（含 -q 脚本模式、实测命令集、沙箱约束、工具链切换）。当需要按用户要求配置 STM32 外设（串口/GPIO/定时器/DMA）或重新生成既有 .ioc 工程时使用。
whenToUse: 用户要求配置 STM32 外设、修改 .ioc、或从 .ioc 生成/重新生成工程（Keil MDK / Makefile / CMake）时。
---

# 无头驱动 STM32CubeMX

## 本机环境（已实测）

| 项 | 值 |
|---|---|
| CubeMX | `D:\STM32Cubemx\STM32CubeMX.exe`，版本 6.17.0，DB 6.0.170 |
| 自带 JRE | `D:\STM32Cubemx\jre`（**无需系统 Java**，本机没有） |
| 固件包仓库 | `C:\Users\szj26\STM32Cube\Repository\`，目前**只有 STM32Cube_FW_F1_V1.8.7** |
| CubeMX 用户目录 | `C:\Users\szj26\.stm32cubemx`（偏好/日志/updater） |

## 调用形式

三种模式，**自动化一律用 `-q`**：

```powershell
cd D:\STM32Cubemx
& 'D:\STM32Cubemx\STM32CubeMX.exe' -q 'D:\path\to\script.txt'
```

- `-i` 交互式命令行（`MX>` 提示符）
- `-s` 脚本模式（有 UI）
- `-q` 静默脚本模式（无 UI 交互）← 用这个

脚本**每行一条命令**。成功逐行输出 `OK`，结束输出 `Bye bye`，进程 exit 0。

## ⚠️ 沙箱约束（本机第一号坑，必读）

CubeMX 是 Java GUI 程序，**启动时要写注册表（java.util.prefs）和 `~/.stm32cubemx`**。
在 DSH 会话沙箱（Windows ACL 受限令牌）内直接运行会**崩溃**，实测链：

```
无法写 C:\Users\szj26\.stm32cubemx\STM32CubeMX.log  → 拒绝访问
无法写注册表 Software\JavaSoft\Prefs\stm32_microxplorer → Access denied
→ 插件 pinoutconfig / filemanager / analytics 加载失败
→ java.lang.NullPointerException: ... "this.pl_pinout" is null
→ 主线程崩溃，生成失败
```

**因此：**

- 若通过 `pwsh` 工具执行，需要一次性沙箱升级（`danger-full-access`），并在执行前告知用户原因。
- 若由插件（在 DSH 宿主进程内 spawn）执行，不受会话沙箱约束，可直接运行。
- 无论哪条路，都应把"这一步在会话沙箱之外运行"**显式告知用户**，不要静默绕过。
- 反过来：**生成产物写进工作区**的部分没问题，问题只在 CubeMX 自己的注册表/家目录。

## 脚本模板

生成到独立目录，不碰用户既有工程：

```
config load <绝对路径>\xxx.ioc
config saveas <输出目录>\xxx.ioc
project name <工程名>
project path <输出目录>
project toolchain Makefile
project generate
exit
```

从零建工程：

```
load STM32F103C8Tx
project name MyProject
project path D:\work\MyProject
project toolchain "MDK-ARM V5.32"
project generate
exit
```

**工具链取值**（实测可用）：`MDK-ARM V5.32` / `Makefile` / `CMake` / `STM32CubeIDE` / `EWARM`。

## 命令集（6.17.0 实测 `help` 输出）

**文档化**：`load <mcu>`、`loadboard <board> <allmodes|nomode>`、`config load|save|saveext|saveas <file>`、`project name|path|toolchain|generate`、`generate code <path>`、`setDriver <Periph> <HAL|LL>`、`SetStructure <Advanced|Basic>`、`SetCopyLibrary`、`csv pinout <file>`、`script <file>`、`swmgr refresh|install|remove`、`pack enable|validate`、`login <email> <pwd> <remember>`、`exit`

**未文档化但真实存在**（写脚本前可先用一次 `help` 确认当前版本）：

| 命令 | 用途 |
|---|---|
| `set` / `unset` / `get` | 读写当前配置项 |
| `list` / `possible_value` / `not_a_possible_value` | 枚举合法取值（**让 CubeMX 当校验器，别让模型猜**） |
| `check` | 校验当前配置合法性 |
| `pinout` / `clock` / `clearpinout` / `waitclock` | 引脚与时钟树操作 |
| `xbuild <project_path>` | 自动构建已生成工程 |
| `setprop` / `getprop` / `getenv` | 系统属性与环境变量 |
| `updateIpUI` / `isPluginError` | 插件状态 |
| `cpload` / `cpexport` / `simulate` / `tinyload` | 其他 |

## 一个极其有用的性质：覆盖生成不污染 `.ioc`

实测：脚本里用 `project toolchain Makefile` 覆盖生成后，**生成的 `.ioc` 里 `ProjectManager.TargetToolchain` 仍是 `MDK-ARM V5.32`**，而产物是 Makefile 工程。

**推论（推荐工作流）**：一份 `.ioc` 作为唯一真源保持用户原有工具链（如 MDK），agent 侧每次无头生成到**独立目录**并覆盖成 Makefile/CMake 用于自动编译验证，**两边互不干扰、零污染**。不要为 agent 另存一份 `.ioc` 长期维护，会漂移。

## 生成后必做

1. **核对产物清单**：应含 `Core/Src/main.c`、`Core/Inc/main.h`、`Drivers/{CMSIS,STM32F1xx_HAL_Driver}`、启动文件、链接脚本，以及目标工具链的工程文件（`Makefile` / `*.uvprojx` / `CMakeLists.txt`）。
2. **读回 `.ioc` 校验**参数真的写进去了（见 `stm32-ioc-editing` 技能）。
3. **编译验证**（见 `stm32-verify-loop` 技能）。

## 失败模式排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `pl_pinout is null` NPE 崩溃 | 在会话沙箱内运行 | 按上文升级权限或改由插件执行 |
| 卡住/提示下载 | 缺对应家族的固件包 | `swmgr install stm32cube_f1_1.8.7 ask`；部分包需先 `login` |
| 改了参数但生成结果没变 | `.ioc` 的 `IPParameters` 没同步该键 | 见 `stm32-ioc-editing`，**这是静默失败** |
| `waiting for thirdparty lock release` | 有并发 CubeMX 实例 | 串行化生成，别并发 |
| 耗时明显 | 实测单次生成约 10–20 s | 走后台 job，别阻塞对话 |

## 与用户既有工程的关系

用户的 STM32 工程在 `D:\STM32_Workspace\`（`3.10`、`DCMotor_test`、`learning_program\*`），形态是 `.ioc + MDK-ARM/`，用 Keil uVision 打开。
**默认不要改动用户工程目录**；agent 侧生成到工作区内的独立目录（如 `<workspace>\build-agent\`）。
