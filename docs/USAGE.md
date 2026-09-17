# dsh-stm32-helper 使用说明

STM32CubeMX **无头配置 + 工程生成 + 写代码** 的 DSH 插件。
一句话：**你说要什么功能，它改 `.ioc`、生成工程、把代码写进 CubeMX 的保留区；编译和烧录由你自己做。**

---

## 目录

- [一、它做什么，不做什么](#一它做什么不做什么)
- [二、前置条件](#二前置条件)
- [三、快速开始（点灯，5 分钟）](#三快速开始点灯5-分钟)
- [四、功能清单（8 个工具）](#四功能清单8-个工具)
- [五、怎么用：对话方式](#五怎么用对话方式)
- [六、怎么用：直接调工具](#六怎么用直接调工具)
- [七、三条必须知道的约定](#七三条必须知道的约定)
- [八、典型场景](#八典型场景)
- [九、故障排查](#九故障排查)
- [十、配套技能](#十配套技能)
- [十一、验证状态与已知边界](#十一验证状态与已知边界)
- [十二、安装](#十二安装)

---

## 一、它做什么，不做什么

**做**：

| 环节 | 说明 |
|---|---|
| 环境自检 | 探测 CubeMX / Keil / GCC / make / cmake / 烧录器 / 固件包 / 串口，报告缺失项 |
| 读配置 | `.ioc` → 结构化 JSON，并检查编号连续性与参数登记表（**能查出静默丢配置的隐患**） |
| 改配置 | 语义化设串口 / GPIO，自动同步两张参数登记表 + 重排编号 + 备份 + 回读校验 |
| 生成工程 | CubeMX `-q` 脚本模式无头生成，自动修 MDK 的编译器设置，校验产物 |
| 保护生成物 | 快照 + 越界改动检出，判断哪些改动会在下次生成时被静默抹掉 |
| 写代码 | 把业务代码写进 `USER CODE BEGIN/END` 保留区（**只能写区内**） |
| 给烧录命令 | 生成可复制的烧录命令行（默认**不执行**） |

**不做**（按约定交给用户）：

- ❌ 编译（Keil / make / cmake 都不代跑）
- ❌ 烧录（默认只给命令，不碰硬件）
- ❌ 时钟树 / PWM / DMA / 编码器这类需要 CubeMX 规则引擎判断的复杂配置（见[第十一节](#十一验证状态与已知边界)）
- ❌ 任何"假装验证过"的结论——没编译就只会说"待你编译验证"

---

## 总开关（默认关闭）

插件的 8 个工具受一个总开关控制，**默认关闭**。

- 开启后：会话里出现 `stm32_*` 工具，模型可以使用。
- 关闭时是**两层**同时生效：
  1. **从模型的工具表里移除** —— 实测工具总数 54 → 46（正好少这 8 个），模型看不到、自然不会调用；
  2. **执行时兜底拒绝** —— 万一有绕过工具表的调用，返回 `{ ok:false, disabled:true, hint:... }`。

**怎么切**：浏览器打开（与 DSH Web 同端口）

    http://127.0.0.1:13080/stm32/

页面上一个按钮，点一下即切换，立即生效（回到会话如未出现，新开一个会话即可）。

状态存在 `%USERPROFILE%\.dsh\dsh-stm32.json`（`{"enabled":true|false}`），也可以用 HTTP 直接切：

    # 查状态
    curl http://127.0.0.1:13080/stm32/api/state
    # 开启 / 关闭
    curl -X POST http://127.0.0.1:13080/stm32/api/enable -H "content-type: application/json" -d "{\"enabled\":true}"

## 前置条件

| 依赖 | 必需 | 说明 |
|---|---|---|
| STM32CubeMX | ✅ | 自带 JRE，**不需要**系统 Java。插件会按常见安装路径自动探测（可用 `stm32_env` 的 `cubeMxPath` 显式指定） |
| CubeMX 固件包 | ✅ | 默认在 `%USERPROFILE%\STM32Cube\Repository`。**换芯片家族要先装**（`swmgr install`） |
| Keil MDK 或 Arm GNU 工具链 | 编译时需要 | 插件本身不需要；你自己编译时才用 |
| STM32_Programmer_CLI | 烧录时需要 | ST 官方 VS Code 扩展装的 bundle 里就有 |

先跑一次自检，缺什么它会直接告诉你：

```json
{ "probeHardware": true }
```

---

## 三、快速开始（点灯，5 分钟）

以 STM32F103C8T6（Blue Pill，板载灯在 **PC13**、低电平点亮）为例。

### 第 1 步：说需求

> 帮我写个 LED 闪烁程序，STM32F103C8T6，用板载灯

### 第 2 步：我会做的事

```
stm32_ioc_set    把 PC13 配成 GPIO_Output，标签 LED
stm32_generate   无头生成 MDK 工程到 D:\STM32_Workspace\DSHCode\led-blink
                 （自动把工程的编译器改成 ARMCLANG/AC6，否则新装 Keil 编不过）
stm32_guard      建立干净基线
stm32_user_code  往 main.c 的 USER CODE 3 区写入点灯代码
stm32_guard      比对确认没有会被抹掉的改动
```

**第一次生成时我会问你一次**：是否允许在会话沙箱之外运行 CubeMX（原因见[第七节](#七三条必须知道的约定)）。回"可以"即可。

### 第 3 步：你编译烧录

用 Keil 打开生成的 `.uvprojx` → `F7` → 点下载。或者：

```powershell
# 编译（可选，命令行方式）
python "$env:USERPROFILE\.dsh\skills\build-keil\scripts\keil_builder.py" --detect `
  --project "D:\STM32_Workspace\DSHCode\led-blink\MDK-ARM\led-blink.uvprojx" --target led-blink

# 烧录（命令由 stm32_flash 生成，复制即可）
STM32_Programmer_CLI.exe -c port=SWD freq=4000 -w "<工程>\MDK-ARM\led-blink\led-blink.hex" -v -rst
```

---

## 四、功能清单（8 个工具）

### 1. `stm32_env` — 环境自检

| 参数 | 必填 | 说明 |
|---|---|---|
| `cubeMxPath` | | 显式指定 `STM32CubeMX.exe` 路径 |
| `probeHardware` | | 为 `true` 时真的调用烧录器枚举探针（慢几秒） |

返回：CubeMX 路径与版本、已装固件包、各工具链绝对路径、串口列表、缺失项清单。

### 2. `stm32_ioc_read` — 读配置 + 查隐患

| 参数 | 必填 | 说明 |
|---|---|---|
| `iocPath` | ✅ | `.ioc` 文件路径 |

返回结构化 JSON：MCU 型号、已启用外设、引脚映射、每个外设的参数、工程设置，以及 **`warnings`**。

`warnings` 是它最有价值的部分，能查出：

- `Mcu.IPNb` / `Mcu.PinsNb` 与实际条目数不一致
- 编号不连续（`Mcu.IP*` / `Mcu.Pin*`）
- **参数键存在但没登记进登记表 → CubeMX 会静默忽略**（下一节详述）
- `ProjectManager.KeepUserCode` 不是 `true`（重新生成会丢 USER CODE 区内容）

### 3. `stm32_ioc_set` — 语义化改配置

| 参数 | 必填 | 说明 |
|---|---|---|
| `iocPath` | ✅ | `.ioc` 路径 |
| `uart` | | 串口配置对象，见下 |
| `gpio` | | GPIO 配置数组，见下 |
| `dryRun` | | 只计算不写盘 |

**串口**：
```json
{ "instance": "USART1", "baud": 115200, "wordLength": 8, "parity": "none",
  "stopBits": 1, "txPin": "PA9", "rxPin": "PA10", "enableIrq": true }
```

**GPIO**：
```json
[ { "pin": "PA1", "mode": "output", "label": "LED1", "initialLevel": "high" },
  { "pin": "PB0", "mode": "input", "pull": "up" } ]
```
`mode` 支持 `output` / `input`；`pull` 支持 `none` / `up` / `down`；`initialLevel` 支持 `high` / `low`；
`speed` 支持 `low` / `medium` / `high` / `veryHigh`。

**它会自动处理**：更新 `<Periph>.IPParameters` 与 `<Pin>.GPIOParameters` 两张登记表、
重排 `Mcu.IP*` / `Mcu.Pin*` 编号、写前备份、写后重新解析校验。

### 4. `stm32_generate` — 无头生成工程

| 参数 | 必填 | 说明 |
|---|---|---|
| `iocPath` | ✅ | `.ioc` 路径（**只读加载，不会被修改**） |
| `outputDir` | | 生成目录。**缺省 = `D:\STM32_Workspace\DSHCode`** |
| `projectName` | | 工程名，缺省取 `.ioc` 文件名 |
| `toolchain` | | `Makefile` / `CMake` / `STM32CubeIDE` / `"MDK-ARM V5.32"` / `EWARM`；只作用于本次生成 |
| `acknowledgeOutsideSandbox` | | **必须为 `true`**，表示用户已同意在会话沙箱外运行 CubeMX |

**自动做的事**：生成后若发现是 MDK 工程且缺 `<uAC6>`，按本机实际安装的 ARMCLANG 版本补写
`<pArmCC>` / `<pCCUsed>` / `<uAC6>`（否则新装 Keil 会因"ARM Compiler 5 不可用"而构建失败）。

返回：exit code、耗时、产物清单（`coreSrc` / `mdkArm` / `makefile` …）、MDK 修正结果、错误行。

### 5. `stm32_guard` — 生成物保护

| 参数 | 必填 | 说明 |
|---|---|---|
| `projectRoot` | ✅ | 工程根目录 |
| `action` | ✅ | `snapshot` / `diff` / `status` / `clear` |

**正确顺序**（很重要）：

```
CubeMX 生成完成 → action=snapshot（建立干净基线）
    → 写代码 / 改代码
    → action=diff（看哪些改动会在下次生成时丢失）
    → 重新生成 → 再 snapshot
```

`diff` 返回 `verdict: safe | will-be-wiped` 与 `atRiskFiles`，越界改动会给出**真实行号与代码内容**。
基线脏了（比如刚生成过）它会提示你重建。

### 6. `stm32_user_code` — 写业务代码

| 参数 | 必填 | 说明 |
|---|---|---|
| `file` | ✅ | C/H 源文件路径，如 `<工程>/Core/Src/main.c` |
| `action` | | `list`（列出可用区域名）/ `write`（缺省） |
| `block` | write 必填 | 区域名，如 `2` / `3` / `WHILE` / `Includes` / `PV` / `PFP` |
| `code` | write 必填 | 要写入的代码（**逐字插入，不自动缩进**） |
| `mode` | | `replace`（缺省）/ `append` |

**结构性安全**：只在 `USER CODE BEGIN X` 与配对的 `END X` 之间替换；文件里没有成对标记就**拒绝**；
`code` 里含 `USER CODE` 标记也**拒绝**；写前备份、写后校验区域仍成对。

`main.c` 里可用的区域：

```
Header  Includes  PTD  PD  PM  PV  PFP  0  1  Init  SysInit  2  WHILE  3  4  Error_Handler_Debug  6
```

### 7. `stm32_flash` — 给烧录命令

| 参数 | 必填 | 说明 |
|---|---|---|
| `file` | ✅ | `.elf` / `.hex` / `.bin` |
| `mode` | | **缺省 `manual`：只返回命令不执行**。仅当你明确要求时才传 `auto` |
| `address` | | `.bin` 必需（如 `0x08000000`）；`.elf` / `.hex` 通常不需要 |
| `erase` / `verify` / `reset` / `freq` | | 整片擦除 / 校验（默认开）/ 复位（默认开）/ SWD 频率 kHz（默认 4000） |
| `confirm` | | `mode=auto` 时真正写入前需为 `true` |

### 8. `stm32_serial` — 读串口并断言

| 参数 | 必填 | 说明 |
|---|---|---|
| `port` | | 如 `COM3`；省略则只列出可用串口 |
| `baud` | | 默认 115200（须与固件一致） |
| `durationMs` | | 读取时长，默认 3000 |
| `expect` | | 正则断言，如 `"Hello|ready"` |
| `listOnly` | | 只列串口不读 |

---

## 五、怎么用：对话方式

**推荐方式**。直接说需求，工具由 agent 决定，你在界面上能看到每次调用的参数与结果。

```
检查一下我的 STM32 开发环境还缺什么
```
```
帮我写个 LED 闪烁程序，STM32F103C8T6，用板载灯
```
```
把 D:\STM32_Workspace\DCMotor_test\DCMotor_test.ioc 的 USART1 改成 9600 8N1
并开启接收中断，PA1 配成输出、标签 LED1，生成到 DSHCode\motor
```
```
在 led-blink 工程里加功能：上电后 USART1 每秒打印一行 "Hello 9600"
代码放在 WHILE 区和 PV 区，不要动生成代码
```
```
读 COM3、9600，3 秒内应该能看到 Hello
```
```
给我一条能烧进去的命令（我手动跑）
```

**你要回答的只有两件事**：

1. 第一次生成时确认"允许在沙箱外运行 CubeMX"
2. 是否允许改**你已有的工程**（默认只在 `D:\STM32_Workspace\DSHCode` 下生成，不碰既有工程）

---

## 六、精确控制：点名工具与参数

> **注意**：工具是 **agent 调用的**，你在对话框里点不了、也发不出工具调用。
> 这一节的作用有两个：① 让你知道可以精确要求什么（照着说需求即可）；
> ② 给其它 agent / 二次开发者参考 payload 形状。

例如要「把串口改成 115200 并生成到指定目录」，agent 会发出这样的调用：

```json
// stm32_ioc_set
{ "iocPath": "D:\\work\\my.ioc",
  "uart": { "instance": "USART1", "baud": 115200, "parity": "none", "stopBits": 1, "enableIrq": true } }
```

```json
// stm32_generate
{ "iocPath": "D:\\work\\my.ioc",
  "outputDir": "D:\\STM32_Workspace\\DSHCode\\my-proj",
  "projectName": "my-proj",
  "toolchain": "MDK-ARM V5.32",
  "acknowledgeOutsideSandbox": true }
```

```json
// stm32_user_code
{ "file": "D:\\STM32_Workspace\\DSHCode\\my-proj\\Core\\Src\\main.c",
  "block": "3",
  "code": "    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);\n    HAL_Delay(500);" }
```

---

## 七、三条必须知道的约定

### 1. 工程代码根 = `D:\STM32_Workspace\DSHCode`

`stm32_generate` 未给 `outputDir` 时默认生成到这里，**不污染既有工程**。
可用环境变量 `DSH_STM32_CODE_ROOT` 覆盖。

该目录位于 DSH 文件沙箱**可写范围之外**，所以：

| 步骤 | 走哪条通道 |
|---|---|
| 生成工程 | `stm32_generate`（插件进程写入） |
| 写业务代码 | `stm32_user_code`（只写 USER CODE 区） |
| 编译 / 烧录 | **你手动做** |

agent 的 shell / 文件工具**不能**直接写那个目录（会报 `Access to the path ... is denied`）——
这不是 bug，是沙箱设计。**因此也不需要**为了它去改会话工作区。

### 2. CubeMX 必须在会话沙箱之外运行

CubeMX 是 Java GUI 程序，启动要写 `java.util.prefs` 注册表与 `%USERPROFILE%\.stm32cubemx`。
在 DSH 会话沙箱（Windows ACL 受限令牌）内运行会直接崩溃（`pl_pinout is null` → 主线程 NPE）。
所以 `stm32_generate` 由插件进程执行，并要求 `acknowledgeOutsideSandbox: true`——
**这是显式的沙箱出口，不是静默绕过**。

### 3. 两张参数登记表：漏登记 = 静默丢配置

CubeMX 只读取**登记表里列出的键**，没登记的**不报错、不警告，直接忽略**。有两层：

| 层 | 登记表 | 例子 |
|---|---|---|
| 外设 | `<Periph>.IPParameters` | `USART1.IPParameters=VirtualMode,BaudRate,...` |
| 引脚 | `<Pin>.GPIOParameters` | `PA1.GPIOParameters=PinState,GPIO_Label` |

**实测教训**：只写 `PA1.GPIO_Label=LED1` 而不登记 `GPIOParameters` → 重新生成后标签凭空消失，
`main.h` 里不会有 `LED1_Pin` 宏，`gpio.c` 里也不写初始电平。

`stm32_ioc_set` 自动处理这两张表；`stm32_ioc_read` 会把漏登记的报成 warning。

---

## 八、典型场景

### 场景 A：从零建一个工程

```
帮我建个工程：STM32F103C8T6，USART1 用 115200 8N1 开接收中断（PA9/PA10），
PC13 配成输出标签 LED，生成 MDK 工程到 DSHCode\demo
```

### 场景 B：改我已有工程的串口

```
把 DCMotor_test 的 .ioc 里 USART1 改成 115200，其他配置不要动
```
（默认只改 `.ioc`；要连工程一起更新就说"生成回工程目录"）

### 场景 C：加功能，不碰生成代码

```
在 demo 工程里加：按键 PA0 按下时 LED 常亮，松开恢复闪烁。
代码写 USER CODE 区，函数声明放 PFP 区
```

### 场景 D：重新生成前确认安全

```
我要改串口配置重新生成，先检查有没有代码会被抹掉
```
→ 走 `stm32_guard`：先 `snapshot`（若还没有基线），改完代码 `diff` 看 `verdict`。

### 场景 E：多项目并存

每个工程用自己的 `projectRoot`；`stm32_guard` 的快照存在各工程自己的 `.dsh-stm32/` 下，互不干扰。

---

## 九、故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `pl_pinout is null` 崩溃 | CubeMX 被跑在会话沙箱内 | 用 `stm32_generate`（带 `acknowledgeOutsideSandbox`），不要用 shell 直接跑 |
| `Access to the path ... is denied` | 想写 `DSHCode` 但在沙箱内 | 写代码用 `stm32_user_code`，生成用 `stm32_generate` |
| `uses ARM-Compiler 'Default Compiler Version 5' which is not available` | Keil 只装了 ARMCLANG(AC6)，工程还是 AC5 | `stm32_generate` 已自动修；手工修见下 |
| 改了参数但生成结果没变 | 参数没登记进 `IPParameters` / `GPIOParameters` | `stm32_ioc_read` 看 warnings；用 `stm32_ioc_set` 改 |
| `Cannot find the firmware package` / 卡在下载 | 缺对应家族的固件包 | CubeMX 里 `swmgr install`（可能要 `login`） |
| 标签没生成宏（`LED1_Pin` 缺失） | `GPIO_Label` 没登记进 `GPIOParameters` | 同上，用 `stm32_ioc_set` |
| `No ST-Link detected!` | 探针没插 / 驱动没装 | 插上后重试；`stm32_flash` 默认只给命令，可直接手动跑 |
| `build-keil` 报"未找到目标 XXX" | 该技能把上次的 target 名字缓存住了 | 调用时显式带 `--target <名字>`，或用 `--workspace <工程目录>` 分开缓存 |

**手工修 MDK 编译器**（若不想用自动修正）：在 `<工程>.uvprojx` 的 `</ToolsetName>` 之后插入

```xml
      <pArmCC>6240000::V6.24::ARMCLANG</pArmCC>
      <pCCUsed>6240000::V6.24::ARMCLANG</pCCUsed>
      <uAC6>1</uAC6>
```

> ⚠️ 版本号要从 `armclang --version` 的 **`Component: Arm Compiler for Embedded 6.24`** 那行取。
> 第一行 `Product: MDK Plus 5.43` 是 **Keil 产品版本**，取错会写成 `V5.43` 而构建失败。

---

## 十、配套技能

技能是"知识手册"，agent 按需读取，不注册任何运行时能力。装到 `~/.dsh/skills`。

**本仓库自带 3 本**：

| 技能 | 内容 |
|---|---|
| `stm32-cubemx-headless` | 无头驱动 CubeMX：`-q` 脚本模式、实测命令集、沙箱约束、工具链切换、默认代码根 |
| `stm32-ioc-editing` | `.ioc` 结构与安全编辑：两张登记表、编号重排、串口/GPIO 配方、备份与回读 |
| `stm32-verify-loop` | 验证纪律与分工边界：USER CODE 越界检测、HAL API 查证、报告模板 |

**可选（来自第三方）**：`build-keil` / `flash-keil` / `serial-monitor` / `memory-analysis` /
`static-analysis` / `workflow` —— 见 [docs/RELATED.md](RELATED.md)。

---

## 十一、验证状态与已知边界

| 能力 | 状态 |
|---|---|
| 环境自检 | ✅ 本机实测 |
| `.ioc` 读取 + 一致性检查 | ✅ 在真实工程上零误报 |
| 语义化改串口 / GPIO（含两张登记表同步） | ✅ 实测：改后重新生成，波特率 / `LED1_Pin` 宏 / 中断全部落进代码 |
| 无头生成（Makefile / MDK） | ✅ 实测，约 20s |
| MDK 编译器自动修正 | ✅ 实测：生成后直接编译成功 |
| USER CODE 区写代码 | ✅ 实测：写后清空 USER CODE 区与备份哈希一致（区外零改动） |
| 越界改动检出 | ✅ 单测 10/10；并用真实 CubeMX 行为反证（区内标记存活、区外标记被抹掉） |
| 烧录命令生成 | ✅ CLI 与参数已实测；**带探针的端到端烧录未验证**（当时没插 ST-LINK） |
| 串口读取与断言 | ⚠️ 代码就绪，**未在真实串口上验证** |
| 时钟树 / PWM / DMA / 编码器配置 | ❌ 未实现。这些要 CubeMX 规则引擎判断，硬编会产出错误配置——请在 GUI 里点一次 |
| 多文件模块（自建 `App/` 目录） | ❌ 未实现。目前 agent 写的代码只能落在 USER CODE 区内 |
| CMake 工具链 | ⚠️ 理论可行；实测在会话沙箱内 CMake configure 会挂（`Detecting C compiler ABI info`），需在沙箱外跑 |

---

## 十二、安装

### 插件

```powershell
git clone https://github.com/awa-cat/dsh-stm32-helper.git
cd dsh-stm32-helper
bash scripts/build.sh          # 建依赖 junction（无需 tsc，本插件是纯 ESM JS）
```

然后在 DSH 里装配（把路径换成你的克隆位置）：

```
dev_install_package { "dir": "<克隆的绝对路径>" }
```

它会：加 `link:` 依赖 → 加进 profile 的 `bundles` → 建 junction → 动态加载。
重启后由 `bundles` 正常装配。

或从 Release 装 tgz：

```powershell
npm install https://github.com/awa-cat/dsh-stm32-helper/releases/download/v0.0.1/dsh-external-dsh-stm32-0.0.1.tgz
```

### 技能

```powershell
Copy-Item .\skills\* "$env:USERPROFILE\.dsh\skills\" -Recurse -Force
```

### 卸载

```
dev_uninject_plugin { "match": "dsh-stm32" }
```

或用 `dsh plugin --profile web remove @dsh-external/dsh-stm32`。
删技能就是删 `~/.dsh/skills/stm32-*` 三个目录。

---

## 许可

BSD-3-Clause。本仓库只包含自己写的代码与技能；第三方项目按"引用而不内嵌"处理，见 [RELATED.md](RELATED.md)。
