# DSH 嵌入式（STM32）开发插件/模式 —— 可行性方案与实施细节

> 结论先行：**可行，且本机已具备 90% 的条件，无需新装任何东西就能跑通"配置 → 生成 → 编译"闭环。**
> 本文的每一条环境结论都来自本机实测，不是推测。实测命令与原始输出留在 `sandbox/mx/`。

---

## 一、可行性判定（先给结论）

| 能力 | 判定 | 依据 |
|---|---|---|
| 用脚本无头驱动 CubeMX 配置并生成工程 | **已验证可行** | 加载你的 `DCMotor_test.ioc` → 覆盖工具链为 Makefile → 生成完整工程，exit 0 |
| 按用户指定串口参数配置 | **可行（两条路，见 §4）** | `.ioc` 是纯文本 key=value，可结构化改写；CubeMX 6.17 另有未文档化的 `set/get/list/possible_value` 脚本命令 |
| 生成后由 agent 完善代码 | **可行** | `ProjectManager.KeepUserCode=true` + `USER CODE BEGIN/END` 保护块 |
| 编译验证 | **已验证可行** | `mingw32-make` + arm-none-eabi-gcc 14.3 编出 elf/hex/bin（text 6572 B） |
| 烧录到板子 | **工具就位，硬件未接** | `STM32_Programmer_CLI.exe` 已存在；当前 PnP 无任何 ST-LINK/串口设备 |
| 串口回环自动验收 | **硬件未接，无法现在验证** | 同上 |
| 在 DSH 会话沙箱内直接跑 CubeMX | **不可行（已实测崩溃）** | 见 §5，这是本方案唯一的架构约束 |

**一句话**：技术上没有拦路虎，真正的设计难点不在"能不能调 CubeMX"，而在**只让 CubeMX 管它该管的东西（引脚/时钟/外设初始化），让 agent 管业务逻辑，并且在两者之间建立防覆盖、防幻觉、可验证的闸门**。

---

## 二、本机环境实测清单（2026-09-16）

### 2.1 现成可用的资产

| 组件 | 路径 / 版本 | 状态 |
|---|---|---|
| STM32CubeMX | `D:\STM32Cubemx\STM32CubeMX.exe`，6.17.0（APP_VER=6.17.0，DB.6.0.170） | ✅ 自带 JRE 21.0.9，**无需系统 Java** |
| 固件包 | `C:\Users\szj26\STM32Cube\Repository\STM32Cube_FW_F1_V1.8.7` | ✅ 只有 F1；换家族需 `swmgr install`（可能要 `login`） |
| 交叉编译链 | `D:\Program Files (x86)\14.3 rel1\bin\arm-none-eabi-{gcc,gdb,objcopy,size}` | ✅ 14.3，已在 PATH |
| make | `D:\mingw64\bin\mingw32-make.exe` | ✅ 未在 PATH，需显式路径或补 PATH |
| 烧录器 CLI | `D:\Program Files (x86)\bin\STM32_Programmer_CLI.exe` | ✅ 路径非标准，需可配置搜索路径 |
| 调试探针 | 无 | ❌ PnP 无 ST-LINK；无 openocd/pyocd/ST-LINK_gdbserver |
| CubeIDE / CubeCLT / Keil MDK | 无 | ❌ 你的工程是 MDK-ARM 形态但本机没装 Keil（`UV4.exe` 不存在） |
| cmake / ninja | 无 | ❌ |
| clangd | 无 | ❌（VS Code 在，可后补） |

### 2.2 CubeMX 无头模式实测

**调用形式**（官方文档写的是 `jre\bin\java -jar STM32CubeMX.exe -q script`，实测直接用 exe 即可）：

```powershell
cd D:\STM32Cubemx
& 'D:\STM32Cubemx\STM32CubeMX.exe' -q 'D:\path\to\script.txt'
```

`-i` 交互命令行 / `-s` 脚本模式（有 UI）/ `-q` 静默脚本模式（无 UI 交互）。

**实测脚本**（`sandbox/mx/gen.txt`）：

```
help
config load D:\STM32_Workspace\DCMotor_test\DCMotor_test.ioc
config saveas D:\dsh-myplugin\sandbox\mx\gen\DCMotor_cli.ioc
project name DCMotor_cli
project path D:\dsh-myplugin\sandbox\mx\gen
project toolchain Makefile
project generate
exit
```

**实测结果**：逐行回 `OK`，结束打 `Bye bye`，**exit 0**，产出完整工程：

