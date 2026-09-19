# 智能车控制与感知算法骨架（可落地代码）

> 教程 PDF 未写 PID/电机闭环，本文件补齐竞赛最常用骨架。  
> **所有增益、标定常数均为占位，必须实车调。** 公式与结构是通用的，参数不是。

## 1. 编码器测速

```c
// 定时器编码器模式或输入捕获均可；此处假设固定周期采样计数差
// ppr: 编码器线数（注意是否 4 倍频后的每圈脉冲）
// ratio: 减速比； wheel_circ_m: 轮周长(米)
float Encoder_SpeedMs(int32_t delta_pulse, float ppr, float ratio,
                      float wheel_circ_m, float dt_s)
{
    if (dt_s <= 0.0f) return 0.0f;
    float rev = (float)delta_pulse / (ppr * ratio);
    return rev * wheel_circ_m / dt_s;
}
```

要点：
- `delta_pulse` 用 `int32_t`，注意溢出回绕
- 轮向反了就对 delta 取反，或机械上对调
- 开环标定：给定 duty，记录稳定 speed，得到 duty–speed 粗曲线

## 2. PID（位置式 + 增量式 + 抗积分饱和）

```c
typedef struct {
    float kp, ki, kd;
    float integral;
    float prev_err;
    float out_min, out_max;
    float i_min, i_max;   // 积分限幅
} PID_t;

void PID_Reset(PID_t *p) { p->integral = 0; p->prev_err = 0; }

float PID_Position(PID_t *p, float err, float dt)
{
    if (dt <= 0) return 0;
    p->integral += err * dt;
    if (p->integral > p->i_max) p->integral = p->i_max;
    if (p->integral < p->i_min) p->integral = p->i_min;
    float d = (err - p->prev_err) / dt;
    p->prev_err = err;
    float out = p->kp * err + p->ki * p->integral + p->kd * d;
    if (out > p->out_max) out = p->out_max;
    if (out < p->out_min) out = p->out_min;
    return out;
}

float PID_Incremental(PID_t *p, float err)
{
    // Δu = kp*(e-e1) + ki*e + kd*(e-2e1+e2)；输出累加
    float derr = err - p->prev_err;
    // 简化：用 prev_err 存 e1，integral 当输出累加器
    float du = p->kp * derr + p->ki * err; // kd 项按需补
    p->prev_err = err;
    p->integral += du;
    if (p->integral > p->out_max) p->integral = p->out_max;
    if (p->integral < p->out_min) p->integral = p->out_min;
    return p->integral;
}
```

调参顺序（竞赛惯例）：
1. 只开 **Kp**，从小到大直到响应快且临界振荡前
2. 需要消稳态误差再加 **Ki**（同时收紧积分限幅）
3. 超调/噪声大再谨慎加 **Kd**（或对测量滤波，而不是猛加 D）
4. 电机速度环与转向环**分开调**；先速度环稳定，再转向

## 3. 差速车：线速度 / 角速度 → 左右轮

```c
// v: m/s, omega: rad/s, track_width: 轮距 m
void DiffDrive(float v, float omega, float track_width,
               float *v_l, float *v_r)
{
    *v_l = v - omega * track_width * 0.5f;
    *v_r = v + omega * track_width * 0.5f;
}
```

常见控制律：

```
error = 期望中线偏差（电磁差比和 / 视觉中线偏移 / 元素状态机）
steer = PID_Steer(error)           // 映射到 omega 或直接 pwm_diff
v_cmd = speed_by_element(error)    // 弯道降速：v = v_max / (1+k*|error|)
DiffDrive(v_cmd, steer, L, &vl, &vr)
Motor_SpeedLoop(left, vl); Motor_SpeedLoop(right, vr);
```

弯道降速示例：

```c
float SpeedByError(float v_max, float err_abs, float k)
{
    float v = v_max / (1.0f + k * err_abs);
    return v;
}
```

## 4. 电机执行层（方向 + PWM + 限幅 + 急停）

```c
typedef struct {
    float target;   // m/s 或 内部单位
    float measure;
    PID_t pid;
    uint16_t arr;   // PWM 满量程
} Motor_t;

static int16_t ClampI16(int16_t x, int16_t lo, int16_t hi)
{ return x < lo ? lo : (x > hi ? hi : x); }

// duty 正负表示方向；底层按驱动芯片接线写 GPIO + CCR
void Motor_Apply(int16_t duty_signed, uint16_t arr)
{
    if (g_emergency_stop) { /* PWM=0, dir brake/coast */ return; }
    if (duty_signed > (int16_t)arr) duty_signed = (int16_t)arr;
    if (duty_signed < -(int16_t)arr) duty_signed = -(int16_t)arr;
    // HAL / 逐飞库：设置方向 IO + __HAL_TIM_SET_COMPARE 或 pwm_set_duty
}

void Motor_SpeedLoop(Motor_t *m, float target_ms)
{
    m->target = target_ms;
    float err = m->target - m->measure;
    float u = PID_Position(&m->pid, err, CONTROL_DT);
    Motor_Apply((int16_t)u, m->arr);
}
```

