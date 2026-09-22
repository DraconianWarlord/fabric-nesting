/**
 * Geometry is unit-tested via vitest — run `npm test` (or `npm run test:watch`).
 * See also src/lib/README.md.
 */
import { describe, expect, it } from 'vitest'
import {
  PANEL_COLORS,
  aabbOverlap,
  applyNestLayoutById,
  autoNestCandidates,
  autoNestPanels,
  canPlace,
  cutSize,
  exactYards,
  findBestSpotOnPattern,
  findOpenSpot,
  isGenericLabel,
  nextSequentialLabel,
  offBolt,
  orderYards,
  overlapsAny,
  panelBounds,
  panelFootprint,
  hasHRepeat,
  hasVRepeat,
  patternCellCenters,
  patternEnabled,
  patternHOffset,
  rotate90,
  snapCenterToPattern,
  suggestSplit,
  tryRotate90,
  usedLengthInches,
  type Panel,
} from './geometry'

function p(partial: Partial<Panel> & Pick<Panel, 'id' | 'width' | 'length' | 'x' | 'y'>): Panel {
  return {
    label: partial.label ?? partial.id,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#000',
    ...partial,
  }
}

describe('footprint + rotate', () => {
  it('swaps sides at 90°', () => {
    const panel = p({ id: 'a', width: 20, length: 24, x: 0, y: 0 })
    expect(panelFootprint(panel)).toEqual({ w: 20, h: 24 })
    expect(panelFootprint(rotate90(panel))).toEqual({ w: 24, h: 20 })
  })

  it('panelFootprint rotate 180 keeps dims; 270 swaps like 90', () => {
    const panel = p({ id: 'a', width: 10, length: 30, x: 0, y: 0, rotation: 180 })
    expect(panelFootprint(panel)).toEqual({ w: 10, h: 30 })
    expect(panelFootprint({ ...panel, rotation: 270 })).toEqual({ w: 30, h: 10 })
  })
})

describe('yardage', () => {
  it('three 20×24 — third wraps; order full yards', () => {
    const panels = [
      p({ id: '1', width: 20, length: 24, x: 0, y: 0 }),
      p({ id: '2', width: 20, length: 24, x: 20.25, y: 0 }),
      p({ id: '3', width: 20, length: 24, x: 0, y: 24.25 }),
    ]
    const used = usedLengthInches(panels)
    expect(used).toBeCloseTo(48.25, 5)
    // exact ≈ 1.34 → ceil to 2 full yards
    expect(orderYards(exactYards(used))).toBe(2)
  })

  it('two 20×24 one row → exact 0.67 → order 1', () => {
    const panels = [
      p({ id: '1', width: 20, length: 24, x: 0, y: 0 }),
      p({ id: '2', width: 20, length: 24, x: 20, y: 0 }),
    ]
    expect(usedLengthInches(panels)).toBe(24)
    expect(orderYards(exactYards(24))).toBe(1)
  })

  it('orderYards steps to whole yards', () => {
    expect(orderYards(1.01)).toBe(2)
    expect(orderYards(2.0)).toBe(2)
    expect(orderYards(0)).toBe(0)
    expect(orderYards(0.01)).toBe(1)
  })

  it('waste', () => {
    expect(exactYards(36, 10)).toBeCloseTo(1.1, 5)
  })

  it('usedLengthInches is max bottom edge', () => {
    const panels = [
      p({ id: 'a', width: 10, length: 10, x: 0, y: 0 }),
      p({ id: 'b', width: 10, length: 20, x: 10, y: 5 }),
    ]
    expect(usedLengthInches(panels)).toBe(25)
    expect(usedLengthInches([])).toBe(0)
  })
})