```
DCMotor_cli/  Makefile  STM32F103XX_FLASH.ld  startup_stm32f103xb.s  .mxproject
             Core/{Inc,Src}/  Drivers/{CMSIS,STM32F1xx_HAL_Driver}/  DCMotor_cli.ioc
```

**命令集（6.17.0 实测 `help` 输出）**——公开文档只列了一半，实际可用的还有这些：

- 文档化：`load` `loadboard` `config load|save|saveext|saveas` `project name|path|toolchain|generate` `setDriver` `SetStructure` `SetCopyLibrary` `generate code` `csv pinout` `script` `swmgr install|remove|refresh` `pack enable|validate` `login` `exit`
- **未文档化但存在**：`set` `get` `unset` `list` `possible_value` `not_a_possible_value` `check` `pinout` `clock` `clearpinout` `tinyload` `waitclock` `xbuild` `cpload` `cpexport` `setprop` `getprop` `getenv` `updateIpUI` `isPluginError` `exit_mx` `simulate`

`possible_value` / `check` 尤其有价值：**能让工具向 CubeMX 规则引擎查询某个参数的全部合法取值与合法性**，而不是让模型猜。

### 2.3 编译实测

```powershell
cd <生成的工程>
& 'D:\mingw64\bin\mingw32-make.exe' -j4
```

**成功**：`arm-none-eabi-size` → text 6572 / data 12 / bss 1860，产出 `.elf` `.hex` `.bin` `.map`。全程 workspace 内写入，**不需要**任何沙箱升级。

### 2.4 一个重要的好性质：覆盖生成不污染 `.ioc`

生成时用 `project toolchain Makefile` 覆盖，但生成后的 `.ioc` 里仍是：

```
ProjectManager.TargetToolchain=MDK-ARM V5.32
```

而产物是 Makefile 工程。**结论：工具链覆盖只作用于本次生成，不回写配置。**这意味着可以做到：

> **一份 `.ioc` 作为唯一真源（保持你的 Keil/MDK 工作流不变），agent 侧每次无头生成到独立目录 `build-agent/`，得到 Makefile 工程用于自动编译验证，两边互不干扰。**

这对"不破坏用户既有工程"是决定性的。

---

## 三、方案形态：四层，按需递进

DSH 这边有三种可组合的载体，不必二选一：

| 层 | 载体 | 作用 | 工作量 |
|---|---|---|---|
| **L1 技能** | `SKILL.md`（`.dsh/skills/` 或插件内） | 把"怎么调 CubeMX、怎么改 ioc、怎么编译烧录"写成可复用手册 | 半天，立刻可用 |
| **L2 工具包** | 插件包（toolkit） | 把易错长链条封装成**确定性工具**，返回结构化结果 | 2–4 天，主力 |
| **L3 模式** | agent preset（`~/.dsh/.agent-presets/<name>/agent.cordis.yml`） | 把工具+技能+纪律组装成"嵌入式模式"，新建会话即进入 | 1–2 小时 |
| **L4 面板** | UI 面板（ui-panel） | 引脚表、串口监视器、一键生成/烧录按钮 | 后续增量 |

**推荐路线：先 L1 保底（今天就能用），再 L2+L3 做主力，L4 看需要。**

不建议"只做 L3 模式、不写代码"：那样每次都要模型自己拼命令行、拼 `.ioc` 编号、自己解析 CubeMX 日志，token 贵且会漂移；而 CubeMX 的失败模式（静默丢配置、卡在下载固件包）恰恰是**必须由确定性代码兜住**的。

---

## 四、核心能力设计：如何"按用户设置的串口配置"

### 4.1 两条路，建议主辅搭配

**路 A（主）：结构化改写 `.ioc`**

实测 `.ioc` 是纯文本 `key=value`。串口的真实形态长这样（你的工程）：

```
Mcu.IP6=USART1
Mcu.IPNb=7
Mcu.Pin7=PA9
Mcu.Pin8=PA10
Mcu.PinsNb=14
PA9.Signal=USART1_TX
PA10.Mode=Asynchronous
PA10.Signal=USART1_RX
USART1.IPParameters=VirtualMode
USART1.VirtualMode=VM_ASYNC
```

**要害细节**：`USART1.IPParameters` 只列了 `VirtualMode`，因为其余参数都取默认值。要把波特率改成 9600，必须**同时**做两件事：

```
USART1.IPParameters=VirtualMode,BaudRate,WordLength,Parity,StopBits
USART1.BaudRate=9600
USART1.WordLength=WORDLENGTH_8B
USART1.Parity=PARITY_NONE
USART1.StopBits=STOPBITS_1
```

