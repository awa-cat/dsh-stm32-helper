/**
 * stm32_guard —— CubeMX 生成物的"快照 / 越界改动检出"。
 *
 * 要解决的问题：CubeMX 只保留 `/* USER CODE BEGIN X *​/ ... /* USER CODE END X *​/` 之间的内容，
 * 其余按 .ioc 重生成。agent（或人）如果把代码写在 USER CODE 区之外，下次 `project generate`
 * 会**静默抹掉**——这是本项目仅次于参数登记表的第二号风险。
 *
 * 核心手法：把 USER CODE 块**内部内容清空**后比较两个版本。
 *   - 归一化后相同  → 所有改动都在 USER CODE 区内 → 重新生成后能存活（safe）
 *   - 归一化后不同  → 存在区外改动 → 重新生成后会被抹掉（will-be-wiped）
 *
 * 正确用法（顺序很重要）：
 *   生成完成 → snapshot（建立干净基线）→ 改代码 → diff（看哪些改动有风险）
 *            → 重新生成 → 再 snapshot
 * 若在"用户已改过、尚未生成"的状态下建立快照，基线本身就是脏的，diff 会失真。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { join, relative, extname, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const STATE_DIR = '.dsh-stm32'
const SNAP_DIR = 'snapshots'
const KEEP_SNAPSHOTS = 5
/**
 * 采集范围版本。**改变采集范围必须递增**——否则旧快照与新采集范围不可比，
 * 会把整片 HAL/CMSIS 目录误报成"新增"（实测踩过：19 文件 → 85 文件，66 条噪音淹没 1 条真信号）。
 * 版本不匹配时 diffAgainstSnapshot 会拒绝比对并要求重建基线。
 */
const SCOPE = 'v2-core-plus-user'

/** 递归收集文件（按扩展名过滤），返回相对 root 的路径。 */
export function walk(root, {
  extensions = null,
  // Drivers/ 是固件包整包拷贝（HAL+CMSIS，上百个文件），既非用户可编辑、也由 CubeMX 整体覆盖，
  // 纳入采集只会淹没真信号，故默认排除。
  skipDirs = new Set(['build', 'Objects', 'Listings', '.git', '.dsh-stm32', 'Debug', 'Release', 'MXTmpFiles', 'node_modules', 'Drivers']),
} = {}) {
  const out = []
  const visit = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue
        visit(full)
      } else if (e.isFile()) {
        if (extensions && !extensions.has(extname(e.name).toLowerCase())) continue
        out.push(relative(root, full))
      }
    }
  }
  visit(root)
  return out
}

/**
 * 清空 C 源码里 USER CODE 块的**内部内容**。
 *
 * 关键：区内行进**整体丢弃**（不是替换成占位符保持行数）——
 * 否则"在区内新增/删除一行"也会改变归一化文本，把合法改动误判成越界改动（实测踩过）。
 * 丢弃会带来行号漂移，因此同时返回 lineMap（归一化行号 → 原始 1-based 行号），
 * 供 diff 把位置还原成真实行号。
 */
export function blankUserCode(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  const lineMap = []
  let depth = 0
  let sawBegin = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\/\*\s*USER CODE BEGIN\b/.test(line)) { depth++; sawBegin = true; out.push(line); lineMap.push(i + 1); continue }
    if (/\/\*\s*USER CODE END\b/.test(line)) { depth = Math.max(0, depth - 1); out.push(line); lineMap.push(i + 1); continue }
    if (depth > 0) continue // 区内内容整体丢弃
    out.push(line)
    lineMap.push(i + 1)
  }
  return { normalized: out.join('\n'), hasUserCode: sawBegin, lineMap }
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const isCore = (rel) => /^core[\\/]/i.test(rel)

