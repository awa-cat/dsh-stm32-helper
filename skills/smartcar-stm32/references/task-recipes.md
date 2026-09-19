# 典型任务实现配方（可直接改写交付）

时钟约定：`Tclk = 72 MHz`（用户工程不同时先读 `.ioc` 时钟树）。

---

## R1. LED 闪烁（点灯）

CubeMX：PC13 GPIO_Output。

```c
/* USER CODE BEGIN 2 */
/* 校准、启动放这里；点灯无需额外启动 */
/* USER CODE END 2 */
while (1) {
  /* USER CODE BEGIN 3 */
  HAL_Delay(500);
  HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
  /* USER CODE END 3 */
}
```

工程实现可改为 1 ms TIM 时间戳，避免长 `HAL_Delay` 堵主循环。

---

## R2. 按键轮询控制 LED

CubeMX：PA9 输入上拉；PC13 输出。

```c
while (1) {
  if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_9) == GPIO_PIN_SET) {
    HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
  } else {
    HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_RESET);
  }
}
```

注意板载 LED 低电平亮，写 SET/RESET 前按原理图对齐「亮/灭」语义。

---

## R3. EXTI 按键消抖翻转（教程练习二）

```c
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  if (GPIO_Pin == GPIO_PIN_8) {
    HAL_Delay(20);
    if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_8) == GPIO_PIN_RESET) {
      HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
    }
  }
}
```

NVIC：外部中断优先级必须低于 SysTick（SysTick 数值更小），否则 `HAL_Delay` 可能卡死。  
更稳妥：改用 R7 定时器扫描，不动 HAL 库。

---

## R4. printf 串口重定向 + 发送

```c
#include "stdio.h"
#include "string.h"

int fputc(int ch, FILE *f) {
  HAL_UART_Transmit(&huart1, (uint8_t *)&ch, 1, 0xffff);
  return ch;
}

// 初始化后：
char txBuffer[] = "Hello World";
HAL_UART_Transmit(&huart1, (uint8_t *)txBuffer, strlen(txBuffer), 1000);
printf("Hello World\r\n");
```

Keil：**Use MicroLIB**。USART1：115200-8-N-1。

---

## R5. 串口指令控灯（阻塞接收）

```c
while (1) {
  uint8_t dataReceived;
  HAL_UART_Receive(&huart1, &dataReceived, 1, HAL_MAX_DELAY);
  if (dataReceived == '0') {
    HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
  } else if (dataReceived == '1') {
    HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_RESET);
  }
}
```

智能车不要在主循环用 `HAL_MAX_DELAY` 死等；见 R6。

---

## R6. 串口中断回显 / 行缓冲（推荐）

```c
uint8_t aRxBuffer;
uint8_t RxBuffer[256];
uint32_t tot = 0;

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
  if (huart != &huart1) return;
  if (tot < sizeof(RxBuffer)) RxBuffer[tot++] = aRxBuffer;
  if (tot >= 2 && RxBuffer[tot - 2] == '\r' && RxBuffer[tot - 1] == '\n') {
    HAL_UART_Transmit(&huart1, RxBuffer, tot, 100);
    tot = 0;
  }
  HAL_UART_Receive_IT(&huart1, &aRxBuffer, 1);  // 再次武装
}

int main(void) {
  /* MX init ... */
  /* USER CODE BEGIN 2 */
  HAL_UART_Receive_IT(&huart1, &aRxBuffer, 1);
  /* USER CODE END 2 */
  while (1) { }
}
```

NVIC：使能 USART1 全局中断。

---

## R7. TIM 中断时间基 + 自定义延时

```c
volatile uint32_t currentMiliSeconds = 0;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim == &htim1) {
    currentMiliSeconds++;
  }
}

void MyDelay(uint32_t Delay) {
  uint32_t expireTime = currentMiliSeconds + Delay;
  while (currentMiliSeconds < expireTime) { }
}
```

CubeMX TIM1：PSC=71，ARR=999 → 1 ms；启动：`HAL_TIM_Base_Start_IT(&htim1)`。

---

## R8. 10 ms 按键扫描消抖（优于 EXTI+Delay）

```c
GPIO_PinState lasState = GPIO_PIN_SET, nowState;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim != &htim1) return;  // 10ms: PSC=71 ARR=9999
  nowState = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_8);
  if (lasState == GPIO_PIN_SET && nowState == GPIO_PIN_RESET) {
    HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
  }
  lasState = nowState;
}
```

---

## R9. PWM 占空比控制（呼吸灯 / 电机调速同构）

CubeMX TIM1 CH1 PWM Mode1：PSC=71，ARR=999（1 kHz）。

```c
HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
// 可选互补：HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_1);

while (1) {
  float t = HAL_GetTick() * 0.001f;
  float duty = 0.5f * sinf(2.0f * 3.1415926f * t) + 0.5f;
  __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_1, (uint32_t)(duty * (999 + 1)));
  // 等价 TIM1->CCR1 = ...
}
```

电机调速骨架（方向 GPIO + 占空比）：

```c
// 假设 DIR 引脚与 PWM 通道已由 .ioc 配置
void Motor_Set(int16_t duty_signed, uint16_t arr) {
  if (duty_signed > (int16_t)arr) duty_signed = (int16_t)arr;
  if (duty_signed < -(int16_t)arr) duty_signed = -(int16_t)arr;
  if (duty_signed >= 0) {
    HAL_GPIO_WritePin(MOTOR_DIR_GPIO_Port, MOTOR_DIR_Pin, GPIO_PIN_RESET);
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_1, (uint32_t)duty_signed);
  } else {
    HAL_GPIO_WritePin(MOTOR_DIR_GPIO_Port, MOTOR_DIR_Pin, GPIO_PIN_SET);
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_1, (uint32_t)(-duty_signed));
  }
}
```