只加 `USART1.BaudRate=` 而不更新 `IPParameters` 列表 → **CubeMX 静默忽略**（不报错，参数丢失）。这是整个方案里最容易踩、也最该由工具封装掉的坑。

**路 B（辅）：CubeMX 脚本命令**

`set` / `get` / `list` / `possible_value` 让 CubeMX 自己当校验器。适合时钟树、DMA 冲突、复用脚位冲突这类需要规则引擎判断的场景。

**建议**：路 A 为默认（确定性、可 diff、可单测、可回滚），路 B 作为"校验/兜底/复杂项"通道。

### 4.2 必须内建的"编号重排"逻辑

`.ioc` 里 `Mcu.IP0..IPn` + `Mcu.IPNb`、`Mcu.Pin0..PinN` + `Mcu.PinsNb` 必须连续、无洞、数量自洽。agent 手改必然把编号弄坏（新增一个外设忘了改 `IPNb`，或删了一个留下空洞）→ CubeMX 静默丢配置或直接报错。**这一层必须由工具的 ioc_set 统一收口，禁止模型直接编辑这些键。**

---

## 五、唯一的架构约束：会话沙箱（已实测，必须正面处理）

### 5.1 现象

| 执行方式 | 结果 |
|---|---|
| agent 用 `pwsh` 工具跑 CubeMX | **崩溃**：无法写 `~/.stm32cubemx/STM32CubeMX.log`、无法写 java.util.prefs 注册表 → `pinoutconfig` / `filemanager` / `analytics` 插件加载失败 → `pl_pinout is null` → 主线程 NPE |
| 同一命令，一次 `danger-full-access` 授权后 | **完整成功**，exit 0 |
| **插件自己 `child_process` spawn 的进程** | **不受约束**：实测直接写 `C:\Users\szj26\.stm32cubemx\` 成功 |

根因：DSH 的 Windows 沙箱是**逐调用包裹的 ACL 受限令牌**（`sandbox-local` 文档："win32: the ACL restricted-token runner"，报告 `enforcement: partial`）。它只包裹 agent 的 shell 工具进程树，管不到插件进程。

### 5.2 这带来一个必须由你拍板的设计与伦理选择

CubeMX 是 Java GUI 应用，**启动就要写注册表和用户目录**，天生不适合被塞进受限令牌。可选路线：

- **路线 1（推荐）**：由插件统一负责调 CubeMX，并在插件里**显式声明**"本工具在会话沙箱之外运行"，首次使用弹一次确认（记进 settings），工具描述和 UI 里持续可见。
  - 优点：一次确认，长期顺滑；CubeMX/烧录这类"必须碰系统资源"的动作本来就不该在沙箱语义里假装安全。
  - 代价：承认有一个**受控的沙箱出口**，必须有明确边界（只允许白名单可执行文件 + 只允许项目目录与 ST 自有目录）。
- **路线 2（保守）**：插件走沙箱化 subprocess 服务，每次调用请求审批升级。
  - 优点：不破坏沙箱语义；缺点：每次弹窗，且 CubeMX 在受限令牌下**根本跑不起来**，等于每次都要 full-access 审批。
- **路线 3（绕开）**：不做无头，改由人手动在 GUI 里点配置，agent 只写代码。
  - 放弃了本需求的核心价值，不推荐。

**我的建议是路线 1，但要把"沙箱出口"做成显式能力而不是偷偷摸摸的后门**——这既是工程正确性，也是你作为插件基础设施作者该守的线。

### 5.3 顺带发现的操作性坑

- 沙箱内 `git clone https://github.com/...` 失败：`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`（受限令牌取不到凭据）。抓先例仓库需要一次非受限网络访问。
- `web_fetch` 对 github.com / raw.githubusercontent.com / cdn.jsdelivr.net 报 "resolves to a non-public IP address"（本机 DNS/策略），只有 `dev.st.com` 这类能取。所以**外部资料核查要靠搜索摘要或让用户在别的环境抓**。

---

## 六、工具清单与契约（L2 插件）

包名建议 `@dsh-external/dsh-stm32`（或 `dsh-embedded-stm32`），形态 **toolkit**，后续可加 client 面板。

