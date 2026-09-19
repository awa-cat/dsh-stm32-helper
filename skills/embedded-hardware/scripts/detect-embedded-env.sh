#!/usr/bin/env bash
# detect-embedded-env.sh — macOS / Linux（也可在 Git-Bash 等环境参考逻辑）
# 用法: bash detect-embedded-env.sh
set -u

have() { command -v "$1" >/dev/null 2>&1; }

echo "=== Host ==="
uname -a
echo "HOME=$HOME"
echo "DSH skills candidates:"
for p in "$HOME/.dsh/skills" "$HOME/.deepseek-harness/skills"; do
  [ -d "$p" ] && echo "  FOUND $p"
done

echo
echo "=== Compilers / Build ==="
for t in arm-none-eabi-gcc arm-none-eabi-g++ arm-none-eabi-objcopy make cmake ninja pio platformio; do
  if have "$t"; then
    echo "OK  $t -> $(command -v "$t")"
  else
    echo "MISS $t"
  fi
done

echo
echo "=== CubeMX ==="
for c in \
  "$HOME/STM32CubeMX/STM32CubeMX" \
  "/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX" \
  "$HOME/STM32CubeMX/STM32CubeMX.app/Contents/MacOS/STM32CubeMX"
do
  if [ -x "$c" ]; then echo "OK  CubeMX -> $c"; fi
done
have cubemx && echo "OK  cubemx on PATH -> $(command -v cubemx)"
[ -d "$HOME/STM32Cube/Repository" ] && echo "OK  FW repo -> $HOME/STM32Cube/Repository"
[ -d "$HOME/.stm32cubemx" ] && echo "OK  user dir -> $HOME/.stm32cubemx"

echo
echo "=== Flash / Debug ==="
for t in openocd st-flash st-info STM32_Programmer_CLI arm-none-eabi-gdb gdb-multiarch pyocd; do
  if have "$t"; then echo "OK  $t -> $(command -v "$t")"; else echo "MISS $t"; fi
done

echo
echo "=== Python / serial ==="
if have python3; then echo "OK  python3 -> $(command -v python3)"; else echo "MISS python3"; fi
python3 -c "import serial; print('OK  pyserial', serial.__version__)" 2>/dev/null || echo "MISS pyserial (pip install pyserial)"

echo
echo "=== Serial ports ==="
ls /dev/cu.* 2>/dev/null || true
ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || true

echo
echo "=== Hint ==="
echo "知识技能可直接拷贝到 ~/.dsh/skills/"
echo "Mac/Linux 编译走 arm-none-eabi-gcc + Make/CMake；烧录走 openocd/st-flash"
echo "Keil/UV4 仅 Windows"