/** 收集受管文件指纹；含 USER CODE 标记的文件额外保存归一化文本（供 diff）。 */
export function collectState(projectRoot) {
  const files = {}
  const coreExts = new Set(['.c', '.h', '.s'])
  const rootExts = new Set(['.ioc', '.ld', '.s', '.txt', '.json'])

  const add = (rel) => {
    const full = join(projectRoot, rel)
    try {
      const text = readFileSync(full, 'utf8')
      const { normalized, hasUserCode } = blankUserCode(text)
      const entry = { hash: sha(text), normHash: sha(normalized), hasUserCode, bytes: statSync(full).size }
      if (hasUserCode) entry.normText = normalized
      files[rel] = entry
    } catch { /* 二进制或读取失败：跳过 */ }
  }

  // 全工程源码都跟踪（含 App/ 这类 CubeMX 不管辖的自建目录）——
  // 这样"新增自建模块"能被明确报成 new-file（安全），而不是干脆不出现，
  // 让 agent 无法区分"没风险"与"没看见"。
  for (const rel of walk(projectRoot, { extensions: coreExts })) add(rel)

  let rootEntries = []
  try { rootEntries = readdirSync(projectRoot, { withFileTypes: true }) } catch { /* 忽略 */ }
  for (const e of rootEntries) {
    if (!e.isFile()) continue
    const ext = extname(e.name).toLowerCase()
    if (rootExts.has(ext) || e.name === 'Makefile' || e.name.startsWith('startup_')) add(e.name)
  }
  for (const sub of ['MDK-ARM', 'STM32CubeIDE']) {
    const d = join(projectRoot, sub)
    if (!existsSync(d)) continue
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { /* 忽略 */ }
    for (const e of entries) {
      if (e.isFile() && ['.uvprojx', '.uvoptx', '.cproject', '.project'].includes(extname(e.name).toLowerCase())) {
        add(join(sub, e.name))
      }
    }
  }

  return { projectRoot, scope: SCOPE, takenAt: new Date().toISOString(), fileCount: Object.keys(files).length, files }
}

export function snapshotDir(projectRoot) {
  return join(projectRoot, STATE_DIR, SNAP_DIR)
}

