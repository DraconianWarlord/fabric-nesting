import { describe, it, expect } from 'vitest'
import {
  autoNestPanels,
  autoNestCandidates,
  irregularCutFromFinished,
  type Panel,
} from './geometry'

function irreg(id: string): Panel {
  const cut = irregularCutFromFinished(12, 20, 14, 18, 22, 0.5)!
  return {
    id,
    label: id,
    kind: 'irregular',
    width: cut.width,
    length: cut.length,
    sideLeft: cut.sideLeft,
    sideFront: cut.sideFront,
    sideRight: cut.sideRight,
    sideBack: cut.sideBack,
    diagonal: cut.diagonal,
    x: 0,
    y: 0,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#000',
  }
}

describe('irregular nest performance', () => {
  it('auto-nests 8 irregulars without hanging', () => {
    const panels = Array.from({ length: 8 }, (_, i) => irreg(`p${i}`))
    const t0 = Date.now()
    const out = autoNestPanels(panels, 54, 0.25)
    const ms = Date.now() - t0
    expect(out).toHaveLength(8)
    expect(ms).toBeLessThan(4000)
  })

  it('autoNestCandidates for 6 irregulars stays responsive', () => {
    const panels = Array.from({ length: 6 }, (_, i) => irreg(`q${i}`))
    const t0 = Date.now()
    const cands = autoNestCandidates(panels, 54, 0.25)
    const ms = Date.now() - t0
    expect(cands.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(5000)
  })
})