| 工具 | 作用 | 关键设计 |
|---|---|---|
| `stm32_env` | 环境自检 | 探测 CubeMX/JRE/工具链/make/烧录器/FW 包/串口设备；**缺失项给出可执行的修复指令**，而不是让后续步骤莫名失败 |
| `stm32_ioc_read` | `.ioc` → 结构化 JSON | 输出 MCU、封装、引脚映射、外设清单与**每外设显式参数 vs 默认值**、时钟树关键项；顺带做一致性校验（编号连续性等） |
| `stm32_ioc_set` | 结构化改外设 | 入参是语义化的（`uart: {instance: USART1, baud: 9600, parity: none, ...}`），内部负责编号重排 + `IPParameters` 同步 + 备份 + 返回 diff；**拒绝越界改动** |
| `stm32_generate` | 无头生成 | 写脚本 → 调 CubeMX → 校验产物清单 → 返回生成文件 diff；处理"FW 包未安装/需登录"的明确报错 |
| `stm32_build` | 编译 | make/CMake 双后端；把 gcc 输出解析成 `file:line:col: error: ...` 结构化错误 |
| `stm32_guard` | 防覆盖审计 | 生成前后 diff，检出"agent 改了 USER CODE 之外区域"（会被下次生成抹掉）并拦下 |
| `stm32_flash` | 烧录 | `STM32_Programmer_CLI -c port=SWD -w <elf> -v -rst`；可选 pyocd/openocd 后端；无探针时明确报错 |
| `stm32_serial` | 串口验收 | 打开指定串口，超时/正则匹配，返回捕获文本；用于"烧完看有没有打出预期日志"的自动判定 |
| `stm32_hal_lookup` | 抗幻觉检索 | 直接在 `C:\Users\szj26\STM32Cube\Repository\...\Drivers\STM32F1xx_HAL_Driver\Inc\*.h` 与 CMSIS 头里检索真实签名/宏/位定义，返回源码引用 |

### 6.1 与 DSH 规范的对接点

- 资源一律挂 `ctx.effect`（工具注销、监听解绑、子进程回收），保证热重载/卸载即净。
- 长任务（生成、编译、烧录、串口等待）走后台 job，不要把工具调用阻塞死。
- 每次生成/改写前自动备份 `.ioc` 与 `Core/`（例如 `.dsh-stm32/backups/<ts>/`），提供一键回滚——嵌入式的"改坏了"代价比 Web 高得多。

---

## 七、模式（L3 preset）设计

`~/.dsh/.agent-presets/embedded-stm32/agent.cordis.yml`（该目录已存在，当前为空），内容大致：

- `persona`：嵌入式工程师人格，强调"寄存器/时序/资源约束"优先于"能编过就行"。
- 工具行：`tool-fs` `tool-pwsh` `tool-skills` + 本插件的 `stm32_*` 工具。
- 提示词段落（preset 的核心价值）：
  1. **真源规则**：`.ioc` 是外设/时钟/引脚的唯一真源，禁止手写 `MX_*_Init()`；
  2. **改动边界**：业务代码只写在 `USER CODE BEGIN/END` 之间或自建 `App/` 目录（CubeMX 不碰的树）；
  3. **验证纪律**：任何"完成"必须附 `stm32_build` 通过证据；涉及运行时的必须附串口/烧录证据或明确标注"未上板验证"；
  4. **抗幻觉**：调 HAL API 前先 `stm32_hal_lookup` 确认真实签名，禁止凭记忆写寄存器位。
- 技能：`cubemx-headless`（脚本手册+命令集）、`ioc-format`（键语义与编号规则）、`hal-patterns`（UART/DMA/中断/定时器惯用法与常见错误）、`debug-hardfault`（HardFault 定位流程）。

> 生态里已有可借鉴者：市场的 `@amethystluna/embedded-workbench`（固件技能 + 验证纪律）、GitHub 的 `WillWangZiHuan/stm32-codex-skill`（板卡手册→CubeMX 工程→编译产物，形态与我们最接近）。建议实现前先抓来读，**取其技能内容与纪律设计，不重复造轮子**。

---

## 八、风险清单与对策

| 风险 | 严重度 | 对策 |
|---|---|---|
| 沙箱内跑 CubeMX 必崩 | 高 | §5：由插件在沙箱外调，显式声明 + 一次确认 |
| `.ioc` 编号/`IPParameters` 改错 → 静默丢配置 | 高 | 全部收口到 `stm32_ioc_set`；改后 `stm32_ioc_read` 回读校验 |
| agent 在 USER CODE 外写代码，下次生成被抹 | 高 | `stm32_guard` 生成前后 diff 拦截 |
| HAL API 幻觉（编造函数/位域） | 高 | `stm32_hal_lookup` 强制查证 + 编译闸门 |
| FW 包缺失导致 CubeMX 卡在下载/登录 | 中 | `stm32_env` 预检；报"请先 `swmgr install stm32cube_f1_1.8.7`" |
| 用户既有 Keil 工程被破坏 | 中 | 一份 `.ioc` 双工具链策略（§2.4），agent 只写独立 `build-agent/` 目录 |
| 无 ST-LINK，烧录/串口验收无法自动化 | 中 | 明确降级为"编译通过 + 未上板验证"；接上硬件后补 M2 验收 |
| CubeMX 并发实例互踩（`thirdparty lock`） | 低 | 插件内串行化生成，加文件锁 |
| 生成耗时长（实测约 10–20 s） | 低 | 走后台 job + 进度回报 |

