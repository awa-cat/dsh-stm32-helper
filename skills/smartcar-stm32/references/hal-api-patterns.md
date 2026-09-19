# HAL API 模式速查（教程提炼 · F1 HAL）

> 写任何调用前：在 `STM32Cube_FW_F1_V1.8.7\Drivers\STM32F1xx_HAL_Driver\Inc\` 查真实签名。
> 本表来自教程正文与附录，函数名已与 PDF 提取结果对齐。

## 传输模式决策

| 场景 | 推荐 | 原因 |
|---|---|---|
| 初始化发一条短消息 / 调试 printf | 阻塞 `HAL_UART_Transmit` | 简单；MicroLIB 重定向用它 |
| 主循环要持续收指令、同时干别的 | 中断 `HAL_UART_Receive_IT` + 回调里再开一次 | 教程练习五进阶 |
| 高频批量日志 / 示波器数据流 | DMA `HAL_UART_Transmit_DMA` | 少占 CPU；**必须开 UART 全局中断**（教程指出 HAL 缺陷） |
| 单次读摇杆/电位器 | 阻塞 ADC：Start → Poll → GetValue | 一次一件事 |
| 多通道轮流采（X/Y 轴） | 多通道扫描 + **间断模式 Number=1**，循环 Start/Poll/Get | 普通/连续多通道下 DR 只剩最后一通道，不可取 |
| 实时连续采样进数组 | ADC+DMA：扫描+连续+DMA Circular，半字宽度，外设→内存 | 教程练习十方法二 |
| 周期性控制（消抖检测、音符节拍、PID 以后） | TIM 中断 `HAL_TIM_Base_Start_IT` + `PeriodElapsedCallback` | 非阻塞，可算可控 |
| 调 LED / 电机占空比 / 蜂鸣器音高 | TIM PWM：`PWM_Start` + `__HAL_TIM_SET_COMPARE` / 直接写 `CCRn` | 同一定时器各通道周期相同、占空比独立 |

## GPIO

```c
GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin);
// 返回 GPIO_PIN_RESET(0) / GPIO_PIN_SET(1)

void HAL_GPIO_WritePin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin, GPIO_PinState PinState);
void HAL_GPIO_TogglePin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin);
```

模式选择：
- 按键一端接地 → 输入**上拉**；松开读到 SET，按下 RESET
- 板载 LED（PC13）→ 推挽输出；**低电平亮**（两端接 3.3V 与 PC13）
- 外设数字输出（电机方向、使能）→ 推挽；需线与/电平转换再考虑开漏

EXTI 链路（只写回调）：

```
EXTIx_IRQHandler → HAL_GPIO_EXTI_IRQHandler → HAL_GPIO_EXTI_Callback
```

- EXTI0–4 独立；EXTI5–9 共用 `EXTI9_5_IRQHandler`；EXTI10–15 共用 `EXTI15_10_IRQHandler`
- **同编号引脚共享 EXTI 线**（PAx 与 PBx 不能同时各自独立 EXTIx）
- 用户只覆盖：

```c
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  if (GPIO_Pin == GPIO_PIN_x) { /* TODO */ }
}
```

## UART

```c
HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *huart, const uint8_t *pData,
                                    uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_UART_Receive(UART_HandleTypeDef *huart, uint8_t *pData,
                                   uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_UART_Transmit_IT(UART_HandleTypeDef *huart, const uint8_t *pData, uint16_t Size);
HAL_StatusTypeDef HAL_UART_Receive_IT(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size);
HAL_StatusTypeDef HAL_UART_Transmit_DMA(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size);

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart);
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart);
```

要点：
- `_IT` / `_DMA` **调用一次只触发一次完成事件**；中断回显必须在回调末尾再次 `HAL_UART_Receive_IT`
- 缓冲区若是 DMA/中断写入，**必须全局变量**，不要栈上局部数组
- 接线：MCU TX↔模块 RX，MCU RX↔模块 TX，**共地**
- 帧：起始位 + 8 数据位 + 可选校验 + 停止位；两端波特率等参数一致
- 字符 `'0'` 的数值是 **48**，不是 0；HEX 显示与 UTF-8 显示只是解读方式不同

printf 重定向（教程标准）：

```c
#include "stdio.h"
int fputc(int ch, FILE *f) {
  HAL_UART_Transmit(&huart1, (uint8_t *)&ch, 1, 0xffff);
  return ch;
}
```

Keil 魔术棒勾选 **Use MicroLIB**。

## TIM（定时 / PWM）

```c
HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *htim);
HAL_StatusTypeDef HAL_TIM_Base_Stop_IT(TIM_HandleTypeDef *htim);
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim);  // update 事件

