# 系统架构模式（通用机电）

竞赛与产品可共用的结构模式；赛项差异放在参数与规则，不放在原理。

## 1. 两轮差速底盘

```
感知(编码器/IMU/线/视觉特征)
  → v, ω 指令
  → vl = v - ωL/2, vr = v + ωL/2
  → 左右速度环 → PWM
```

适合：寻线车、清洁机器人、简单移动平台。

## 2. 全向底盘（麦克纳姆等）

```
vx, vy, ω → 各轮速度矢量和 → 每轮速度环
```

轮组安装符号必须与代码一致；先空载核对四轮方向。

## 3. 云台 / 关节

```
目标角 → 角度环 → 角速度环 → 力矩/PWM
         ↑ IMU 或 编码器
```

回差、限位、上电姿态初始化要在硬件与软件上都有方案。

## 4. 顺序机构（抓取、升降、装配）

用**动作表**驱动状态机，而不是散落的 `delay`：

| 步 | 条件 | 动作 | 超时 | 失败 |
|---|---|---|---|---|
| 1 | 启动键 | 伸出气缸 | 800ms | 报错停止 |
| 2 | 前限位 | 夹紧 | 500ms | 重试1次 |
| 3 | 夹紧电流/到位 | 提升 | — | 急停 |

硬件限位优先于软件超时。

## 5. 双环调速（有刷常见）

```c
// 每 CONTROL_DT
measure = Encoder_Speed();
err = target - measure;
duty  = PID(&pid, err, CONTROL_DT);
Motor_Apply((int16_t)duty, arr);
```

参数先保守（低速、弱增益），再按响应整定。

## 6. 安全层（任何项目）

```c
void Safety_Tick(void)
{
    if (batt < BATT_MIN) g_emergency_stop = 1;
    if (comm_timeout)    Target_AllZero();
    if (stall_too_long)  g_emergency_stop = 1;
}
```

## 7. 分层软件目录（示意）

```
App/
  board.h      // 引脚与时钟假设
  motor.c
  encoder.c
  sensor.c
  pid.c
  control.c    // 固定周期
  safety.c
  comm.c
  params.c
```

硬件相关宏集中在 `board.h`，禁止在业务代码里散落魔法引脚号。
