import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(resolve(srcDir, 'App.tsx'), 'utf8')

describe('Export PDF wiring', () => {
  it('statically imports exportNestingPdf (no post-click dynamic import)', () => {
    expect(app).toMatch(/import\s*\{\s*exportNestingPdf\s*\}\s*from\s*'\.\/lib\/exportPdf'/)
    expect(app).not.toMatch(/import\(\s*['"]\.\/lib\/exportPdf['"]\s*\)/)
  })

  it('surfaces export failures to the user via setActionHint', () => {
    expect(app).toMatch(/Export PDF failed/)
    expect(app).toMatch(/setActionHint/)
  })
})
