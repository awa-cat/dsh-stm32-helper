# CubeMX / .ioc 配方（教程练习参数）

> 固定基础配置（教程默认，练习配置中通常省略但必须有）：
> - MCU：STM32F103C8Tx / C8T6
> - RCC HSE：Crystal/Ceramic Resonator
> - SYS Debug：Serial Wire
> - Clock：教程常规树，**HCLK = 72 MHz**
> - Project：KeepUserCode = true；工具链 MDK-ARM
>
> 精确改 `.ioc` 键时用 `stm32-ioc-editing`；无头生成用 `stm32-cubemx-headless`。
> **不要手写 `MX_*_Init()`。**

## 通用：板载 LED PC13

| 项 | 值 |
|---|---|
| 引脚 | PC13 → GPIO_Output |
| 模式 | 推挽 Push-Pull |
| 上下拉 | 无 |
| 速度 | 低速 |
| 初始电平 | 教练习一/四用 **High**（灯灭）；亮 = 写 RESET |

## 练习一：按键轮询点灯

| 引脚 | 配置 |
|---|---|
| PA9 | GPIO_Input，**上拉**，（按键到 GND） |
| PC13 | GPIO_Output，推挽，初始 High，低速 |

逻辑：`ReadPin(PA9)==SET` → LED 逻辑按教程写法；实际灯低电平亮，实现时按原理图核对。

## 练习二：EXTI 按键消抖翻转

| 引脚 | 配置 |
|---|---|
| PA8 | GPIO_EXTI，下降沿（或上升沿，视摇杆逻辑），上拉（无灯摇杆） |
| PC13 | GPIO_Output |
| NVIC | **使能 EXTI**；SysTick 优先级要高于（数值更小）外部中断，否则 ISR 里 `HAL_Delay` 卡死 |

摇杆 Z 轴注意：带灯模块多为按下高；无灯模块需上拉且按下低。

## 练习三–五：UART1

| 项 | 值 |
|---|---|
| USART1 | Asynchronous |
| 波特率 | **115200** Bits/s |
| 字长 / 校验 / 停止 | 8 / None / 1 |
| NVIC | 用 `_IT`/`_DMA` 接收或发送时 **使能 USART1 全局中断** |

接线：TX↔RX 交叉，共地；USB-TTL 常为 CH340。

## 练习六：1 ms 系统时基 + MyDelay

| TIM1 项 | 值 |
|---|---|
| 时钟源 | Internal Clock |
| PSC | **71** |
| ARR | **999** |
| 计数模式 | 向上 |
| RCR | 0 |
| ARR 预加载 | 使能 |
| NVIC | TIM1 update interrupt 使能 |

`T = 72e6 / (72 * 1000) = 1 ms`。回调里 `currentMiliSeconds++`（须 `volatile`）。

## 练习七：10 ms 按键扫描消抖

| 项 | 值 |
|---|---|
| TIM1 PSC / ARR | **71 / 9999** → 10 ms |
| PA8 | GPIO_Input，上拉 |
| PC13 | GPIO_Output |
| NVIC | TIM1 update 中断 |

边沿检测：`last==SET && now==RESET` → 按下瞬间动作；`last==RESET && now==SET` → 松开忽略。

## 练习八：互补 PWM 呼吸灯

| TIM1 项 | 值 |
|---|---|
| Channel1 | PWM Generation CH1 + CH1N（互补） |
| PSC / ARR | **71 / 999** → PWM 周期 1 ms（1 kHz） |
| PWM Mode | Mode 1 |
| CCR1 初始 | 0 |
| CCR 预加载 | 使能（避免占空比突变） |
| 极性 | 正常与互补均为 Positive（若要互补亮度对冲，硬件/极性按原理图） |

占空比：`duty = 0.5*sin(2πt)+0.5`，`CCR = duty*(ARR+1)`。

## 练习九：双通道 ADC 轮询 + 方向判断

| 外设 | 配置 |
|---|---|
| ADC1 IN0, IN1 | 模拟输入 |
| 数据对齐 | **右对齐** |
| 扫描 | 多通道自动开启 |
| 连续转换 | **关** |
| 间断模式 | **开**，Number of Discontinuous Conversions = **1** |
| 常规序列长度 | 2 |
| Rank1 / Rank2 | 通道 0 / 通道 1，采样时间 **7.5 Cycle** |
| 触发 | Software |
| TIM1 | PSC=**7199**, ARR=**999** → **100 ms** |
| USART1 | 115200-8-N-1，printf 重定向 |
| NVIC | TIM1 update 中断 |

启动前：`HAL_ADCEx_Calibration_Start(&hadc1)`。

## 练习十：ADC + DMA + UART DMA

### 方法 A（定时触发，Normal DMA）

| 项 | 值 |
|---|---|
| ADC1 | 扫描 + 连续关 + 间断关，序列长度 2，IN0/IN1，7.5 Cycle，右对齐 |
| ADC DMA | 半字，**Normal**，外设→内存 |
| TIM1 | 100 ms（7199/999），中断里 `HAL_ADC_Start_DMA(..., 2)` |
| USART1 TX DMA | **字节**，**Normal**，内存→外设 |
| NVIC | TIM1 中断 + **USART1 全局中断**；ADC DMA 优先级按需压低 |

### 方法 B（连续采样，Circular DMA）

| 项 | 值 |
|---|---|
| ADC1 | 扫描 + **连续开** + 间断关，序列 2 |
| ADC DMA | 半字，**Circular**，外设→内存 |
| main | `Calibration` → `HAL_ADC_Start_DMA` 一次 |
| TIM1 | 100 ms 读 `ADC_Value[]` 并 UART DMA 发送 |
| NVIC | **降低 ADC DMA 通道优先级**，避免打断控制用 TIM |

缓冲区示例：

```c
uint8_t  buf[12];        // DMA 发送缓冲，全局
uint16_t ADC_Value[2];   // DMA 采样缓冲，全局
```

## 大作业：摇杆控无源蜂鸣器（配置要点）

| 外设 | 用途 |
|---|---|
| ADC X/Y（IN0/IN1） | 方法 B：Circular DMA 连续读，控制 rate / pitch |
| TIM 节奏 | 10 ms：`PSC=71, ARR=999`，update 中断推进音符进度 |
| TIM PWM → 蜂鸣器 | 固定 `ARR=99`，动态改 PSC 换音高；占空比 ~50% |
| GPIO EXTI 或 10ms 轮询 | Z 轴暂停/播放 |
| NVIC | TIM 节奏中断 + UART 可选；SysTick 勿被 EXTI 压住 |

音符频率表与 PSC 计算见 `task-recipes.md`。

## .ioc 编辑陷阱（必须遵守）

1. 每个外设参数要登记进 `<Periph>.IPParameters`；每个引脚参数进 `<Pin>.GPIOParameters`，否则**静默丢弃**。
2. `Mcu.IP0..n` / `Mcu.Pin0..n` 编号连续，且与 `IPNb`/`PinsNb` 一致。
3. 改完用 `stm32_ioc_read` 或无头生成后回读校验。
4. 生成后 diff `Core/`：USER CODE 区外的改动会被覆盖。
