---
name: embedded-comp-hardware
description: 兼容入口。通用嵌入式硬件知识库主体已迁移至技能 embedded-hardware；本目录仅保留「RM / RoboCon / 智能车 三类赛事硬件与电控架构对照」独有专篇。
whenToUse: 会话仍触发本技能名时，或需要 RM / RoboCon / 智能车三类赛事的机器人硬件与电控架构横向对照时。
---

# 兼容入口（主体已迁移）

通用嵌入式硬件内容——电源与安全、电机与驱动、传感器与总线、PCB 与布线、系统架构模式、调试与分层排查——请读技能 **`embedded-hardware`**：`C:\Users\szj26\.dsh\skills\embedded-hardware\SKILL.md`。

> **🌏 平台**：上面的绝对路径是作者本机的（POSIX 等价物是 `~/.dsh/skills/embedded-hardware/SKILL.md`）；
> 各平台工具链路径与串口设备名对照见 [../PLATFORM.md](../PLATFORM.md)。

## 本目录仅存的独有资料

| 主题 | 文件 |
|---|---|
| RM / RoboCon / 智能车 三类赛事硬件与电控架构对照 | [references/rm-robocon-smartcar.md](references/rm-robocon-smartcar.md) |

## 赛事的「写码侧」不在这里

STM32 HAL 外设、逐飞 SeekFree 开源、PID / 编码器 / 巡线骨架 → 技能 `smartcar-stm32`。

> 原先放在本目录的 6 份通用硬件专题（power-and-safety / motors-and-drivers / sensors-and-buses / pcb-and-wiring / system-patterns / debug-and-tools）与 `embedded-hardware/references/` 逐字节重复，已统一到后者，避免两份副本各自漂移。
