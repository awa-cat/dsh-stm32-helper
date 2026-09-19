---
name: stm32-verify-loop
description: STM32 的验证纪律与生成物保护——USER CODE 越界检测、CubeMX 生成前后 diff、HAL API 查证、验证阶梯与诚实标注，外加本机工具链路径兜底。当生成或编写 STM32 代码后需要判断改动是否安全、或向用户报告"是否真的验证过"时使用。
whenToUse: CubeMX 生成工程后、修改 STM32 代码后、需要编译/烧录验证时，或需要报告功能是否真正实现时。
---

# STM32 验证纪律

> **🌏 平台**：下面的工具链路径表与命令以 **Windows** 为例（作者本机环境）。
> Linux / macOS 请对照 [../PLATFORM.md](../PLATFORM.md) 替换：Keil（`UV4.exe`）**在你那边不存在**，
> 改用 `make` / `gmake` + `arm-none-eabi-gcc`，烧录用 `STM32_Programmer_CLI` / `openocd` / `st-flash`。
> 验证阶梯与诚实标注的纪律本身与平台无关，照常执行。细节见下表第二行。

## 参考文件

| 主题 | 文件 |
|---|---|
| 跨平台补充：构建/烧录命令对照、路径探测、验证阶梯的通用性 | [references/cross-platform.md](references/cross-platform.md) |

## 🔧 分工边界（用户指定，必须遵守）

**agent 只做到「代码写入工程」为止。编译与烧录由用户手动执行。**

- **不要**调用 Keil 构建（UV4 / build-keil 脚本）、**不要**用 make 编译、**不要**执行烧录器。
- 交接时给出四样：① 工程文件绝对路径（`.uvprojx`）② Keil 里的操作（打开 → F7 编译 → 下载）
  ③ 命令行方式（可选，供用户选择）④ 编译后产物的预期路径（`MDK-ARM\<工程名>\<工程名>.hex`）。
- 因为没有编译，**不得声称"编译通过"**。正确说法：**"代码已写入，待你编译验证"**。
- 下面的命令与路径表是**交给用户的参考资料**，不是 agent 的执行清单。

## 交接用的命令（参考，由用户手动执行）

下列技能/命令**由用户自行执行**；agent 只负责把准确的命令与路径交给用户：

| 需求 | 技能 | 典型调用 |
|---|---|---|
| 编译 Keil 工程 | `build-keil` | `python "<技能根>\build-keil\scripts\keil_builder.py" --detect --project <uvprojx> --uv4 "C:\Users\szj26\AppData\Local\Keil_v5\UV4\UV4.exe"` |
| 烧录 | `flash-keil` | 见该技能正文 |
| 串口日志 | `serial-monitor` | 见该技能正文 |
| 固件体积/map 分析 | `memory-analysis` | 见该技能正文 |

这些是用户手动那一侧的工具（Keil 的 CLI 封装），agent 不代为调用。

若用户想走命令行，下面这些路径与命令均已实测可用。

## 本机工具链路径（实测）

| 工具 | 绝对路径 |
|---|---|
| Keil uVision 5.43.1 | `C:\Users\szj26\AppData\Local\Keil_v5\UV4\UV4.exe`（**非标准路径**，自动探测常失败） |
| ARMCLANG | `C:\Users\szj26\AppData\Local\Keil_v5\ARM\ARMCLANG\Bin` |
| Arm GNU GCC | `arm-none-eabi-gcc`（PATH 内，14.3） |
| GNU make | `D:\mingw64\bin\mingw32-make.exe`（**不在 PATH**） |
| 烧录 CLI | `C:\Users\szj26\AppData\Local\stm32cube\bundles\programmer\2.23.0\bin\STM32_Programmer_CLI.exe` |
| CMake / Ninja | `...\stm32cube\bundles\cmake\4.3.1+st.1\bin\cmake.exe` / `...\ninja\1.13.2+st.1\bin\ninja.exe` |
| ST-LINK GDB server | `...\stm32cube\bundles\stlink-gdbserver\7.14.0+st.2\bin\ST-LINK_gdbserver.exe` |
| clangd | `...\stm32cube\bundles\st-arm-clangd\21.1.0+st.2\bin\starm-clangd.exe` |

