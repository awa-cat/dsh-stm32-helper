---
name: stm32-ioc-editing
description: 安全地读写 STM32CubeMX 的 .ioc 配置文件（键族结构、IPParameters 同步规则、Mcu.IPx/Pinx 编号重排、常见外设参数配方、备份与回读校验）。当需要按用户要求设置串口/GPIO/定时器/DMA 参数而又不想打开 CubeMX GUI 时使用。
whenToUse: 需要修改 .ioc 中的外设参数（串口波特率、引脚、上下拉、定时器、中断优先级、DMA），或核对生成结果是否真的写入了配置时。
---

# 安全编辑 .ioc

`.ioc` 是**纯文本 `key=value`**（`#MicroXplorer Configuration settings` 头），是外设/时钟/引脚的**唯一真源**。改它比改生成的 C 代码正确得多：生成的 `MX_*_Init()` 会被下次生成覆盖，而 `.ioc` 不会。

## ⚠️ 头号陷阱：**有两张**参数登记表，漏登记就静默丢弃

CubeMX 只读取**登记表里列出的键**。没登记的参数**即使存在也被静默忽略，不报错、不警告**。有两层，实测都踩过：

### 外设层：`<Periph>.IPParameters`

你的工程里 USART1 只有：

```
USART1.IPParameters=VirtualMode
USART1.VirtualMode=VM_ASYNC
```

**要设波特率，必须同时做两件事**：

```
USART1.IPParameters=VirtualMode,BaudRate,WordLength,Parity,StopBits
USART1.BaudRate=9600
USART1.WordLength=WORDLENGTH_8B
USART1.Parity=PARITY_NONE
USART1.StopBits=STOPBITS_1
```

### 引脚层：`<Pin>.GPIOParameters`

**这一层极易漏。** 从你 `learning_program/3.1`、`LED_Manager` 等 5 个真实工程里核实的写法：

```
PA1.GPIOParameters=PinState,GPIO_Label
PA1.GPIO_Label=LED1
PA1.PinState=GPIO_PIN_SET
```

**实测教训**：只写 `PA1.GPIO_Label=LED1` 而不登记 `GPIOParameters` → 无头生成后标签**凭空消失**，`main.h` 里不会出现 `LED1_Pin` / `LED1_GPIO_Port` 宏，gpio.c 里也不会写初始电平。登记之后两者都正常生成。

**结构性键不属于参数**，不要登记进 `GPIOParameters`：`Signal`、`Mode`、`Locked`。

### 通用规则

> 写任何 `<X>.<param>` 之后，确认 `<X>.IPParameters`（外设）或 `<X>.GPIOParameters`（引脚）里**列出了这个 param 名**。

`stm32_ioc_set` 工具已内置两张表的自动同步与剪枝；但仍建议改完用 `stm32_ioc_read` 回读，它会把这类未登记参数报成 warning。

## ⚠️ 第二个陷阱：编号族必须连续自洽

```
Mcu.IP0=NVIC          Mcu.IPNb=7
Mcu.Pin0=PC13-TAMPER-RTC   Mcu.PinsNb=14
```

- `Mcu.IP0..IPn` 必须**连续无洞**，且 `Mcu.IPNb` == 实际条数
- `Mcu.Pin0..PinN` 同理，`Mcu.PinsNb` == 实际条数
- 新增/删除外设或引脚后**必须整体重排编号**，否则 CubeMX 静默丢配置或直接报错

**纪律：不要用文本替换直接手工改编号族。** 每次改动后要么重排全部编号，要么改用"生成 → 读回 → 校验"闭环验证。M1 之后这些应交给 `stm32_ioc_set` 工具统一收口。

## 键族速查