describe('collision', () => {
  it('overlap', () => {
    expect(
      aabbOverlap(
        panelBounds(p({ id: 'a', width: 10, length: 10, x: 0, y: 0 })),
        panelBounds(p({ id: 'b', width: 10, length: 10, x: 5, y: 5 })),
      ),
    ).toBe(true)
  })
  it('touching ok', () => {
    expect(
      aabbOverlap(
        panelBounds(p({ id: 'a', width: 10, length: 10, x: 0, y: 0 })),
        panelBounds(p({ id: 'b', width: 10, length: 10, x: 10, y: 0 })),
      ),
    ).toBe(false)
  })
  it('off bolt', () => {
    expect(offBolt(p({ id: 'a', width: 20, length: 10, x: 40, y: 0 }), 54)).toBe(true)
  })
  it('canPlace rejects overlap and off-bolt', () => {
    const a = p({ id: 'a', width: 20, length: 20, x: 0, y: 0 })
    const b = p({ id: 'b', width: 20, length: 20, x: 5, y: 5 })
    expect(canPlace(b, [a], 54)).toBe(false)
    const ok = p({ id: 'c', width: 20, length: 20, x: 20, y: 0 })
    expect(canPlace(ok, [a], 54)).toBe(true)
    const off = p({ id: 'd', width: 20, length: 20, x: 40, y: 0 })
    expect(canPlace(off, [a], 54)).toBe(false)
  })
})

describe('cutSize', () => {
  it('adds 2×seam allowance per dimension', () => {
    expect(cutSize(20, 0.5)).toBe(21)
    expect(cutSize(24, 0.5)).toBe(25)
    expect(cutSize(20, 0)).toBe(20)
  })
})

describe('findOpenSpot', () => {
  it('never overlaps when adding 3 identical 20×24 on 54" bolt', () => {
    const fabricWidth = 54
    const placed: Panel[] = []
    for (let i = 0; i < 3; i++) {
      const spot = findOpenSpot(20, 24, fabricWidth, placed)
      const panel = p({ id: `p${i}`, width: 20, length: 24, x: spot.x, y: spot.y })
      expect(overlapsAny(panel, placed)).toBe(false)
      expect(offBolt(panel, fabricWidth)).toBe(false)
      placed.push(panel)
    }
    expect(placed).toHaveLength(3)
    // Two fit across (20+0.25+20=40.25 ≤ 54); third wraps
    expect(placed[0]).toMatchObject({ x: 0, y: 0 })
    expect(placed[1].x).toBeCloseTo(20.25, 5)
    expect(placed[1].y).toBeCloseTo(0, 5)
    expect(placed[2].y).toBeGreaterThan(0)
  })
})

