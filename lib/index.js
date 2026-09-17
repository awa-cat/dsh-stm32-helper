/**
 * @dsh-external/dsh-stm32 —— STM32CubeMX 无头配置与工程生成（工具包形态）
 *
 * 本插件承担生态里缺失的那一层：**外设配置与工程生成**。
 * 构建 / 烧录 / 调试交给 embed-ai-tool 技能集（build-keil / flash-keil / serial-monitor），不重复造。
 *
 * 资源注册一律挂 ctx.effect（热重载 / 卸载自动清理）。
 *
 * 沙箱说明（本机实测，务必遵守）：
 *   CubeMX 是 Java GUI 程序，启动需写 java.util.prefs 注册表与 ~/.stm32cubemx。
 *   在 DSH 会话沙箱（Windows ACL 受限令牌）内运行会崩溃：pinoutconfig 插件加载失败 → NPE。
 *   插件自身 spawn 的进程不受该沙箱约束，因此由本插件执行；但这是**显式的沙箱出口**，
 *   故 stm32_generate 要求显式 acknowledgeOutsideSandbox 确认，不做静默绕过。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as ioc from './ioc.js'
import * as guard from './guard.js'
import * as flash from './flash.js'
import * as serial from './serial.js'

export const name = '@dsh-external/dsh-stm32'
export const inject = ['tools']

const execFileAsync = promisify(execFile)
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? ''
const BUNDLES = join(LOCALAPPDATA, 'stm32cube', 'bundles')

/**
 * 本机约定的工程代码根（由用户指定）。stm32_generate 未显式给 outputDir 时默认落在这里，
 * 以便所有 agent 产出的工程集中在一处、互不污染既有工程。
 * 可用环境变量 DSH_STM32_CODE_ROOT 覆盖。
 */
const DEFAULT_CODE_ROOT = process.env.DSH_STM32_CODE_ROOT ?? 'D:\\STM32_Workspace\\DSHCode'

const firstExisting = (paths) => paths.find((p) => p && existsSync(p)) ?? null