`...\stm32cube\bundles\` = `C:\Users\szj26\AppData\Local\stm32cube\bundles\`

## 📁 工程代码根

默认代码根是 `D:\STM32_Workspace\DSHCode`（`stm32_generate` 的默认 outputDir），位于文件沙箱可写范围之外。

- **写业务代码一律用 `stm32_user_code`**：先 `action=list` 看区域名（main.c 有 2 / 3 / WHILE / Includes / PV / PFP…），
  再 `action=write`。它只替换 `USER CODE BEGIN/END` 之间的内容，区外不动，写前备份、写后校验。
- **不要**用 file 工具直接编辑该目录（会被沙箱拒绝），也不要为了写入去改会话工作区。
- 编译与烧录由用户手动执行，agent 不代做。

## 兜底：Keil 命令行构建（实测）

```powershell
$uv4  = 'C:\Users\szj26\AppData\Local\Keil_v5\UV4\UV4.exe'
$proj = '<工程>\MDK-ARM\xxx.uvprojx'
$p = Start-Process -FilePath $uv4 -ArgumentList @('-b', $proj, '-j0', '-o', '<log>') -Wait -PassThru
"exit=$($p.ExitCode)"
```

**必须 `Start-Process -Wait`**：`UV4.exe` 是 GUI 子系统程序，直接 `& $uv4` 不会等待也拿不到退出码。

退出码（实测）：`0`=无错误无警告 ✅ / `1`=有警告 / `2`=**编译错误** / `3`=致命。
日志行格式可直接解析：`../Core/Src/gpio.c(78): error: expected expression`。
出现 `Target not created.` 即**无镜像产出**，不要继续烧录。

**沙箱**：Keil 批处理构建在会话沙箱内可正常运行（工程在工作区内即可）。

## 兜底：GNU Make 构建（实测）

```powershell
cd <CubeMX 生成的 Makefile 工程目录>
& 'D:\mingw64\bin\mingw32-make.exe' -j4
& 'arm-none-eabi-size' build\<name>.elf
```

全流程工作区内，无需权限升级。

## ✅ USER CODE 保护与越界检测（本流程最关键的一环）

CubeMX 只保留这样的区块，其余按 `.ioc` **重生成覆盖**：

```c
/* USER CODE BEGIN 2 */
  // 允许修改
/* USER CODE END 2 */
```

**规则**：

- 业务逻辑只写在 `USER CODE BEGIN/END` 之间，**或**自建模块目录（如 `App/`，CubeMX 完全不碰）——复杂项目强烈推荐后者
- `ProjectManager.KeepUserCode=true` 必须保持
- 禁止手写 `MX_*_Init()`：那是生成物，外设配置一律改 `.ioc`

**越界检测（每次重新生成前必做）**：

> 若会话中存在 `stm32_guard` 工具，**优先用它，别靠肉眼**：
> 生成完成后 `action=snapshot` 建基线 → 改代码 → `action=diff` 得到
> `verdict: safe | will-be-wiped` 与越界行号。它是用真实 CubeMX 行为验证过的
> （区外代码重新生成后确实会消失）。下面的手工流程是它不可用时的兜底。

1. 生成**之前**对 `Core/` 做快照
2. 调用 CubeMX 重新生成
3. 生成**之后** diff 快照

若发现改动落在 USER CODE 区之外 → **这些改动已被抹掉或即将被抹掉**，必须立刻向用户报告，并迁移进 USER CODE 区或 `App/`。**不要静默继续。**

## ✅ HAL API 查证（写代码前必做，抗幻觉）

模型凭记忆写 STM32 HAL 极易编造函数名、参数与寄存器位。**写任何 HAL 调用前先查真实签名**：

```
C:\Users\szj26\STM32Cube\Repository\STM32Cube_FW_F1_V1.8.7\Drivers\STM32F1xx_HAL_Driver\Inc\
    stm32f1xx_hal_uart.h / _gpio.h / _tim.h / _dma.h / _rcc.h ...
C:\Users\szj26\STM32Cube\Repository\STM32Cube_FW_F1_V1.8.7\Drivers\CMSIS\Device\ST\STM32F1xx\Include\
    stm32f103xb.h（寄存器与位定义）
```

用 `grep` 在头文件里检索，确认存在与签名后再写。**查不到就不要写**。
（本机目前只装了 F1 固件包；换家族需先 `swmgr install`。）

## 验证阶梯与诚实边界

| 级 | 手段 | 能证明什么 |
|---|---|---|
| L0 | 生成产物清单核对 | 工程结构完整 |
| L1 | **编译通过** | 语法/类型/链接/无未定义符号 —— **每次必做** |
| L2 | 烧录 + `-v` 校验 | 镜像真的写进芯片 |
| L3 | 串口输出断言 | 程序真的在跑、行为符合预期 |
| L4 | GDB 读寄存器/变量 | 内部状态正确 |

**不可自动验证**：模拟量精度、真实传感器时序、电机/机械响应、中断实时性。这类必须让用户在实物上确认。

**报告纪律**：只做到 L1 就必须写"**仅编译通过，未上板验证**"。不要用"功能已实现"掩盖没上板的事实。

## 报告模板

```
改动：<文件:行为>
配置：<.ioc 键改动，含 IPParameters 同步确认>
编译：<工具链> exit=<码>，<N> error(s) <M> warning(s)
产物：<elf/axf/hex 路径>，text=<x> data=<y> bss=<z>
上板：未验证 | 已烧录校验通过 | 串口读到 "<内容>"
越界：USER CODE 区外无改动（或：已迁移 <清单>）
```