export function writeSnapshot(projectRoot) {
  const state = collectState(projectRoot)
  const dir = snapshotDir(projectRoot)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}.json`)
  writeFileSync(file, JSON.stringify(state), 'utf8') // 紧凑写，normText 体积敏感
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ file: `${stamp}.json`, takenAt: state.takenAt }), 'utf8')
  pruneSnapshots(dir)
  return { file, takenAt: state.takenAt, fileCount: state.fileCount }
}

function pruneSnapshots(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'latest.json').sort()
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
      try { unlinkSync(join(dir, f)) } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
}

export function readLatestSnapshot(projectRoot) {
  const ptr = join(snapshotDir(projectRoot), 'latest.json')
  if (!existsSync(ptr)) return null
  try {
    const { file } = JSON.parse(readFileSync(ptr, 'utf8'))
    const full = join(snapshotDir(projectRoot), file)
    if (!existsSync(full)) return null
    return { ...JSON.parse(readFileSync(full, 'utf8')), file: full }
  } catch { return null }
}

/** 行级 diff（LCS）。只用于小文件（单个 .c），O(n*m) 可接受。 */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n')
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const hunks = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; continue }
    const startA = i, startB = j
    while (i < n && j < m && A[i] !== B[j]) {
      if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
    hunks.push({ oldStart: startA + 1, oldLines: A.slice(startA, i), newStart: startB + 1, newLines: B.slice(startB, j) })
    if (hunks.length >= 30) break
  }
  if (i < n || j < m) hunks.push({ oldStart: i + 1, oldLines: A.slice(i), newStart: j + 1, newLines: B.slice(j) })
  return hunks
}

const MAX_HUNKS_PER_FILE = 3
const MAX_LINES_PER_HUNK = 6
const trim = (arr) => (arr.length > MAX_LINES_PER_HUNK ? [...arr.slice(0, MAX_LINES_PER_HUNK), `… (${arr.length - MAX_LINES_PER_HUNK} more lines)`] : arr)

/**
 * 与上次快照比较，判断改动是否会在下次重新生成时被抹掉。
 */
export function diffAgainstSnapshot(projectRoot) {
  const snap = readLatestSnapshot(projectRoot)
  if (!snap) {
    return { ok: false, error: '没有快照。正确顺序：CubeMX 生成完成后先 action=snapshot 建立基线，再改代码，然后 action=diff。' }
  }
  if (snap.scope !== SCOPE) {
    return {
      ok: false,
      error: `快照的采集范围与当前版本不一致（快照 scope=${snap.scope ?? 'v1'}，当前 ${SCOPE}），两者不可比。请重新 action=snapshot 建立基线。`,
      baseline: { file: snap.file, takenAt: snap.takenAt, fileCount: snap.fileCount },
    }
  }
  const current = collectState(projectRoot)
  const results = []
  const allRel = new Set([...Object.keys(snap.files), ...Object.keys(current.files)])

  for (const rel of [...allRel].sort()) {
    const oldF = snap.files[rel]
    const newF = current.files[rel]
    if (oldF && !newF) { results.push({ file: rel, kind: 'deleted', risk: 'managed-file-removed' }); continue }
    if (!oldF && newF) {
      results.push({
        file: rel,
        kind: 'added',
        risk: isCore(rel) ? 'outside-user-code' : 'new-file',
        note: isCore(rel) ? 'CubeMX 管理的目录里新增文件，重新生成可能被移除' : 'CubeMX 不管辖，重新生成后仍在',
      })
      continue
    }
    if (oldF.hash === newF.hash) continue

    if (oldF.hasUserCode && newF.hasUserCode) {
      if (oldF.normHash === newF.normHash) {
        results.push({ file: rel, kind: 'modified', risk: 'user-code-only', note: '改动全在 USER CODE 区内，重新生成后保留' })
      } else {
        const cur = blankUserCode(readFileSync(join(projectRoot, rel), 'utf8'))
        const hunks = diffLines(oldF.normText ?? '', cur.normalized)
        const at = (normalizedStart, k) => cur.lineMap[normalizedStart - 1 + k]
        results.push({
          file: rel,
          kind: 'modified',
          risk: 'outside-user-code',
          note: 'USER CODE 区之外有改动 —— 下次 project generate 会【静默抹掉】',
          hint: '把改动迁进 USER CODE 块，或挪到自建目录（如 App/）',
          hunkCount: hunks.length,
          hunks: hunks.slice(0, MAX_HUNKS_PER_FILE).map((h) => ({
            added: h.newLines.slice(0, MAX_LINES_PER_HUNK).map((t, k) => ({ line: at(h.newStart, k), text: t })),
            addedOmitted: Math.max(0, h.newLines.length - MAX_LINES_PER_HUNK),
            removedCount: h.oldLines.length,
          })),
        })
      }
    } else {
      results.push({ file: rel, kind: 'modified', risk: 'managed-file-changed', note: '无 USER CODE 标记（工程文件/链接脚本/.ioc），由 CubeMX 重新生成' })
    }
  }

  const atRisk = results.filter((r) => r.risk === 'outside-user-code')
  const MAX_CHANGED = 40
  return {
    ok: true,
    baseline: { file: snap.file, takenAt: snap.takenAt, fileCount: snap.fileCount },
    currentFileCount: current.fileCount,
    changed: results.slice(0, MAX_CHANGED),
    changedCount: results.length,
    changedOmitted: Math.max(0, results.length - MAX_CHANGED),
    verdict: atRisk.length === 0 ? 'safe' : 'will-be-wiped',
    atRiskFiles: atRisk.map((r) => r.file),
    advice: atRisk.length === 0
      ? '未发现会在重新生成时丢失的改动。'
      : `有 ${atRisk.length} 个文件的改动会在下次 CubeMX 生成时丢失：先按 hint 迁移，再执行 generate。`,
    reminder: atRisk.length > 0
      ? '若你刚刚执行过 generate，这些"区外改动"很可能是 CubeMX 自己的改写（或它已抹掉你之前写的区外代码）。生成完成后请重新 action=snapshot 建立新基线，否则基线会一直停留在旧状态。'
      : undefined,
  }
}

export function clearSnapshots(projectRoot) {
  const dir = join(projectRoot, STATE_DIR)
  if (!existsSync(dir)) return { removed: false }
  rmSync(dir, { recursive: true, force: true })
  return { removed: true }
}
