# 平台差异对照（Windows / macOS / Linux）

`skills/` 下各技能的正文**以作者本机（Windows）为例**写路径与命令。
在 macOS / Linux 上照着做会全错，请用这张表替换。插件工具本身已经跨平台
（`stm32_env` 会返回当前平台的探测结果与 `platform.verified` 标记）。

> ⚠️ 本表由作者整理：Windows 列是实测值；**macOS / Linux 列是按官方安装器与各发行版常见位置整理的，未经真机验证**。
> 实际路径以你自己的安装位置为准——找不到时把绝对路径显式传给工具（如 `stm32_env { "cubeMxPath": "…" }`）。

## 工具路径

| 工具 | Windows | macOS | Linux |
|---|---|---|---|
| STM32CubeMX | `D:\STM32Cubemx\STM32CubeMX.exe`<br />`C:\ST\STM32CubeMX\STM32CubeMX.exe` | `/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX` | `/opt/STMicroelectronics/STM32CubeMX/STM32CubeMX`<br />`~/STMicroelectronics/STM32CubeMX/STM32CubeMX` |
| 固件包仓库 | `C:\Users\<user>\STM32Cube\Repository` | `~/STM32Cube/Repository` | `~/STM32Cube/Repository` |
| 工程代码根（默认） | `D:\STM32_Workspace\DSHCode` | `~/STM32_Workspace/DSHCode` | `~/STM32_Workspace/DSHCode` |
| GNU make | `D:\mingw64\bin\mingw32-make.exe` | `gmake`（`brew install make`）→ `/opt/homebrew/bin/gmake` | `/usr/bin/make` |
| arm-none-eabi-gcc | `D:\Program Files (x86)\<ver>\bin\arm-none-eabi-gcc.exe` | `brew install --cask gcc-arm-embedded`<br />`/Applications/ArmGNUToolchain/*/bin/` | `sudo apt install gcc-arm-none-eabi`<br />`/usr/bin/arm-none-eabi-gcc` |
| CMake / Ninja | ST 扩展 bundle：`%LOCALAPPDATA%\stm32cube\bundles\{cmake,ninja}\…` | `brew install cmake ninja` | `sudo apt install cmake ninja-build` |
| 烧录 CLI（首选） | `…\bundles\programmer\<ver>\bin\STM32_Programmer_CLI.exe` | `/Applications/STM32CubeProgrammer.app/Contents/MacOS/bin/STM32_Programmer_CLI` | `/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI` |
| 备选烧录 | 同上 | `brew install openocd stlink` | `sudo apt install openocd stlink-tools` |
| Keil MDK（`UV4.exe`） | `C:\Users\<user>\AppData\Local\Keil_v5\UV4\UV4.exe` | ➖ 仅 Windows，不存在 | ➖ 仅 Windows，不存在 |
| ST 扩展 bundle 根 | `%LOCALAPPDATA%\stm32cube\bundles` | `~/Library/Application Support/stm32cube/bundles` | `~/.local/share/stm32cube/bundles`<br /><sub>都可用 `DSH_STM32_BUNDLES` 覆盖</sub> |

## 命令对照

| 目的 | Windows | macOS | Linux |
|---|---|---|---|
| 列串口 | `[System.IO.Ports.SerialPort]::GetPortNames()`（PowerShell） | `ls /dev/cu.*` | `ls /dev/ttyUSB* /dev/ttyACM*` |
| 串口设备名 | `COM3` 等 | `/dev/cu.usbserial-*`、`/dev/cu.wchusbserial*` | `/dev/ttyUSB0`、`/dev/ttyACM0` |
| 配串口（手工调试用） | `mode COM3:115200` | `stty -f /dev/cu.usbserial-1420 115200 raw -echo` | `stty -F /dev/ttyUSB0 115200 raw -echo` |
| 串口权限 | 无需（装驱动即可） | 一般无需 | 需加入 `dialout` 组：`sudo usermod -aG dialout $USER`（重新登录） |
| CubeMX 无头生成 | `& 'D:\STM32Cubemx\STM32CubeMX.exe' -q script.txt` | `'/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX' -q script.txt` | `/opt/STMicroelectronics/STM32CubeMX/STM32CubeMX -q script.txt` |
| 编译 CubeMX Makefile 工程 | `& 'D:\mingw64\bin\mingw32-make.exe' -j4` | `gmake -j4` | `make -j4` |
| 编译 CubeMX CMake 工程 | `cmake -B build -G Ninja && cmake --build build` | 同左 | 同左 |
| 编译 Keil 工程 | `<技能根>\build-keil\scripts\keil_builder.py --detect …` 或 `UV4.exe -b proj.uvprojx` | ➖ 用 Makefile/CMake 代替 | ➖ 用 Makefile/CMake 代替 |
| 烧录（手动） | `STM32_Programmer_CLI.exe -c port=SWD -w app.hex -v -rst` | `STM32_Programmer_CLI -c port=SWD -w app.hex -v -rst` | 同左；或 `st-flash --reset write app.bin 0x08000000` |

## 构建系统登记（`stm32_app_file` 自动做）

| 工程里的构建文件 | 登记位置 | CubeMX 重新生成后 |
|---|---|---|
| `MDK-ARM/*.uvprojx`（Windows + Keil） | `Application/User/App` 文件组 + `<Cads>` 段 `IncludePath` | ⚠️ 工程文件被重写 → 条目会丢，需重新登记 |
| `Makefile`（CubeMX 生成的 Makefile 工程） | `C_SOURCES` 续行块 + `C_INCLUDES` | ⚠️ 被重写 → 需重新登记 |
| `CMakeLists.txt`（CubeMX 的 CMake 工程） | **顶层** `CMakeLists.txt` 的两个用户区（`# Add user sources here` / `# Add user defined include paths`） | ✅ 该文件 CubeMX 只生成一次、不重写，无需重复登记 |

> ⚠️ CubeMX 的 Makefile 用 `$(notdir $(C_SOURCES:.c=.o))` 拼目标名 —— **不同目录的同名 `.c` 会撞同一个 `.o`**。
> `stm32_app_file` 会检出这种情况并报出来；规避办法是给 `App/` 下的文件改名，或改 Makefile 的 `OBJECTS` 规则。

## 技能里哪些段落最需要按平台替换

| 技能 | 主要平台相关内容 |
|---|---|
| `stm32-verify-loop` | 本机工具链路径表、Keil 命令行构建、GNU Make 构建、HAL 头文件 grep 路径 |
| `stm32-cubemx-headless` | CubeMX 可执行文件路径、固件包仓库、`~/.stm32cubemx` 位置、PowerShell 调用示例 |
| `smartcar-stm32` | 固件包头文件路径（写 HAL 调用前的查证目录） |
| `embedded-comp-hardware` | 指向 `embedded-hardware` 的绝对路径 |
| `embedded-hardware` | 平台中立，无需替换 |