> PID 闭环本版教程未给出；在固定 TIM 周期里：`err = target - measure; out += Kp*(err-last)+...`（增量式）或位置式，输出进 `Motor_Set`。参数必须实车调。

---

## R10. ADC 单通道阻塞读

```c
HAL_ADCEx_Calibration_Start(&hadc1);
HAL_ADC_Start(&hadc1);
HAL_ADC_PollForConversion(&hadc1, 100);
uint32_t raw = HAL_ADC_GetValue(&hadc1);
float volts = raw / 4096.0f * 3.3f;
```

---

## R11. ADC 多通道轮询（间断模式 Number=1）

```c
// CubeMX: 扫描开, 连续关, 间断开 Number=1, Rank1=ch0 Rank2=ch1, 7.5Cycle
HAL_ADCEx_Calibration_Start(&hadc1);

void SampleXY(uint16_t *x, uint16_t *y) {
  HAL_ADC_Start(&hadc1);
  HAL_ADC_PollForConversion(&hadc1, 100);
  *x = (uint16_t)HAL_ADC_GetValue(&hadc1);
  HAL_ADC_Start(&hadc1);
  HAL_ADC_PollForConversion(&hadc1, 100);
  *y = (uint16_t)HAL_ADC_GetValue(&hadc1);
}
```

定时器 100 ms 调用 `SampleXY`，并可 `printf` 方向判断。

---

## R12. ADC + DMA + UART DMA（实时波形）

```c
uint8_t  buf[16];
uint16_t ADC_Value[2];

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim != &htim1) return;
  int len = sprintf((char *)buf, "%d %d\r\n", ADC_Value[0], ADC_Value[1]);
  if (len > 0) HAL_UART_Transmit_DMA(&huart1, buf, (uint16_t)len);
}

int main(void) {
  /* MX_*_Init(); */
  HAL_ADCEx_Calibration_Start(&hadc1);
  HAL_ADC_Start_DMA(&hadc1, (uint32_t *)ADC_Value, 2);  // Circular 连续采
  HAL_TIM_Base_Start_IT(&htim1);  // 100ms 发送
  while (1) { }
}
```

- SerialPlot：空格分隔 + `\n`
- 逐飞示波器：`"%d,%f,%d,%d,%f\n"`
- CubeMX：UART1 全局中断 ON；ADC DMA Circular 半字；UART DMA Normal 字节

---

## R13. 无源蜂鸣器音乐（大作业骨架）

频率表（Hz）与索引：

| 索引 | 含义 | 频率 |
|---|---|---|
| 0 | 休止 | 40000（超声波，听不见） |
| 1–7 | 次低音 | 131,147,165,175,196,220,247 |
| 8–14 | 低音 | 262,293,330,349,392,440,494 |
| 15–21 | 原音 | 523,587,659,698,784,880,988 |
| 22–28 | 高音 | 1047,1175,1319,1397,1568,1760,1976 |
| 29–35 | 次高音 | 2093,2349,2637,2794,3136,3520,3951 |

```c
int32_t freq[36] = {
  40000, 131, 147, 165, 175, 196, 220, 247,
  262, 293, 330, 349, 392, 440, 494,
  523, 587, 659, 698, 784, 880, 988,
  1047, 1175, 1319, 1397, 1568, 1760, 1976,
  2093, 2349, 2637, 2794, 3136, 3520, 3951
};
int32_t notePSC[36];
int32_t music[] = {15, 16, 17, 18, 19, 20, 21};
int32_t totalNotes = 7, currentNote = 0;
int32_t step = 2, progress = 0, threshold = 40, currentTone = 0;

void init_notePSC(void) {
  for (int i = 0; i < 36; i++) {
    notePSC[i] = 72000000 / (freq[i] * 99) - 1;  // ARR=99
  }
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim != &htim2) return;  // 节奏 TIM 10ms
  // TODO: 用 ADC_Value[0/1] 设 step 与 currentTone（-7/0/+7）
  // TODO: Z 轴暂停时 step=0
  if (step == 0 || music[currentNote] == 0)
    TIM1->PSC = notePSC[0];
  else {
    int idx = music[currentNote] + currentTone;
    if (idx < 0) idx = 0;
    if (idx > 35) idx = 35;
    TIM1->PSC = notePSC[idx];
  }
  progress += step;
  if (progress >= threshold) {
    progress = 0;
    currentNote = (currentNote + 1) % totalNotes;
  }
}
```

启动顺序：`init_notePSC` → ADC 校准 → ADC DMA 连续采 → `HAL_TIM_PWM_Start`（ARR=99，约 50% 占空比）→ 节奏 TIM `Start_IT`。  
暂停续播：靠 `progress` 保留，不重置 `currentNote`。

---

## 交付检查

1. 代码落在 USER CODE / `App/`
2. CubeMX 参数与 recipe 一致（或已说明差异）
3. `build-keil` 编译 exit code 与警告数
4. 报告模板见 `stm32-verify-loop`
5. 上板项（电机、蜂鸣器音准、摇杆）明确「未验证」或用户实测结果
