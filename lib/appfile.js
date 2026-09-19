/**
 * stm32_app_file —— 工程内 `App/` 目录的自建模块文件读写。
 *
 * 为什么需要它：
 *   控制类代码（PID、电机闭环、巡线）塞进 `USER CODE` 区很快就乱，分模块是刚需；
 *   而 `D:\STM32_Workspace\DSHCode` 在文件沙箱可写范围之外，agent 的文件工具写不进去。
 *
 * 安全边界（**结构性**，不是靠自觉）：
 *   - 作用域限定在 `<projectRoot>/App/` 内：解析后必须落在该目录之下，`..` 穿越一律拒绝。
 *   - 只接受 `.c` / `.h` 扩展名。
 *   - 写前备份（已有文件才备份），写后回读校验。
 *
 * 比"能写文件"更重要的一半：**新文件要登记进构建系统**，否则编译器根本不会编译它。
 * 所以写入 `.c` 时会按工程里实际存在的构建文件登记（三者可同时存在，全都改）：
 *   - Keil `.uvprojx`——加进 `Application/User/App` 文件组 + `<Cads>` 段 `IncludePath`
 *   - CubeMX 的 `Makefile`——`C_SOURCES` 续行块 + `C_INCLUDES`
 *   - CubeMX 的 CMake 工程——顶层 `CMakeLists.txt` 的**用户区**
 *     （该文件 CubeMX 只生成一次、不重写；`cmake/stm32cubemx/CMakeLists.txt` 才是生成物，别碰）
 * 每步都幂等，改前备份、改后回读校验。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'

const APP_DIR = 'App'
const ALLOWED_EXT = new Set(['.c', '.h'])
const MDK_GROUP = 'Application/User/App'

function backup(file) {
  const dir = join(dirname(file), '.dsh-stm32', 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dir, `${stamp}-${file.split(/[\\/]/).pop()}`)
  copyFileSync(file, dest)
  return dest
}

/** 校验工程根：必须像 CubeMX 工程。 */
export function assertProject(projectRoot) {
  const root = resolve(projectRoot)
  if (!existsSync(root)) throw new Error(`工程目录不存在: ${root}`)
  const looksLikeProject = existsSync(join(root, 'Core')) || existsSync(join(root, '.mxproject'))
  if (!looksLikeProject) {
    throw new Error(`不像 CubeMX 工程（缺 Core/ 与 .mxproject）: ${root}`)
  }
  return root
}

/**
 * 把 `App/` 下的相对路径解析成绝对路径，并**强制限定在 App/ 内**。
 * 任何 `..` 穿越、绝对路径、非法扩展名都会被拒绝。
 */
export function resolveAppPath(projectRoot, rel) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('file 不能为空（App/ 下的相对路径）')
  const raw = rel.trim().replace(/\\/g, '/')
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error(`只接受 App/ 下的相对路径，收到绝对路径: ${rel}`)
  const root = assertProject(projectRoot)
  const appRoot = join(root, APP_DIR)
  const target = resolve(appRoot, raw)
  // 关键守卫：必须在 appRoot 之下（含分隔符，避免 AppX 之类的前缀绕过）
  if (target !== appRoot && !target.startsWith(appRoot + sep)) {
    throw new Error(`路径越界被拒绝（只能写在 ${APP_DIR}/ 内）: ${rel}`)
  }
  const dot = target.lastIndexOf('.')
  const ext = dot >= 0 ? target.slice(dot).toLowerCase() : ''
  if (!ALLOWED_EXT.has(ext)) throw new Error(`只允许 .c / .h 文件，收到: ${rel}`)
  return { root, appRoot, target, rel: target.slice(appRoot.length + 1).replace(/\\/g, '/') }
}

export function listApp(projectRoot) {
  const root = assertProject(projectRoot)
  const appRoot = join(root, APP_DIR)
  if (!existsSync(appRoot)) return { appRoot, exists: false, files: [] }
  const files = []
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.dsh-stm32') continue
        visit(full)
      } else {
        files.push({ path: full.slice(appRoot.length + 1).replace(/\\/g, '/'), bytes: statSync(full).size })
      }
    }
  }
  visit(appRoot)
  return { appRoot, exists: true, files: files.sort((a, b) => a.path.localeCompare(b.path)) }
}

export function readApp(projectRoot, rel) {
  const { target, rel: relNorm } = resolveAppPath(projectRoot, rel)
  if (!existsSync(target)) throw new Error(`文件不存在: ${APP_DIR}/${relNorm}`)
  return { path: target, rel: relNorm, content: readFileSync(target, 'utf8') }
}

