# 验证纪律的跨平台补充

正文 `stm32-verify-loop/SKILL.md` 中的 **UV4 / PowerShell / `D:\` / `C:\Users\szj26\...` 路径为 Windows 本机示例**。

## 验证阶梯（通用）

L0 产物清单 → L1 编译 → L2 烧录校验 → L3 串口行为 → L4 调试器读状态  

报告纪律不变：只做到 L1 必须写「仅编译通过，未上板」。

## 构建命令对照

| 宿主 | 有 Keil MDK？ | 构建 |
|---|---|---|
| Windows | 是 | `UV4.exe -b <uvprojx>`（Start-Process -Wait）；技能 `build-keil` |
| Windows/macOS/Linux | 否 / 不用 Keil | CubeMX 生成 **Makefile/CMake** → `make` 或 `cmake --build` |
| 全平台 | — | PlatformIO：`pio run`（若工程用 PIO） |

```bash
# macOS / Linux Makefile 工程
cd "$PROJECT"
make -j4
arm-none-eabi-size build/*.elf   # 产物路径以工程为准
```

```bash
# 烧录示例（OpenOCD + ST-Link）
openocd -f interface/stlink.cfg -f target/stm32f1x.cfg \
  -c "program <elf-or-bin> verify reset exit"
```

## 路径探测

| 类型 | Windows 示例 | Unix |
|---|---|---|
| 技能根 | `C:\Users\szj26\.dsh\skills\` | `$HOME/.dsh/skills/` |
| HAL 头文件 | `C:\Users\szj26\STM32Cube\Repository\STM32Cube_FW_F1_V1.8.7\...` | `$HOME/STM32Cube/Repository/...` |
| 代码根 | `D:\STM32_Workspace\...` | 用户项目目录 |
| 串口 | `COMx` | `/dev/cu.*` / `/dev/ttyACM*` |

探测脚本：`embedded-hardware/scripts/detect-embedded-env.{sh,ps1}`  
工具链说明：`embedded-hardware/references/cross-platform-toolchain.md`

## USER CODE / 查证

与正文相同：CubeMX 只保留 `USER CODE BEGIN/END`；复杂业务进 `App/`；HAL 调用前查本机固件包头文件。Mac/Linux 上同样禁止手写 `MX_*_Init()`。
