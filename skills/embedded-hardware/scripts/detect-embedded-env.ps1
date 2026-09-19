# detect-embedded-env.ps1 — Windows DSH
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File detect-embedded-env.ps1

function Test-Tool($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { "OK  $name -> $($c.Source)" } else { "MISS $name" }
}

"=== Host ==="
$env:OS
"HOME=$HOME"
"USERPROFILE=$env:USERPROFILE"
$candidates = @(
  "$env:USERPROFILE\.dsh\skills",
  "C:\Users\szj26\.dsh\skills"
)
foreach ($p in $candidates) {
  if (Test-Path $p) { "FOUND skills -> $p" }
}

"`n=== Compilers / Build ==="
foreach ($t in @('arm-none-eabi-gcc','make','mingw32-make','cmake','ninja','python','py')) {
  Test-Tool $t
}
$uv4 = 'C:\Users\szj26\AppData\Local\Keil_v5\UV4\UV4.exe'
if (Test-Path $uv4) { "OK  UV4 -> $uv4" } else { "MISS UV4 (Keil MDK Windows-only)" }

"`n=== CubeMX ==="
foreach ($c in @('D:\STM32Cubemx\STM32CubeMX.exe','C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeMX\STM32CubeMX.exe')) {
  if (Test-Path $c) { "OK  CubeMX -> $c" }
}
if (Test-Path 'C:\Users\szj26\STM32Cube\Repository') { "OK  FW repo -> C:\Users\szj26\STM32Cube\Repository" }

"`n=== Flash / Debug ==="
foreach ($t in @('openocd','st-flash','STM32_Programmer_CLI','arm-none-eabi-gdb')) { Test-Tool $t }
$prog = 'C:\Users\szj26\AppData\Local\stm32cube\bundles\programmer\2.23.0\bin\STM32_Programmer_CLI.exe'
if (Test-Path $prog) { "OK  Programmer CLI -> $prog" }

"`n=== Serial ==="
Test-Tool 'python'
python -c "import serial; print('OK  pyserial')" 2>$null
[SerialPort]::GetPortNames() | ForEach-Object { "PORT $_" }

"`n=== Hint ==="
"Mac/Linux: 拷贝技能到 ~/.dsh/skills/，见 embedded-hardware/references/cross-platform-toolchain.md"
"脚本: scripts/detect-embedded-env.sh"
