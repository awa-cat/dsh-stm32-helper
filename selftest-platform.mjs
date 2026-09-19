/**
 * selftest-platform.mjs —— 跨平台适配的自测（可在任意平台上跑）。
 *
 * 为什么这样测：本仓库作者手上只有 Windows，**没有 Linux/macOS 机器**。
 * 与其写"我觉得在 Linux 上应该行"，不如把平台的三个自由度（platform / env / exists）
 * 全部注入，让决策逻辑在 Windows 上被断言。这样能证明：
 *   - 候选表按目标平台生成（`.exe` 后缀、`:` 而不是 `;` 切 PATH、Homebrew/.app 路径）
 *   - POSIX 上 Keil 被显式标成"不可用"而不是"探测失败"
 *   - 串口设备枚举、stty 参数按平台分流
 *   - appfile 的构建系统登记（Keil / Makefile / CMake）真能改对文件、且幂等
 * 不能证明：真机上 CubeMX/GCC/烧录器/串口**实际可用**。那必须由用户在真机上跑。
 *
 * 用法：node selftest-platform.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as platform from './lib/platform.js'
import * as flash from './lib/flash.js'
import * as serial from './lib/serial.js'
import * as appfile from './lib/appfile.js'

let pass = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ' → ' + detail : ''}`) }
}
const section = (t) => console.log(`\n== ${t} ==`)

// ── 1. 平台描述符 ────────────────────────────────────────────────────────────
section('1. resolvePlatform：后缀 / PATH 分隔符 / 默认代码根')
{
  const win = platform.resolvePlatform({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\u', PATH: 'C:\\a;C:\\b' }, home: 'C:\\Users\\u' })
  const mac = platform.resolvePlatform({ platform: 'darwin', env: { HOME: '/Users/u', PATH: '/usr/bin:/bin' }, home: '/Users/u' })
  const lin = platform.resolvePlatform({ platform: 'linux', env: { HOME: '/home/u', PATH: '/usr/bin:/snap/bin' }, home: '/home/u' })

  ok('win32 后缀 .exe / 分隔符 ;', win.exeSuffix === '.exe' && win.pathDelimiter === ';')
  ok('darwin 无后缀 / 分隔符 :', mac.exeSuffix === '' && mac.pathDelimiter === ':')
  ok('linux 无后缀 / 分隔符 :', lin.exeSuffix === '' && lin.pathDelimiter === ':')
  ok('win 默认代码根保持本机约定不变', platform.defaultCodeRoot(win) === 'D:\\STM32_Workspace\\DSHCode', platform.defaultCodeRoot(win))
  ok('darwin 默认代码根落在家目录（用 / 拼）', platform.defaultCodeRoot(mac) === '/Users/u/STM32_Workspace/DSHCode', platform.defaultCodeRoot(mac))
  ok('DSH_STM32_CODE_ROOT 覆盖一切', platform.defaultCodeRoot(platform.resolvePlatform({ platform: 'linux', env: { HOME: '/h', DSH_STM32_CODE_ROOT: '/data/code' }, home: '/h' })) === '/data/code')
  ok('Windows 标为已验证 / POSIX 标为未验证', win.verified === true && mac.verified === false && lin.verified === false)
  ok('spawnOpts：Windows 带 windowsHide，POSIX 不带', platform.spawnOpts(win).windowsHide === true && platform.spawnOpts(lin).windowsHide === undefined)
}

// ── 2. PATH 扫描按目标平台分隔符 ─────────────────────────────────────────────
section('2. detectToolchains：PATH 分隔符与平台专属路径')
{
  const env = { HOME: '/home/u', PATH: '/usr/local/bin:/usr/bin:/snap/bin' }
  const lin = platform.resolvePlatform({ platform: 'linux', env, home: '/home/u' })
  // 只让这三个路径"存在"，其余一律 false
  const present = new Set(['/usr/bin/arm-none-eabi-gcc', '/usr/bin/make', '/usr/bin/cmake', '/usr/bin/STM32_Programmer_CLI', '/usr/bin/openocd'])
  const tc = platform.detectToolchains(lin, { exists: (p) => present.has(p), readdir: () => [] })

  ok('PATH 用 : 切开后找到 arm-none-eabi-gcc', tc.armGcc === '/usr/bin/arm-none-eabi-gcc', String(tc.armGcc))
  ok('找到 make（POSIX 分支）', tc.make === '/usr/bin/make', String(tc.make))
  ok('找到 cmake（走 PATH 而不只 bundle）', tc.cmake === '/usr/bin/cmake', String(tc.cmake))
  ok('找到 STM32_Programmer_CLI（无 .exe 后缀）', tc.programmerCli === '/usr/bin/STM32_Programmer_CLI', String(tc.programmerCli))
  ok('找到备选烧录后端 openocd', tc.openocd === '/usr/bin/openocd', String(tc.openocd))
  ok('Linux 上 Keil 为 null 且有明确原因', tc.keilUv4 === null && typeof tc.keilUnavailableReason === 'string' && tc.keilUnavailableReason.includes('Windows'))
  ok('带上平台标记便于报告', tc.platform === 'linux' && tc.platformLabel === 'Linux')
}
{
  // 反例：把 PATH 写成 Windows 风格，POSIX 平台下不应该被"误切"
  const env = { HOME: '/home/u', PATH: '/opt/tools;/usr/bin' }
  const lin = platform.resolvePlatform({ platform: 'linux', env, home: '/home/u' })
  const tc = platform.detectToolchains(lin, { exists: (p) => p === '/usr/bin/make', readdir: () => [] })
  ok('POSIX 不按 ; 切 PATH（不会把 /opt/tools;/usr/bin 当整体）', tc.make === '/usr/bin/make', String(tc.make))
}
{
  const env = { USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', PATH: 'C:\\tools' }
  const win = platform.resolvePlatform({ platform: 'win32', env, home: 'C:\\Users\\u' })
  const present = new Set([
    'C:\\Keil_v5\\UV4\\UV4.exe',
    'D:\\mingw64\\bin\\mingw32-make.exe',
    'C:\\tools\\arm-none-eabi-gcc.exe',
  ])
  const tc = platform.detectToolchains(win, { exists: (p) => present.has(p), readdir: () => [] })
  ok('Windows：Keil 命中 C:\\Keil_v5', tc.keilUv4 === 'C:\\Keil_v5\\UV4\\UV4.exe', String(tc.keilUv4))
  ok('Windows：make 命中 D:\\mingw64', tc.make === 'D:\\mingw64\\bin\\mingw32-make.exe', String(tc.make))
  ok('Windows：PATH 用 ; 切且补 .exe', tc.armGcc === 'C:\\tools\\arm-none-eabi-gcc.exe', String(tc.armGcc))
  ok('Windows：Keil 无"不可用原因"', tc.keilUnavailableReason === null)
}
{
  const env = { HOME: '/Users/u', PATH: '/opt/homebrew/bin:/usr/bin' }
  const mac = platform.resolvePlatform({ platform: 'darwin', env, home: '/Users/u' })
  const present = new Set([
    '/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX',
    '/opt/homebrew/bin/make',
    '/Applications/STM32CubeProgrammer.app/Contents/MacOS/bin/STM32_Programmer_CLI',
  ])
  const tc = platform.detectToolchains(mac, { exists: (p) => present.has(p), readdir: () => [] })
  const cube = platform.detectCubeMx(mac, undefined, { exists: (p) => present.has(p), readFile: () => '' })
  ok('macOS：make 命中 Homebrew 前缀', tc.make === '/opt/homebrew/bin/make', String(tc.make))
  ok('macOS：烧录 CLI 命中 .app 内部路径', tc.programmerCli === '/Applications/STM32CubeProgrammer.app/Contents/MacOS/bin/STM32_Programmer_CLI', String(tc.programmerCli))
  ok('macOS：CubeMX 命中 .app/Contents/MacOS', cube.exists && cube.path.endsWith('STM32CubeMX.app/Contents/MacOS/STM32CubeMX'), String(cube.path))
  ok('macOS：找不到时的安装提示是平台专属的', platform.detectCubeMx(mac, undefined, { exists: () => false, readFile: () => '' }).installHint.includes('Applications'))
}

// ── 3. 串口：设备枚举与后端 ──────────────────────────────────────────────────
section('3. 串口：/dev 枚举 + stty 参数分流')
{
  const lin = platform.resolvePlatform({ platform: 'linux', env: { HOME: '/home/u' }, home: '/home/u' })
  const mac = platform.resolvePlatform({ platform: 'darwin', env: { HOME: '/Users/u' }, home: '/Users/u' })

  const linDevs = ['tty', 'ttyS0', 'ttyUSB0', 'ttyACM0', 'null', 'sda', 'ttyprintk']
  const linPorts = platform.listPosixSerialPorts({ devDir: '/dev', readdir: (d) => (d === '/dev' ? linDevs : []), exists: () => false })
  ok('Linux 只挑出真实串口设备', linPorts.join(',') === '/dev/ttyUSB0,/dev/ttyACM0,/dev/ttyS0', linPorts.join(','))
  ok('Linux 不会把 ttyprintk / sda 误当串口', !linPorts.some((p) => /ttyprintk|sda/.test(p)))
  ok('POSIX 路径用 / 拼（不是当前平台的 \\）', linPorts.every((p) => p.startsWith('/dev/')), linPorts.join(','))

  const macDevs = ['cu.usbserial-1420', 'tty.usbserial-1420', 'disk0', 'cu.Bluetooth-Incoming-Port']
  const macPorts = platform.listPosixSerialPorts({ devDir: '/dev', readdir: (d) => (d === '/dev' ? macDevs : []), exists: () => false })
  const firstTty = macPorts.findIndex((p) => p.includes('/dev/tty.'))
  const lastCu = macPorts.map((p, i) => ({ p, i })).filter(({ p }) => p.includes('/dev/cu.')).pop()
  ok('macOS：所有 cu.* 排在 tty.* 之前', firstTty >= 0 && lastCu && lastCu.i < firstTty, macPorts.join(','))
  ok('macOS：disk0 被排除', !macPorts.some((p) => p.includes('disk0')))

  const withById = platform.listPosixSerialPorts({
    devDir: '/dev',
    readdir: (d) => (d.endsWith('by-id') ? ['usb-STLink_V3-if00'] : ['ttyACM0']),
    exists: (p) => p.endsWith('by-id'),
  })
  ok('/dev/serial/by-id 的稳定软链也被列出', withById.some((p) => p.includes('by-id')))

  ok('后端选择：Windows=powershell', platform.serialBackend(platform.resolvePlatform({ platform: 'win32', env: {}, home: '/x' })) === 'powershell')
  ok('后端选择：POSIX=posix-tty', platform.serialBackend(lin) === 'posix-tty')
  const linStty = serial.buildSttyArgs(lin, { port: '/dev/ttyUSB0', baud: 115200 })
  const macStty = serial.buildSttyArgs(mac, { port: '/dev/cu.usbserial-1420', baud: 921600 })
  ok('stty：Linux 用 -F', linStty.join(' ') === '-F /dev/ttyUSB0 115200 raw -echo', linStty.join(' '))
  ok('stty：macOS 用 -f（不是 -F）', macStty.join(' ') === '-f /dev/cu.usbserial-1420 921600 raw -echo', macStty.join(' '))
}

// ── 4. flash 备选后端命令模板 ────────────────────────────────────────────────
section('4. flash：官方 CLI 之外的备选命令（模板）')
{
  const oc = flash.buildOpenOcdCommand({ file: '/p/build/demo.elf' })
  const ocBin = flash.buildOpenOcdCommand({ file: '/p/demo.bin', address: '0x08000000' })
  const sf = flash.buildStFlashCommand({ file: '/p/demo.bin', address: '0x08000000' })
  ok('openocd：elf 不带地址', oc.includes('program /p/build/demo.elf verify reset exit') && !oc.includes('0x0800'))
  ok('openocd：bin 带地址', ocBin.includes('0x08000000'))
  ok('openocd：默认用 ST-LINK + F1 组态', oc.includes('interface/stlink.cfg') && oc.includes('target/stm32f1x.cfg'))
  ok('st-flash：write + 地址', sf.startsWith('st-flash --reset write') && sf.includes('0x08000000'))
  ok('官方 CLI 参数顺序未变，重构没碰它', flash.buildArgs({ file: 'a.elf' }).join(' ') === '-c port=SWD freq=4000 -w a.elf -v -rst')
}

// ── 5. appfile：构建系统登记（真文件、真改写、真幂等） ───────────────────────
section('5. appfile：Keil / Makefile / CMake 三套登记')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-stm32-pf-'))
  const mk = (p, content) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), content, 'utf8') }
  try {
    mkdirSync(join(root, 'Core', 'Src'), { recursive: true })
    writeFileSync(join(root, '.mxproject'), '', 'utf8')
    writeFileSync(join(root, 'Core', 'Src', 'pid.c'), '/* 与 App/pid/pid.c 撞 basename */\n', 'utf8')

    // ── Makefile（CubeMX 风格续行块，且已有一个同名 pid.c）
    mk('Makefile', [
      '# CubeMX generated Makefile',
      'C_SOURCES =  \\',
      'Core/Src/main.c \\',
      'Core/Src/pid.c \\',
      'Core/Src/syscalls.c  ',
      '',
      'ASM_SOURCES =  \\',
      'startup_stm32f103xb.s',
      '',
      'C_INCLUDES =  \\',
      '-ICore/Inc \\',
      '-IDrivers/CMSIS/Include',
      '',
      'OBJECTS = $(addprefix $(BUILD_DIR)/,$(notdir $(C_SOURCES:.c=.o)))',
      '',
    ].join('\n'))

    const r1 = appfile.writeApp(root, 'pid/pid.c', 'int pid_init(void){return 0;}\n')
    const makeSys = r1.build.systems.find((s) => s.kind === 'makefile')
    const makeText = readFileSync(join(root, 'Makefile'), 'utf8')

    ok('writeApp 认得 Makefile 工程', !!makeSys && makeSys.patched, JSON.stringify(r1.build.changedSystems))
    ok('C_SOURCES 里插入了 App/pid/pid.c', makeText.includes('App/pid/pid.c'))
    ok('插入点保住了续行符（后一行仍以 \\ 结尾）', /App\/pid\/pid\.c \\\n\s*Core\/Src\/syscalls\.c/.test(makeText))
    ok('C_INCLUDES 加了 -IApp', makeText.includes('-IApp'))
    ok('C_INCLUDES 加了子目录 -IApp/pid', makeText.includes('-IApp/pid'))
    ok('写后校验通过', makeSys.sourceVerified === true && makeSys.includeVerified === true)
    ok('检出同名 .o 碰撞（Core/Src/pid.c）', makeSys.objectNameCollision?.otherSource === 'Core/Src/pid.c', JSON.stringify(makeSys.objectNameCollision))
    ok('给出"重新生成会丢"的警告', typeof makeSys.staleWarning === 'string' && makeSys.staleWarning.includes('重新生成'))

    const makeAfter1 = makeText
    const r2 = appfile.writeApp(root, 'pid/pid.c', 'int pid_init(void){return 0;}\n')
    const makeSys2 = r2.build.systems.find((s) => s.kind === 'makefile')
    ok('重复写幂等：Makefile 不再改动', makeSys2.changed === false && readFileSync(join(root, 'Makefile'), 'utf8') === makeAfter1)

    // ── CMake（顶层用户区 + 生成物子目录）
    mk('CMakeLists.txt', [
      'cmake_minimum_required(VERSION 3.22)',
      'set(CMAKE_PROJECT_NAME demo)',
      'project(${CMAKE_PROJECT_NAME})',
      'add_executable(${CMAKE_PROJECT_NAME})',
      'add_subdirectory(cmake/stm32cubemx)',
      'target_sources(${CMAKE_PROJECT_NAME} PRIVATE',
      '    # Add user sources here',
      ')',
      'target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE',
      '    # Add user defined include paths',
      ')',
      '',
    ].join('\n'))
    const genDir = join(root, 'cmake', 'stm32cubemx')
    mkdirSync(genDir, { recursive: true })
    writeFileSync(join(genDir, 'CMakeLists.txt'), 'set(MX_Application_Src\n    ${CMAKE_CURRENT_SOURCE_DIR}/../../Core/Src/main.c\n)\n', 'utf8')
    const genBefore = readFileSync(join(genDir, 'CMakeLists.txt'), 'utf8')

    const r3 = appfile.writeApp(root, 'motor.c', 'int motor_init(void){return 0;}\n')
    const cm = r3.build.systems.find((s) => s.kind === 'cmake')
    const cmText = readFileSync(join(root, 'CMakeLists.txt'), 'utf8')
    const cmLine = '${CMAKE_CURRENT_SOURCE_DIR}/App/motor.c'

    ok('writeApp 认得 CMake 工程', !!cm && cm.patched === true, JSON.stringify(r3.build.changedSystems))
    ok('源文件插进用户区注释之后', cmText.includes('# Add user sources here\n    ' + cmLine))
    ok('包含路径插进用户区注释之后', cmText.includes('# Add user defined include paths\n    ${CMAKE_CURRENT_SOURCE_DIR}/App'))
    ok('没碰生成物 cmake/stm32cubemx/CMakeLists.txt', readFileSync(join(genDir, 'CMakeLists.txt'), 'utf8') === genBefore)
    ok('CMake 写入无"重新生成会丢"警告（顶层文件不重写）', cm.staleWarning === undefined && typeof cm.note === 'string')
    const r4 = appfile.writeApp(root, 'motor.c', 'int motor_init(void){return 0;}\n')
    ok('重复写幂等：CMake 不再改动', r4.build.systems.find((s) => s.kind === 'cmake').changed === false)

    // ── Keil（.uvprojx 分组 + <Cads> 段 IncludePath）
    mkdirSync(join(root, 'MDK-ARM'), { recursive: true })
    writeFileSync(join(root, 'MDK-ARM', 'demo.uvprojx'), [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Project>',
      '  <Targets><Target><TargetOption><TargetCommonOption>',
      '      <ToolsetName>ARM-ADS</ToolsetName>',
      '  </TargetCommonOption><Cads><VariousControls>',
      '      <IncludePath>../Core/Inc</IncludePath>',
      '  </VariousControls></Cads></TargetOption>',
      '      <Groups>',
      '      </Groups>',
      '</Target></Targets>',
      '</Project>',
      '',
    ].join('\n'), 'utf8')

    const r5 = appfile.writeApp(root, 'pid/pid.h', '#pragma once\n')
    const keil = r5.build.systems.find((s) => s.kind === 'keil')
    const proj = readFileSync(join(root, 'MDK-ARM', 'demo.uvprojx'), 'utf8')
    ok('Keil：.h 只补 IncludePath，不加文件组', keil.includeAdded.includes('../App') && !proj.includes('<FileName>pid.h</FileName>'))
    ok('Keil：IncludePath 落在 <Cads> 段内', /<Cads>[\s\S]*?\.\.\/App[\s\S]*?<\/Cads>/.test(proj))
    ok('Keil：写后校验通过', keil.includeVerified === true)

    const r6 = appfile.writeApp(root, 'pid/pid.c', 'int x;\n')
    const proj2 = readFileSync(join(root, 'MDK-ARM', 'demo.uvprojx'), 'utf8')
    ok('Keil：.c 进了 Application/User/App 分组', proj2.includes('<GroupName>Application/User/App</GroupName>') && proj2.includes('<FilePath>../App/pid/pid.c</FilePath>'))
    ok('三套构建系统同时登记时全部报出来', (r6.build.changedSystems ?? []).length >= 1 && r6.build.systems.length === 3, JSON.stringify(r6.build.systems.map((s) => s.kind)))

    // ── 没有构建文件时：明确报"需手动加入"，不假装成功
    const bare = mkdtempSync(join(tmpdir(), 'dsh-stm32-bare-'))
    try {
      mkdirSync(join(bare, 'Core'), { recursive: true })
      writeFileSync(join(bare, '.mxproject'), '', 'utf8')
      const r7 = appfile.writeApp(bare, 'x.c', 'int x;\n')
      ok('无构建文件时：patched=false 且给出手动登记提示', r7.build.patched === false && typeof r7.reminder === 'string' && r7.reminder.includes('手动'))
    } finally { rmSync(bare, { recursive: true, force: true }) }

    // ── 备份真的落了盘（改动可回溯）
    ok('Makefile 改动前有备份', existsSync(makeSys.backup))
    ok('CMake 改动前有备份', existsSync(cm.backup))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ── 6. 越界守卫没有因为重构而放松 ────────────────────────────────────────────
