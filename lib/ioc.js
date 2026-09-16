/**
 * .ioc 解析 / 校验 / 语义化改写 —— 纯逻辑，无 IO，便于单独验证。
 *
 * 设计约束（来自本机对真实 .ioc 的实测）：
 * 1. .ioc 是纯文本 key=value，key 可含转义空格（如 `TIM2.Channel-PWM\ Generation1\ CH1`），
 *    而该外设的 IPParameters 列表里写的是未转义形式（`Channel-PWM Generation1 CH1`）。
 *    ⇒ 任何"键 vs IPParameters"的比对都必须容忍这种差异，否则会误判/误删。
 * 2. CubeMX 只读取外设 IPParameters 里列出的键；列表里没有的键被【静默忽略】。
 *    ⇒ 写入任何外设参数后必须同步 IPParameters，否则改动无声丢失。
 * 3. Mcu.IP<n>/Mcu.IPNb 与 Mcu.Pin<n>/Mcu.PinsNb 必须连续自洽。
 * 4. NVIC 是伪 IP，没有 NVIC.IPParameters（实测）。
 */

const KV = /^([^=]+)=(.*)$/

export function parseIoc(text) {
  const entries = text.split(/\r?\n/).map((raw) => {
    if (raw === '' || raw.startsWith('#')) return { kind: 'other', raw }
    const m = KV.exec(raw)
    if (!m) return { kind: 'other', raw }
    return { kind: 'kv', key: m[1], value: m[2] }
  })
  return { entries }
}

export function serializeIoc(doc) {
  return doc.entries.map((e) => (e.kind === 'kv' ? `${e.key}=${e.value}` : e.raw)).join('\n')
}

export function toMap(doc) {
  const map = new Map()
  for (const e of doc.entries) if (e.kind === 'kv') map.set(e.key, e.value)
  return map
}

export function getKey(doc, key) {
  return toMap(doc).get(key)
}

/** 原地更新，或追加到末尾。返回 true 表示是新增。 */
export function setKey(doc, key, value) {
  for (const e of doc.entries) {
    if (e.kind === 'kv' && e.key === key) { e.value = value; return false }
  }
  doc.entries.push({ kind: 'kv', key, value })
  return true
}

