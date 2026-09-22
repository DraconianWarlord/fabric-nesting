import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = dirname(fileURLToPath(import.meta.url))
const appTsx = readFileSync(resolve(srcDir, 'App.tsx'), 'utf8')
const appCss = readFileSync(resolve(srcDir, 'App.css'), 'utf8')
const calcNav = readFileSync(resolve(srcDir, 'CalculatorNav.tsx'), 'utf8')

describe('layout regressions', () => {
  it('does not render the estimate disclaimer bar', () => {
    expect(appTsx).not.toMatch(/className="disclaimer"/)
    expect(appTsx).not.toMatch(/Estimate only\. Double-check/)
  })

  it('does not render the shop strip bar', () => {
    expect(appTsx).not.toMatch(/className="shop-strip"/)
    expect(appTsx).not.toMatch(/Ready to order about/)
    expect(appTsx).not.toMatch(/Foam & cushion supplies/)
  })

  it('keeps Auto-Nest spaced below Add to bolt (beats button.auto-nest reset)', () => {
    expect(appCss).toMatch(/button\.add-panel-auto-nest\s*\{[^}]*margin-top:\s*1\.25rem/)
    expect(appTsx).toMatch(/add-panel-auto-nest/)
  })

  it('stacks mobile header status onto its own row so chrome does not overlap', () => {
    const mobile = appCss.match(/@media \(max-width: 800px\)\s*\{[\s\S]*?\n\}(?=\s*\/\*|\s*@media|\s*$)/)
    expect(mobile, 'missing 800px media query').toBeTruthy()
    const block = mobile![0]
    expect(block).toMatch(/\.app-header-bar\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(block).toMatch(/\.app-header-status\s*\{[^}]*flex:\s*1\s+1\s+100%/)
    expect(block).toMatch(/\.calc-switch\s*\{\s*display:\s*none/)
    expect(block).toMatch(/\.current-tool\s*\{[^}]*display:\s*inline-flex/)
  })

  it('header + calc nav classNames used in TSX have CSS rules', () => {
    const classes = new Set<string>()
    for (const src of [appTsx, calcNav]) {
      for (const m of src.matchAll(/className="([^"]+)"/g)) {
        for (const c of m[1].split(/\s+/)) classes.add(c)
      }
    }
    const required = [
      'app-header',
      'app-header-bar',
      'app-header-identity',
      'app-header-status',
      'brand-logo',
      'current-tool',
      'calc-switch',
      'calc-more-mobile',
      'export-pdf',
      'add-panel-auto-nest',
    ]
    for (const c of required) {
      expect(classes.has(c), `tsx missing class ${c}`).toBe(true)
      expect(appCss).toMatch(new RegExp(`\\.${c.replace(/-/g, '\\-')}\\b`))
    }
  })

  it('disabled primary/Auto-Nest uses opaque muted colors (not opacity wash)', () => {
    expect(appCss).toMatch(/button\.primary:disabled[\s\S]*?color:\s*#333333/)
    expect(appCss).not.toMatch(/button:disabled\s*\{\s*opacity:\s*0\.5/)
  })

  it('mobile bolt canvas kills accidental horizontal scroll', () => {
    const mobile = appCss.match(/@media \(max-width: 800px\)\s*\{[\s\S]*?\n\}(?=\s*\/\*|\s*@media|\s*$)/)
    expect(mobile, 'missing 800px media query').toBeTruthy()
    expect(mobile![0]).toMatch(/\.canvas-wrap\s*\{[^}]*overflow-x:\s*hidden/)
  })

})