/**
 * 把新源文件登记进 Keil 工程：文件组 + IncludePath。幂等，改前备份。
 */
/**
 * 消毒：把误加到 **非 C 编译器段** 的 `../App` 条目清掉。
 * 这是本工具自身 bug 的唯一足迹（曾把 ../App 写进一个空的 IncludePath 元素），
 * 保留它是为了能自愈已经写坏的工程文件。
 */
export function normalizeAppIncludes(xml) {
  const cadsRanges = []
  for (const m of xml.matchAll(/<Cads>[\s\S]*?<\/Cads>/g)) cadsRanges.push([m.index, m.index + m[0].length])
  const inCads = (i) => cadsRanges.some(([a, b]) => i > a && i < b)
  let removed = 0
  const next = xml.replace(/<IncludePath>([^<]*)<\/IncludePath>/g, (full, content, offset) => {
    if (inCads(offset)) return full
    const parts = String(content).split(';').map((t) => t.trim()).filter(Boolean)
    const kept = parts.filter((p) => p !== '../' + APP_DIR && !p.startsWith('../' + APP_DIR + '/'))
    if (kept.length !== parts.length) removed += parts.length - kept.length
    return `<IncludePath>${kept.join(';')}</IncludePath>`
  })
  return { xml: next, removed }
}

export function patchMdkProject(projectRoot, relUnderApp, { isSource }) {
  const mdkDir = join(projectRoot, 'MDK-ARM')
  if (!existsSync(mdkDir)) return { patched: false, reason: '没有 MDK-ARM 目录（非 Keil 工程），需要在你的构建系统里手动加入该文件' }
  let proj = null
  try { proj = readdirSync(mdkDir).find((f) => f.toLowerCase().endsWith('.uvprojx')) } catch { /* 忽略 */ }
  if (!proj) return { patched: false, reason: 'MDK-ARM 下找不到 .uvprojx' }

  const file = join(mdkDir, proj)
  let xml = readFileSync(file, 'utf8')
  const out = { patched: true, projectFile: file, groupAdded: false, fileAdded: false, includeAdded: [] }
  // 先消毒历史误写（本工具早期 bug 会把 ../App 加到非 <Cads> 段）
  const cleaned = normalizeAppIncludes(xml)
  xml = cleaned.xml
  if (cleaned.removed) out.includeCleaned = cleaned.removed

  // ① 头文件搜索路径：**只在 C 编译器段 <Cads> 里改**。
  //    项目里存在多个 <IncludePath>（<Aads> 汇编段、其它 target、空元素），
  //    按"第一个匹配"会改错元素——实测把 ../App 加进了一个空的 IncludePath，
  //    真正的编译搜索路径没变，结果头文件找不到、编译失败。
  const partsForInc = relUnderApp.split('/')
  const includeDirs = ['../' + APP_DIR]
  if (partsForInc.length > 1) includeDirs.push('../' + APP_DIR + '/' + partsForInc.slice(0, -1).join('/'))
  for (const m of [...xml.matchAll(/<Cads>[\s\S]*?<\/Cads>/g)]) {
    const block = m[0]
    const inc = /<IncludePath>([^<]*)<\/IncludePath>/.exec(block)
    if (!inc) continue
    const cur = inc[1].split(';').map((t) => t.trim()).filter(Boolean)
    const add = includeDirs.filter((d) => !cur.includes(d))
    if (!add.length) continue
    const fixedBlock = block.replace(inc[0], `<IncludePath>${[...cur, ...add].join(';')}</IncludePath>`)
    xml = xml.replace(block, fixedBlock)
    out.includeAdded = [...out.includeAdded, ...add]
  }

  // ② 文件组 + 文件条目（只有 .c 需要登记；头文件靠 IncludePath 就能被找到）
  if (isSource) {
    const parts = relUnderApp.split('/')
    const filePath = '../' + APP_DIR + '/' + relUnderApp
    const fileName = parts[parts.length - 1]
    if (xml.includes(`<FilePath>${filePath}</FilePath>`)) {
      out.fileAdded = false
      out.note = '工程里已存在该文件条目，未重复添加'
    } else {
      const entry =
        `            <File>\n` +
        `              <FileName>${fileName}</FileName>\n` +
        `              <FileType>1</FileType>\n` +
        `              <FilePath>${filePath}</FilePath>\n` +
        `            </File>\n`
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const groupRe = new RegExp(`(<Group>\\s*<GroupName>${esc(MDK_GROUP)}</GroupName>\\s*<Files>)`)
      const gm = groupRe.exec(xml)
      if (gm) {
        xml = xml.replace(gm[1], gm[1] + '\n' + entry)
        out.fileAdded = true
      } else {
        const newGroup =
          `        <Group>\n` +
          `          <GroupName>${MDK_GROUP}</GroupName>\n` +
          `          <Files>\n` +
          entry +
          `          </Files>\n` +
          `        </Group>\n`
        if (!xml.includes('      </Groups>')) return { patched: false, reason: '工程文件结构异常（找不到 </Groups>）' }
        xml = xml.replace('      </Groups>', newGroup + '      </Groups>')
        out.groupAdded = true
        out.fileAdded = true
      }
    }
  }

  if (!out.includeAdded.length && !out.fileAdded && !out.groupAdded) {
    return { ...out, changed: false, note: '工程文件无需改动（已登记）' }
  }
  out.backup = backup(file)
  writeFileSync(file, xml, 'utf8')
  out.changed = true
  // 写后校验：C 编译器段里的 IncludePath 必须真的含 ../App
  const after = readFileSync(file, 'utf8')
  const cads = /<Cads>[\s\S]*?<\/Cads>/.exec(after)
  const incNow = cads ? /<IncludePath>([^<]*)<\/IncludePath>/.exec(cads[0]) : null
  out.includeVerified = !!(incNow && incNow[1].includes('../' + APP_DIR))
  if (!out.includeVerified) {
    out.warning = '写后校验失败：C 编译器段的 IncludePath 里没有 ../App，头文件可能找不到'
  }
  return out
}

