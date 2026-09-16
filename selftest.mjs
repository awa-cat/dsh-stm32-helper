// .ioc 纯逻辑自测：拿真实工程当输入
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import * as ioc from './lib/ioc.js'

const SRC = 'D:\\STM32_Workspace\\DCMotor_test\\DCMotor_test.ioc'
const OUT = 'D:\\dsh-myplugin\\sandbox\\ioc-test'
mkdirSync(OUT, { recursive: true })

const text = readFileSync(SRC, 'utf8')
const doc = ioc.parseIoc(text)

const before = ioc.summarize(doc)
console.log('=== 摘要（原始工程） ===')
console.log('mcu:', JSON.stringify(before.mcu))
console.log('enabledPeripherals:', before.enabledPeripherals.join(', '))
console.log('allocatedPins:', before.allocatedPins.join(', '))
console.log('peripherals:', Object.keys(before.peripherals).join(', '))
console.log('USART1 params:', JSON.stringify(before.peripherals.USART1))
console.log('warnings:', before.warnings.length ? before.warnings : '(none)')

console.log('\n=== 语义化设串口：USART1 115200 8N1 + 开中断 ===')
const r = ioc.setUart(doc, { instance: 'USART1', baud: 115200, wordLength: 8, parity: 'none', stopBits: 1, enableIrq: true })
console.log('changes:', r.changes.map((c) => `${c.key}=${c.value}(${c.status})`).join('\n         '))
console.log('ipParameters.added:', r.ipParameters.added)
console.log('ipParameters.written:', r.ipParameters.written.join(','))

console.log('\n=== 语义化设 GPIO：PA1 输出 标签 LED1 ===')
const g = ioc.setGpio(doc, { pin: 'PA1', mode: 'output', label: 'LED1' })
console.log('changes:', g.changes.map((c) => `${c.key}=${c.value}(${c.status})`).join(', '), '| pinAdded:', g.pinAdded)

const outFile = `${OUT}\\DCMotor_test.uart.ioc`
writeFileSync(outFile, ioc.serializeIoc(doc), 'utf8')

console.log('\n=== 回读校验（重新解析写出的文件） ===')
const back = ioc.parseIoc(readFileSync(outFile, 'utf8'))
const sum = ioc.summarize(back)
const checks = [
  ['USART1.BaudRate', ioc.getKey(back, 'USART1.BaudRate')],
  ['USART1.IPParameters', ioc.getKey(back, 'USART1.IPParameters')],
  ['NVIC.USART1_IRQn', ioc.getKey(back, 'NVIC.USART1_IRQn')],
  ['PA1.GPIO_Label', ioc.getKey(back, 'PA1.GPIO_Label')],
  ['Mcu.IPNb', ioc.getKey(back, 'Mcu.IPNb')],
  ['Mcu.IP6', ioc.getKey(back, 'Mcu.IP6')],
  ['Mcu.PinsNb', ioc.getKey(back, 'Mcu.PinsNb')],
]
for (const [k, v] of checks) console.log(`  ${k} = ${v}`)
console.log('warnings after edit:', sum.warnings.length ? sum.warnings : '(none)')

// 关键断言：BaudRate 必须登记进 IPParameters，否则 CubeMX 静默忽略
const ipList = (ioc.getKey(back, 'USART1.IPParameters') ?? '').split(',')
const ok = ipList.includes('BaudRate') && ipList.includes('Parity') && ipList.includes('StopBits') && ipList.includes('WordLength')
console.log('\n断言 IPParameters 已同步:', ok ? 'PASS' : 'FAIL')
console.log('断言 Mcu.IPNb 自洽:', Number(ioc.getKey(back, 'Mcu.IPNb')) === ioc.readNumbered(back, 'Mcu.IP').length ? 'PASS' : 'FAIL')
console.log('断言 Mcu.PinsNb 自洽:', Number(ioc.getKey(back, 'Mcu.PinsNb')) === ioc.readNumbered(back, 'Mcu.Pin').length ? 'PASS' : 'FAIL')
console.log('\n输出:', outFile)