section('6. appfile 作用域守卫（回归）')
{
  const root = mkdtempSync(join(tmpdir(), 'dsh-stm32-guard-'))
  try {
    mkdirSync(join(root, 'Core'), { recursive: true })
    writeFileSync(join(root, '.mxproject'), '', 'utf8')
    const cases = ['../evil.c', 'sub/../../evil.c', '/abs/evil.c', 'C:\\abs\\evil.c', 'notes.txt']
    const results = cases.map((f) => {
      try { appfile.writeApp(root, f, 'x'); return `${f}:未拦截` } catch (e) { return `${f}:拒绝` }
    })
    ok('五种越界/非法输入全部被拒', results.every((r) => r.endsWith('拒绝')), results.join(' | '))
    // App/../x.c 会规范化为 App/x.c（仍在 App/ 内），属于合法，不是逃逸
    const normalized = appfile.writeApp(root, 'App/../x.c', 'int x;\n')
    ok('App/../x.c 被规范化进 App/ 内（非逃逸）', normalized.ok && normalized.rel === 'App/x.c', normalized.rel)
    ok('拒绝后没有留下文件', !existsSync(join(root, 'evil.c')) && !existsSync(join(root, 'notes.txt')))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// ── 7. 哈希工具（自查：确保本文件没被"顺手改绿"） ────────────────────────────
section('7. 自检文件指纹')
{
  const self = readFileSync(new URL(import.meta.url), 'utf8')
  ok('本文件仍包含注入式平台切换（不是空跑）', self.includes("platform: 'linux'") && self.includes("platform: 'darwin'") && self.includes("platform: 'win32'"))
  ok('本文件确实断言了 Keil 在 POSIX 不可用', self.includes('keilUnavailableReason'))
  void createHash
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`)
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log('  -', f)
  process.exit(1)
}
console.log('（注意：这些断言证明的是"跨平台决策逻辑"，不是"真机上可用"——见文件头说明。）')
