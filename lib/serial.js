/**
 * stm32_serial —— 串口读取与正则断言（上板验收用）。
 *
 * Node 没有内置串口支持，所以按平台分两条后端：
 *
 *   Windows（powershell）——
 *     .NET 的 System.IO.Ports 是系统自带的，走 PowerShell 子进程。
 *     脚本以 base64(UTF-16LE) 通过 -EncodedCommand 传入，彻底绕开引号/转义问题。
 *
 *   POSIX（posix-tty）——
 *     没有 .NET 可用，改为：① `stty` 把设备设成 raw + 目标波特率；
 *     ② spawn `cat <port>` 读，读满 durationMs 后 kill。
 *     用 cat 而不是 Node 的 fs 流，是为了避开 tty 非阻塞读的 EAGAIN 语义差异。
 *
 * ⚠️ 诚实标注：PowerShell 那条路径是本机实测过的；**POSIX 那条路径没有真机验证**
 *    （作者手上没有 Linux/macOS 机器）。参数拼装与设备枚举有注入式单测覆盖，
 *    但"真的能读到板子输出"必须在 POSIX 机器上实测后才能说。
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import * as platform from './platform.js'

const execFileAsync = promisify(execFile)

// ── Windows 后端 ─────────────────────────────────────────────────────────────

export function buildReaderScript({ port, baud = 115200, durationMs = 3000, dataBits = 8, parity = 'None', stopBits = 'One' }) {
  return `
$ErrorActionPreference = 'Stop'
try {
  $p = New-Object System.IO.Ports.SerialPort
  $p.PortName = '${port}'
  $p.BaudRate = ${Number(baud)}
  $p.DataBits = ${Number(dataBits)}
  $p.Parity = '${parity}'
  $p.StopBits = '${stopBits}'
  $p.ReadTimeout = 500
  $p.WriteTimeout = 500
  $p.Open()
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $sb = New-Object System.Text.StringBuilder
  while ($sw.ElapsedMilliseconds -lt ${Number(durationMs)}) {
    try { $c = $p.ReadExisting(); if ($c.Length -gt 0) { [void]$sb.Append($c) } } catch { }
    Start-Sleep -Milliseconds 40
  }
  $p.Close()
  [Console]::Out.Write($sb.ToString())
} catch {
  [Console]::Error.Write('SERIAL_ERROR: ' + $_.Exception.Message)
  exit 1
}
`
}

const toEncodedCommand = (script) => Buffer.from(script, 'utf16le').toString('base64')

async function readSerialWindows(opts, { timeoutMs = 30000 } = {}) {
  const script = buildReaderScript(opts)
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', toEncodedCommand(script)],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 << 20, encoding: 'utf8' },
    )
    return { ok: true, captured: stdout, backend: 'powershell' }
  } catch (e) {
    return {
      ok: false,
      captured: String(e?.stdout ?? ''),
      error: String(e?.stderr ?? e?.message ?? e).trim(),
      backend: 'powershell',
    }
  }
}

// ── POSIX 后端 ───────────────────────────────────────────────────────────────

/**
 * stty 参数。注意 macOS 是 `-f`、Linux 是 `-F`（实测差异，用错会报
 * "stty: invalid argument" 或直接改错文件），所以按平台分开生成。
 * 只用 `raw -echo` 这两个各平台都认的选项——多加 `-ocrnl` 之类虽然"更干净"，
 * 但 BSD/GNU stty 的选项集并不完全一致，反而容易在某个平台上直接失败。
 */
export function buildSttyArgs(pf, { port, baud = 115200 }) {
  const flag = pf.isMac ? '-f' : '-F'
  return [flag, port, String(Number(baud)), 'raw', '-echo']
}

/** 读串口的 cat 参数（这里只是 `[port]`，单独抽出来是为了可单测）。 */
export function buildCatArgs({ port }) {
  return [port]
}

export async function readSerialPosix(opts, pf, { timeoutMs = 30000, spawnImpl = spawn } = {}) {
  const { port, durationMs = 3000 } = opts
  // ① 配置设备：波特率 + raw 模式
  try {
    await execFileAsync('stty', buildSttyArgs(pf, opts), { timeout: 10000 })
  } catch (e) {
    return {
      ok: false,
      captured: '',
      backend: 'posix-tty',
      error: `stty 配置失败: ${String(e?.stderr ?? e?.message ?? e).trim()}`,
      hint: '检查设备路径是否存在、当前用户是否有权限（Linux 通常需要加入 dialout 组：sudo usermod -aG dialout $USER，重新登录生效）。',
    }
  }

  // ② 读：cat 设备文件，读满 durationMs 后 kill
  return await new Promise((resolve) => {
    const child = spawnImpl('cat', buildCatArgs({ port }), { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let settled = false
    let guard = null
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(killer)
      if (guard) clearTimeout(guard)
      try { child.kill('SIGTERM') } catch { /* 已退出 */ }
      resolve(result)
    }
    const killer = setTimeout(() => finish({ ok: true, captured: out, backend: 'posix-tty' }), durationMs)
    if (typeof timeoutMs === 'number' && timeoutMs > durationMs) {
      // 兜底：cat 卡住不返回也不会永远挂着
      guard = setTimeout(() => finish({ ok: true, captured: out, backend: 'posix-tty', warning: '读串口超时兜底触发' }), timeoutMs)
    }
    child.stdout?.on('data', (d) => { out += d.toString('utf8') })
    child.stderr?.on('data', (d) => { err += d.toString('utf8') })
    child.on('error', (e) => finish({ ok: false, captured: out, backend: 'posix-tty', error: String(e?.message ?? e) }))
    child.on('close', (code) => {
      if (code === 0 || code === null) finish({ ok: true, captured: out, backend: 'posix-tty' })
      else finish({ ok: false, captured: out, backend: 'posix-tty', error: err.trim() || `cat 退出码 ${code}` })
    })
  })
}

// ── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 打开串口读取 durationMs 毫秒，返回捕获到的文本。
 * @param {object} opts 读串口参数
 * @param {{platform?: object, timeoutMs?: number, spawnImpl?: Function}} [io] 注入点（单测用）
 */
export async function readSerial(opts, io = {}) {
  const pf = io.platform ?? platform.resolvePlatform()
  const { timeoutMs = 30000 } = io
  if (platform.serialBackend(pf) === 'powershell') return await readSerialWindows(opts, { timeoutMs })
  return await readSerialPosix(opts, pf, { timeoutMs, spawnImpl: io.spawnImpl })
}

/**
 * 列出可用串口。
 * Windows 走 .NET（避免被沙箱挡住的 WMI/CIM 路径）；POSIX 读 /dev。
 * @param {{platform?: object, io?: object}} [opts]
 */
export async function listPorts({ platform: pfInjected, io } = {}) {
  const pf = pfInjected ?? platform.resolvePlatform()
  if (platform.serialBackend(pf) === 'posix-tty') {
    return platform.listPosixSerialPorts(io ?? {})
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() -join ","'],
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
    )
    return stdout.trim().split(',').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** 用正则匹配捕获内容；返回是否命中与命中片段（含上下文）。 */
export function matchExpectation(captured, expect) {  if (!expect) return { matched: null }
  try {
    const re = new RegExp(expect, 'm')
    const m = re.exec(captured)
    if (!m) return { matched: false }
    const lines = captured.split(/\r?\n/)
    const hit = lines.filter((l) => re.test(l)).slice(0, 5)
    return { matched: true, matchedText: m[0], matchedLines: hit }
  } catch (e) {
    return { matched: null, regexError: String(e?.message ?? e) }
  }
}
