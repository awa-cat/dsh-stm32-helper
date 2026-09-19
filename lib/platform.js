/**
 * 平台抽象层 —— 本插件**唯一**与操作系统耦合的地方。
 *
 * 三条设计约束（改这里之前先读）：
 *
 *  1. **Windows 行为一字不变**。原来的候选路径表（Keil / mingw32-make / ST 扩展 bundle /
 *     `D:\STM32Cubemx` …）原样保留在 `*_WIN` 表里，顺序都不动 —— 重构不得改变本机既有结果。
 *  2. **决策可注入、可单测**。所有探测都接受 `{ platform, env, exists, readdir }`，
 *     因此可以在 Windows 上把 platform 伪装成 darwin/linux 来断言分支——
 *     没有真机也能验"选择逻辑"，但**不假装验过真机**（见 SUPPORT.verified）。
 *  3. **不编造路径**。POSIX 的候选来自各发行版/Homebrew/官方安装器的常见位置；
 *     找不到时的正解是让用户设环境变量（`DSH_STM32_*`），而不是猜更多路径。
 */

import { existsSync as fsExists, readdirSync as fsReaddir, readFileSync as fsReadFile } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, platform as osPlatform } from 'node:os'

/**
 * 平台支持矩阵。`verified: false` 的含义是：**代码路径已实现并通过注入式单测，
 * 但作者手上没有该平台机器，未在真机上跑过**。`stm32_env` 会把这个字段原样返回，
 * 不要在文档或对话里把它说成"已支持/已实测"。
 */
export const SUPPORT = {
  win32: {
    label: 'Windows',
    verified: true,
    notes: '本项目原始开发环境（CubeMX 6.17 + Keil MDK 5.43 + GNU GCC/make + ST 扩展 bundle）。',
  },
  darwin: {
    label: 'macOS',
    verified: false,
    notes: '代码路径已实现（Homebrew 前缀、.app 内可执行文件、/dev/cu.* 串口）；未真机验证。',
  },
  linux: {
    label: 'Linux',
    verified: false,
    notes: '代码路径已实现（/usr、/opt/STMicroelectronics、/dev/ttyUSB*|ttyACM*）；未真机验证。',
  },
}

const KNOWN = new Set(Object.keys(SUPPORT))

/** 归一化平台名：未知平台按"类 Unix"处理，但会被标为未验证。 */
export function normalizePlatformId(platform = osPlatform()) {
  return KNOWN.has(platform) ? platform : platform
}

/**
 * 构造平台描述符。
 * @param {{platform?: string, env?: Record<string,string|undefined>, home?: string}} [over]
 */
export function resolvePlatform({ platform = osPlatform(), env = process.env, home } = {}) {
  const id = normalizePlatformId(platform)
  const isWindows = id === 'win32'
  const isMac = id === 'darwin'
  const isLinux = id === 'linux'
  const h = home ?? (isWindows ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir())
  const localAppData = isWindows ? env.LOCALAPPDATA || join(h, 'AppData', 'Local') : null
  return {
    id,
    isWindows,
    isMac,
    isLinux,
    isPosix: !isWindows,
    label: SUPPORT[id]?.label ?? id,
    verified: SUPPORT[id]?.verified ?? false,
    /** 可执行文件后缀：Windows 是 `.exe`，POSIX 空。 */
    exeSuffix: isWindows ? '.exe' : '',
    /** PATH 分隔符**按目标平台算**（不是按当前运行平台）——注入测试的关键。 */
    pathDelimiter: isWindows ? ';' : ':',
    env,
    home: h,
    localAppData,
    xdgData: isWindows ? null : env.XDG_DATA_HOME || posixJoin(h, '.local', 'share'),
    macAppSupport: isMac ? posixJoin(h, 'Library', 'Application Support') : null,
  }
}

/** 把裸命令名补成目标平台的可执行名。 */
export const exeName = (pf, name) => (pf.isWindows ? `${name}.exe` : name)

/**
 * POSIX 目标路径的拼接：**永远用 `/`**，与"当前运行平台"无关。
 * 这是注入式自测能跑的关键——在 Windows 上把 platform 伪装成 darwin/linux 时，
 * node:path 的 join 会拼出 `\`，而 Linux/macOS 的候选路径必须是 `/`。
 */