固定周期控制（TIM 中断，教程序列兼容）：

```c
#define CONTROL_DT 0.005f  // 5ms；与 TIM 配置一致

void HAL_TIM_PeriodElapsedCallback(...) {
    // 1) 采编码器 → measure
    // 2) 采感知 → error / element
    // 3) 控制律 → Motor_SpeedLoop / 舵机
    // 4) 低频：日志、菜单、电压检测
}
```

## 5. 电磁巡线（电感 ADC）

```c
// n 路电感；差比和求横向偏差（经典）
float EM_Error(const float *adc, int n)
{
    float sum = 0, diff = 0;
    for (int i = 0; i < n; i++) sum += adc[i];
    // 例：左右对称两两相减，按实际排布改
    diff = adc[0] - adc[n - 1];
    if (sum < 1e-3f) return 0;  // 丢线保护
    return diff / sum;           // 归一化，约 [-1,1]
}
```

标定：白板/赛道左右极限、中心零点；丢线时用**上次有效方向**或转头搜索策略（按赛项）。

## 6. 摄像头巡线（总线结构，细节随摄像头库）

```c
typedef struct {
    uint8_t image[H][W]; // 二值图
    int16_t center[H];   // 每行中线
    int16_t err;         // 加权偏差
    uint8_t element;     // 直道/弯/十字/环岛… 按规则自定义
} Vision_t;

void Vision_OnFrame(Vision_t *v)
{
    // 1) 二值化（大津/固定阈值，必须现场标定）
    // 2) 逐行找边界 → center
    // 3) 对感兴趣行加权：err = Σ w[i]*(center[i]-W/2)
    // 4) 元素识别状态机（十字/环岛/车库… 按当年赛道规则）
}
```

上位机：逐飞助手摄像头显示 / 串口发中线；**图像与算法必须对齐摄像头型号**（SCC8660 等见逐飞库 Example）。

## 7. IMU / 平衡（骨架）

```c
// 互补滤波示例；正式项目再评估 Kalman/误差状态
float CompleAngle(float gyro_dps, float acc_angle_deg, float alpha, float dt)
{
    static float ang;
    ang = alpha * (ang + gyro_dps * dt) + (1.0f - alpha) * acc_angle_deg;
    return ang;
}
// 姿态环：err = target_angle - ang → 输出直立/转向
// 速度环在外环限制倾角目标；强实时，中断周期通常 1–2ms 级
```

## 8. 舵机转向（阿克曼）

```c
// pulse_us: 一般 500~2500，中值由机械标定
uint16_t Servo_PulseFromSteer(float steer, uint16_t mid_us,
                              uint16_t range_us)
{
    if (steer > 1) steer = 1;
    if (steer < -1) steer = -1;
    return (uint16_t)(mid_us + steer * range_us);
}
```

## 9. 调参与安全清单（生成代码时强制注释）

- [ ] `board.h` 引脚与驱动模块原理图一致
- [ ] 控制周期 `CONTROL_DT` 与 TIM 配置一致
- [ ] 上电 PWM=0，按键/菜单使能后才跑车
- [ ] 软件急停：全局标志 + 遥控/按键；优先级高于 PID
- [ ] 堵转检测：measure≈0 且 target 大 → 降占空比或停
- [ ] 电池电压阈值：低压降功率
- [ ] PID 与限速参数放 `const` 表或 Flash，可屏幕调
- [ ] 所有 `Kp/Ki/Kd/v_max/k` 标注 `TODO: 实车标定`
- [ ] 报告：编译通过 ≠ 赛道稳定

## 10. 参数表模板

```c
typedef struct {
    float steer_kp, steer_ki, steer_kd;
    float speed_kp, speed_ki, speed_kd;
    float v_max, err_slow_k;
    float em_scale[8];
    uint16_t servo_mid, servo_range;
} CarParam_t;

const CarParam_t kDefaultParam = {
    .steer_kp = 0.0f, /* TODO 标定 */
    .v_max = 0.5f,    /* TODO：先慢后快 */
    // ...
};
```

写代码时：先用保守默认（低速、弱增益）保证「能跑不飞车」，再按清单逐项调。