/**
 * ── Makefile 登记（CubeMX 的 Makefile 工程；POSIX 上最常见的构建路径） ──
 *
 * 生成物形如：
 *   C_SOURCES =  \
 *   Core/Src/main.c \
 *   ...
 *   Core/Src/syscalls.c
 *   C_INCLUDES =  \
 *   -ICore/Inc \
 *   ...
 *   -IDrivers/CMSIS/Include
 *
 * 两个真实坑（都在这里处理）：
 *   ① 续行：块内除最后一行外都必须以 ` \` 结尾，插错位置 Make 直接语法错。
 *   ② **扁平目标名**：生成物用 `$(notdir $(C_SOURCES:.c=.o))` 拼目标文件，
 *      两个不同目录下的同名 .c（App/pid/pid.c 与 Core/Src/pid.c）会撞同一个 .o。
 *      这种情况必须报出来，不能默默加进去了事。
 */
export function patchMakefile(projectRoot, relUnderApp, { isSource }) {
  const file = join(projectRoot, 'Makefile')
  if (!existsSync(file)) return { patched: false, reason: '没有 Makefile（非 Makefile 工程）' }
  let text = readFileSync(file, 'utf8')

  const rel = `${APP_DIR}/${relUnderApp}`
  const parts = relUnderApp.split('/')
  const subDir = parts.length > 1 ? `${APP_DIR}/${parts.slice(0, -1).join('/')}` : null
  const out = {
    patched: true, buildSystem: 'makefile', projectFile: file,
    sourceAdded: false, includeAdded: [],
  }

  /** 在 `VAR = \` 续行块的末尾插入若干行（新行自己带续行符）。 */
  const insertIntoVar = (src, varName, newLines) => {
    const lines = src.split('\n')
    const start = lines.findIndex((l) => new RegExp(`^${varName}\\s*=`).test(l))
    if (start < 0) return { text: src, ok: false, reason: `找不到 ${varName} 赋值块` }
    let end = start
    while (end < lines.length && lines[end].trimEnd().endsWith('\\')) end++
    // end 指向块的最后一行（不以 \ 结尾）；块只有一行时 end === start
    if (end === start) {
      lines[start] = lines[start].trimEnd() + newLines.map((n) => ` ${n}`).join('')
      return { text: lines.join('\n'), ok: true, singleLine: true }
    }
    const ins = newLines.map((n) => `  ${n} \\`).join('\n')
    lines.splice(end, 0, ins)
    return { text: lines.join('\n'), ok: true }
  }

  /** 读出一个 `VAR = \` 续行块里的所有值（去掉续行符，空行/下一个赋值行截断）。 */
  const readVarEntries = (src, varName) => {
    const lines = src.split('\n')
    const start = lines.findIndex((l) => new RegExp(`^${varName}\\s*=`).test(l))
    if (start < 0) return []
    const entries = []
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i].trim()
      if (!l) break
      if (/^[A-Za-z_][\w-]*\s*[:+]?=/.test(l)) break // 下一个变量赋值开始
      entries.push(l.replace(/\s*\\$/, '').trim())
    }
    return entries
  }

  if (isSource && !text.includes(rel)) {
    // 同名 .o 碰撞检查（见上文 ②）
    const existing = readVarEntries(text, 'C_SOURCES')
    const myBase = parts[parts.length - 1]
    const clash = existing.find((e) => e.split('/').pop() === myBase)
    if (clash) {
      out.objectNameCollision = {
        otherSource: clash,
        why: 'CubeMX 的 Makefile 用 $(notdir $(C_SOURCES:.c=.o)) 拼目标名，不同目录的同名 .c 会撞同一个 .o',
        suggestion: '给 App/ 下的文件改名（如 pid_motor.c），或把 Makefile 的 OBJECTS 规则改成保留目录结构。',
      }
    }
    const r = insertIntoVar(text, 'C_SOURCES', [rel])
    if (r.ok) { text = r.text; out.sourceAdded = true } else out.sourceNote = r.reason
  }

  const incs = [`-I${APP_DIR}`]
  if (subDir) incs.push(`-I${subDir}`)
  const existingIncs = new Set(readVarEntries(text, 'C_INCLUDES'))
  const missingIncs = incs.filter((i) => !existingIncs.has(i))
  if (missingIncs.length) {
    const r = insertIntoVar(text, 'C_INCLUDES', missingIncs)
    if (r.ok) { text = r.text; out.includeAdded = missingIncs } else out.includeNote = r.reason
  }

  if (!out.sourceAdded && !out.includeAdded.length) {
    return { ...out, changed: false, note: 'Makefile 无需改动（已登记）' }
  }
  out.backup = backup(file)
  writeFileSync(file, text, 'utf8')
  const after = readFileSync(file, 'utf8')
  out.sourceVerified = !isSource || after.includes(rel)
  out.includeVerified = incs.every((i) => after.includes(i))
  if (!out.sourceVerified || !out.includeVerified) out.warning = '写后校验失败：Makefile 里没找到刚插入的条目'
  out.staleWarning = 'CubeMX 重新生成工程会重写 Makefile，这些条目会丢——重新生成后需再登记一次。'
  out.changed = true
  return out
}

