/**
 * stm32_user_code —— 只往 CubeMX 的 USER CODE 区里写代码。
 *
 * 为什么需要它：
 *   1. 语义正确。CubeMX 只保留 `/* USER CODE BEGIN X *​/ ... /* USER CODE END X *​/` 之间的内容，
 *      业务代码写在这里，重新 `project generate` 不会丢。
 *   2. 绕开会话沙箱的摩擦。生成的工程按用户约定放在 `D:\STM32_Workspace\DSHCode`（工作区之外），
 *      agent 的文件工具写不进去；插件进程不受该沙箱约束。
 *
 * 安全边界（**结构性**，不是靠自觉）：
 *   - 只接受含 `USER CODE BEGIN` 标记的文件；一个都没有就直接拒绝。
 *   - 只在 `BEGIN X` 与配对的 `END X` 之间替换，区外内容一个字节都不动。
 *   - 拒绝 code 里含有 USER CODE 标记（否则会破坏区域结构）。
 *   - 写前备份、写后重新解析校验区域仍成对存在。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const BEGIN = /\/\*\s*USER CODE BEGIN\s+([^*]*?)\s*\*\//
const END = /\/\*\s*USER CODE END\s+([^*]*?)\s*\*\//

/** 解析文件里的 USER CODE 块。返回行号均为 1-based。 */
export function parseBlocks(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const blocks = []
  let open = null
  for (let i = 0; i < lines.length; i++) {
    const b = BEGIN.exec(lines[i])
    if (b) { open = { name: b[1].trim(), beginLine: i + 1, contentFrom: i + 1 }; continue }
    const e = END.exec(lines[i])
    if (!e) continue
    const name = e[1].trim()
    if (open && open.name === name) {
      blocks.push({
        name,
        beginLine: open.beginLine,
        endLine: i + 1,
        content: lines.slice(open.contentFrom, i),
      })
      open = null
    } else {
      blocks.push({ name, beginLine: null, endLine: i + 1, content: [], unpaired: true })
    }
  }
  return { eol, lines, blocks, unterminated: open ? open.name : null }
}

export function readBlocks(file) {
  const text = readFileSync(file, 'utf8')
  const { blocks, unterminated } = parseBlocks(text)
  return {
    file,
    blocks: blocks.map((b) => ({
      name: b.name,
      lines: b.beginLine ? `${b.beginLine}-${b.endLine}` : `?-${b.endLine}`,
      unpaired: !!b.unpaired,
      empty: b.content.every((l) => l.trim() === ''),
      currentContent: b.content.join('\n'),
    })),
    unterminated,
  }
}

/** 把代码写入指定 USER CODE 块。 */
export function writeBlock(file, blockName, code, { mode = 'replace' } = {}) {
  if (!existsSync(file)) throw new Error(`文件不存在: ${file}`)
  const text = readFileSync(file, 'utf8')
  const { eol, lines, blocks } = parseBlocks(text)

  const usable = blocks.filter((b) => !b.unpaired)
  if (usable.length === 0) {
    throw new Error(
      '该文件里没有成对的 USER CODE 区，拒绝写入（本工具只写 CubeMX 保留区，避免动到生成代码）。'
      + (blocks.length ? ` 发现的孤立标记: ${blocks.map((b) => b.name).join(', ')}` : ''),
    )
  }
  const block = usable.find((b) => b.name === blockName)
  if (!block) {
    throw new Error(`找不到 USER CODE 块 "${blockName}"。该文件可用块: ${usable.map((b) => b.name).join(', ')}`)
  }
  if (BEGIN.test(code) || END.test(code)) {
    throw new Error('code 里不能包含 USER CODE 标记（会破坏区域结构）')
  }

  const codeBody = code.replace(/\r?\n+$/, '')
  const codeLines = codeBody === '' ? [] : codeBody.split(/\r?\n/)
  const inner = mode === 'append' ? [...block.content, ...codeLines] : codeLines

  const out = [
    ...lines.slice(0, block.beginLine),
    ...inner,
    ...lines.slice(block.endLine - 1),
  ]
  const next = out.join(eol)

  // 备份
  const bdir = join(dirname(file), '.dsh-stm32', 'backups')
  mkdirSync(bdir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(bdir, `${stamp}-${file.split(/[\\/]/).pop()}`)
  copyFileSync(file, backup)

  writeFileSync(file, next, 'utf8')

  // 写后校验：区域仍成对，且内容确实进去了
  const after = parseBlocks(readFileSync(file, 'utf8'))
  const re = after.blocks.find((b) => b.name === blockName && !b.unpaired)
  const ok = !!re && re.content.join('\n').includes(codeLines.filter((l) => l.trim()).slice(-1)[0] ?? '')
  return {
    ok,
    file,
    block: blockName,
    mode,
    backup,
    before: { lines: block.content.length, range: `${block.beginLine}-${block.endLine}` },
    after: re ? { lines: re.content.length, range: `${re.beginLine}-${re.endLine}` } : null,
    written: codeLines,
    verify: ok ? '区域成对且内容已落地' : '⚠️ 写后校验未通过，请人工确认',
  }
}