HAL_StatusTypeDef HAL_TIM_PWM_Start(TIM_HandleTypeDef *htim, uint32_t Channel);
HAL_StatusTypeDef HAL_TIM_PWM_Stop(TIM_HandleTypeDef *htim, uint32_t Channel);
HAL_StatusTypeDef HAL_TIMEx_PWMN_Start(TIM_HandleTypeDef *htim, uint32_t Channel);  // 互补
HAL_StatusTypeDef HAL_TIMEx_PWMN_Stop(TIM_HandleTypeDef *htim, uint32_t Channel);

__HAL_TIM_SET_COMPARE(htim, channel, value);    // == TIMx->CCRn
__HAL_TIM_SET_AUTORELOAD(htim, value);          // == TIMx->ARR
__HAL_TIM_SET_PRESCALER(htim, value);           // == TIMx->PSC
```

F103C8T6 定时器：TIM1（高级，有互补）+ TIM2/TIM3/TIM4（通用）。

PWM 模式 1：`CNT ≤ CCR` → 高；`CNT > CCR` → 低。  
同一 TIM 的 PSC/ARR 共享 → **各通道周期相同，CCR 独立调占空比**。

蜂鸣器（无源）：
- **频率 = 音调**，占空比对响度影响小
- 教程固定 `ARR = 99`，按音符表算 `PSC`（见 task-recipes）
- 休止用超声波 40 kHz 或 PWM Stop / 占空比 0

## ADC（F1 12-bit SAR）

```c
HAL_StatusTypeDef HAL_ADCEx_Calibration_Start(ADC_HandleTypeDef* hadc); // 仅初始化后一次
HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef* hadc);
HAL_StatusTypeDef HAL_ADC_Start_IT(ADC_HandleTypeDef* hadc);
HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef* hadc, uint32_t Timeout);
uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef* hadc);
HAL_StatusTypeDef HAL_ADC_Start_DMA(ADC_HandleTypeDef* hadc, uint32_t* pData, uint32_t Length);
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc);
```

| 配置 | 教程结论 |
|---|---|
| 单通道 + 连续关 + 间断关 | 阻塞三连或 IT 读 DR，**可用** |
| 单通道 + 连续开 | 高阻源（摇杆）电容充不满，值不稳，**不推荐** |
| 多通道 + 连续关/开 + 间断关 | DR/回调里只有序列最后通道，**不可取** |
| 多通道 + 间断模式 Number=1 | 循环 `Start→Poll→Get` 逐通道读，**教程推荐多通道轮询** |
| 多通道 + 扫描 + 连续 + DMA Circular | 练习十方法二，实时采样首选 |

其它：
- ADC 输入时钟 ≤ **14 MHz**（CubeMX 时钟树分频）
- 采样时间教程常用 **7.5 Cycle**（内阻不明的传感器）
- 右对齐：raw ≈ 0..4095，`V = raw/4096*3.3`
- 左对齐数值 ×16，少用
- F1 中断在**整个常规序列结束**才触发，间断单次完成不会按通道打断

## DMA

| 项 | 教程取值 |
|---|---|
| 方向 | ADC：外设→内存；UART TX：内存→外设 |
| ADC 宽度 | 半字（16-bit，装 12-bit 结果） |
| UART 宽度 | 字节（8-bit） |
| 模式 | 单次发/非连续采样：Normal；连续 ADC：Circular |
| 注意 | `HAL_UART_Transmit_DMA` 需在 CubeMX 打开该 UART **全局中断** |

阻塞 / 中断 / DMA 对比（写注释或选型说明时可用）：
- 阻塞：CPU 干等，实现最简单
- 中断：事件驱动，频繁中断有开销
- DMA：控制器搬运，批量/流式最高效；批量完成仍会中断通知 CPU

## 回调骨架（统一风格）

```c
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  if (GPIO_Pin == GPIO_PIN_x) { /* ... */ }
}
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
  if (huart == &huart1) { /* ... HAL_UART_Receive_IT(...); */ }
}
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim == &htim1) { /* ... */ }
}
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc) {
  if (hadc == &hadc1) { value = HAL_ADC_GetValue(&hadc1); }
}
```