/** ST 扩展自带 bundle 里的可执行文件（版本目录名不确定，扫描一层）。 */
function bundleExe(bundle, rels) {
  const base = join(BUNDLES, bundle)
  if (!existsSync(base)) return null
  let vers = []
  try {
    vers = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { /* 忽略 */ }
  const out = []
  for (const v of vers) for (const rel of rels) out.push(join(base, v, rel))
  return firstExisting(out)
}

/** ST 官方 VS Code 扩展的统一启动器 cube.exe（可驱动 cmake/ninja/programmer/gdbserver/clangd）。 */
function stLauncher() {
  const extRoot = join(HOME, '.vscode', 'extensions')
  if (!existsSync(extRoot)) return null
  try {
    const dirs = readdirSync(extRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('stmicroelectronics.stm32cube-ide-core-'))
      .map((d) => d.name)
    for (const d of dirs) {
      const p = join(extRoot, d, 'resources', 'binaries', 'win32', 'x86_64', 'cube.exe')
      if (existsSync(p)) return p
    }
  } catch { /* 忽略 */ }
  return null
}

function detectToolchains() {
  const gccOnPath = (process.env.PATH ?? '')
    .split(';')
    .map((d) => join(d, 'arm-none-eabi-gcc.exe'))
    .find((p) => existsSync(p)) ?? null
  return {
    stLauncher: stLauncher(),
    keilUv4: firstExisting([
      join(LOCALAPPDATA, 'Keil_v5', 'UV4', 'UV4.exe'),
      'C:\\Keil_v5\\UV4\\UV4.exe',
      'D:\\Keil_v5\\UV4\\UV4.exe',
    ]),
    armGcc: gccOnPath,
    make: firstExisting(['D:\\mingw64\\bin\\mingw32-make.exe', 'C:\\mingw64\\bin\\mingw32-make.exe']),
    cmake: bundleExe('cmake', ['bin\\cmake.exe']),
    ninja: bundleExe('ninja', ['bin\\ninja.exe', 'ninja.exe']),
    programmerCli: firstExisting([
      bundleExe('programmer', ['bin\\STM32_Programmer_CLI.exe']),
      'D:\\Program Files (x86)\\bin\\STM32_Programmer_CLI.exe',
      join(HOME, '.eide', 'tools', 'st_cube_programer', 'bin', 'STM32_Programmer_CLI.exe'),
    ]),
    stlinkGdbServer: bundleExe('stlink-gdbserver', ['bin\\ST-LINK_gdbserver.exe']),
    clangd: bundleExe('st-arm-clangd', ['bin\\starm-clangd.exe']),
  }
}

function detectCubeMx(explicit) {
  const path = firstExisting([
    explicit,
    'D:\\STM32Cubemx\\STM32CubeMX.exe',
    'C:\\ST\\STM32CubeMX\\STM32CubeMX.exe',
    join('C:\\Program Files', 'STMicroelectronics', 'STM32Cube', 'STM32CubeMX', 'STM32CubeMX.exe'),
  ].filter(Boolean))
  if (!path) return { path: null, exists: false, version: null, bundledJre: null }
  const jre = join(dirname(path), 'jre', 'bin', 'java.exe')
  let version = null
  // 版本号在安装记录的 Java 序列化 blob 里（APP_VERt 6.17.0）；
  // mxinstallversion.txt 存的是安装说明文字，不是版本，别用。
  try {
    const info = join(dirname(path), '.installationinformation')
    if (existsSync(info)) {
      const raw = readFileSync(info, 'latin1')
      const m = /APP_VER\s*t\s*([0-9][0-9A-Za-z.\-_]*)/.exec(raw)
      if (m) version = m[1]
    }
  } catch { /* 忽略 */ }
  return { path, exists: true, version, bundledJre: existsSync(jre) ? jre : null }
}

function detectFirmwarePacks() {
  const repo = join(HOME, 'STM32Cube', 'Repository')
  if (!existsSync(repo)) return { repository: repo, exists: false, packs: [] }
  let packs = []
  try {
    packs = readdirSync(repo, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^STM32Cube_FW_/.test(d.name))
      .map((d) => d.name)
      .sort()
  } catch { /* 忽略 */ }
  return { repository: repo, exists: true, packs }
}

async function listSerialPorts() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() -join ","'],
      { timeout: 15000, windowsHide: true },
    )
    return stdout.trim().split(',').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

async function listProbes(programmerCli) {
  if (!programmerCli) return null
  try {
    const { stdout } = await execFileAsync(programmerCli, ['-l'], { timeout: 60000, windowsHide: true, maxBuffer: 8 << 20 })
    const found = []
    if (/No ST-Link detected/i.test(stdout)) found.push({ kind: 'stlink', present: false })
    else if (/ST-Link/i.test(stdout)) found.push({ kind: 'stlink', present: true })
    if (/No J-Link\/flasher probe detected/i.test(stdout)) found.push({ kind: 'jlink', present: false })
    else if (/J-Link/i.test(stdout)) found.push({ kind: 'jlink', present: true })
    const ports = /Total number of serial ports available:\s*(\d+)/i.exec(stdout)
    return { probes: found, serialPortCount: ports ? Number(ports[1]) : null }
  } catch (e) {
    return { error: String(e?.message ?? e) }
  }
}

const asText = (value) => [{ type: 'text', text: String(value) }]
const jsonOut = { schema: { type: 'string' }, render: (_a, v) => asText(v) }
const j = (o) => JSON.stringify(o, null, 2)

function readIocOrThrow(p) {
  const abs = resolve(p)
  if (!existsSync(abs)) throw new Error(`找不到 .ioc 文件: ${abs}`)
  return { abs, doc: ioc.parseIoc(readFileSync(abs, 'utf8')) }
}

function backupFile(file) {
  const dir = join(dirname(file), '.dsh-stm32', 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dir, `${stamp}-${file.split(/[\\/]/).pop()}`)
  copyFileSync(file, dest)
  return dest
}

