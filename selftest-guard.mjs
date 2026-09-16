// stm32_guard 逻辑自测：三种关键情形必须判对
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as guard from './lib/guard.js'

const ROOT = 'D:\\dsh-myplugin\\sandbox\\guard-test'
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, 'Core', 'Src'), { recursive: true })
mkdirSync(join(ROOT, 'Core', 'Inc'), { recursive: true })

const MAIN = join(ROOT, 'Core', 'Src', 'main.c')
const BASE = `#include "main.h"

int main(void)
{
  HAL_Init();
  /* USER CODE BEGIN 2 */

  /* USER CODE END 2 */
  while (1)
  {
    /* USER CODE BEGIN 3 */

    /* USER CODE END 3 */
  }
}
`
const write = (t) => writeFileSync(MAIN, t, 'utf8')
write(BASE)
guard.writeSnapshot(ROOT)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

// ── 情形 A：只在 USER CODE 区内加代码 → 必须判 safe（这是最容易误报的一例）
write(BASE.replace('  /* USER CODE BEGIN 2 */\n', '  /* USER CODE BEGIN 2 */\n  uint8_t a = 1;\n  uint8_t b = 2;\n'))
let r = guard.diffAgainstSnapshot(ROOT)
check('A 区内新增两行 → 判 safe', r.verdict === 'safe', JSON.stringify(r.atRiskFiles))
check('A 且不改动报告非空', r.changed.some((c) => c.risk === 'user-code-only'), JSON.stringify(r.changed.map((c) => c.risk)))

// ── 情形 B：只在 USER CODE 区外加代码 → 必须判 will-be-wiped
write(BASE)
guard.writeSnapshot(ROOT)
write(BASE.replace('  HAL_Init();\n', '  HAL_Init();\n  int outside = 42;\n'))
r = guard.diffAgainstSnapshot(ROOT)
check('B 区外新增一行 → 判 will-be-wiped', r.verdict === 'will-be-wiped', r.verdict)
const hunk = r.changed.find((c) => c.risk === 'outside-user-code')?.hunks?.[0]
check('B 定位到真实行号 6', hunk?.added?.[0]?.line === 6, JSON.stringify(hunk))
check('B 命中文本正确', hunk?.added?.[0]?.text === '  int outside = 42;', JSON.stringify(hunk?.added))

// ── 情形 C：新增自建模块文件（CubeMX 不管辖）→ 不应算风险
write(BASE)
guard.writeSnapshot(ROOT)
mkdirSync(join(ROOT, 'App'), { recursive: true })
writeFileSync(join(ROOT, 'App', 'app.c'), 'void app_init(void) {}\n', 'utf8')
writeFileSync(join(ROOT, 'Core', 'Src', 'app_extra.c'), '/* USER CODE BEGIN 0 */\n/* USER CODE END 0 */\n', 'utf8')
r = guard.diffAgainstSnapshot(ROOT)
const appEntry = r.changed.find((c) => c.file.includes('app.c') && c.file.startsWith('App'))
check('C App/app.c 判为 new-file（安全）', appEntry?.risk === 'new-file', JSON.stringify(appEntry))
const coreNew = r.changed.find((c) => c.file.includes('app_extra.c'))
check('C Core/ 下新增文件算风险', coreNew?.risk === 'outside-user-code', JSON.stringify(coreNew))

// ── 情形 D：区内外同时改 → 必须报区外那处，而不是因为"有改动"就一律报警
write(BASE)
guard.writeSnapshot(ROOT)
write(BASE
  .replace('  /* USER CODE BEGIN 2 */\n', '  /* USER CODE BEGIN 2 */\n  uint8_t ok = 1;\n')
  .replace('  HAL_Init();\n', '  HAL_Init();\n  int bad = 2;\n'))
r = guard.diffAgainstSnapshot(ROOT)
const d = r.changed.find((c) => c.file.endsWith('main.c'))
check('D 区内外同改 → will-be-wiped', r.verdict === 'will-be-wiped', r.verdict)
check('D 只报区外那一行', d?.hunks?.length === 1 && d.hunks[0].added[0].text.includes('bad'), JSON.stringify(d?.hunks))

// ── 情形 E：无快照时给出可操作的指引而不是崩
rmSync(join(ROOT, '.dsh-stm32'), { recursive: true, force: true })
r = guard.diffAgainstSnapshot(ROOT)
check('E 无快照 → 明确报错并给顺序指引', r.ok === false && /snapshot/.test(r.error ?? ''), JSON.stringify(r))

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`)
rmSync(ROOT, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
