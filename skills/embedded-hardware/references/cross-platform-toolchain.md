# 跨平台嵌入式工具链（通用）

技能包**知识内容**（电源/电机/总线/HAL 模式/控制骨架）与 OS 无关，可在 macOS / Linux / Windows 上复用。  
**绑死平台的是路径与工具**：Keil、盘符、`.exe`、PowerShell 专有命令。下面用「探测 → 替代」方式适配。

## 1. DSH 技能如何装到 Mac / Linux

| 步骤 | 说明 |
|---|---|
| 技能根 | 一般是 `~/.dsh/skills/`（与 Windows 的 `C:\Users\<you>\.dsh\skills\` 对应） |
| 复制 | 把 `smartcar-stm32/`、`embedded-hardware/` 等目录整个拷入技能根 |
| 路径 | 正文里的 `C:\Users\szj26\...` 换成 `$HOME/...` 或 `/Users/<you>/...` |
| 会话 | 重启 DSH 或新开会话，确认技能列表出现 `embedded-hardware` / `smartcar-stm32` |
| 脚本 | 技能内 `python scripts/*.py` 用 `python3 "$HOME/.dsh/skills/<name>/scripts/xxx.py"` |

可执行探测脚本（技能根下）：

- `scripts/detect-embedded-env.sh`（macOS / Linux）
- `scripts/detect-embedded-env.ps1`（Windows）

## 2. 工具映射表

| 用途 | Windows（你本机现状） | macOS / Linux（推荐） |
|---|---|---|
| C 交叉编译 | Keil ARMCLANG / UV4；或 arm-none-eabi-gcc | **arm-none-eabi-gcc** + Make/CMake；或 STM32CubeIDE |
| 构建 | `UV4.exe -b`；`mingw32-make` | `make` / `cmake --build` / `ninja` / `pio run` |
| 工程生成 | CubeMX（`D:\STM32Cubemx\STM32CubeMX.exe`） | 见 §3 |
| 烧录 | Keil Download；STM32_Programmer_CLI | **OpenOCD** / `st-flash` / STM32_Programmer_CLI / pio |
| 调试 | Keil / ST-Link GDB server | `arm-none-eabi-gdb` + OpenOCD / pyOCD |
| 串口 | `COM*`；技能脚本 | Linux `/dev/ttyACM*` `/dev/ttyUSB*`；macOS **`/dev/cu.*`** |
| Python | `python` / `$env:MIMO_PYTHON` | `python3` |
| Shell | PowerShell | `zsh` / `bash` |

**没有 Keil 的机器不要硬编 UV4**：改走 GNU Makefile/CMake（CubeMX 可生成）或 PlatformIO。

## 3. STM32CubeMX 跨平台

| 平台 | 常见启动方式 |
|---|---|
| Windows | `D:\STM32Cubemx\STM32CubeMX.exe` |
| macOS | `/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX` |
| Linux | `~/STM32CubeMX/STM32CubeMX` 或安装目录下的可执行文件 |

静默脚本模式（三平台通用）：

```bash
# macOS / Linux
"$CUBEMX" -q /abs/path/script.txt

# 生成到独立目录的脚本仍适用（load / project toolchain Makefile / generate / exit）
```

注意：

- CubeMX 是 Java 程序，用户配置在 `~/.stm32cubemx`；Linux/macOS 无写权限同样会崩
- 无图形环境时可能需要 `xvfb-run`（Linux）或保证 JDK/自带 JRE 可用
- 固件包仓库常见：`~/STM32Cube/Repository`（与 Windows `C:\Users\...\STM32Cube\Repository` 对应）
- **工具链选 `Makefile` 或 `CMake`** 最适合 Mac/Linux 自动编译；MDK 仅 Windows

## 4. GNU 构建（Mac/Linux 主路径）

```bash
# 工程为 CubeMX 生成的 Makefile
cd <project>
make -j4
arm-none-eabi-size build/*.elf

# CMake 工程
cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=<if provided>
cmake --build build -j
```

安装提示（需本机管理员/包管理器，**不要在 DSH 会话里静默 sudo**）：

| 平台 | 可能的安装方式 |
|---|---|
| macOS | Homebrew：`brew install --cask gcc-arm-embedded`；`brew install cmake ninja openocd` |
| Ubuntu/Debian | `gcc-arm-none-eabi`、`cmake`、`ninja-build`、`openocd`、`stlink-tools` |
| Arch | `arm-none-eabi-gcc`、`openocd`、`stlink` |

## 5. 烧录与串口

```bash
# OpenOCD + ST-Link
openocd -f interface/stlink.cfg -f target/stm32f1x.cfg \
  -c "program build/firmware.elf verify reset exit"

# st-flash
st-flash write build/firmware.bin 0x8000000

# 串口监视（跨平台，装 pyserial）
python3 -m serial.tools.miniterm /dev/cu.usbmodemXXXX 115200   # macOS
python3 -m serial.tools.miniterm /dev/ttyACM0 115200           # Linux
```

udev（Linux 访问 ST-Link/串口）：把用户加入 `dialout`（及发行版要求的组），配置 ST 规则后 **重新登录**。

## 6. 技能正文改写约定

1. **环境表**写成「先探测、再使用」，本机绝对路径仅作 Windows 示例。
2. 脚本调用：
   - Windows：`python "<skill_root>\scripts\x.py"`
   - Unix：`python3 "<skill_root>/scripts/x.py"`
3. 禁止假设 `C:\Users\szj26`、`D:\STM32_Workspace` 在 Mac 上存在；工作区用当前会话目录或用户声明路径。
4. Keil 专用步骤标注：`Windows + MDK only`；并给出 GNU/OpenOCD 等价路径。
5. 写码知识（HAL、PID、电源）原样可用，无需改。

## 7. 与 smartcar / hardware 技能的分工

| 技能 | 跨平台性 |
|---|---|
| `embedded-hardware` | 内容通用；串口名按 §2 |
| `smartcar-stm32` | 知识通用；「本机环境」块仅 Windows 示例 |
| `build-keil` / UV4 | **主要 Windows**；Mac/Linux 改用 Makefile+CMake |
| `stm32-cubemx-headless` | `-q` 通用；启动器路径分平台 |
| `serial-monitor` | 脚本 + pyserial 通用；端口名分平台 |
| `stm32-verify-loop` | 验证阶梯通用；构建命令分平台 |

## 8. 探测失败时的回复模板

```
宿主：linux|macos|windows
技能根：~/.dsh/skills（或实际路径）
编译器：找到/未找到 arm-none-eabi-gcc（路径…）
CubeMX：找到/未找到
烧录：openocd / st-flash / STM32_Programmer_CLI / 无
串口：/dev/cu.* 或 /dev/ttyACM* 或 COMx
建议：安装缺失工具，或改用 Makefile 工程 + OpenOCD；不要调用 Keil/UV4
```