/**
 * ── CMake 登记（CubeMX 的 CMake 工程） ──
 *
 * 关键区别（本函数存在的理由）：CubeMX 的**顶层 CMakeLists.txt 是"只生成一次、
 * 之后不再重写"**（文件头自带这句话），并留了两个用户区：
 *     target_sources(${CMAKE_PROJECT_NAME} PRIVATE
 *         # Add user sources here
 *     )
 *     target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
 *         # Add user defined include paths
 *     )
 * 所以只往用户区里加：既生效，又不怕重新生成。**不要**去改
 * `cmake/stm32cubemx/CMakeLists.txt`——那个每次生成都会重写。
 */
export function patchCMake(projectRoot, relUnderApp, { isSource }) {
  const file = join(projectRoot, 'CMakeLists.txt')
  if (!existsSync(file)) return { patched: false, reason: '没有顶层 CMakeLists.txt' }
  let text = readFileSync(file, 'utf8')
  if (!/add_subdirectory\(\s*cmake\/stm32cubemx/.test(text)) {
    return { patched: false, projectFile: file, reason: 'CMakeLists.txt 不像 CubeMX 生成的工程（缺 add_subdirectory(cmake/stm32cubemx)）' }
  }

  const out = { patched: true, buildSystem: 'cmake', projectFile: file, sourceAdded: false, includeAdded: [] }
  const srcLine = `    \${CMAKE_CURRENT_SOURCE_DIR}/${APP_DIR}/${relUnderApp}`
  const parts = relUnderApp.split('/')
  const incLines = [`    \${CMAKE_CURRENT_SOURCE_DIR}/${APP_DIR}`]
  if (parts.length > 1) incLines.push(`    \${CMAKE_CURRENT_SOURCE_DIR}/${APP_DIR}/${parts.slice(0, -1).join('/')}`)

  /** 往用户区注释之后插入命令行（按"整行相等"判幂等，避免 `App` 命中 `App/motor.c` 这类子串误判）。 */
  const insertAfterMarker = (src, marker, newLines) => {
    const existing = new Set(src.split('\n').map((l) => l.trim()))
    const toAdd = newLines.filter((l) => !existing.has(l.trim()))
    if (!toAdd.length) return { text: src, changed: false }
    const lines = src.split('\n')
    const idx = lines.findIndex((l) => l.trim() === marker)
    if (idx < 0) return { text: src, changed: false, reason: `找不到用户区标记 "${marker}"` }
    lines.splice(idx + 1, 0, ...toAdd)
    return { text: lines.join('\n'), changed: true }
  }

  if (isSource) {
    const r = insertAfterMarker(text, '# Add user sources here', [srcLine])
    if (r.changed) { text = r.text; out.sourceAdded = true } else if (r.reason) out.sourceNote = r.reason
  }
  const incRes = insertAfterMarker(text, '# Add user defined include paths', incLines)
  if (incRes.changed) { text = incRes.text; out.includeAdded = incLines.map((l) => l.trim()) }
  else if (incRes.reason) out.includeNote = incRes.reason

  if (!out.sourceAdded && !out.includeAdded.length) {
    return { ...out, changed: false, note: 'CMakeLists.txt 无需改动（已登记）' }
  }
  out.backup = backup(file)
  writeFileSync(file, text, 'utf8')
  const after = readFileSync(file, 'utf8')
  out.sourceVerified = !isSource || after.includes(srcLine.trim())
  out.includeVerified = incLines.every((l) => after.includes(l.trim()))
  out.changed = true
  out.note = '改动落在顶层 CMakeLists.txt 的用户区（CubeMX 不重写该文件），无需重新登记。'
  return out
}

/**
 * 按工程里**实际存在**的构建文件自动选登记目标（可同时存在，全都登记）。
 * Keil(.uvprojx) / Makefile / CMakeLists.txt 三者互不排斥。
 */
export function patchBuild(projectRoot, relUnderApp, { isSource }) {
  const systems = []
  if (existsSync(join(projectRoot, 'MDK-ARM'))) {
    systems.push({ kind: 'keil', ...patchMdkProject(projectRoot, relUnderApp, { isSource }) })
  }
  if (existsSync(join(projectRoot, 'Makefile'))) {
    systems.push({ kind: 'makefile', ...patchMakefile(projectRoot, relUnderApp, { isSource }) })
  }
  if (existsSync(join(projectRoot, 'CMakeLists.txt'))) {
    systems.push({ kind: 'cmake', ...patchCMake(projectRoot, relUnderApp, { isSource }) })
  }
  if (!systems.length) {
    return {
      patched: false,
      reason: '工程里没有 MDK-ARM/ 、Makefile 、CMakeLists.txt 任何一种构建文件',
      reminder: '该文件尚未登记进构建系统——请手动加入（Keil：右键分组 → Add Existing Files；Makefile：加进 C_SOURCES；CMake：target_sources）。',
    }
  }
  return {
    patched: systems.some((s) => s.changed),
    changedSystems: systems.filter((s) => s.changed).map((s) => s.kind),
    systems,
    staleWarnings: systems.map((s) => s.staleWarning).filter(Boolean),
  }
}

export function writeApp(projectRoot, rel, code, { register = true } = {}) {
  const { root, target, rel: relNorm } = resolveAppPath(projectRoot, rel)
  if (typeof code !== 'string') throw new Error('code 必须是字符串')
  mkdirSync(dirname(target), { recursive: true })
  const existed = existsSync(target)
  const fileBackup = existed ? backup(target) : null
  writeFileSync(target, code, 'utf8')

  const isSource = relNorm.toLowerCase().endsWith('.c')
  const build = register ? patchBuild(root, relNorm, { isSource }) : { patched: false, reason: 'register=false' }
  // 兼容旧字段：mdk 仍指向 Keil 那一份结果（没有 Keil 工程时就是 null）
  const mdk = (build.systems ?? []).find((s) => s.kind === 'keil') ?? null
  const verify = readFileSync(target, 'utf8')

  return {
    ok: verify === code,
    file: target,
    rel: `${APP_DIR}/${relNorm}`,
    created: !existed,
    bytes: Buffer.byteLength(code, 'utf8'),
    backup: fileBackup,
    build,
    mdk,
    verify: verify === code ? '写后回读一致' : '⚠️ 写后回读不一致',
    reminder: isSource && !build.patched ? (build.reminder ?? '该文件尚未登记进构建系统——请手动加入。') : undefined,
  }
}

export function deleteApp(projectRoot, rel) {
  const { target, rel: relNorm } = resolveAppPath(projectRoot, rel)
  if (!existsSync(target)) throw new Error(`文件不存在: ${APP_DIR}/${relNorm}`)
  const b = backup(target)
  rmSync(target, { force: true })
  return {
    ok: true, deleted: `${APP_DIR}/${relNorm}`, backup: b,
    note: '已删除（备份保留）。若它是 .c，请从构建系统里一并摘掉条目（Keil 分组 / Makefile 的 C_SOURCES / CMake 的 target_sources）——工具不会替你改构建文件，免得误删与"工程被悄悄改坏"分不清。',
  }
}