describe('pattern', () => {
  it('patternEnabled when at least one repeat > 0 (stripe modes)', () => {
    expect(patternEnabled(12, 12)).toBe(true)
    expect(patternEnabled(0, 12)).toBe(true) // horizontal stripes
    expect(patternEnabled(12, 0)).toBe(true) // vertical stripes
    expect(patternEnabled(0, 0)).toBe(false)
    expect(hasHRepeat(12)).toBe(true)
    expect(hasHRepeat(0)).toBe(false)
    expect(hasVRepeat(12)).toBe(true)
    expect(hasVRepeat(0)).toBe(false)
  })

  it('patternHOffset centers leftover width', () => {
    // 54 % 10 = 4 → /2 = 2
    expect(patternHOffset(54, 10)).toBe(2)
    expect(patternHOffset(54, 12)).toBe(3) // 54%12=6 → 3
    expect(patternHOffset(54, 18)).toBe(0) // exact fit
  })

  it('patternCellCenters use hOffset; vertical top-origin', () => {
    // h=10 on 54 → hOffset=2; first cx = 2+5=7; first cy = v/2
    const centers = patternCellCenters(10, 18, 54, 36)
    expect(centers[0].cx).toBeCloseTo(7, 5)
    expect(centers[0].cy).toBeCloseTo(9, 5) // v/2 top-origin
    expect(centers.some((c) => Math.abs(c.cx - 7) < 1e-9 && Math.abs(c.cy - 9) < 1e-9)).toBe(
      true,
    )
    expect(centers.some((c) => Math.abs(c.cx - 17) < 1e-9 && Math.abs(c.cy - 9) < 1e-9)).toBe(
      true,
    )

    // h=12 on 54 → hOffset=3; first cx = 3+6=9
    const offset12 = patternCellCenters(12, 18, 54, 36)
    expect(patternHOffset(54, 12)).toBe(3)
    expect(offset12[0].cx).toBeCloseTo(9, 5)
    expect(offset12[0].cy).toBeCloseTo(9, 5)

    // Exact horizontal fit: hOffset=0, first cx = h/2
    const exact = patternCellCenters(18, 18, 54, 36)
    expect(patternHOffset(54, 18)).toBe(0)
    expect(exact[0].cx).toBeCloseTo(9, 5)
    expect(exact[0].cy).toBeCloseTo(9, 5)
  })

  it('patternCellCenters vertical stripes (H only) return X stripe centers', () => {
    const centers = patternCellCenters(12, 0, 54, 36)
    expect(centers.length).toBeGreaterThan(0)
    const hOff = patternHOffset(54, 12)
    expect(centers[0].cx).toBeCloseTo(hOff + 6, 5)
    expect(centers[0].cy).toBe(0)
    // All centers share unconstrained cy placeholder; distinct stripe xs
    const cxs = new Set(centers.map((c) => Math.round(c.cx * 1000) / 1000))
    expect(cxs.size).toBe(centers.length)
  })

  it('patternCellCenters horizontal stripes (V only) return Y stripe centers', () => {
    const centers = patternCellCenters(0, 18, 54, 36)
    expect(centers.length).toBeGreaterThan(0)
    expect(centers[0].cy).toBeCloseTo(9, 5)
    expect(centers[0].cx).toBeCloseTo(27, 5) // fabricWidth/2
  })

  it('snapCenterToPattern moves panel center onto a cell center', () => {
    const panel = p({ id: 'a', width: 10, length: 10, x: 1, y: 2 })
    // hOffset(54,12)=3; nearest to center (6,7) → (9,6)
    const { x, y } = snapCenterToPattern(panel, 12, 12, 54)
    const cx = x + 5
    const cy = y + 5
    expect(cx).toBeCloseTo(9, 5)
    expect(cy).toBeCloseTo(6, 5)
  })

  it('snapCenterToPattern vertical stripes snaps X only', () => {
    const panel = p({ id: 'a', width: 10, length: 10, x: 1, y: 7 })
    const { x, y } = snapCenterToPattern(panel, 12, 0, 54)
    const cx = x + 5
    expect(cx).toBeCloseTo(9, 5) // hOffset 3 + 6
    expect(y).toBeCloseTo(7, 5) // Y unchanged
  })

  it('snapCenterToPattern horizontal stripes snaps Y only', () => {
    const panel = p({ id: 'a', width: 10, length: 10, x: 4, y: 2 })
    const { x, y } = snapCenterToPattern(panel, 0, 12, 54)
    const cy = y + 5
    expect(x).toBeCloseTo(4, 5) // X unchanged
    expect(cy).toBeCloseTo(6, 5) // nearest (j+0.5)*12
  })

  it('findBestSpotOnPattern places without overlap and centers on pattern', () => {
    const fabricWidth = 54
    const h = 18
    const v = 18
    const hOff = patternHOffset(fabricWidth, h)
    const placed: Panel[] = []
    for (let i = 0; i < 3; i++) {
      const spot = findBestSpotOnPattern(12, 12, fabricWidth, placed, h, v)
      const panel = p({ id: `p${i}`, width: 12, length: 12, x: spot.x, y: spot.y })
      expect(canPlace(panel, placed, fabricWidth)).toBe(true)
      const cx = spot.x + 6
      const cy = spot.y + 6
      // Center on offset horizontal grid + half-repeat vertical
      const fracH = ((cx - hOff) / h) % 1
      const fracV = (cy / v) % 1
      expect(Math.abs(fracH - 0.5)).toBeLessThan(1e-6)
      expect(Math.abs(fracV - 0.5)).toBeLessThan(1e-6)
      placed.push(panel)
    }
    expect(placed).toHaveLength(3)
  })

  it('findBestSpotOnPattern vertical stripes snaps X to H, free Y', () => {
    const fabricWidth = 54
    const h = 18
    const hOff = patternHOffset(fabricWidth, h)
    const placed: Panel[] = []
    for (let i = 0; i < 3; i++) {
      const spot = findBestSpotOnPattern(12, 12, fabricWidth, placed, h, 0)
      const panel = p({ id: `p${i}`, width: 12, length: 12, x: spot.x, y: spot.y })
      expect(canPlace(panel, placed, fabricWidth)).toBe(true)
      const cx = spot.x + 6
      const fracH = ((cx - hOff) / h) % 1
      expect(Math.abs(fracH - 0.5)).toBeLessThan(1e-6)
      placed.push(panel)
    }
    // First should sit at y=0 (free vertical)
    expect(placed[0].y).toBeCloseTo(0, 5)
  })

  it('findBestSpotOnPattern horizontal stripes snaps Y to V, free X', () => {
    const fabricWidth = 54
    const v = 18
    const placed: Panel[] = []
    for (let i = 0; i < 2; i++) {
      const spot = findBestSpotOnPattern(12, 12, fabricWidth, placed, 0, v)
      const panel = p({ id: `p${i}`, width: 12, length: 12, x: spot.x, y: spot.y })
      expect(canPlace(panel, placed, fabricWidth)).toBe(true)
      const cy = spot.y + 6
      const fracV = (cy / v) % 1
      expect(Math.abs(fracV - 0.5)).toBeLessThan(1e-6)
      placed.push(panel)
    }
    // Free X: first at x=0
    expect(placed[0].x).toBeCloseTo(0, 5)
  })
})