export function delKey(doc, key) {
  doc.entries = doc.entries.filter((e) => !(e.kind === 'kv' && e.key === key))
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 读取 `Mcu.IP0..N` 形式的编号族。 */
export function readNumbered(doc, prefix) {
  const re = new RegExp(`^${escRe(prefix)}(\\d+)$`)
  const out = []
  for (const e of doc.entries) {
    if (e.kind !== 'kv') continue
    const m = re.exec(e.key)
    if (m) out.push({ n: Number(m[1]), value: e.value })
  }
  out.sort((a, b) => a.n - b.n)
  return out
}

/**
 * 重写编号族：优先"原地"替换（保持文件可读、diff 小），多余项删除，不足项补在末尾；
 * 同时更新计数键。编号连续由本函数保证。
 */
export function writeNumbered(doc, prefix, countKey, items) {
  const re = new RegExp(`^${escRe(prefix)}(\\d+)$`)
  const had = doc.entries.some((e) => e.kind === 'kv' && re.test(e.key))
  const out = []
  let p = 0
  for (const e of doc.entries) {
    if (e.kind === 'kv' && re.test(e.key)) {
      if (p < items.length) out.push({ kind: 'kv', key: `${prefix}${p}`, value: items[p++] })
    } else out.push(e)
  }
  while (p < items.length) out.push({ kind: 'kv', key: `${prefix}${p}`, value: items[p++] })
  doc.entries = out
  setKey(doc, countKey, String(items.length))
  return { had, count: items.length }
}

/**
 * 通用参数登记表同步：把 `<prefix>.<name>` 形式的实际键，同步进 `<prefix>.<listKey>` 声明的列表。
 *
 * 这是本文件最核心的一层保护。CubeMX 有**两处**同款静默丢弃陷阱（实测）：
 *   外设：`USART1.BaudRate` 必须登记进 `USART1.IPParameters`
 *   引脚：`PA1.GPIO_Label`  必须登记进 `PA1.GPIOParameters`
 * 未登记者被无声忽略，不报错、不警告。
 */
export function syncParamList(doc, prefix, listKeyName = 'IPParameters', exclude = new Set()) {
  const map = toMap(doc)
  const listKey = `${prefix}.${listKeyName}`
  const declared = (map.get(listKey) ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  const actual = []
  const alias = new Map() // 去转义名 → 原始键名
  for (const [k] of map) {
    if (!k.startsWith(`${prefix}.`)) continue
    const name = k.slice(prefix.length + 1)
    if (name === listKeyName || name.includes('.') || exclude.has(name)) continue
    actual.push(name)
    alias.set(name.replace(/\\ /g, ' '), name)
  }

  const merged = [...declared]
  for (const name of actual) {
    const unescaped = name.replace(/\\ /g, ' ')
    if (!merged.includes(unescaped) && !merged.includes(name)) merged.push(unescaped)
  }
  const kept = []
  for (const d of merged) {
    if (alias.has(d)) kept.push(alias.get(d))
    else if (actual.includes(d)) kept.push(d)
  }
  setKey(doc, listKey, kept.join(','))

  return {
    listKey,
    declaredBefore: declared,
    actualKeys: actual,
    written: kept,
    added: kept.filter((k) => !declared.some((d) => d === k || d === k.replace(/\\ /g, ' '))),
    removed: declared.filter((d) => !kept.some((k) => k === d || k.replace(/\\ /g, ' ') === d)),
  }
}

/** 外设参数表（`<Periph>.IPParameters`）。 */
export function syncIpParameters(doc, peripheral) {
  return syncParamList(doc, peripheral, 'IPParameters')
}

/** 引脚参数表（`<Pin>.GPIOParameters`）。Signal/Mode/Locked 是结构性键，不属于参数，必须排除。 */
export function syncPinParameters(doc, pin) {
  return syncParamList(doc, pin, 'GPIOParameters', new Set(['Signal', 'Mode', 'Locked']))
}

/** 确保外设出现在 Mcu.IP* 里（GPIO 除外：实测 CubeMX 不把 GPIO 记入 Mcu.IP*）。 */
export function ensurePeripheral(doc, peripheral) {
  if (peripheral === 'GPIO') return { added: false }
  const list = readNumbered(doc, 'Mcu.IP').map((x) => x.value)
  if (list.includes(peripheral)) return { added: false }
  list.push(peripheral)
  writeNumbered(doc, 'Mcu.IP', 'Mcu.IPNb', list)
  return { added: true }
}

/** 确保引脚出现在 Mcu.Pin* 里。 */
export function ensurePin(doc, pin) {
  const list = readNumbered(doc, 'Mcu.Pin').map((x) => x.value)
  if (list.includes(pin)) return { added: false }
  list.push(pin)
  writeNumbered(doc, 'Mcu.Pin', 'Mcu.PinsNb', list)
  return { added: true }
}

const UART_WORD = { 8: 'WORDLENGTH_8B', 9: 'WORDLENGTH_9B' }
const UART_PARITY = { none: 'PARITY_NONE', even: 'PARITY_EVEN', odd: 'PARITY_ODD' }
const UART_STOP = { 1: 'STOPBITS_1', 0.5: 'STOPBITS_0_5', 2: 'STOPBITS_2', 1.5: 'STOPBITS_1_5' }
const IRQ_VALUE = 'true\\:0\\:0\\:false\\:false\\:true\\:true\\:true\\:true'

/** 语义化配置一个异步 UART（唯一支持的外设族；其余需 CubeMX 规则引擎，见文档）。 */
export function setUart(doc, spec) {
  const inst = spec.instance
  if (!/^(USART|UART|LPUART)\d+$/.test(inst)) {
    throw new Error(`不支持的串口实例名: ${inst}（应形如 USART1 / UART4 / LPUART1）`)
  }
  const changes = []
  const put = (k, v) => {
    const isNew = setKey(doc, k, v)
    changes.push({ key: k, value: v, status: isNew ? 'added' : 'updated' })
  }

  put(`${inst}.VirtualMode`, 'VM_ASYNC')
  if (spec.baud != null) {
    if (!Number.isInteger(spec.baud) || spec.baud <= 0) throw new Error(`baud 非法: ${spec.baud}`)
    put(`${inst}.BaudRate`, String(spec.baud))
  }
  if (spec.wordLength != null) {
    const v = UART_WORD[spec.wordLength]
    if (!v) throw new Error(`wordLength 只支持 8 或 9，收到 ${spec.wordLength}`)
    put(`${inst}.WordLength`, v)
  }
  if (spec.parity != null) {
    const v = UART_PARITY[String(spec.parity).toLowerCase()]
    if (!v) throw new Error(`parity 只支持 none/even/odd，收到 ${spec.parity}`)
    put(`${inst}.Parity`, v)
  }
  if (spec.stopBits != null) {
    const v = UART_STOP[spec.stopBits]
    if (!v) throw new Error(`stopBits 只支持 1 / 1.5 / 2 / 0.5，收到 ${spec.stopBits}`)
    put(`${inst}.StopBits`, v)
  }

  const pins = []
  if (spec.txPin) { put(`${spec.txPin}.Signal`, `${inst}_TX`); put(`${spec.txPin}.Mode`, 'Asynchronous'); pins.push(spec.txPin) }
  if (spec.rxPin) { put(`${spec.rxPin}.Signal`, `${inst}_RX`); put(`${spec.rxPin}.Mode`, 'Asynchronous'); pins.push(spec.rxPin) }
  for (const p of pins) ensurePin(doc, p)
  const ip = ensurePeripheral(doc, inst)

  if (spec.enableIrq) put(`NVIC.${inst}_IRQn`, IRQ_VALUE)

  const sync = syncIpParameters(doc, inst)
  return { instance: inst, changes, pinsEnsured: pins, peripheralAdded: ip.added, ipParameters: sync }
}

const GPIO_PULL = { none: null, up: 'GPIO_PULLUP', down: 'GPIO_PULLDOWN' }
const GPIO_SPEED = { low: 'GPIO_SPEED_FREQ_LOW', medium: 'GPIO_SPEED_FREQ_MEDIUM', high: 'GPIO_SPEED_FREQ_HIGH', veryhigh: 'GPIO_SPEED_FREQ_VERY_HIGH' }
const GPIO_INITIAL = { high: 'GPIO_PIN_SET', low: 'GPIO_PIN_RESET' }

/**
 * 语义化配置一个 GPIO 引脚。
 * 注意：写任何 GPIOParameters 类型的键（GPIO_Label / GPIO_PuPd / GPIO_Speed / PinState）
 * 之后**必须**把它们登记进 `<pin>.GPIOParameters`，否则 CubeMX 静默丢弃（实测）。
 */
export function setGpio(doc, spec) {
  const pin = spec.pin
  if (!/^P[A-Z]\d+(-\S+)?$/.test(pin)) throw new Error(`引脚名可疑: ${pin}（应形如 PA1 / PC13-TAMPER-RTC）`)
  const mode = spec.mode
  if (mode !== 'output' && mode !== 'input') throw new Error(`mode 只支持 output / input，收到 ${mode}`)
  const changes = []
  const put = (k, v) => {
    const isNew = setKey(doc, k, v)
    changes.push({ key: k, value: v, status: isNew ? 'added' : 'updated' })
  }

  put(`${pin}.Signal`, mode === 'output' ? 'GPIO_Output' : 'GPIO_Input')
  if (spec.label) put(`${pin}.GPIO_Label`, spec.label)

  if (mode === 'input') {
    if (spec.pull != null) {
      const key = String(spec.pull).toLowerCase()
      const v = GPIO_PULL[key]
      if (v) put(`${pin}.GPIO_PuPd`, v)
      else if (key !== 'none') throw new Error(`pull 只支持 none/up/down，收到 ${spec.pull}`)
    }
  } else if (spec.initialLevel != null) {
    const key = String(spec.initialLevel).toLowerCase()
    const v = GPIO_INITIAL[key]
    if (!v) throw new Error(`initialLevel 只支持 high/low，收到 ${spec.initialLevel}`)
    put(`${pin}.PinState`, v)
  }

  if (spec.speed != null) {
    const key = String(spec.speed).toLowerCase().replace(/[_-]/g, '')
    const v = GPIO_SPEED[key]
    if (!v) throw new Error(`speed 只支持 low/medium/high/veryHigh，收到 ${spec.speed}`)
    put(`${pin}.GPIO_Speed`, v)
  }

  const added = ensurePin(doc, pin)
  // 关键：登记 GPIOParameters，否则上面写的键会被 CubeMX 静默丢弃
  const params = syncPinParameters(doc, pin)
  return { pin, changes, pinAdded: added.added, gpioParameters: params }
}

/** 结构化摘要 + 一致性校验（只读，供 model 理解现状）。 */
export function summarize(doc) {
  const map = toMap(doc)
  const ips = readNumbered(doc, 'Mcu.IP')
  const pins = readNumbered(doc, 'Mcu.Pin')
  const declaredIpsN = Number(map.get('Mcu.IPNb'))
  const declaredPinsN = Number(map.get('Mcu.PinsNb'))

  // 非外设前缀：MCU 元信息、工程设置、UI 状态、伪 IP（GPIO 的 groupedBy 是 UI 开关，NVIC 单独处理）
  const NON_PERIPHERAL = new Set([
    'Mcu', 'MxCube', 'MxDb', 'PinOutPanel', 'File', 'GPIO', 'PCC', 'CAD', 'SH', 'board', 'ProjectManager', 'NVIC',
  ])

  const peripherals = {}
  const pinInfo = {}
  for (const [k, v] of map) {
    const dot = k.indexOf('.')
    if (dot < 0) continue
    const prefix = k.slice(0, dot)
    const name = k.slice(dot + 1)
    if (/^P[A-Z]\d+/.test(prefix) || prefix.startsWith('VP_')) { pinInfo[prefix] ??= {}; pinInfo[prefix][name] = v; continue }
    if (NON_PERIPHERAL.has(prefix)) continue
    peripherals[prefix] ??= { parameters: {}, ipParameters: null }
    if (name === 'IPParameters') peripherals[prefix].ipParameters = v.split(',').map((s) => s.trim()).filter(Boolean)
    else peripherals[prefix].parameters[name] = v
  }

  const warnings = []
  if (Number.isFinite(declaredIpsN) && declaredIpsN !== ips.length) {
    warnings.push(`Mcu.IPNb=${declaredIpsN} 与实际 Mcu.IP* 条目数 ${ips.length} 不一致`)
  }
  if (Number.isFinite(declaredPinsN) && declaredPinsN !== pins.length) {
    warnings.push(`Mcu.PinsNb=${declaredPinsN} 与实际 Mcu.Pin* 条目数 ${pins.length} 不一致`)
  }
  const gap = (arr) => arr.findIndex((x, i) => x.n !== i)
  const ipGap = gap(ips)
  if (ipGap >= 0) warnings.push(`Mcu.IP* 编号不连续（位置 ${ipGap} 处为 Mcu.IP${ips[ipGap].n}）`)
  const pinGap = gap(pins)
  if (pinGap >= 0) warnings.push(`Mcu.Pin* 编号不连续（位置 ${pinGap} 处为 Mcu.Pin${pins[pinGap].n}）`)

  // 核心检查：参数键存在但未登记进 IPParameters ⇒ CubeMX 会静默忽略
  // 比对前必须把键名归一化：.ioc 键里的转义空格（`Channel-PWM\ Generation1\ CH1`）
  // 在 IPParameters 列表里是不转义形式，直接比会误报。
  for (const [name, per] of Object.entries(peripherals)) {
    if (!per.ipParameters) continue
    const norm = (s) => s.replace(/\\ /g, ' ')
    const paramNames = new Set()
    for (const p of Object.keys(per.parameters)) { paramNames.add(p); paramNames.add(norm(p)) }
    const declaredNorm = new Set(per.ipParameters.map(norm))

    const orphan = Object.keys(per.parameters).filter((p) => !declaredNorm.has(norm(p)))
    if (orphan.length) warnings.push(`${name}: 参数 ${orphan.join(', ')} 未登记在 ${name}.IPParameters 中 → CubeMX 将静默忽略`)
    const dangling = per.ipParameters.filter((d) => !paramNames.has(d) && !paramNames.has(norm(d)))
    if (dangling.length) warnings.push(`${name}.IPParameters 声明了不存在的键: ${dangling.join(', ')}`)
  }

  // 引脚级同款检查：<Pin>.GPIOParameters 未登记的参数键 ⇒ CubeMX 静默丢弃
  // （实测：只写 PA1.GPIO_Label=LED1 而不登记 GPIOParameters，重新生成后标签消失、main.h 无 LED1_Pin 宏）
  const PIN_STRUCTURAL = new Set(['Signal', 'Mode', 'Locked', 'GPIOParameters'])
  for (const [pin, info] of Object.entries(pinInfo)) {
    const declared = new Set((info.GPIOParameters ?? '').split(',').map((s) => s.trim()).filter(Boolean))
    const paramNames = Object.keys(info).filter((k) => !PIN_STRUCTURAL.has(k))
    if (paramNames.length === 0) continue
    const orphan = paramNames.filter((p) => !declared.has(p))
    if (orphan.length) warnings.push(`${pin}: 参数 ${orphan.join(', ')} 未登记在 ${pin}.GPIOParameters 中 → CubeMX 将静默丢弃`)
    const dangling = [...declared].filter((d) => !paramNames.includes(d))
    if (dangling.length) warnings.push(`${pin}.GPIOParameters 声明了不存在的键: ${dangling.join(', ')}`)
  }

  // 兼容旧名（供外部调用方读取）
  const unregisteredPins = Object.keys(pinInfo).filter((p) => !pins.some((x) => x.value === p) && p.startsWith('P'))
  if (unregisteredPins.length) warnings.push(`引脚 ${unregisteredPins.join(', ')} 有配置但未登记进 Mcu.Pin*`)

  if (map.get('ProjectManager.KeepUserCode') !== 'true') {
    warnings.push('ProjectManager.KeepUserCode 不是 true —— 重新生成会丢失 USER CODE 区内容')
  }

  return {
    mcu: {
      name: map.get('Mcu.Name') ?? null,
      cpn: map.get('Mcu.CPN') ?? null,
      package: map.get('Mcu.Package') ?? null,
      family: map.get('Mcu.Family') ?? null,
      userName: map.get('Mcu.UserName') ?? null,
    },
    cubeMxVersion: map.get('MxCube.Version') ?? null,
    dbVersion: map.get('MxDb.Version') ?? null,
    enabledPeripherals: ips.map((x) => x.value),
    allocatedPins: pins.map((x) => x.value),
    peripherals,
    pins: pinInfo,
    project: {
      name: map.get('ProjectManager.ProjectName') ?? null,
      targetToolchain: map.get('ProjectManager.TargetToolchain') ?? null,
      firmwarePackage: map.get('ProjectManager.FirmwarePackage') ?? null,
      keepUserCode: map.get('ProjectManager.KeepUserCode') ?? null,
      deviceId: map.get('ProjectManager.DeviceId') ?? null,
    },
    warnings,
  }
}
