/**
 * stm32_flash —— STM32_Programmer_CLI 封装。
 *
 * 双模设计（用户明确要求"烧录可以自动也可以手动"）：
 *   auto   —— 检测到探针就真的烧，返回校验结果
 *   manual —— 不执行，返回可复制的确切命令行（无探针时的默认退化行为）
 *
 * 无探针时不报"失败"就完事，而是把命令交给用户手动跑 —— 这比让 agent 干瞪眼有用。
 */

/** 组装 STM32_Programmer_CLI 参数（顺序即 CLI 官方推荐顺序）。 */
export function buildArgs({ file, address, erase = false, verify = true, reset = true, port = 'SWD', freq = 4000 } = {}) {
  const args = ['-c', `port=${port}`, `freq=${freq}`]
  if (erase) args.push('-e', 'all')
  args.push('-w', file)
  if (address) args.push(address)
  if (verify) args.push('-v')
  if (reset) args.push('-rst')
  return args
}

const quote = (a) => (/[\s"]/.test(a) ? `"${a}"` : a)

export function commandLine(cli, args) {
  return [quote(cli), ...args.map(quote)].join(' ')
}

/**
 * 解析 CLI 输出。注意：无硬件时的端到端行为尚未在本机验证，
 * 因此这里只做保守判断，并把原文尾部一并返回供人工确认。
 */
export function parseOutput(stdout = '', stderr = '') {
  const all = `${stdout}\n${stderr}`
  const noProbe = /No ST-Link detected|No STM32 device in DFU mode connected|No J-Link/i.test(all)
  const verified = /Download verified successfully|verified successfully/i.test(all)
  const failed = /\bError\b|Error occurred|failed to|No such file/i.test(all) && !noProbe
  return {
    noProbe,
    verified,
    failed,
    tail: all.split(/\r?\n/).filter((l) => l.trim()).slice(-14),
  }
}

/** 需要人工在场的动作（擦除整片）单独标出来，便于上层要求更明确的确认。 */
export function isDestructive({ erase } = {}) {
  return erase === true
}

// ── 备选后端（POSIX 上常见；Windows 上也可能是装了 winget 版 stlink/openocd） ──
//
// ⚠️ 诚实标注：下面两个函数**只生成命令模板，未在真机上验证过写入行为**
//    （作者手上没有 Linux/macOS + 探针环境）。因此 index.js 只在拿不到官方 CLI 时
//    把它们当作"手动可选项"给出来，绝不自动执行。

/**
 * OpenOCD 命令模板。
 * 默认按 ST-LINK + STM32F1 组态；换芯片/探针要改 cfg。
 * 地址只有 `.bin` 需要（`.hex`/`.elf` 自带地址，传了会出错，所以按需省略）。
 */
export function buildOpenOcdCommand({ file, address, interface: iface = 'interface/stlink.cfg', target = 'target/stm32f1x.cfg' } = {}) {
  const program = `program ${quote(file)}${address ? ` ${address}` : ''} verify reset exit`
  return `openocd -f ${iface} -f ${target} -c "${program}"`
}

/**
 * st-flash（stlink-tools）命令模板。
 * st-flash 写 `.bin` 必须给地址；写 `.hex` 时不带地址。
 */
export function buildStFlashCommand({ file, address } = {}) {
  return `st-flash --reset write ${quote(file)}${address ? ` ${address}` : ''}`
}