describe('nextSequentialLabel', () => {
  it('uses max numeric label + 1; ignores non-numeric', () => {
    expect(nextSequentialLabel([])).toBe('1')
    expect(nextSequentialLabel([{ label: 'Panel' }, { label: 'Front' }])).toBe('1')
    expect(nextSequentialLabel([{ label: '3' }, { label: 'Front' }, { label: '7' }])).toBe('8')
    expect(nextSequentialLabel([{ label: '1' }, { label: '2' }])).toBe('3')
  })

  it('isGenericLabel treats blank and Panel as generic', () => {
    expect(isGenericLabel('')).toBe(true)
    expect(isGenericLabel('  ')).toBe(true)
    expect(isGenericLabel('Panel')).toBe(true)
    expect(isGenericLabel('panel')).toBe(true)
    expect(isGenericLabel('Front')).toBe(false)
    expect(isGenericLabel('1')).toBe(false)
    expect(isGenericLabel('Panel 2')).toBe(false)
  })
})

describe('panel color', () => {
  it('PANEL_COLORS has Sailrite palette entries and panel stores color', () => {
    expect(PANEL_COLORS.length).toBeGreaterThanOrEqual(5)
    expect(PANEL_COLORS[0]).toMatch(/^#[0-9a-fA-F]{6}$/)
    const panel = p({ id: 'c', width: 10, length: 10, x: 0, y: 0, color: PANEL_COLORS[2] })
    expect(panel.color).toBe(PANEL_COLORS[2])
    const recolored = { ...panel, color: '#ff00aa' }
    expect(recolored.color).toBe('#ff00aa')
  })
})

describe('autoNestPanels', () => {
  it('clears intentional overlaps', () => {
    const overlapping = [
      p({ id: 'a', width: 20, length: 24, x: 0, y: 0 }),
      p({ id: 'b', width: 20, length: 24, x: 5, y: 5 }),
      p({ id: 'c', width: 20, length: 24, x: 8, y: 8 }),
    ]
    expect(overlapsAny(overlapping[0], overlapping)).toBe(true)

    const nested = autoNestPanels(overlapping, 54)
    expect(nested).toHaveLength(3)
    for (const panel of nested) {
      expect(overlapsAny(panel, nested)).toBe(false)
      expect(offBolt(panel, 54)).toBe(false)
    }
    // Keep identity fields
    expect(nested.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('rotates a lone 10×40 on 54″ to rotation 90 (footprint 40×10)', () => {
    const nested = autoNestPanels([p({ id: 'tall', width: 10, length: 40, x: 0, y: 0 })], 54)
    expect(nested).toHaveLength(1)
    expect(nested[0].rotation).toBe(90)
    expect(panelFootprint(nested[0])).toEqual({ w: 40, h: 10 })
    expect(usedLengthInches(nested)).toBeCloseTo(10, 5)
  })

  it('rotates four 30×20 on 54″ so used length is under 70', () => {
    const panels = [
      p({ id: 'a', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'b', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'c', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'd', width: 30, length: 20, x: 0, y: 0 }),
    ]
    const nested = autoNestPanels(panels, 54)
    expect(nested).toHaveLength(4)
    for (const panel of nested) {
      expect(overlapsAny(panel, nested)).toBe(false)
      expect(offBolt(panel, 54)).toBe(false)
    }
    const used = usedLengthInches(nested)
    // Unrotated: one per row → ~80+; rotated 20×30 two-across → ~60+
    expect(used).toBeLessThan(70)
  })

  it('rotates 56×20 on 54″ to 90 (only orientation that fits)', () => {
    const nested = autoNestPanels([p({ id: 'wide', width: 56, length: 20, x: 0, y: 0 })], 54)
    expect(nested).toHaveLength(1)
    expect(nested[0].rotation).toBe(90)
    expect(panelFootprint(nested[0])).toEqual({ w: 20, h: 56 })
    expect(offBolt(nested[0], 54)).toBe(false)
  })
})

describe('autoNestPanels baseline + search', () => {
  it('never worsens a valid tight hand layout', () => {
    // Four 30×20 rotated to 20×30, two-across on 54″ → used ≈ 60.25
    const hand: Panel[] = [
      p({ id: 'a', width: 30, length: 20, x: 0, y: 0, rotation: 90 }),
      p({ id: 'b', width: 30, length: 20, x: 20.25, y: 0, rotation: 90 }),
      p({ id: 'c', width: 30, length: 20, x: 0, y: 30.25, rotation: 90 }),
      p({ id: 'd', width: 30, length: 20, x: 20.25, y: 30.25, rotation: 90 }),
    ]
    for (const panel of hand) {
      expect(overlapsAny(panel, hand)).toBe(false)
      expect(offBolt(panel, 54)).toBe(false)
    }
    const U = usedLengthInches(hand)
    expect(U).toBeCloseTo(60.25, 5)

    const nested = autoNestPanels(hand, 54)
    expect(usedLengthInches(nested)).toBeLessThanOrEqual(U + 1e-6)
    for (const panel of nested) {
      expect(overlapsAny(panel, nested)).toBe(false)
      expect(offBolt(panel, 54)).toBe(false)
    }
  })

  it('is deterministic for the same input', () => {
    const panels = [
      p({ id: 'a', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'b', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'c', width: 25, length: 18, x: 0, y: 0 }),
      p({ id: 'd', width: 22, length: 16, x: 0, y: 0 }),
      p({ id: 'e', width: 15, length: 40, x: 0, y: 0 }),
    ]
    const a = autoNestPanels(panels, 54)
    const b = autoNestPanels(panels, 54)
    expect(a).toEqual(b)
    expect(usedLengthInches(a)).toEqual(usedLengthInches(b))
  })
})

describe('autoNestCandidates', () => {
  it('returns ≥1 layout and short pack for four 30×20 on 54″', () => {
    const panels = [
      p({ id: 'a', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'b', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'c', width: 30, length: 20, x: 0, y: 0 }),
      p({ id: 'd', width: 30, length: 20, x: 0, y: 0 }),
    ]
    const cands = autoNestCandidates(panels, 54)
    expect(cands.length).toBeGreaterThanOrEqual(1)
    expect(cands.length).toBeLessThanOrEqual(12)
    const shortest = usedLengthInches(cands[0])
    expect(shortest).toBeLessThan(70)
    // Cycling indices yield distinct layouts when multiple exist
    if (cands.length > 1) {
      const key = (ps: Panel[]) =>
        [...ps]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((x) => `${x.id}:${x.x.toFixed(2)},${x.y.toFixed(2)},${x.rotation}`)
          .join('|')
      const keys = cands.map(key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('pattern-aware candidates length ≥1 and valid', () => {
    const panels = [
      p({ id: 'a', width: 12, length: 12, x: 0, y: 0 }),
      p({ id: 'b', width: 12, length: 12, x: 0, y: 0 }),
    ]
    const cands = autoNestCandidates(panels, 54, 0.25, 18, 18)
    expect(cands.length).toBeGreaterThanOrEqual(1)
    for (const layout of cands) {
      for (const panel of layout) {
        expect(canPlace(panel, layout, 54)).toBe(true)
      }
    }
  })
})

describe('applyNestLayoutById', () => {
  it('maps nest x/y/rotation by id and preserves entry order', () => {
    const original = [
      p({ id: 'first', width: 10, length: 10, x: 0, y: 0, label: 'A', rotation: 0 }),
      p({ id: 'second', width: 12, length: 12, x: 0, y: 0, label: 'B', rotation: 0 }),
      p({ id: 'third', width: 14, length: 14, x: 0, y: 0, label: 'C', rotation: 0 }),
    ]
    // Nested result in different order with new positions/rotations
    const nested = [
      p({ id: 'third', width: 14, length: 14, x: 5, y: 20, label: 'C', rotation: 90 }),
      p({ id: 'first', width: 10, length: 10, x: 1, y: 2, label: 'A', rotation: 0 }),
      p({ id: 'second', width: 12, length: 12, x: 3, y: 4, label: 'B', rotation: 90 }),
    ]
    const result = applyNestLayoutById(original, nested)
    expect(result.map((x) => x.id)).toEqual(['first', 'second', 'third'])
    expect(result[0]).toMatchObject({ id: 'first', x: 1, y: 2, rotation: 0, label: 'A' })
    expect(result[1]).toMatchObject({ id: 'second', x: 3, y: 4, rotation: 90, label: 'B' })
    expect(result[2]).toMatchObject({ id: 'third', x: 5, y: 20, rotation: 90, label: 'C' })
  })

  it('leaves unmatched panels unchanged', () => {
    const original = [
      p({ id: 'a', width: 10, length: 10, x: 0, y: 0 }),
      p({ id: 'b', width: 10, length: 10, x: 0, y: 0 }),
    ]
    const nested = [p({ id: 'a', width: 10, length: 10, x: 9, y: 8, rotation: 90 })]
    const result = applyNestLayoutById(original, nested)
    expect(result.map((x) => x.id)).toEqual(['a', 'b'])
    expect(result[0]).toMatchObject({ x: 9, y: 8, rotation: 90 })
    expect(result[1]).toMatchObject({ x: 0, y: 0, rotation: 0 })
  })
})

describe('suggestSplit', () => {
  it('returns null when at least one orientation fits', () => {
    expect(suggestSplit(20, 24, 54, 0.5)).toBeNull()
    expect(suggestSplit(56, 20, 54, 0)).toBeNull() // 90° fits (w=20)
    expect(suggestSplit(20, 56, 54, 0)).toBeNull() // 0° fits (w=20)
  })

  it('splits the longer excess side: 61×163 on 54″ → 4 strips of ~40.75', () => {
    // ceil(163/54)=4 so each strip cut ≤ fabric width (3×54.333 would still exceed 54)
    const s = suggestSplit(61, 163, 54, 0)
    expect(s).not.toBeNull()
    expect(s!.splitDim).toBe('length')
    expect(s!.pieceCount).toBe(4)
    expect(s!.pieceCutApprox).toBeCloseTo(163 / 4, 5)
    expect(s!.pieceCutApprox).toBeLessThanOrEqual(54)
    expect(s!.otherCut).toBe(61)
    expect(s!.pieceFinishedW).toBeCloseTo(61, 5)
    expect(s!.pieceFinishedL).toBeCloseTo(163 / 4, 5)
  })

  it('accounts for seam allowance in finished piece sizes', () => {
    // cut 62×164 with SA 0.5 → finished 61×163; split length into 3
    const s = suggestSplit(62, 164, 54, 0.5)
    expect(s).not.toBeNull()
    expect(s!.splitDim).toBe('length')
    expect(s!.pieceCount).toBe(Math.ceil(164 / 54))
    expect(s!.pieceFinishedW).toBeCloseTo(61, 5)
    expect(s!.pieceFinishedL).toBeCloseTo(163 / s!.pieceCount, 5)
  })

  it('prefers splitting width when width is the longer side', () => {
    const s = suggestSplit(163, 61, 54, 0)
    expect(s).not.toBeNull()
    expect(s!.splitDim).toBe('width')
    expect(s!.pieceCount).toBe(4)
    expect(s!.pieceCutApprox).toBeCloseTo(163 / 4, 5)
  })
})

describe('tryRotate90', () => {
  it('rejects rotate when only 0° fits (keeps caller responsible for prior pose)', () => {
    // 40×20 on 54″: at 0° footprint 40×20 fits; at 90° footprint 20×40 fits too.
    // Use 50×10: 0° → 50×10 fits; 90° → 10×50 fits.
    // Use cut that only fits at 0°: width 40, length 60 on 54″.
    // 0°: fp 40×60 fits; 90°: fp 60×40 — 60 > 54, reject.
    const panel = p({ id: 'only0', width: 40, length: 60, x: 0, y: 0, rotation: 0 })
    expect(panelFootprint(panel).w).toBeLessThanOrEqual(54)
    expect(panelFootprint(rotate90(panel)).w).toBeGreaterThan(54)
    expect(tryRotate90(panel, [], 54)).toBeNull()
  })

  it('applies rotate when new footprint fits and can place', () => {
    const panel = p({ id: 'a', width: 20, length: 24, x: 0, y: 0, rotation: 0 })
    const next = tryRotate90(panel, [], 54)
    expect(next).not.toBeNull()
    expect(next!.rotation).toBe(90)
    expect(panelFootprint(next!)).toEqual({ w: 24, h: 20 })
    expect(offBolt(next!, 54)).toBe(false)
  })

  it('re-spots when rotate at current xy would overlap', () => {
    const base = p({ id: 'base', width: 10, length: 40, x: 0, y: 0, rotation: 0 }) // fp 10×40
    const wall = p({ id: 'wall', width: 40, length: 10, x: 0, y: 0, rotation: 0 }) // occupies top strip
    // Rotating base → 40×10; clamp to 0,0 overlaps wall → should re-spot below.
    const next = tryRotate90(base, [wall], 54)
    expect(next).not.toBeNull()
    expect(next!.rotation).toBe(90)
    expect(canPlace(next!, [wall], 54)).toBe(true)
    expect(offBolt(next!, 54)).toBe(false)
  })
})
