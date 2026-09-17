# @dsh-external/dsh-stm32

STM32CubeMX **无头配置与工程生成** 工具包（DSH 插件，toolkit 形态）。

生态里 `embed-ai-tool` 等技能集覆盖的是**已有工程**的 build / flash / debug / serial；
本插件补的是它们**完全没有**的那一层：**外设配置 → 无头生成 → 配置真的落进代码**。

> 📖 **使用说明见 [docs/USAGE.md](docs/USAGE.md)** —— 功能清单、8 个工具的参数、典型场景、故障排查。

## 安装

```powershell
git clone https://github.com/awa-cat/dsh-stm32-helper.git
cd dsh-stm32-helper

# 1) 让 lib/ 里的 import '@deepseek-ai/dsh-tools' 能解析（指向本机 npm 安装的那份）
bash scripts/build.sh

# 2) 装进 DSH（把路径换成你的克隆位置）
#    在 DSH 会话里执行：dev_install_package { "dir": "<绝对路径>" }
#    或手工把 link: 依赖 + bundles 条目加进 ~/.dsh/profiles/<profile>/package.json
```

技能（`skills/`）装到用户级技能根即可被所有会话发现：

```powershell
Copy-Item .\skills\* "$env:USERPROFILE\.dsh\skills\" -Recurse -Force
```

## 仓库内容

| 路径 | 内容 |
|---|---|
| `lib/` | 插件本体（纯 ESM JavaScript，无需编译） |
| `skills/` | 3 本技能：无头驱动 CubeMX、`.ioc` 安全编辑、验证纪律 |
| `docs/DESIGN.md` | 完整方案：可行性实测、工具契约、风险对策、分阶段路线 |
| `docs/RELATED.md` | 与 `embed-ai-tool` 等第三方项目的分工与**按上游安装**的方法 |
| `selftest*.mjs` | 自测：`.ioc` 解析/改写/登记表同步；guard 的 5 类判定 |

## 总开关（默认关闭）

8 个工具受一个总开关控制，**默认关闭**。关闭时两层同时生效：

1. 从模型的工具表里移除（实测工具总数 54 → 46）；
2. 执行时兜底拒绝（绕过调用会拿到 `{ ok:false, disabled:true }`）。

浏览器打开 **http://127.0.0.1:13080/stm32/** 点一下即切换（与 DSH Web 同端口、同源）。
状态存 `%USERPROFILE%\.dsh\dsh-stm32.json`。

## 默认工程代码根

`stm32_generate` 未给 `outputDir` 时默认生成到 **`D:\STM32_Workspace\DSHCode`**，
可用环境变量 `DSH_STM32_CODE_ROOT` 覆盖。这样所有 agent 产出的工程集中一处，不污染用户的既有工程。

⚠️ 该目录位于 DSH 文件沙箱可写范围**之外**：agent 的 shell/文件工具不能直接写。因此插件提供两条受限通道：

| 步骤 | 工具 | 说明 |
|---|---|---|
| 生成工程 | `stm32_generate` | 插件进程写入 |
| 写业务代码 | `stm32_user_code` | **只写 `USER CODE BEGIN/END` 之间**，区外不动，写前备份、写后校验 |
| 编译 / 烧录 | — | 由用户手动执行 |

因此**不需要**把会话工作区改为 `D:\STM32_Workspace`。

## 环境前提

本插件针对 Windows + STM32CubeMX 开发，实测环境：

- STM32CubeMX 6.17.0（自带 JRE，**不需要系统 Java**）
- 固件包位于 `%USERPROFILE%\STM32Cube\Repository`（换家族需先 `swmgr install`）
- 构建/烧录后端任一即可：Keil MDK、Arm GNU GCC + make、或 ST 官方 VS Code 扩展自带的
  cmake/ninja/programmer/gdbserver bundle

`stm32_env` 会把上述全部探一遍并列出缺失项。

---

## 工具

| 工具 | 作用 | 只读 |
|---|---|---|
| `stm32_env` | 探测 CubeMX / Keil / GCC / make / cmake / ninja / 烧录器 / 固件包 / 串口，报告缺失项 | ✅ |
| `stm32_ioc_read` | `.ioc` → 结构化 JSON，并检查编号连续性、参数登记表一致性 | ✅ |
| `stm32_ioc_set` | 语义化改 `.ioc`（uart / gpio），自动同步登记表 + 编号重排，改前备份改后回读 | |
| `stm32_generate` | CubeMX `-q` 脚本模式无头生成，校验产物 | ⚠️ 沙箱外 |
| `stm32_user_code` | 把业务代码写进 USER CODE 保留区（结构性只能写区内） | ⚠️ 沙箱外、结构受限 |
| `stm32_guard` | 生成物快照 + 越界改动检出（快照/比对/查基线/清快照） | |
| `stm32_flash` | 烧录 STM32（`auto` 有探针就烧 / `manual` 只给命令） | |
| `stm32_serial` | 读取串口输出并按正则断言，用于上板验收 | |

### 推荐工作流（把两张登记表 + 越界保护串起来）

```
stm32_ioc_set  改外设参数（自动同步 IPParameters / GPIOParameters + 编号重排 + 备份）
stm32_generate 无头生成到独立目录（不回写 .ioc，用户 MDK 工程零污染）
stm32_guard    action=snapshot   ← 生成完立刻建基线
  ... 写业务代码（只写 USER CODE 区内，或自建 App/ 目录）...
stm32_guard    action=diff       ← 检出"会被下次生成抹掉"的改动
build-keil     编译（embed-ai-tool 技能）
stm32_flash    烧录（有探针自动烧，否则给出可复制命令）
stm32_serial   串口断言验收
```

## 快速验证（本机已实测通过）

