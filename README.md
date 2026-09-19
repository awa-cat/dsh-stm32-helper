# dsh-stm32

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">让 agent 真的会配 STM32 外设：CubeMX 无头配置 → 生成工程 → 代码只写进安全区</b><br /><br />
  <a href="LICENSE"><img alt="License: BSD-3-Clause" src="https://img.shields.io/badge/License-BSD--3--Clause-blue.svg" /></a>
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.1.x-4d6bfe" />
  <img alt="工具" src="https://img.shields.io/badge/%E5%B7%A5%E5%85%B7-9%20%E4%B8%AA-4d6bfe" />
  <img alt="技能" src="https://img.shields.io/badge/%E6%8A%80%E8%83%BD-6%20%E6%9C%AC-4d6bfe" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-%E2%9C%85%20%E5%AE%9E%E6%B5%8B-2ea043" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-%E2%9A%A0%EF%B8%8F%20%E6%9C%AA%E7%9C%9F%E6%9C%BA-d29922" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-%E2%9A%A0%EF%B8%8F%20%E6%9C%AA%E7%9C%9F%E6%9C%BA-d29922" /><br /><br />
  <img alt="环境自检" src="https://img.shields.io/badge/-%E7%8E%AF%E5%A2%83%E8%87%AA%E6%A3%80-4d6bfe" />
  <img alt="ioc 读写" src="https://img.shields.io/badge/-.ioc%20%E8%AF%BB%E5%86%99-4d6bfe" />
  <img alt="无头生成" src="https://img.shields.io/badge/-%E6%97%A0%E5%A4%B4%E7%94%9F%E6%88%90-4d6bfe" />
  <img alt="越界保护" src="https://img.shields.io/badge/-%E8%B6%8A%E7%95%8C%E4%BF%9D%E6%8A%A4-4d6bfe" />
  <img alt="App 模块登记" src="https://img.shields.io/badge/-App%20%E6%A8%A1%E5%9D%97%E7%99%BB%E8%AE%B0-4d6bfe" />
  <img alt="跨平台" src="https://img.shields.io/badge/-%E8%B7%A8%E5%B9%B3%E5%8F%B0-4d6bfe" /><br /><br />
  DSH 插件（toolkit 形态）。生态里 <code>build-keil</code> / <code>flash-keil</code> / <code>serial-monitor</code> 那一套管的是<b>已有工程</b>的编译烧录调试；<br />
  本插件补的是它们<b>完全没有</b>的那一层：<b>外设配置 → 无头生成 → 配置真的落进代码</b>。
</div>

## 📑 目录

