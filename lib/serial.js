/**
 * stm32_serial —— 串口读取与正则断言（上板验收用）。
 *
 * Node 没有内置串口支持，本机也没装 serialport 原生模块；
 * 而 .NET 的 System.IO.Ports 是 Windows 自带的，所以走 PowerShell 子进程。
 * 脚本以 base64(UTF-16LE) 通过 -EncodedCommand 传入，彻底绕开引号/转义问题。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

/** 打开串口读取 durationMs 毫秒，返回捕获到的文本。 */
export async function readSerial(opts, { timeoutMs = 30000 } = {}) {
  const script = buildReaderScript(opts)
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', toEncodedCommand(script)],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 << 20, encoding: 'utf8' },
    )
    return { ok: true, captured: stdout }
  } catch (e) {
    return {
      ok: false,
      captured: String(e?.stdout ?? ''),
      error: String(e?.stderr ?? e?.message ?? e).trim(),
    }
  }
}

/** 列出可用串口（走 .NET，避免被沙箱挡住的 WMI/CIM 路径）。 */
export async function listPorts() {
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
export function matchExpectation(captured, expect) {
  if (!expect) return { matched: null }
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