---

## 九、分阶段实施与验收标准

**M0 · 技能保底（半天）**
产出 `cubemx-headless` + `ioc-format` 两个 SKILL。
验收：用自然语言让 agent 把串口改成 9600 8N1 并生成 Makefile 工程，人工确认 `.ioc` 改动正确、工程可编译。

**M1 · 工具包核心（2–3 天）**
`stm32_env` `stm32_ioc_read` `stm32_ioc_set` `stm32_generate` `stm32_build` `stm32_guard` + 沙箱出口机制。
验收：一句话需求 → 自动改 ioc → 无头生成 → 编译 → 返回 `text/data/bss` 与产物路径；`.ioc` 备份与回滚可用；沙箱出口有一次确认且可见。
**（本机今天就能验收 M1，因为 CubeMX+工具链都到位）**

**M2 · 上板闭环（1–2 天，需硬件）**
`stm32_flash` `stm32_serial` + 端到端验收脚本。
验收：烧录校验通过，串口收到预期字符串（例如周期性 `Hello 9600`）。
前置：ST-LINK 接上；确认 `STM32_Programmer_CLI` 路径可配置且能 `-l` 枚举到探针。

**M3 · 模式与智能（1–2 天）**
preset 组装 + `stm32_hal_lookup` + clangd 静态诊断（CMake 工程导出 `compile_commands.json`）。
验收：新建会话默认进入"嵌入式模式"；HAL 调用全部有源码引用；clangd 诊断接入编译反馈。

**M4 · 面板与守护（按需）**
UI 面板：引脚表 / 外设参数表单 / 串口监视器 / 一键生成·编译·烧录。
守护循环：盯串口日志或构建产物，异常自动回灌给 agent。

---

## 十、待你拍板的四个问题

1. **硬件**：有 ST-LINK 和板子吗？型号与用于调试的串口是哪个？（决定 M2 能否验收、默认参数怎么定）
2. **工具链**：agent 侧编译走哪条？
   - (a) Makefile + 现成 `mingw32-make`（**已验证，零安装**）
   - (b) 装 STM32CubeCLT，用官方 CMake + ninja（更整洁，能出 `compile_commands.json` 喂 clangd，需下载安装）
   - (c) 必须兼容你现有的 Keil MDK（需装 Keil 并摸清 `UV4.exe -b` 命令行构建）
3. **沙箱出口**：接受"插件在会话沙箱外驱动 CubeMX，首次确认一次并长期可见"（路线 1）吗？还是坚持每次审批（路线 2）？
4. **交付顺序**：先出 L1 技能让你今天就能用，还是直接开工 L2 插件包？

---

## 附录 A：实测原始证据位置

| 文件 | 内容 |
|---|---|
| `sandbox/mx/help.txt` / `help.out.txt` | 沙箱内运行 → 崩溃现场（注册表/prefs 被拒 → NPE） |
| `sandbox/mx/gen.txt` | 无头生成脚本 |
| `sandbox/mx/gen.out.txt` | 成功生成全过程日志（含 6.17.0 真实命令集） |
| `sandbox/mx/gen/DCMotor_cli/` | 生成的 Makefile 工程（已编译出 elf/hex/bin） |
| `sandbox/mx/gen/DCMotor_cli.ioc` | 生成后的 `.ioc`，用于核对 `TargetToolchain` 未被污染 |

## 附录 B：一条最小心智模型

```
        ┌── .ioc（唯一真源：引脚/时钟/外设初始化）──┐
        │                                          │
   用户/agent 语义化改参数                     CubeMX 无头生成
        │                                          │
        └────────────► stm32_ioc_set ──────────────┘
                            │
                            ▼
        build-agent/（Makefile 工程，agent 专用，不碰 Keil 目录）
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        USER CODE 区     App/ 自建模块    stm32_guard 审计
        （agent 写业务逻辑）
              │
              ▼
        stm32_build → stm32_flash → stm32_serial（验收证据）
```
