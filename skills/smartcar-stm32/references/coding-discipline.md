# 写码纪律与坑位（教程 + 电控工程实践）

## 1. 代码放哪里

CubeMX 只保留：

```c
/* USER CODE BEGIN x */
/* USER CODE END x */
```

| 位置 | 用途 |
|---|---|
| `USER CODE BEGIN Includes` | `#include` |
| `USER CODE BEGIN 0` | 全局变量、函数声明、业务函数实现 |
| `USER CODE BEGIN 2` | 初始化：校准 ADC、启动 PWM/TIM/UART_IT/DMA |
| `USER CODE BEGIN WHILE` 或 WHILE 与 3 之间 | 主循环逻辑 |
| `USER CODE BEGIN 1` | **禁止放业务代码**（硬件尚未初始化完成，易卡死） |
| `App/` 等自建目录 | 复杂业务强烈推荐，CubeMX 完全不碰 |

- 禁止手写/修改生成的 `MX_*_Init()`；配置变更改 `.ioc` 后重新生成。
- `ProjectManager.KeepUserCode` 必须保持 true。
- 重新生成前对 `Core/` 做快照，生成后 diff；USER CODE 外改动必须报告。

## 2. 单片机程序模型

- 无 OS：上电只跑你的程序，主函数必须 **`while(1)` 常驻**，不能像洛谷题那样 `main` 返回。
- 阻塞 API（`HAL_Delay`、`HAL_UART_Receive` 超时很长、`HAL_MAX_DELAY`）会卡住整个主循环。
- 智能车后续闭环控制：**采样与算输出放 TIM 固定周期中断**，主循环做慢任务（状态机、日志、标定）。

## 3. 中断纪律

1. **回调里短平快**：读传感器/写标志/改 PWM 占空比可以；禁止长 `printf` 大包、禁止复杂阻塞。
2. 共享变量加 **`volatile`**（如 `currentMiliSeconds`、状态标志）。
3. 多外设回调必须 `if (handle == &hxxx)` 判断实例。
4. **`HAL_Delay` 依赖 SysTick**；SysTick 默认优先级最差（15），更高优先级的 EXTI 里调用会卡死。
   - 处理：CubeMX NVIC 把 **SysTick 优先级调高**（数值更小），或 ISR 内不用 `HAL_Delay`，改用定时器时间戳消抖。
5. EXTI 回调消抖经典写法（教程）：延时 20 ms 后再 `ReadPin` 确认；更好的工程做法是 10 ms TIM 扫描（练习七）。
6. 教程曾改 `HAL_GPIO_EXTI_IRQHandler` 先回调后清标志以避免重入——**改 HAL 库源码可移植性差**；智能车工程优先用 TIM 扫描消抖，避免动库文件。
7. 同编号 EXTI 线冲突：PA0 与 PB0 不能同时独立外部中断。

## 4. 数据类型与内存

- 嵌入式优先 `<stdint.h>`：`uint8_t/uint16_t/uint32_t/int32_t`，不要依赖 `int` 宽度。
- 12-bit ADC 结果用 `uint16_t`；需要电压用 `float`：`raw / 4096.0f * 3.3f`。
- DMA/中断写入的缓冲区：**全局**、对齐注意、勿放栈上。
- `sprintf` 输出缓冲给 UART DMA 时长度要算对；`buf` 全局。
- Watch 窗口只能可靠观察未被优化掉的**全局变量**；调试观察变量加 `volatile`。

## 5. 信号与硬件直觉

- 数字：高低电平相对 **GND**；模拟：连续电压，经 ADC 变数字。
- PC13 LED：**低电平亮**。
- 推挽：可主动输出高低；开漏：输出 0 拉低，输出 1 高阻。
- 无源蜂鸣器：外加 PWM/方波；**频率定音调**。
- USB-TTL：TX→MCU RX，RX→MCU TX，共地。
- 编码器/PID/电机驱动：本版教程未展开；TIM 输入捕获/编码器模式与闭环算法在后续专题，写代码时声明依据。

## 6. 反幻觉（模型写 HAL 时）

1. 函数名、参数、通道宏以本机 `STM32F1xx_HAL_Driver` 头文件为准。
2. 不要编造 `HAL_ADC_ReadMulti` 之类不存在的封装；用教程/头文件里存在的：`Start` / `Start_IT` / `Start_DMA` / `PollForConversion` / `GetValue`。
3. 宏与寄存器等价关系可写注释：`__HAL_TIM_SET_COMPARE` ≈ `TIMx->CCRn`。
4. 时钟树未确认前不要写死 `72e6`；用户工程若改 HCLK，公式里的 Tclk 要跟着改。
5. 验证分级诚实报告：
   - L1 编译通过 ≠ 功能正确
   - 电机、传感器模拟量、实时性必须用户上板确认

## 7. Keil / 调试习惯（教程）

| 操作 | 说明 |
|---|---|
| Build | 增量编译，日常用 |
| Rebuild | 全量，异常错误时用 |
| Download | 烧录 .axf |
| Options for Target | 编译器、调试器、**Use MicroLIB**（printf 重定向） |
| 调试 | 断点 → Run；Watch 1 看全局变量；可关 Hex 显示 |

编译器缺失时：魔术棒将编译器选为 v6.18（ARMCLANG）等本机已装版本。

## 8. 智能车电控代码结构建议（在教程能力上外推）

```
App/
  motor.c/.h      // 方向 GPIO + PWM 占空比；闭环接口预留
  encoder.c/.h    // 以后：TIM 编码器模式 / 输入捕获
  sensor.c/.h     // ADC / 电感 / 摄像头阈值
  control.c/.h    // 以后：PID；固定周期中断里调用
  comm.c/.h       // 串口协议、调参、波形输出
main.c            // 只做 MX 初始化 + USER CODE 2 启动 + while 慢循环
```

约定：
- 控制周期与 TIM 一致（如 1 ms / 10 ms），ISR 内：读传感器 → 控制律 → 写 PWM
- 调参变量全局 + `volatile` 或暴露到串口，便于逐飞助手/SerialPlot
- 输出限幅、上电安全（PWM 从 0 开始、急停引脚）写进 `App`，不要散落