```
stm32_ioc_set  { iocPath, uart: { instance: "USART1", baud: 9600, wordLength: 8,
                                  parity: "none", stopBits: 1, txPin: "PA9", rxPin: "PA10",
                                  enableIrq: true },
                 gpio: [{ pin: "PA1", mode: "output", label: "LED1", initialLevel: "high" }] }
stm32_generate { iocPath, outputDir, projectName, toolchain: "Makefile",
                 acknowledgeOutsideSandbox: true }
```

实测结果（STM32F103C8T6，CubeMX 6.17.0，20.5 s）：

```
usart.c:   huart1.Init.BaudRate = 9600;
           HAL_NVIC_EnableIRQ(USART1_IRQn);
main.h:    #define LED1_Pin        GPIO_PIN_1
           #define LED1_GPIO_Port  GPIOA
gpio.c:    HAL_GPIO_WritePin(LED1_GPIO_Port, LED1_Pin, GPIO_PIN_SET);
编译:      arm-none-eabi-gcc 14.3 + mingw32-make → text 7936, exit 0
```

## ⚠️ 沙箱出口（重要，别当成普通工具）

`stm32_generate` 会在 **DSH 会话沙箱之外** 运行 STM32CubeMX。

原因（本机实测）：CubeMX 是 Java GUI 程序，启动需写 `java.util.prefs` 注册表与
`%USERPROFILE%\.stm32cubemx`。在会话沙箱（Windows ACL 受限令牌）内运行会：

```
写注册表被拒 → pinoutconfig/filemanager/analytics 插件加载失败
→ java.lang.NullPointerException: "this.pl_pinout" is null → 主线程崩溃
```

插件自身 spawn 的进程不受该沙箱约束，因此由本插件执行。但这是**显式的沙箱出口**，
所以 `stm32_generate` 要求显式传 `acknowledgeOutsideSandbox: true`；不传则返回说明而不执行，
**不做静默绕过**。首次使用应先向用户说明并取得同意。

它会触及：CubeMX 安装目录（读，可能写 updater 状态）、`~/.stm32cubemx`、HKCU 注册表、指定的 outputDir。

## 设计要点：两张参数登记表

CubeMX 只读取**登记表里列出的键**，未登记者**静默丢弃、不报错**。实测有两层：

| 层 | 登记表 | 例 |
|---|---|---|
| 外设 | `<Periph>.IPParameters` | `USART1.IPParameters=VirtualMode,BaudRate,...` |
| 引脚 | `<Pin>.GPIOParameters` | `PA1.GPIOParameters=PinState,GPIO_Label` |

本插件的 `stm32_ioc_set` 内置两张表的同步与剪枝；`stm32_ioc_read` 会把未登记参数报成 warning。

> 开发记录：`PA1.GPIO_Label` 只写不登记时，标签在重新生成后消失、`main.h` 无 `LED1_Pin` 宏。
> 这个坑是作者自己先踩到、再由 `stm32_ioc_read` 的检查暴露出来的——所以那条检查规则不是理论推导。

其他已处理的细节：

- **键名转义空格**：`TIM2.Channel-PWM\ Generation1\ CH1` 在 `IPParameters` 里写作未转义形式；
  比对与写回都做归一化，否则会误删 PWM 参数。
- **编号族**：`Mcu.IP<n>/Mcu.IPNb`、`Mcu.Pin<n>/Mcu.PinsNb` 由代码统一重排，禁止模型手改。
- **NVIC 是伪 IP**，没有 `NVIC.IPParameters`（实测），中断键直接写。
- **`project toolchain` 不回写 `.ioc`**：生成时可覆盖工具链，用户 MDK 工程零污染。

## 支持范围（M1）

- ✅ uart（USART/UART/LPUART：波特率/字长/校验/停止位/收发引脚/中断）
- ✅ gpio（输入输出、标签、上拉下拉、输出速率、初始电平）
- ✅ 环境探测、`.ioc` 读取与一致性检查、无头生成
- ❌ 定时器/PWM/编码器/DMA/时钟树：这些需要 CubeMX 规则引擎判断，
  应让用户在 GUI 里点一次或用脚本 `set`/`check` 通道，**不要硬编**（硬编会产出错误配置）
- ❌ `stm32_guard`（生成前后 diff、USER CODE 越界检测）：见 M1.5

## 构建 / 维护

本插件是**纯 ESM JavaScript**，不需要 tsc。DSH 脚手架默认生成 TypeScript 骨架并依赖
一个 DSH 源码 checkout（`$DSH_CHECKOUT/packages` + `vendor/cordis`）来跑 tsc；
本机没有该 checkout，因此改为直接维护 `lib/`。

依赖解析：`lib/index.js` 里 `import '@deepseek-ai/dsh-tools'` 从包自身 `node_modules` 解析，
需要 junction 到 npm 安装的那一份（`scripts/build.sh` 会自动建）：

```
node_modules/@deepseek-ai/dsh-tools → C:\Users\<user>\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools
```

改动流程：改 `lib/*.js` → `dev_reload_package {"packageName":"dsh-stm32"}`（约 1 秒热重载，无需重启）。

自测：`node selftest.mjs`（拿真实 `.ioc` 验证解析、语义改写、登记表同步、回读断言）。

## 与生态其他部分的分工

| 环节 | 归属 |
|---|---|
| 外设配置、工程生成 | **本插件** |
| Keil 构建、烧录、串口、静态分析 | `build-keil` / `flash-keil` / `serial-monitor` / `static-analysis` 技能（embed-ai-tool 适配层） |
| 验证纪律、USER CODE 越界、HAL 查证 | `stm32-verify-loop` 技能 |
| CubeMX 无头细节、`.ioc` 结构 | `stm32-cubemx-headless` / `stm32-ioc-editing` 技能 |