| 键族 | 含义 |
|---|---|
| `Mcu.Name` / `Mcu.CPN` / `Mcu.Package` / `Mcu.Family` | 芯片型号、封装、家族 |
| `Mcu.IPx` / `Mcu.IPNb` | 已启用外设清单与计数 |
| `Mcu.Pinx` / `Mcu.PinsNb` | 已占用引脚清单与计数 |
| `<Pin>.Signal` | 引脚功能，如 `USART1_TX`、`GPIO_Output`、`S_TIM2_CH1_ETR` |
| `<Pin>.Mode` | 模式，如 `Asynchronous`、`Serial_Wire` |
| `<Pin>.GPIO_Label` | 用户标签（生成 `MX_<Label>_Pin` 宏） |
| `<Pin>.Locked=true` | 锁定该引脚不被自动重分配 |
| `<Periph>.IPParameters` | **该外设生效的参数键列表**（关键） |
| `<Periph>.<Param>` | 参数值 |
| `<Periph>.VirtualMode` | `VM_ASYNC` / `VM_SYNC` 等 |
| `NVIC.<IRQn>` | 中断使能/抢占/子优先级，格式 `true\:抢占\:子\:...` |
| `NVIC.PriorityGroup` | 优先级分组，如 `NVIC_PRIORITYGROUP_4` |
| `ProjectManager.*` | 工程设置（工具链、堆栈、USER CODE 保留等） |
| `RCC.*` / `Clock.*` | 时钟源与时钟树 |

`ProjectManager` 里两个关键项：

- `ProjectManager.KeepUserCode=true` —— **保留 `USER CODE` 区块**（务必保持 true）
- `ProjectManager.TargetToolchain=MDK-ARM V5.32` —— 用户工程的目标工具链，**通常不要改**（agent 侧用脚本 `project toolchain` 临时覆盖即可，不污染此键）

## 常见配方

**串口（异步 UART，9600 8N1，开接收中断）**

```
PA9.Signal=USART1_TX
PA10.Mode=Asynchronous
PA10.Signal=USART1_RX
USART1.IPParameters=VirtualMode,BaudRate,WordLength,Parity,StopBits
USART1.VirtualMode=VM_ASYNC
USART1.BaudRate=9600
USART1.WordLength=WORDLENGTH_8B
USART1.Parity=PARITY_NONE
USART1.StopBits=STOPBITS_1
NVIC.USART1_IRQn=true\:0\:0\:false\:false\:true\:true\:true\:true
```
并在 `Mcu.IPx` 加入 `USART1`、`Mcu.Pinx` 加入 `PA9`/`PA10`，同步 `IPNb`/`PinsNb`。

**GPIO 输出（带标签与初始电平）**

```
PA1.Signal=GPIO_Output
PA1.GPIOParameters=PinState,GPIO_Label
PA1.GPIO_Label=LED1
PA1.PinState=GPIO_PIN_SET
PA1.Locked=true
```
生成后代码里用 `LED1_Pin` / `LED1_GPIO_Port`，gpio.c 会写 `HAL_GPIO_WritePin(..., GPIO_PIN_SET)`。
`PinState` 取值：`GPIO_PIN_SET`（高）/ `GPIO_PIN_RESET`（低）。

**GPIO 输入 + 上拉**

```
PB0.Signal=GPIO_Input
PB0.GPIOParameters=GPIO_PuPd
PB0.GPIO_PuPd=GPIO_PULLUP
```

**GPIO 输出速率**

```
PA2.GPIOParameters=GPIO_Speed,PinState
PA2.GPIO_Speed=GPIO_SPEED_FREQ_HIGH
```

登记表里多个参数用逗号连接，顺序不敏感（但 CubeMX 自己写回时会重排）。

**PWM（TIM2_CH1）**
需要同时配引脚复用信号、TIM 的 `IPParameters`（`Channel-PWM Generation1 CH1` 相关键）与预分频/重载，复杂度高 —— **优先让 CubeMX 自己算**（脚本 `set`/`check` 或让用户在 GUI 里点一次），不要硬编。

## 安全流程（每次改动的固定动作）

1. **备份** `.ioc` 与待改文件（时间戳目录）
2. 改键（记住 `IPParameters` 同步 + 编号重排）
3. **读回校验**：重新解析 `.ioc`，确认目标键存在**且在该外设的 `IPParameters` 列表里**
4. 无头生成（见 `stm32-cubemx-headless`）
5. **再读回生成后的 `.ioc`**，确认 CubeMX 没有丢掉你的设置
6. 编译验证（见 `stm32-verify-loop`）

第 3 步和第 5 步不可省 —— CubeMX 的丢配置是**静默**的，只有读回能发现。

## 为什么不直接写 C 代码里的 `MX_*_Init()`

`Core/Src/*.c` 是**生成产物**。除 `/* USER CODE BEGIN X */ ... /* USER CODE END X */` 区块外的任何改动，都会在下一次 `project generate` 时被抹掉。外设配置一律改 `.ioc`，业务逻辑一律写进 USER CODE 区或自建模块（见 `stm32-verify-loop`）。