export const posixJoin = (...parts) => parts.filter((x) => x !== '' && x != null).join('/').replace(/\/{2,}/g, '/')

/** PATH 上的候选（按目标平台的分隔符与后缀）。 */
export function pathCandidates(pf, names) {
  const dirs = String(pf.env.PATH ?? '').split(pf.pathDelimiter)
  const out = []
  for (const dir of dirs) {
    if (!dir) continue
    for (const n of names) out.push(pf.isWindows ? join(dir, exeName(pf, n)) : posixJoin(dir, exeName(pf, n)))
  }
  return out
}

/**
 * ST 官方 VS Code 扩展（stm32cube-ide-core）自带的 bundle 根。
 * cube 启动器与 cmake/ninja/programmer/gdbserver/clangd 都在它下面。
 */
export function bundlesDir(pf) {
  if (pf.env.DSH_STM32_BUNDLES) return pf.env.DSH_STM32_BUNDLES
  if (pf.isWindows) return join(pf.localAppData ?? '', 'stm32cube', 'bundles')
  if (pf.isMac) return posixJoin(pf.macAppSupport ?? '', 'stm32cube', 'bundles')
  return posixJoin(pf.xdgData ?? '', 'stm32cube', 'bundles')
}

/** bundle 里的可执行文件（版本目录名不确定，扫一层）。 */
export function bundleCandidates(pf, bundle, rels, { readdir = fsReaddir } = {}) {
  const j = pf.isWindows ? join : posixJoin
  const base = j(bundlesDir(pf), bundle)
  let vers = []
  try {
    vers = readdir(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out = []
  for (const v of vers) for (const rel of rels) out.push(j(base, v, rel))
  return out
}

/** ST VS Code 扩展的 cube 统一启动器（可驱动 cmake/ninja/programmer/gdbserver/clangd）。 */
export function stLauncherCandidates(pf, { readdir = fsReaddir } = {}) {
  const extRoot = posixJoin(pf.home, '.vscode', 'extensions')
  let dirs = []
  try {
    dirs = readdir(extRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('stmicroelectronics.stm32cube-ide-core-'))
      .map((d) => d.name)
  } catch {
    return []
  }
  const triple = pf.isMac ? ['darwin', 'arm64'] : pf.isLinux ? ['linux', 'x64'] : ['win32', 'x86_64']
  const j = pf.isWindows ? join : posixJoin
  const out = []
  for (const d of dirs) {
    for (const arch of pf.isMac ? ['arm64', 'x64'] : [triple[1]]) {
      out.push(j(extRoot, d, 'resources', 'binaries', triple[0], arch, exeName(pf, 'cube')))
    }
  }
  return out
}

// ── 候选路径表 ────────────────────────────────────────────────────────────────
// 顺序 = 优先级。**Windows 表与重构前逐条一致**（连多余的 PATH 兜底都不加），
// 免得重构顺手改了本机既有探测结果；POSIX 表才额外扫 PATH。

const KEIL_WIN = (pf) => [
  join(pf.localAppData ?? '', 'Keil_v5', 'UV4', 'UV4.exe'),
  'C:\\Keil_v5\\UV4\\UV4.exe',
  'D:\\Keil_v5\\UV4\\UV4.exe',
]

const MAKE_WIN = () => [
  'D:\\mingw64\\bin\\mingw32-make.exe',
  'C:\\mingw64\\bin\\mingw32-make.exe',
]

const PROGRAMMER_WIN = (pf, opts) => [
  ...bundleCandidates(pf, 'programmer', ['bin\\STM32_Programmer_CLI.exe'], opts),
  'D:\\Program Files (x86)\\bin\\STM32_Programmer_CLI.exe',
  join(pf.home, '.eide', 'tools', 'st_cube_programer', 'bin', 'STM32_Programmer_CLI.exe'),
]

const CUBEMX_WIN = (pf) => [
  'D:\\STM32Cubemx\\STM32CubeMX.exe',
  'C:\\ST\\STM32CubeMX\\STM32CubeMX.exe',
  join('C:\\Program Files', 'STMicroelectronics', 'STM32Cube', 'STM32CubeMX', 'STM32CubeMX.exe'),
]

const POSIX_BIN_DIRS = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin', '/snap/bin']

const ARM_GCC_POSIX = (pf) => [
  ...pathCandidates(pf, ['arm-none-eabi-gcc']),
  ...POSIX_BIN_DIRS.map((d) => posixJoin(d, 'arm-none-eabi-gcc')),
  posixJoin(pf.home, '.local', 'bin', 'arm-none-eabi-gcc'),
  // macOS 官方 Arm GNU Toolchain 安装器
  ...(pf.isMac ? ['/Applications/ArmGNUToolchain', '/opt/homebrew/Caskroom/gcc-arm-embedded'].flatMap((root) => {
    let vers = []
    try {
      vers = fsReaddir(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch { /* 不存在就算了 */ }
    return vers.map((v) => posixJoin(root, v, 'bin', 'arm-none-eabi-gcc'))
  }) : []),
  '/usr/lib/cc-arm-none-eabi/bin/arm-none-eabi-gcc',
]

const MAKE_POSIX = (pf) => [
  ...pathCandidates(pf, ['make', 'gmake']),
  ...POSIX_BIN_DIRS.map((d) => posixJoin(d, 'make')),
]

const CMAKE_NINJA_POSIX = (pf, bundle, rel, opts) => [
  ...pathCandidates(pf, [bundle === 'cmake' ? 'cmake' : 'ninja']),
  ...POSIX_BIN_DIRS.map((d) => posixJoin(d, bundle === 'cmake' ? 'cmake' : 'ninja')),
  ...bundleCandidates(pf, bundle, [rel], opts ?? {}),
]

const PROGRAMMER_POSIX = (pf, opts) => [
  ...pathCandidates(pf, ['STM32_Programmer_CLI']),
  posixJoin(pf.home, 'STMicroelectronics', 'STM32Cube', 'STM32CubeProgrammer', 'bin', 'STM32_Programmer_CLI'),
  '/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI',
  '/opt/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI',
  '/opt/stm32cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI',
  ...(pf.isMac ? ['/Applications/STM32CubeProgrammer.app/Contents/MacOS/bin/STM32_Programmer_CLI'] : []),
  posixJoin(pf.home, '.eide', 'tools', 'st_cube_programer', 'bin', 'STM32_Programmer_CLI'),
  ...bundleCandidates(pf, 'programmer', ['bin/STM32_Programmer_CLI'], opts),
]

const CUBEMX_POSIX = (pf) => [
  ...pathCandidates(pf, ['STM32CubeMX']),
  ...(pf.isMac ? [
    '/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX',
    '/Applications/STMicroelectronics/STM32CubeMX.app/Contents/MacOS/STM32CubeMX',
    posixJoin(pf.home, 'Applications', 'STM32CubeMX.app', 'Contents', 'MacOS', 'STM32CubeMX'),
  ] : []),
  ...POSIX_BIN_DIRS.map((d) => posixJoin(d, 'STM32CubeMX')),
  '/opt/STMicroelectronics/STM32CubeMX/STM32CubeMX',
  posixJoin(pf.home, 'STMicroelectronics', 'STM32CubeMX', 'STM32CubeMX'),
  posixJoin(pf.home, 'STM32CubeMX', 'STM32CubeMX'),
]

// ── 探测 ─────────────────────────────────────────────────────────────────────

/**
 * 工具链探测。
 * @param {ReturnType<typeof resolvePlatform>} pf
 * @param {{exists?: (p: string) => boolean, readdir?: Function}} [io]
 */
export function detectToolchains(pf, io = {}) {
  const opts = { readdir: io.readdir ?? fsReaddir }
  const exists = io.exists ?? fsExists
  const first = (arr) => arr.filter(Boolean).find((p) => exists(p)) ?? null

  return {
    platform: pf.id,
    platformLabel: pf.label,
    /** POSIX 上 Keil 天然不可用——给一句人话原因，别让用户以为是探测失败。 */
    keilUnavailableReason: pf.isWindows
      ? null
      : 'Keil MDK（UV4.exe）仅 Windows 可用；POSIX 请用 Makefile/CMake + arm-none-eabi-gcc。',
    stLauncher: first(stLauncherCandidates(pf, opts)),
    keilUv4: pf.isWindows ? first(KEIL_WIN(pf)) : null,
    armGcc: pf.isWindows ? first(pathCandidates(pf, ['arm-none-eabi-gcc'])) : first(ARM_GCC_POSIX(pf)),
    make: pf.isWindows ? first(MAKE_WIN(pf)) : first(MAKE_POSIX(pf)),
    cmake: pf.isWindows
      ? first(bundleCandidates(pf, 'cmake', ['bin\\cmake.exe'], opts))
      : first(CMAKE_NINJA_POSIX(pf, 'cmake', 'bin/cmake', opts)),
    ninja: pf.isWindows
      ? first(bundleCandidates(pf, 'ninja', ['bin\\ninja.exe', 'ninja.exe'], opts))
      : first(CMAKE_NINJA_POSIX(pf, 'ninja', 'ninja', opts)),
    programmerCli: pf.isWindows ? first(PROGRAMMER_WIN(pf, opts)) : first(PROGRAMMER_POSIX(pf, opts)),
    /** 备选烧录后端（主要给 POSIX；Windows 上装了也会被探测到，但默认仍用官方 CLI）。 */
    openocd: first([
      ...pathCandidates(pf, ['openocd']),
      ...POSIX_BIN_DIRS.map((d) => posixJoin(d, 'openocd')),
    ]),
    stflash: first([
      ...pathCandidates(pf, ['st-flash']),
      ...POSIX_BIN_DIRS.map((d) => posixJoin(d, 'st-flash')),
    ]),
    stlinkGdbServer: pf.isWindows
      ? first(bundleCandidates(pf, 'stlink-gdbserver', ['bin\\ST-LINK_gdbserver.exe'], opts))
      : first(bundleCandidates(pf, 'stlink-gdbserver', ['bin/ST-LINK_gdbserver'], opts)),
    clangd: pf.isWindows
      ? first(bundleCandidates(pf, 'st-arm-clangd', ['bin\\starm-clangd.exe'], opts))
      : first(bundleCandidates(pf, 'st-arm-clangd', ['bin/starm-clangd'], opts)),
    bundlesDir: bundlesDir(pf),
  }
}

/**
 * 探测 STM32CubeMX。POSIX 上 macOS 是 `.app` 内的可执行文件，Linux 是普通 ELF。
 * 版本号仍在 `.installationinformation` 那个 Java 序列化 blob 里（APP_VER）。
 */
export function detectCubeMx(pf, explicit, io = {}) {
  const exists = io.exists ?? fsExists
  const read = io.readFile ?? ((p) => fsReadFile(p, 'latin1'))
  const candidates = [explicit, ...(pf.isWindows ? CUBEMX_WIN(pf) : CUBEMX_POSIX(pf))].filter(Boolean)
  const path = candidates.find((p) => exists(p)) ?? null
  if (!path) {
    return {
      path: null,
      exists: false,
      version: null,
      bundledJre: null,
      installHint: pf.isWindows
        ? '装 STM32CubeMX（默认 C:\\ST\\STM32CubeMX 或 D:\\STM32Cubemx），或用 cubeMxPath 显式指定。'
        : pf.isMac
          ? '装 STM32CubeMX（拖进 /Applications）；CLI 入口是 STM32CubeMX.app/Contents/MacOS/STM32CubeMX。找不到就用 cubeMxPath 显式指定。'
          : '装 STM32CubeMX（官方 .zip 解到 /opt 或家目录），或让它进 PATH；也可以用 cubeMxPath 显式指定。',
    }
  }
  const jreRel = pf.isWindows ? ['jre', 'bin', 'java.exe'] : ['jre', 'bin', 'java']
  const j = pf.isWindows ? join : posixJoin
  const jre = j(dirname(path), ...jreRel)
  let version = null
  try {
    const info = j(dirname(path), '.installationinformation')
    if (exists(info)) {
      const raw = read(info)
      const m = /APP_VER\s*t\s*([0-9][0-9A-Za-z.\-_]*)/.exec(raw)
      if (m) version = m[1]
    }
  } catch { /* 忽略 */ }
  return { path, exists: true, version, bundledJre: exists(jre) ? jre : null }
}

/** 固件包仓库（CubeMX 的 Repository 目录，各平台都在家目录下）。 */
export function firmwareRepo(pf) {
  return pf.isWindows ? join(pf.home, 'STM32Cube', 'Repository') : posixJoin(pf.home, 'STM32Cube', 'Repository')
}

/** 生成/烧录工具的默认工程代码根。Windows 保持本机约定不变；POSIX 落在 ~/STM32_Workspace。 */
export function defaultCodeRoot(pf) {
  if (pf.env.DSH_STM32_CODE_ROOT) return pf.env.DSH_STM32_CODE_ROOT
  return pf.isWindows ? 'D:\\STM32_Workspace\\DSHCode' : posixJoin(pf.home, 'STM32_Workspace', 'DSHCode')
}

/** 提示文案里的代码根（工具描述用，随平台变）。 */
export function codeRootHint(pf) {
  return defaultCodeRoot(pf)
}

/**
 * `stm32_generate` 的沙箱出口告知内容。
 * Windows 上会碰注册表（Java prefs）；POSIX 上是 ~/.stm32cubemx 与 CubeMX 安装目录。
 */
export function generateTouchList(pf, cubeMxPath) {
  const out = []
  if (cubeMxPath) out.push(`${dirname(cubeMxPath)}/（读取，可能写 updater 状态）`)
  out.push(pf.isWindows ? join(pf.home, '.stm32cubemx', '（偏好与日志）') : posixJoin(pf.home, '.stm32cubemx', '（偏好与日志）'))
  if (pf.isWindows) out.push('Windows 注册表 HKCU\\Software\\JavaSoft\\Prefs')
  else out.push(`${posixJoin(pf.home, '.config', 'java')} 或 ~/Library/Preferences（Java prefs）`)
  out.push('outputDir（生成产物）')
  return out
}

/** 子进程 spawn 选项（windowsHide 在 POSIX 上无意义，只在 Windows 传）。 */
export function spawnOpts(pf, extra = {}) {
  return pf.isWindows ? { windowsHide: true, ...extra } : { ...extra }
}

// ── 串口设备枚举 ─────────────────────────────────────────────────────────────

/** POSIX 串口设备名模式：Linux 的 ttyUSB / ttyACM，macOS 的 cu.xxx 与 tty.xxx。 */
export const POSIX_SERIAL_PATTERNS = [
  /^ttyUSB\d+$/,
  /^ttyACM\d+$/,
  /^ttyAMA\d+$/,
  /^ttyS\d+$/,
  /^cu\.(usb|serial|SLAB|wch|Bluetooth).*/i,
  /^tty\.(usb|serial|SLAB|wch|Bluetooth).*/i,
]

/**
 * 枚举 POSIX 串口：读 /dev 过滤设备名，再补 /dev/serial/by-id 的稳定软链。
 * 默认排序：cu.* / ttyUSB / ttyACM 在前（macOS 首选 cu.*，Linux 用 tty*）。
 *
 * 注意：这里**显式用 `/` 拼路径**而不是 path.join —— 因为 POSIX 设备路径永远是 `/`，
 * 而 path.join 用的是"当前运行平台"的分隔符；若在 Windows 上跑单测（注入 devDir），
 * path.join 会拼出 `\dev\...`，既不对也不利于断言。
 */
export function listPosixSerialPorts({ devDir = '/dev', readdir = fsReaddir, exists = fsExists } = {}) {
  let names = []
  try {
    names = readdir(devDir)
  } catch {
    return []
  }
  const slash = (base, n) => base.replace(/[\\/]+$/, '') + '/' + n
  const rank = (n) => (n.startsWith('cu.') ? 0 : n.startsWith('ttyUSB') ? 1 : n.startsWith('ttyACM') ? 2 : n.startsWith('tty.') ? 3 : 4)
  const ports = names
    .filter((n) => POSIX_SERIAL_PATTERNS.some((re) => re.test(n)))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((n) => slash(devDir, n))

  const byId = slash(devDir, 'serial/by-id')
  if (exists(byId)) {
    try {
      for (const n of readdir(byId)) ports.push(slash(byId, n))
    } catch { /* 忽略 */ }
  }
  return ports
}

/** 串口后端选择：Windows 走 PowerShell + .NET；POSIX 走 stty + 读设备文件。 */
export function serialBackend(pf) {
  return pf.isWindows ? 'powershell' : 'posix-tty'
}
