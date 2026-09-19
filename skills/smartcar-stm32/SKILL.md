---
name: smartcar-stm32
description: 基于《2025 智能车培训简明教程 V4.31》提炼的智能车嵌入式写码知识库，并补充全国大学生智能车竞赛开源生态（逐飞 SeekFree 等）与 PID/编码器/巡线控制骨架。当需要写 STM32 HAL 外设代码、竞赛电控（电机闭环/转向/电磁/摄像头结构）、或要查竞赛开源库与规则获取方式时使用。
whenToUse: 写 STM32/智能车电控代码、HAL 外设、竞赛 PID/编码器/巡线、问开源库或赛规如何接到技能时。与 stm32-verify-loop / stm32-cubemx-headless / stm32-ioc-editing / build-keil 协同使用。
---

# 智能车 STM32 HAL 写码技能（教程提炼）

## 知识边界（诚实声明）

| 来源 | 状态 |
|---|---|
| 《2025 智能车培训简明教程》v4.31 PDF（110 页） | 已提炼进本技能 |
| 第 1 章 C 语言、第 2 章环境、第 3 章 HAL 外设 + 附录练习解答 | 完整 |
| 有刷电机闭环 / PID / 通识章节 | **教程 PDF 未写入**；已由 [control-and-perception.md](references/control-and-perception.md) 补通用骨架，参数必须实车标定 |
| 当年官方竞赛规则 PDF | **本环境未抓到**；写「符合某组车规」前必须用户提供规则或确认组别/MCU，见 [competition-ecosystem.md](references/competition-ecosystem.md) |

本机环境（与既有 DSH 技能一致）：
- MCU：**STM32F103C8T6**，教程默认系统时钟 **Tclk = 72 MHz**
- 工具链：CubeMX + Keil MDK（ARMCLANG）；用户工程在 `D:\STM32_Workspace\`
- 固件包：`C:\Users\szj26\STM32Cube\Repository\STM32Cube_FW_F1_V1.8.7`（写 HAL 调用前务必查头文件，禁止编造 API）

## 何时读哪份参考

| 任务 | 文件 |
|---|---|
| 写任意 HAL 外设调用 / 选传输模式 | [references/hal-api-patterns.md](references/hal-api-patterns.md) |
| 配置 CubeMX / 改 .ioc 参数 | [references/cubemx-recipes.md](references/cubemx-recipes.md) |
| 代码放哪、中断坑、类型与调试纪律 | [references/coding-discipline.md](references/coding-discipline.md) |
| 直接套用典型任务实现（点灯→蜂鸣器） | [references/task-recipes.md](references/task-recipes.md) |
| 竞赛开源库、主控生态、规则获取 | [references/competition-ecosystem.md](references/competition-ecosystem.md) |
| PID / 编码器 / 差速 / 电磁 / 视觉骨架 | [references/control-and-perception.md](references/control-and-perception.md) |
| 电源/电机/总线/PCB/通用架构/调试 | 技能 **`embedded-hardware`**（`C:\Users\szj26\.dsh\skills\embedded-hardware\`） |

## 竞赛写码附加流程

1. 先确认：**组别、主控 MCU、车模/传感器清单**；无当年规则时不得声称「符合赛规」。
2. 开源驱动参考 [competition-ecosystem.md](references/competition-ecosystem.md)（逐飞 Gitee）；**API 以对应库 Example 为准**，禁止与 STM32 HAL 混写。
3. 控制算法用 [control-and-perception.md](references/control-and-perception.md) 骨架，增益一律 `TODO: 实车标定`。
4. 安全：上电停车、软急停、输出限幅、堵转/低压处理写进 `App/motor`。
5. 仍走 DSH 验证技能：编译 ≠ 赛道可用。

## 写码工作流（强制）

1. **先定外设与引脚**，再写业务逻辑。配置以 `.ioc` 为真源；业务代码只进 `USER CODE` 区或 `App/` 目录。
2. **HAL API 查证**：调用前在 `STM32Cube_FW_F1_V1.8.7\Drivers\STM32F1xx_HAL_Driver\Inc\` 中 grep 真实签名。查不到就不写。
3. **选模式**（阻塞 / 中断 / DMA）按 [hal-api-patterns.md](references/hal-api-patterns.md) 的决策表，不要一律 `HAL_*_Receive` 死等。
4. **写出代码后验证**：调用 `stm32-verify-loop` / `build-keil` 编译；报告必须区分「仅编译通过」与「已上板」。
5. 需要无头改外设配置时，走 `stm32-cubemx-headless` + `stm32-ioc-editing`，不要手改 `MX_*_Init()`。

## 教程核心公式（写代码时直接用）

```
定时器溢出周期:  T = (ARR+1)(PSC+1)(RCR+1) / Tclk
PWM 频率:        f = Tclk / ((PSC+1)(ARR+1))
PWM 占空比:      duty = CCR / (ARR+1)     // 教程计算方便时写 CCR = duty*(ARR+1)
ADC 电压:        V = raw / 4096.0f * 3.3f  // 12-bit，右对齐
音符预分频:      PSC = Tclk / (freq * (ARR+1)) - 1
```

教程常用参数：`PSC=71, ARR=999` → 1 kHz PWM 或 1 ms 定时（72e6/72/1000）；`PSC=71, ARR=9999` → 10 ms；`PSC=7199, ARR=999` → 100 ms。

## 与其它 DSH 技能交接

| 需求 | 调用技能 |
|---|---|
| 改引脚/外设/时钟/NVIC/DMA | `stm32-ioc-editing`、`stm32-cubemx-headless` |
| 编译 / 烧录 / map | `build-keil`、`flash-keil`、`memory-analysis` |
| 串口观察波形/日志 | `serial-monitor`（配合逐飞助手 / SerialPlot 协议） |
| 提交前质量 | `static-analysis`（MISRA 速查） |
| 验证阶梯与诚实报告 | `stm32-verify-loop` |

## 上位机串口协议（教程约定）

- 逐飞助手虚拟示波器：`printf("%d,%f,%d,%d,%f\n", ...);` 最多 8 通道
- SerialPlot：ASCII + 空格分隔 + 行末 `\n`
- 常用串口参数：USART 异步 **115200-8-N-1**
- printf 重定向必须勾选 Keil **Use MicroLIB**

## 快速自检清单（交付嵌入式代码前）

- [ ] 业务代码在 `USER CODE` 区或 `App/`，未污染生成文件
- [ ] HAL 函数名/参数与本机 F1 头文件一致
- [ ] 回调里用 `if (handle == &huartX / &htimX / &hadcX)` 区分实例
- [ ] ISR 共享变量标了 `volatile`
- [ ] 中断里避免无保护的 `HAL_Delay`（或已调 SysTick 优先级）
- [ ] 传输模式选择有理由（见决策表）
- [ ] 报告写明验证级别（编译 / 烧录 / 串口 / 上板）
