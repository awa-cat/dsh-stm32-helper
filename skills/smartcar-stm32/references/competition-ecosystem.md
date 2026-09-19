# 全国大学生智能车竞赛 · 开源与规则补充

> 抓取日期：2026-09（本会话）。GitHub / 竞赛官网在本环境不可达；**Gitee 逐飞组织页可访问且为竞赛主流开源源**。
> **规则 PDF 未抓到**：写车规相关逻辑（MCU 限定、传感器、车模、赛道元素）前，必须以当年官方规则为准。

## 1. 规则与知识从哪来（优先级）

| 优先级 | 来源 | 用途 |
|---|---|---|
| P0 | 当年竞赛**官方规则/技术规范 PDF**（组委会） | MCU/传感器/车模/赛道/计时/违规 —— 唯一权威 |
| P0 | 学校车队内部文档、往届调车笔记 | 引脚定义、车模机械、场地参数 |
| P1 | 逐飞公众号 / 官方店文档 / 开源库 README+Example | 模块驱动、接线、上位机协议 |
| P1 | 各校开源赛题车（Gitee/GitHub 搜队名） | 架构参考，**不可照抄参数** |
| P2 | 卓晴等公开技术分享、B站/知乎调车帖 | 算法直觉、调参经验 |
| P2 | 芯片参考手册 + 逐飞库源码 | API 真源，防幻觉 |

**抓取不到官网时的代理做法**：让用户提供规则 PDF/截图，或从车队共享盘挂载；技能侧只写「通用竞赛电控架构」，不臆造当年赛项限制。

## 2. 历届常见组别形态（**非当年规则，仅架构索引**）

赛项几乎每年调整。写代码前先确认「你们报哪一组、主控是什么」。

| 形态 | 巡线/感知 | 驱动 | 控制特点 |
|---|---|---|---|
| 电磁组 | 电感/运放 + ADC | 有刷差速 / 舵机转向 | 差比和求偏差，直道/弯道分区 PID |
| 摄像头组 | 总钻风/SCC 等摄像头 | 差速或阿克曼 | 二值化 → 中线/元素识别 → 转向 |
| 全向车 | 摄像头/电磁 | 麦克纳姆等全向轮 | 运动学解耦 v, ω 或 vx, vy |
| 平衡单车/独轮 | IMU + 陀螺仪 | 有刷/无刷（BLDC） | 姿态环 + 速度环，强实时 |
| 越野/极速 | 视觉+IMU+编码器 | 大功率电机 | 抗颠簸、预测控制、电源管理 |
| 智能视觉/信标 | 摄像头/特殊目标 | 差速 | 目标跟踪、停车/信标逻辑 |
| 摩托/独轮等特殊组 | 按当年 | 常含 BLDC/LED 点阵 | 逐飞有对应委托开源 |

主控芯片生态（逐飞已开源库，**以当年允许清单为准**）：

- **英飞凌 AURIX**：TC264（库最成熟，Gitee ★1.3k）、TC364 / TC377 / TC387、CYT4BB7、CYT2BL3
- **恩智浦**：RT1064（高性能，库支持外置 SDRAM 加速）、历史 NXP Cup 相关
- **TI**：MSPM0G3507 / G3519
- **STC**：STC32G12K128 / STC32G144K246（MDK C251）
- **龙芯**：LS2K0300 / LS2K0301（视觉算力向）
- **培训向 STM32F103**：南工绝影教程主芯片；**能否上赛场看当年规则**

## 3. 已核实开源仓库（逐飞 SeekFree · Gitee）

组织主页：https://gitee.com/seekfree（约 79 个公开仓库，GPL-3.0 居多）

### MCU 开源库（驱动封装 + Example）