/**
 * CubeMX 生成的 MDK 工程默认使用 **ARM Compiler 5**，而较新的 Keil 安装往往只有
 * **ARMCLANG(AC6)** ⇒ 构建直接失败：
 *   "Target 'X' uses ARM-Compiler 'Default Compiler Version 5' which is not available."
 * 实测（Keil 5.43.1 + ARMCLANG 6.24）确认该组合下 UV4 返回码 2。
 *
 * 按本机实际安装的编译器补写 <uAC6>/<pArmCC>/<pCCUsed>。
 * 版本号格式：6240000::V6.24::ARMCLANG ← 6*1000000 + 24*10000
 */
function ensureMdkCompiler(projectDir, keilUv4) {
  const mdkDir = join(projectDir, 'MDK-ARM')
  if (!existsSync(mdkDir)) return null
  let proj = null
  try { proj = readdirSync(mdkDir).find((f) => f.toLowerCase().endsWith('.uvprojx')) } catch { return null }
  if (!proj) return null
  const file = join(mdkDir, proj)
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  if (/<uAC6>/.test(text)) return { file, changed: false, reason: '工程已指定编译器，未改动' }

  const keilRoot = keilUv4 ? dirname(dirname(keilUv4)) : null
  const armclang = keilRoot ? join(keilRoot, 'ARM', 'ARMCLANG', 'bin', 'armclang.exe') : null
  if (!armclang || !existsSync(armclang)) {
    return { file, changed: false, reason: '本机找不到 ARMCLANG(AC6)；若只装了 ARM Compiler 5 则无需改动' }
  }

  let major = 6, minor = 0
  try {
    const out = execFileSync(armclang, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    const m = /Arm Compiler for Embedded\s+(\d+)\.(\d+)/i.exec(out) ?? /Component:[^\n]*?(\d+)\.(\d+)/.exec(out)
    if (m) { major = Number(m[1]); minor = Number(m[2]) }
  } catch { /* 解析失败按 6.0 兜底 */ }

  const tag = `${major * 1000000 + minor * 10000}::V${major}.${minor}::ARMCLANG`
  const ins = `      <pArmCC>${tag}</pArmCC>\r\n      <pCCUsed>${tag}</pCCUsed>\r\n      <uAC6>1</uAC6>\r\n`
  const patched = text.replace(/(\r?\n)(\s*<ToolsetName>[^<]*<\/ToolsetName>\r?\n)/, `$1$2${ins}`)
  if (patched === text) return { file, changed: false, reason: '未找到 <ToolsetName> 锚点，未改动' }
  writeFileSync(file, patched, 'utf8')
  return { file, changed: true, compiler: tag, note: '原本会用 ARM Compiler 5（本机不可用），已改为 ARMCLANG' }
}

export function apply(ctx) {
  // ── 1. 环境自检 ────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_env',
    description: '探测本机 STM32 工具链（CubeMX/Keil/GCC/make/cmake/烧录器/固件包/串口）并报告缺失项。',
    parameters: {
      cubeMxPath: { type: 'string', description: '显式指定 STM32CubeMX.exe 路径（可选）' },
      probeHardware: { type: 'boolean', description: '是否真的调用 STM32_Programmer_CLI 枚举探针（较慢，约数秒）' },
    },
    isConcurrencySafe: () => true,
    output: jsonOut,
    async execute(args) {
      const out = {
        cubeMx: detectCubeMx(args.cubeMxPath),
        firmware: detectFirmwarePacks(),
        toolchains: detectToolchains(),
        serialPorts: await listSerialPorts(),
      }
      if (args.probeHardware) out.hardware = await listProbes(out.toolchains.programmerCli)
      const missing = []
      if (!out.cubeMx.exists) missing.push('STM32CubeMX（stm32_generate 必需）')
      if (!out.toolchains.keilUv4) missing.push('Keil UV4.exe（build-keil 技能必需）')
      if (!out.toolchains.armGcc) missing.push('arm-none-eabi-gcc')
      if (!out.toolchains.make) missing.push('mingw32-make（GNU Make 构建路径所需）')
      if (out.firmware.exists && out.firmware.packs.length === 0) missing.push('固件包（需 swmgr install）')
      out.missing = missing
      return j(out)
    },
  })), '@dsh-external/dsh-stm32: env probe')

  // ── 2. .ioc 结构化读取 ─────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_ioc_read',
    description: '把 CubeMX 的 .ioc 解析成结构化 JSON，并检查编号连续性与 IPParameters 登记（静默丢配置风险）。',
    parameters: {
      iocPath: { type: 'string', required: true, description: '.ioc 文件路径' },
    },
    isConcurrencySafe: () => true,
    output: jsonOut,
    async execute(args) {
      const { abs, doc } = readIocOrThrow(args.iocPath)
      return j({ path: abs, ...ioc.summarize(doc) })
    },
  })), '@dsh-external/dsh-stm32: ioc read')

  // ── 3. .ioc 语义化改写 ─────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_ioc_set',
    description: '按语义改 .ioc（目前支持 uart / gpio），自动同步 IPParameters 与 Mcu.IP*/Pin* 编号；改前备份，改后回读校验。',
    parameters: {
      iocPath: { type: 'string', required: true, description: '.ioc 文件路径' },
      uart: { type: 'json', description: '如 {"instance":"USART1","baud":115200,"wordLength":8,"parity":"none","stopBits":1,"txPin":"PA9","rxPin":"PA10","enableIrq":true}' },
      gpio: { type: 'json', description: '数组，如 [{"pin":"PA1","mode":"output","label":"LED1"},{"pin":"PB0","mode":"input","pull":"up"}]' },
      dryRun: { type: 'boolean', description: '只计算不写盘（默认 false）' },
    },
    output: jsonOut,
    async execute(args) {
      const { abs, doc } = readIocOrThrow(args.iocPath)
      const applied = []
      if (args.uart) applied.push({ kind: 'uart', ...ioc.setUart(doc, args.uart) })
      if (args.gpio) {
        const list = Array.isArray(args.gpio) ? args.gpio : [args.gpio]
        for (const g of list) applied.push({ kind: 'gpio', ...ioc.setGpio(doc, g) })
      }
      if (applied.length === 0) {
        return j({ ok: false, error: '没有给出任何要改的内容：请提供 uart 和/或 gpio 参数' })
      }
      const after = ioc.summarize(doc)
      if (args.dryRun) return j({ ok: true, dryRun: true, path: abs, applied, warningsAfter: after.warnings })

      const backup = backupFile(abs)
      writeFileSync(abs, ioc.serializeIoc(doc), 'utf8')

      // 回读校验：重新解析写出的文件，确认关键键真的落地且登记进 IPParameters
      const verifyDoc = ioc.parseIoc(readFileSync(abs, 'utf8'))
      const verify = ioc.summarize(verifyDoc)
      return j({
        ok: verify.warnings.length === 0,
        path: abs,
        backup,
        applied,
        warningsAfter: verify.warnings,
        verifiedPeripherals: verify.peripherals,
      })
    },
  })), '@dsh-external/dsh-stm32: ioc set')

  // ── 4. 无头生成 ────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_generate',
    timeoutMs: 300000,
    description: '用 CubeMX 无头生成工程（-q 脚本模式）。⚠️ 在会话沙箱之外运行，首次调用必须先显式承认。',
    parameters: {
      iocPath: { type: 'string', required: true, description: '.ioc 路径（不会被修改）' },
      outputDir: { type: 'string', description: '生成目录；**缺省 = D:\\STM32_Workspace\\DSHCode**（本机约定的代码根）。仅当用户明确要求其他位置时才传。' },
      projectName: { type: 'string', description: '工程名，默认取 .ioc 文件名' },
      toolchain: { type: 'string', description: 'Makefile | CMake | STM32CubeIDE | "MDK-ARM V5.32"；只作用于本次生成，不回写 .ioc' },
      acknowledgeOutsideSandbox: { type: 'boolean', description: '必须为 true 才执行：确认允许本工具在会话沙箱外运行 CubeMX' },
    },
    output: jsonOut,
    async execute(args) {
      if (args.acknowledgeOutsideSandbox !== true) {
        return j({
          ok: false,
          needsAcknowledgement: true,
          reason: '本工具会在 DSH 会话沙箱【之外】运行 STM32CubeMX。',
          detail: 'CubeMX 是 Java GUI 程序，启动需写 java.util.prefs 注册表与 ~/.stm32cubemx；在沙箱内运行会因注册表被拒导致 pinout 插件加载失败并崩溃（实测 NPE）。插件自身 spawn 的进程不受该沙箱约束，故由插件执行——但这是一个显式的沙箱出口。',
          whatItTouches: ['D:\\STM32Cubemx（读取，可能写 updater 状态）', 'C:\\Users\\<user>\\.stm32cubemx（偏好与日志）', 'Windows 注册表 HKCU\\Software\\JavaSoft\\Prefs', 'outputDir（生成产物）'],
          nextStep: '请先向用户说明并取得同意，再以 acknowledgeOutsideSandbox=true 重新调用。',
        })
      }

      const { abs } = readIocOrThrow(args.iocPath)
      const cubeMx = detectCubeMx()
      if (!cubeMx.exists) return j({ ok: false, error: `找不到 STM32CubeMX.exe（探测: ${cubeMx.path ?? '无'}）` })

      const outDir = resolve(args.outputDir ?? DEFAULT_CODE_ROOT)
      mkdirSync(outDir, { recursive: true })
      const projectName = args.projectName ?? abs.split(/[\\/]/).pop().replace(/\.ioc$/i, '')
      const lines = [
        `config load ${abs}`,
        `project name ${projectName}`,
        `project path ${outDir}`,
      ]
      if (args.toolchain) lines.push(`project toolchain ${args.toolchain}`)
      lines.push('project generate', 'exit')
      const scriptPath = join(outDir, '.dsh-stm32-generate.txt')
      writeFileSync(scriptPath, lines.join('\n') + '\n', 'utf8')

      const t0 = Date.now()
      let stdout = ''
      let stderr = ''
      let code = null
      let timedOut = false
      try {
        const r = await execFileAsync(cubeMx.path, ['-q', scriptPath], {
          cwd: dirname(cubeMx.path),
          timeout: 240000,
          windowsHide: true,
          maxBuffer: 64 << 20,
        })
        stdout = r.stdout; stderr = r.stderr; code = 0
      } catch (e) {
        stdout = String(e?.stdout ?? ''); stderr = String(e?.stderr ?? '')
        code = typeof e?.code === 'number' ? e.code : null
        timedOut = e?.killed === true || e?.signal != null
      }

      const okCount = (stdout.match(/^OK\s*$/gm) ?? []).length
      const saidBye = /Bye bye/.test(stdout)
      const projectDir = join(outDir, projectName)
      const artifacts = {
        projectDir,
        coreSrc: existsSync(join(projectDir, 'Core', 'Src', 'main.c')),
        coreInc: existsSync(join(projectDir, 'Core', 'Inc', 'main.h')),
        drivers: existsSync(join(projectDir, 'Drivers')),
        makefile: existsSync(join(projectDir, 'Makefile')),
        cubeIde: existsSync(join(projectDir, '.cproject')),
        mdkArm: existsSync(join(projectDir, 'MDK-ARM')),
        cmakeLists: existsSync(join(projectDir, 'CMakeLists.txt')),
        mxproject: existsSync(join(projectDir, '.mxproject')),
      }
      // MDK 工具链：CubeMX 默认写 AC5，本机若只有 ARMCLANG(AC6) 会直接构建失败
      const mdkFix = artifacts.mdkArm ? ensureMdkCompiler(projectDir, detectToolchains().keilUv4) : null

      const errorLines = (stdout + '\n' + stderr)
        .split(/\r?\n/)
        .filter((l) => /\[(ERROR|FATAL)\]|Exception in thread/.test(l))
        .slice(0, 10)

      return j({
        // 不把 saidBye 作为硬条件：有报告称 exe 形式的 stdout 在某些 spawn 方式下捕获不到，
        // 而 exit code 与产物是可靠信号。stdoutCaptured 如实反映捕获情况。
        ok: code === 0 && artifacts.coreSrc,
        exitCode: code,
        timedOut,
        elapsedMs: Date.now() - t0,
        projectDir,
        artifacts,
        script: scriptPath,
        mdkFix,
        stdoutCaptured: stdout.length > 0,
        saidBye,
        commandsOk: okCount,
        commandsSent: lines.length,
        errorLines,
        hint: artifacts.coreSrc ? undefined : '未找到 Core/Src/main.c —— 生成可能失败；请看 errorLines 与 script。',
      })
    },
  })), '@dsh-external/dsh-stm32: headless generate')

  // ── 5. 生成物保护（USER CODE 越界检测） ─────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_guard',
    description: 'CubeMX 生成物快照与越界改动检出：判断改动是否会在下次生成时被静默抹掉。',
    parameters: {
      projectRoot: { type: 'string', required: true, description: 'CubeMX 工程根目录' },
      action: {
        type: 'string', required: true,
        enum: ['snapshot', 'diff', 'status', 'clear'],
        description: 'snapshot=建立干净基线（生成完成后立刻做）；diff=检出会被抹掉的改动；status=查看基线；clear=删除快照',
      },
    },
    output: jsonOut,
    async execute(args) {
      const root = resolve(args.projectRoot)
      if (!existsSync(root)) return j({ ok: false, error: `目录不存在: ${root}` })
      if (args.action === 'snapshot') return j({ ok: true, action: 'snapshot', ...guard.writeSnapshot(root) })
      if (args.action === 'diff') return j({ action: 'diff', ...guard.diffAgainstSnapshot(root) })
      if (args.action === 'status') {
        const s = guard.readLatestSnapshot(root)
        return j({
          ok: true, action: 'status', hasSnapshot: !!s,
          baseline: s ? { file: s.file, takenAt: s.takenAt, fileCount: s.fileCount } : null,
          reminder: s ? undefined : '还没有基线。请在 CubeMX 生成完成后先 action=snapshot。',
        })
      }
      return j({ ok: true, action: 'clear', ...guard.clearSnapshots(root) })
    },
  })), '@dsh-external/dsh-stm32: guard')

  // ── 6. 烧录（自动 / 手动双模） ─────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_flash',
    timeoutMs: 180000,
    description: '烧录固件到 STM32（STM32_Programmer_CLI）。auto=有探针就烧；manual=只返回可复制的命令。',
    parameters: {
      file: { type: 'string', required: true, description: '.elf/.hex/.bin 路径' },
      mode: { type: 'string', enum: ['auto', 'manual'], description: '默认 auto；无探针时会自动退化为 manual，把命令交给用户' },
      address: { type: 'string', description: '.bin 必需（如 0x08000000）；.elf/.hex 通常不需要' },
      erase: { type: 'boolean', description: '烧前整片擦除（-e all），破坏性操作' },
      verify: { type: 'boolean', description: '写入后校验，默认 true' },
      reset: { type: 'boolean', description: '烧完复位运行，默认 true' },
      freq: { type: 'integer', description: 'SWD 频率 kHz，默认 4000' },
      confirm: { type: 'boolean', description: '真正写入硬件前必须为 true' },
    },
    output: jsonOut,
    async execute(args) {
      const cli = detectToolchains().programmerCli
      if (!cli) return j({ ok: false, error: '找不到 STM32_Programmer_CLI.exe' })
      const file = resolve(args.file)
      if (!existsSync(file)) return j({ ok: false, error: `找不到固件文件: ${file}` })

      const opts = {
        file, address: args.address, erase: args.erase === true,
        verify: args.verify !== false, reset: args.reset !== false, freq: args.freq ?? 4000,
      }
      const cliArgs = flash.buildArgs(opts)
      const command = flash.commandLine(cli, cliArgs)
      const destructive = flash.isDestructive(opts)

      if (args.mode === 'manual') {
        return j({ ok: true, executed: false, mode: 'manual', command, destructive, note: '手动模式：请在终端执行该命令。' })
      }

      const probe = await listProbes(cli)
      const noProbe = !probe || probe.error || (probe.probes ?? []).every((p) => p.present === false)
      if (noProbe) {
        return j({
          ok: false, executed: false, noProbe: true, command, destructive,
          detail: probe?.error ?? '未检测到 ST-LINK / J-Link 探针',
          nextStep: '接上探针后重试；或自行在终端执行上面这条命令（手动模式同样可用）。',
        })
      }

      if (args.confirm !== true) {
        return j({
          ok: false, executed: false, needsConfirm: true, command, destructive,
          what: `将把 ${file} 写入目标芯片${opts.erase ? '（先整片擦除）' : ''}${opts.verify ? '，写入后校验' : ''}${opts.reset ? '，最后复位运行' : ''}。`,
          nextStep: '确认后以 confirm=true 重新调用。',
        })
      }

      let stdout = '', stderr = '', code = null
      try {
        const r = await execFileAsync(cli, cliArgs, { timeout: 150000, windowsHide: true, maxBuffer: 32 << 20 })
        stdout = r.stdout; stderr = r.stderr; code = 0
      } catch (e) {
        stdout = String(e?.stdout ?? ''); stderr = String(e?.stderr ?? ''); code = typeof e?.code === 'number' ? e.code : null
      }
      const parsed = flash.parseOutput(stdout, stderr)
      return j({
        ok: code === 0 && parsed.verified, exitCode: code, command, destructive,
        verified: parsed.verified, noProbe: parsed.noProbe, failed: parsed.failed,
        outputTail: parsed.tail,
      })
    },
  })), '@dsh-external/dsh-stm32: flash')

  // ── 7. 串口读取与断言（上板验收） ──────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stm32_serial',
    timeoutMs: 120000,
    description: '读取 STM32 串口输出并按正则断言，用于上板验收。省略 port 则列出可用串口。',
    parameters: {
      port: { type: 'string', description: '如 COM3；省略则只列出可用串口' },
      baud: { type: 'integer', description: '波特率，默认 115200（须与固件一致）' },
      durationMs: { type: 'integer', description: '读取时长毫秒，默认 3000' },
      expect: { type: 'string', description: '正则断言，如 "Hello|ready"' },
      listOnly: { type: 'boolean', description: '只列出串口，不读取' },
    },
    output: jsonOut,
    async execute(args) {
      const ports = await serial.listPorts()
      if (args.listOnly || !args.port) {
        return j({ ok: true, ports, count: ports.length, note: ports.length ? undefined : '当前没有串口设备（板子未插或驱动未装）。' })
      }
      if (!ports.includes(args.port)) {
        return j({ ok: false, error: `串口 ${args.port} 不在可用列表里`, ports })
      }
      const r = await serial.readSerial({
        port: args.port, baud: args.baud ?? 115200, durationMs: args.durationMs ?? 3000,
      })
      if (!r.ok) return j({ ok: false, error: r.error, captured: r.captured, port: args.port })
      const m = serial.matchExpectation(r.captured, args.expect)
      return j({
        ok: m.matched === false ? false : true,
        port: args.port, baud: args.baud ?? 115200,
        capturedBytes: r.captured.length,
        captured: r.captured.slice(0, 4000),
        truncated: r.captured.length > 4000,
        expectation: args.expect ?? null,
        matched: m.matched,
        matchedText: m.matchedText,
        regexError: m.regexError,
        verdict: args.expect
          ? (m.matched ? '断言命中' : '未命中预期输出')
          : '仅采集（未给 expect）',
      })
    },
  })), '@dsh-external/dsh-stm32: serial')
}