- [✨ 功能一览](#-功能一览)
- [🚀 安装](#-安装)
- [🔧 各平台工具链安装](#-各平台工具链安装)
- [🖥️ 平台支持](#️-平台支持)
- [🧰 工具一览](#-工具一览)
- [⚡ 快速开始](#-快速开始)
- [✅ 验证状态](#-验证状态)
- [📚 配套技能](#-配套技能)
- [❓ 常见问题](#-常见问题)
- [🛠️ 开发与自测](#️-开发与自测)

## ✨ 功能一览

- **🔍 `stm32_env` 环境自检**：一次性探完 CubeMX / Keil / GCC / make / cmake / ninja / 烧录器 / 固件包 / 串口，列出缺什么、怎么补
- **📖 `.ioc` 结构化读写**：把 CubeMX 配置解析成 JSON 并检查隐患（编号连续性、两张参数登记表一致性）；语义化改 uart/gpio，自动同步 `IPParameters` / `GPIOParameters`、自动重排 `Mcu.IP*` / `Mcu.Pin*`，改前备份、改后回读校验
- **🏗️ 无头生成工程**：CubeMX `-q` 脚本模式，20 秒出一个 Makefile / CMake / MDK / CubeIDE 工程，**不回写 `.ioc`、不污染你既有工程**
- **🛡️ 生成物保护**：`stm32_guard` 建快照、比对，告诉你哪些改动会被下次生成抹掉（附真实行号与代码）
- **✍️ 两处安全写入**：`stm32_user_code` 只写 `USER CODE BEGIN/END` 之间（区外一个字节不动）；`stm32_app_file` 在 `App/` 下建自建模块（PID、电机闭环、巡线），**并自动登记进构建系统**——Keil 分组 + IncludePath、Makefile 的 `C_SOURCES`/`C_INCLUDES`、CMake 的用户区 `target_sources`
- **🔌 烧录与串口**：`stm32_flash` 默认只给命令、你手动执行；`stm32_serial` 读串口并断言，用于上板验收
- **🎛️ 总开关**：9 个工具默认**关闭**，`/stm32 on` 或 <http://127.0.0.1:13080/stm32/> 一个按钮打开（关闭时从工具表移除 + 执行时兜底拒绝，两层防护）
- **🌏 跨平台**：Windows / macOS / Linux 三条路径的探测、串口与构建系统登记都分平台实现（见[平台支持](#️-平台支持)）

## 🚀 安装

**前置**：DSH 已可用（`dsh web` 能正常启动）、**Node.js ≥ 20**、**Git**、**bash**（Windows 上即 Git Bash）。

> 本插件未发布到 npm，装法是「克隆源码 → 链进 profile」。

**方式一：从源码装（推荐，最新）**

```sh
# 1) 克隆并建依赖链接（让 lib/ 里的 import '@deepseek-ai/dsh-tools' 能解析）
git clone https://github.com/awa-cat/dsh-stm32-helper.git
cd dsh-stm32-helper
bash scripts/build.sh          # Windows 用 Git Bash；macOS / Linux 直接跑

# 2) 注册进 profile：编辑 profile 的 package.json
#    Windows : %USERPROFILE%\.dsh\profiles\web\package.json
#    macOS/Linux : ~/.dsh/profiles/web/package.json
```

```jsonc
{
  "dependencies": {
    // 路径按你克隆的位置改；Windows 用正斜杠或双反斜杠
    "@dsh-external/dsh-stm32": "link:/Users/you/dsh-stm32-helper"   // Windows: "link:D:/dsh-stm32-helper"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // …原有内容…
        "@dsh-external/dsh-stm32"     // ← 加这一行
      ]
    }
  }
}
```

```sh
# 3) 装依赖并重启 DSH
cd ~/.dsh/profiles/web && pnpm install     # Windows 同样在 %USERPROFILE%\.dsh\profiles\web 下执行
# 然后重启 dsh web
```

重启后在输入框打 **`/stm32 on`**（或对 agent 说「打开 STM32 开关」）即可用。

**方式二：让 DSH 自己装**——把下面这段提示词发给任意一个 DSH 会话：

```text
帮我安装 dsh-stm32 插件（STM32CubeMX 无头配置与工程生成），步骤：
1. git clone https://github.com/awa-cat/dsh-stm32-helper.git 到任意目录，cd 进去执行 bash scripts/build.sh
2. 把 "@dsh-external/dsh-stm32": "link:<该目录的绝对路径>" 加进 ~/.dsh/profiles/web/package.json 的 dependencies
3. 把 "@dsh-external/dsh-stm32" 加进同一文件 dsh.profile.bundles 数组
4. 在 ~/.dsh/profiles/web 下执行 pnpm install
5. 重启 dsh web，然后提醒我在输入框打 /stm32 on 打开总开关
遇到报错先看 https://github.com/awa-cat/dsh-stm32-helper 的 README 常见问题。
```

<details>
<summary><b>方式三：从 Release 的 tgz 装</b></summary>

```sh
dsh plugin --profile web add https://github.com/awa-cat/dsh-stm32-helper/releases/download/v0.0.2/dsh-external-dsh-stm32-0.0.2.tgz
```

tgz 里**同时包含 `skills/`**（6 本技能），装完后它们在 `<profile>/node_modules/@dsh-external/dsh-stm32/skills/`，拷到技能根即可用：

```sh
cp -r <profile>/node_modules/@dsh-external/dsh-stm32/skills/* ~/.dsh/skills/   # macOS / Linux
```

> Release 可能落后于源码（**源码装法永远最新**；不确定就用方式一）。

</details>

<details>
<summary><b>更新 / 卸载</b></summary>

**更新**（源码装法）：`cd <克隆目录> && git pull`，然后重启 `dsh web`。改了 `lib/*.js` 且装了 super-injector 的话，可以在会话里直接热重载：`dev_reload_package {"packageName":"dsh-stm32"}`。

**卸载**：删掉 profile `package.json` 里那两处（`dependencies` 的 `link:` 行 + `bundles` 里的名字）→ `pnpm install` → 重启。
装了 super-injector 的也可以 `dev_uninject_plugin { "match": "dsh-stm32" }`。

</details>

## 🔧 各平台工具链安装

插件本身跨平台；**它调用的外部工具**要你自己装。`stm32_env` 会把缺失项列出来。

<table>
<tr><th>组件</th><th>Windows</th><th>macOS</th><th>Linux</th></tr>
<tr>
<td>STM32CubeMX<br /><sub>（生成工程，必需）</sub></td>
<td>ST 官网安装器（自带 JRE）</td>
<td>ST 官网 <code>.app</code> 拖进 <code>/Applications</code><br /><sub>CLI 入口在 <code>STM32CubeMX.app/Contents/MacOS/STM32CubeMX</code></sub></td>
<td>ST 官网 <code>.zip</code> 解到 <code>/opt</code> 或家目录<br /><sub>或让它进 <code>PATH</code></sub></td>
</tr>
<tr>
<td>编译</td>
<td>Keil MDK（可选）<br />或 <code>arm-none-eabi-gcc</code> + <code>mingw32-make</code></td>
<td><code>brew install --cask gcc-arm-embedded</code><br /><code>brew install make cmake ninja</code></td>
<td><code>sudo apt install gcc-arm-none-eabi make cmake ninja-build</code><br /><sub>包名以你的发行版为准</sub></td>
</tr>
<tr>
<td>烧录</td>
<td>STM32CubeProgrammer（自带 CLI）</td>
<td><code>brew install --cask stm32cubeprogrammer</code><br />或 <code>brew install openocd stlink</code></td>
<td>STM32CubeProgrammer 官方 <code>.zip</code>，或<br /><code>sudo apt install openocd stlink-tools</code></td>
</tr>
<tr>
<td>串口设备名</td>
<td><code>COM3</code> 等</td>
<td><code>/dev/cu.usbserial-*</code>、<code>/dev/cu.wchusbserial*</code><br /><sub>CH340/CP210x 可能要装驱动</sub></td>
<td><code>/dev/ttyUSB0</code>、<code>/dev/ttyACM0</code><br /><sub>需在 <code>dialout</code> 组：<code>sudo usermod -aG dialout $USER</code>（重新登录生效）</sub></td>
</tr>
</table>

> 找不到工具时，可以直接把路径传给工具：`stm32_env { "cubeMxPath": "/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX" }`。
> 也可以用环境变量改默认值：`DSH_STM32_CODE_ROOT`（工程代码根）、`DSH_STM32_BUNDLES`（ST 扩展 bundle 目录）。

## 🖥️ 平台支持

| 能力 | Windows | Linux | macOS |
|---|---|---|---|
| `.ioc` 读写 / 守卫生成 / `App` 模块文件 | ✅ 本机实测 | ✅ 纯文件操作 | ✅ 纯文件操作 |
| 无头生成（CubeMX `-q`） | ✅ 本机实测（20.5 s） | ⚠️ 代码就绪，需装 CubeMX，**未真机** | ⚠️ 同上（`.app` 内入口） |
| 构建系统登记 | ✅ Keil `.uvprojx` 实测 | ✅ Makefile / CMake 单测通过 | ✅ Makefile / CMake 单测通过 |
| 串口读取 | ✅ 本机实测 | ⚠️ `stty -F` + `cat`，**未真机** | ⚠️ `stty -f` + `/dev/cu.*`，**未真机** |
| 烧录 | ✅ 官方 CLI（带探针的写入未验证） | ⚠️ 官方 CLI / `openocd` / `st-flash` | ⚠️ `.app` 内 CLI |
| Keil MDK（`UV4.exe`） | ✅ | ➖ 仅 Windows，工具会明确说明而非报错 | ➖ 同左 |

> ⚠️ **诚实标注**：Linux / macOS 的代码路径已实现，并有 67 项注入式自测覆盖三平台分支（`selftest-platform.mjs`），
> 但作者手上只有 Windows 机器，**没有在真机上验证过**。`stm32_env` 会返回 `platform.verified: false` 提醒这一点。
> Keil 在 POSIX 上不是"探测失败"，而是设计上不适用——用 Makefile / CMake + `arm-none-eabi-gcc`。

## 🧰 工具一览

| 工具 | 作用 | 备注 |
|---|---|---|
| `stm32_env` | 探测工具链与固件包，列出缺失项 | 只读 |
| `stm32_ioc_read` | `.ioc` → JSON + 一致性检查 | 只读 |
| `stm32_ioc_set` | 语义化改 uart / gpio（同步登记表 + 编号重排） | 改前备份 |
| `stm32_generate` | CubeMX 无头生成工程 | ⚠️ 沙箱外，需显式承认 |
| `stm32_guard` | 生成物快照 + 越界改动检出 | |
| `stm32_user_code` | 写 `USER CODE` 保留区 | ⚠️ 沙箱外、结构受限 |
| `stm32_app_file` | `<工程>/App/` 下建自建模块并登记进构建系统 | ⚠️ 沙箱外、结构受限 |
| `stm32_flash` | 给烧录命令（`manual` 默认）/ 有探针时执行 | |
| `stm32_serial` | 读串口并正则断言，用于上板验收 | |

<details>
<summary><b>为什么 stm32_generate 是"沙箱出口"</b></summary>

CubeMX 是 Java GUI 程序，启动要写 `java.util.prefs`（Windows 注册表 / `~/.config/java`）与 `~/.stm32cubemx`。
在 DSH 会话沙箱内跑会因权限被拒导致 pinout 插件加载失败并崩溃（实测 NPE）。插件自身 spawn 的进程不受该沙箱约束，
因此由插件执行——但这是**显式的沙箱出口**，所以要求显式传 `acknowledgeOutsideSandbox: true`，不传就返回说明而不执行，**不做静默绕过**。

</details>

## ⚡ 快速开始

对 agent 说「用 STM32CubeMX 给我配一个 USART1 9600 + PA1 输出点灯，生成到默认代码根」即可。底下发生的事：

```
stm32_env      探测环境
stm32_ioc_set  改 .ioc（自动同步 IPParameters / GPIOParameters + 编号重排 + 备份）
stm32_generate 无头生成到独立目录（不回写 .ioc）
stm32_guard    action=snapshot   ← 生成完立刻建基线
  … agent 写代码：USER CODE 区 或 stm32_app_file 建 App/ 模块 …
stm32_guard    action=diff       ← 检出"会被下次生成抹掉"的改动
编译 / 烧录 / 串口            ← 由你手动执行（工具只给命令）
```

实测一次生成结果（STM32F103C8T6，CubeMX 6.17.0，20.5 s）：

```
usart.c:  huart1.Init.BaudRate = 9600;
          HAL_NVIC_EnableIRQ(USART1_IRQn);
main.h:   #define LED1_Pin        GPIO_PIN_1
          #define LED1_GPIO_Port  GPIOA
编译:     arm-none-eabi-gcc 14.3 + make → text 7936, exit 0
```

详细用法（9 个工具的参数、典型场景、故障排查）见 **[docs/USAGE.md](docs/USAGE.md)**；设计与取舍见 [docs/DESIGN.md](docs/DESIGN.md)。

## ✅ 验证状态

| 能力 | 状态 |
|---|---|
| 环境自检 / `.ioc` 读取与一致性检查 | ✅ 真实工程上零误报 |
| 语义化改 uart / gpio | ✅ 实测：改后重新生成，波特率 / 标签宏 / 中断全部落进代码 |
| 无头生成（Makefile / MDK） | ✅ 实测约 20 s，生成后直接编译成功 |
| USER CODE 区写入 | ✅ 实测：写后清空该区，哈希与备份一致（区外零改动） |
| 越界改动检出 | ✅ 单测 10/10 + 真实 CubeMX 行为反证 |
| `App/` 自建模块 + 构建系统登记 | ✅ 实测：Keil 分组与 `<Cads>` IncludePath 落盘；Makefile / CMake 单测通过；重复写幂等；`../evil.c`、`.txt` 被拒 |
| 跨平台决策（三平台分支） | ✅ 单测 67/67（注入式，本机可跑） |
| 烧录 | ⚠️ 命令与参数已实测；**带探针的端到端写入未验证** |
| 串口读取 | ⚠️ Windows 实测可用；POSIX 后端**未真机验证** |
| Linux / macOS 真机 | ⚠️ **未验证**（代码就绪 + 注入式单测） |
| 时钟树 / PWM / DMA / 编码器配置 | ❌ 未实现——这些要 CubeMX 规则引擎判断，硬编会产出错误配置，请在 GUI 里点一次 |

## 📚 配套技能

`skills/` 下 6 本，装到技能根（`~/.dsh/skills` 或工作区 `.dsh/skills`）就会被所有会话发现：

```sh
# macOS / Linux
cp -r skills/* ~/.dsh/skills/
# Windows PowerShell
Copy-Item .\skills\* "$env:USERPROFILE\.dsh\skills\" -Recurse -Force
```

| 技能 | 内容 |
|---|---|
| `stm32-cubemx-headless` | 无头驱动 CubeMX：`-q` 脚本、沙箱约束、工具链切换 |
| `stm32-ioc-editing` | `.ioc` 结构、两张登记表、编号重排、串口/GPIO 配方 |
| `stm32-verify-loop` | 验证纪律：USER CODE 越界、HAL API 查证、报告模板 |
| `smartcar-stm32` | 智能车写码：HAL 外设、CubeMX 配方、任务实现、逐飞开源、PID/编码器/巡线 |
| `embedded-hardware` | 通用机电硬件：电源与安全、电机驱动、总线、PCB、调试排查 |
| `embedded-comp-hardware` | RM / RoboCon / 智能车三类赛事硬件与电控架构对照 |

> 🔧 **技能里的路径与命令以 Windows 为例**（作者的本机环境）。Linux / macOS 的等价路径、命令与串口设备名见 [`skills/PLATFORM.md`](skills/PLATFORM.md)。

## ❓ 常见问题

<details>
<summary><b>工具没出现 / 调不了</b></summary>

总开关**默认关闭**。在 DSH 输入框打 `/stm32 on`，或打开 <http://127.0.0.1:13080/stm32/> 点一下。
关闭时工具会被从模型的工具表里移除，同时执行时会返回 `{ ok:false, disabled:true }`。
状态存在 `~/.dsh/dsh-stm32.json`。

</details>

<details>
<summary><b>找不到 STM32CubeMX</b></summary>

各平台默认查找位置不同（见[各平台工具链安装](#-各平台工具链安装)）。装好后一般能自动探到；
装在非标准位置就用 `cubeMxPath` 显式指路，例如：

```
stm32_env { "cubeMxPath": "/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX" }
```

</details>

<details>
<summary><b>找不到烧录 CLI</b></summary>

`stm32_flash` 优先用 STM32CubeProgrammer 的 CLI。没装的话，装了 `openocd` 或 `st-flash` 时工具会给出**命令模板**（只给命令、不自动执行，且模板未经真机验证）；两者都没有才会明确报缺失。

</details>

<details>
<summary><b>Linux 读串口报权限错</b></summary>

把当前用户加进 `dialout` 组并重新登录：

```sh
sudo usermod -aG dialout $USER
```

</details>

<details>
<summary><b>macOS 上串口设备名是什么</b></summary>

`/dev/cu.usbserial-*`（CP210x / FTDI）、`/dev/cu.wchusbserial*`（CH340）。`stm32_serial` 省略 `port` 时会列出
`/dev/cu.*` 与 `/dev/tty.*`（`cu.*` 排在前面，因为它是"呼出"设备，更适合主动收发）。

</details>

<details>
<summary><b>新加的 App/ 文件没被编译</b></summary>

`stm32_app_file` 写文件时会自动登记；但**CubeMX 重新生成工程会重写 Makefile / `.uvprojx`**，登记条目会丢——重新生成后再登记一次即可。
CMake 工程例外：改动落在顶层 `CMakeLists.txt` 的用户区，CubeMX 不重写该文件，无需重复登记。
另外 CubeMX 的 Makefile 用 `$(notdir)` 拼目标名，**不同目录的同名 `.c` 会撞同一个 `.o`**——这种情况工具会直接报出来。

</details>

<details>
<summary><b>Keil 相关功能在 Linux / macOS 上怎么办</b></summary>

Keil MDK 只有 Windows 版。POSIX 上用 CubeMX 生成 **Makefile 或 CMake** 工程，配 `arm-none-eabi-gcc` 编译，
`openocd` / `st-flash` / STM32CubeProgrammer CLI 烧录。工具会明确告诉你 Keil 不适用，而不是报"探测失败"。

</details>

## 🛠️ 开发与自测

本插件是**纯 ESM JavaScript**（`lib/*.js`），不需要编译，改完即是源码。

```sh
npm run check               # 语法检查（lib/ 下全部模块）
npm run selftest            # 跨平台决策 67 项（自包含，用系统临时目录，任何平台可跑）
node selftest-guard.mjs     # 越界改动检出 10 项
node selftest.mjs           # .ioc 解析 / 语义改写 / 登记表同步 / 回读断言
```

> ⚠️ 只有 `selftest-platform.mjs` 是**自包含**的（所以做成了 `npm run selftest`）。
> `selftest.mjs` 需要一个**真实 `.ioc`** 作输入（文件顶部写死了作者本机的路径，换机器要改），
> `selftest-guard.mjs` 目前也写死了本机临时目录——两者都还没做成带 fixture 的可移植测试。

`lib/` 的分工：`index.js` 注册工具与总开关，`platform.js` 是**唯一**与操作系统耦合的地方（平台探测、路径、串口后端），
`ioc.js` / `appfile.js` / `usercode.js` / `guard.js` / `flash.js` / `serial.js` 各管一块。

装了 super-injector 时可以热重载，改完立刻生效、无需重启：`dev_reload_package {"packageName":"dsh-stm32"}`。

## 📄 许可

BSD-3-Clause。第三方项目按"引用而不内嵌"处理，见 [docs/RELATED.md](docs/RELATED.md)。