| 仓库 | 说明 | 环境 |
|---|---|---|
| [TC264_Library](https://gitee.com/seekfree/TC264_Library) | 英飞凌 TC264，竞赛最常用之一 | AURIX Development Studio |
| [RT1064_Library](https://gitee.com/seekfree/RT1064_Library) | NXP RT1064；代码/中断可加载外置 SDRAM，DTCM 扩至 448KB | IAR 或 MDK |
| [TC377_Library](https://gitee.com/seekfree/TC377_Library) / [TC387_Library](https://gitee.com/seekfree/TC387_Library) / [TC364_Library](https://gitee.com/seekfree/TC364_Library) | AURIX 家族扩展 | ADS 系 |
| [CYT4BB7_Library](https://gitee.com/seekfree/CYT4BB7_Library) / [CYT2BL3_Library](https://gitee.com/seekfree/CYT2BL3_Library) | 英飞凌 CYT 系 | 对应 IDE |
| [MSPM0G3507_Library](https://gitee.com/seekfree/MSPM0G3507_Library) | TI MSPM0G3507；README 含智能车扩展板接口 | MDK + DAP |
| [STC32G12K128_Library](https://gitee.com/seekfree/STC32G12K128_Library) | STC32G，核心板 CH340 下载 | MDK C251 |
| [LS2K0300_Library](https://gitee.com/seekfree/LS2K0300_Library) / LS2K0301 | 龙芯 | 对应工具链 |

### 电机 / 驱动专题

| 仓库 | 说明 |
|---|---|
| [DRV8701E_Brush_Driver_Project](https://gitee.com/seekfree/DRV8701E_Brush_Driver_Project) | 有刷驱动参考；支持 100% 占空比，方向 IO 控制，省 PWM 资源 |
| [TC264_GTM_BLDC_Project](https://gitee.com/seekfree/TC264_GTM_BLDC_Project) | 组委会/英飞凌委托，平衡单车 BLDC；GTM 出 PWM；正反转、速度闭环、刹车、堵转保护 |
| [CYT2BL3_Brushless_Driver_Project](https://gitee.com/seekfree/CYT2BL3_Brushless_Driver_Project) | 双电机无刷；FOC + 六步可配置；12V 小型 BLDC |
| [STC32G_Brushless_Driver_Project](https://gitee.com/seekfree/STC32G_Brushless_Driver_Project) | STC32G FOC 无刷 |

### 上位机与其它

| 仓库 | 说明 |
|---|---|
| [seekfree_assistant](https://gitee.com/seekfree/seekfree_assistant) | 逐飞助手：串口、虚拟示波器、摄像头图像 |
| [TLD7002_LED_Dot_Matrix](https://gitee.com/seekfree/TLD7002_LED_Dot_Matrix) | 委托开源，摩托/独轮 LED 点阵 7×15 |
| [Lora3a22_Remote_Controller](https://gitee.com/seekfree/Lora3a22_Remote_Controller) | 无线遥控参考 |

### 怎么用这些库（给 Agent 的纪律）

1. **先确认主控与 IDE**，再选库；不要把 TC264 API 写进 STM32 工程。
2. 库结构共性：`Example/` 例程 + `*_Opensource_Library/` 驱动 + 原理图/文档/上位机。
3. **API 以库头文件/Example 为准**（反幻觉）；STM32 HAL 与逐飞库命名体系不同，禁止混写。
4. Example 学「模块怎么调用」；赛题逻辑（元素、策略、调参）必须自己写。
5. 许可证多为 **GPL-3.0**：公开分发衍生工程时注意传染性；校内竞赛代码通常可闭源，发布开源仓需合规。
6. 同步更新：`git clone` 后不要盲目 pull 覆盖自己的调参分支。

### 其它检索关键词（官网/GitHub 可达时再挖）

- Gitee/GitHub：`智能车`、`smartcar`、`seekfree`、`TC264`、`RT1064`、`MSPM0G3507`、队名缩写
- 「智能车之家」类社区、各校车队组织页
- 立创开源平台、往年获奖方案分享（注意规则合规，禁用违规模块）

## 4. 竞赛电控通用架构（可写进代码）

```
感知层   encoder / adc电感 / camera / imu / tof
   ↓
特征层   速度、偏差error、元素标志、姿态角
   ↓
控制层   转向PID + 速度环（差速）或 舵机PWM
   ↓
执行层   motor_set(duty, dir) / servo_set(pulse_us)
   ↓
安全层   急停、堵转、电池电压、看门狗、参数flash
```

推荐目录（任意 MCU 可套）：

```
App/
  board.h        // 引脚与时钟，与规则允许硬件一致
  encoder.c
  sensor.c
  image.c / em.c // 按组别
  motor.c        // 开环/闭环输出，含限幅与急停
  pid.c
  control.c      // 固定周期：读传感→控制律→写电机
  menu.c         // 屏幕调参
  flash_param.c
  comm.c         // 逐飞助手波形
```

**调参纪律**：一次只改一个量；串口/屏幕打出 error、out、实际速度；上电默认停车；急停优先级最高。

## 5. 与 DSH 技能衔接

| 需求 | 动作 |
|---|---|
| STM32 HAL 基础写码 | `smartcar-stm32` + 教程提炼 |
| 编译/烧录/串口 | `build-keil` / `flash-keil` / `serial-monitor` |
| 算法骨架（PID/编码器/巡线） | `references/control-and-perception.md` |
| 用户给了官方规则 PDF | 摘成 `rules-summary.md` 挂进本技能，再生成赛项相关代码 |

## 6. 给 Agent 的诚实边界

- 未拿到当年规则时：**不生成**「符合某组车规」的断言；只写通用可调骨架 + 待确认清单。
- 未上板：参数一律标注 `TODO: 实车标定`。
- 禁止编造逐飞/芯片 API；引用仓库时给出 Gitee 路径，调用前应打开对应 Example。
- 视觉/电磁特征随赛道与硬件变化很大，算法框架可生成，阈值必须现场标定。
