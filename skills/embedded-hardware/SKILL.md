---
name: embedded-hardware
description: 通用嵌入式机电/机器人硬件知识库：电源与安全、电机与驱动、传感器与总线、PCB与布线、系统架构模式、调试与分层排查。适用于任意 MCU 项目（不限赛事）；竞赛规则仅作应用附注。
whenToUse: 选型、接线方案、上电/通信/电机故障分析，或写驱动控制代码前需要硬件前提时。与 smartcar-stm32、build-keil、serial-monitor、stm32-verify-loop 协同。
---

# 通用嵌入式硬件知识库

面向 **MCU + 电源 + 执行器 + 传感器** 的机电项目。原则通用；具体引脚、功率与禁用清单以项目规格或项目文档为准。

## 参考文件

| 主题 | 文件 |
|---|---|
| 电源树、电池、保险、急停、接地 | [references/power-and-safety.md](references/power-and-safety.md) |
| 电机、H 桥/电调、编码器、舵机 | [references/motors-and-drivers.md](references/motors-and-drivers.md) |
| UART/SPI/I2C/CAN、传感器、协议 | [references/sensors-and-buses.md](references/sensors-and-buses.md) |
| PCB、线束、EMC、可测试性 | [references/pcb-and-wiring.md](references/pcb-and-wiring.md) |
| 差速/全向/云台/顺序机构等模式 | [references/system-patterns.md](references/system-patterns.md) |
| 工具、排查树、最小测试法 | [references/debug-and-tools.md](references/debug-and-tools.md) |

## 速查

| 问题 | 思路 |
|---|---|
| 执行器 | 扭矩/速度/反馈 → 有刷·无刷·舵机·步进·气动 |
| 闭环 | 要稳态与轨迹就上编码器/绝对值反馈 |
| 总线 | 板内 SPI/I2C；调试 UART；多节点抗扰 CAN/RS485 |
| 电源 | 先电流预算；逻辑与功率分开；地策略明确 |
| 控制 | 周期环进定时器；日志进慢路径 |
| 验证 | 上电单点 → MRTest → 再闭环 |

## 代码前硬件假设

```c
#define HW_MCU         "..."
#define HW_DRIVE       "DIFF|MEC|..."
#define HW_BUS         "UART|CAN|..."
#define HW_SPEC_OK     0  /* 0=未对照规格/规则，交付须提示 */
```

## 应用附注（非主体）

- STM32 HAL / 智能车教程 / 逐飞开源 → 技能 `smartcar-stm32`
- RoboMaster 规则与协议 → https://bbs.robomaster.com/wiki/20204847
- 其它项目 → 提供规格书或规则 PDF 后再收紧约束
