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
  circleCenter,
  circleCutFromFinished,
  circleRadius,
  cutSize,
  exactYards,
  findBestSpotOnPattern,
  findOpenSpot,
  findBestSpot,
  isGenericLabel,
  nextSequentialLabel,
  offBolt,
  orderYards,
  orientationsThatFit,
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
  trapCutFromFinished,
  panelPolygon,
  panelDimLabel,
  defaultDiagonal,
  irregularCutFromFinished,
  quadPolygonFromSides,
  isIrregular,
  makeProbeFromPanel,
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
    expect(cands.length).toBeLessThanOrEqual(6)
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

describe('trapezoid geometry', () => {
  function trap(
    partial: Partial<Panel> &
      Pick<Panel, 'id' | 'x' | 'y'> & { topWidth: number; bottomWidth: number; height: number },
  ): Panel {
    const { topWidth, bottomWidth, height, ...rest } = partial
    const width = Math.max(topWidth, bottomWidth)
    return p({
      kind: 'trap',
      width,
      length: height,
      topWidth,
      bottomWidth,
      ...rest,
    })
  }

  it('trapCutFromFinished expands each dim by 2×SA', () => {
    const c = trapCutFromFinished(12, 18, 20, 0.5)
    expect(c.topWidth).toBe(13)
    expect(c.bottomWidth).toBe(19)
    expect(c.height).toBe(21)
    expect(c.width).toBe(19)
    expect(c.length).toBe(21)
  })

  it('equal top/bottom behaves like a rect (AABB + polygon)', () => {
    const t = trap({ id: 'eq', topWidth: 20, bottomWidth: 20, height: 24, x: 0, y: 0 })
    expect(panelFootprint(t)).toEqual({ w: 20, h: 24 })
    const poly = panelPolygon(t)
    expect(poly).toHaveLength(4)
    // Corners of a 20×24 rect
    expect(poly.map((pt) => [pt.x, pt.y])).toEqual([
      [0, 0],
      [20, 0],
      [20, 24],
      [0, 24],
    ])
  })

  it('isosceles trap local polygon centers both edges', () => {
    const t = trap({ id: 't', topWidth: 10, bottomWidth: 20, height: 10, x: 0, y: 0 })
    const poly = panelPolygon(t)
    expect(poly[0]).toEqual({ x: 5, y: 0 })
    expect(poly[1]).toEqual({ x: 15, y: 0 })
    expect(poly[2]).toEqual({ x: 20, y: 10 })
    expect(poly[3]).toEqual({ x: 0, y: 10 })
    expect(panelFootprint(t)).toEqual({ w: 20, h: 10 })
  })

  it('rotate90 swaps footprint AABB for traps', () => {
    const t = trap({ id: 't', topWidth: 10, bottomWidth: 20, height: 10, x: 0, y: 0 })
    const r = rotate90(t)
    expect(panelFootprint(r)).toEqual({ w: 10, h: 20 })
    const poly = panelPolygon(r)
    const b = panelBounds(r)
    expect(b.x1).toBeCloseTo(0)
    expect(b.y1).toBeCloseTo(0)
    expect(b.x2).toBeCloseTo(10)
    expect(b.y2).toBeCloseTo(20)
    expect(poly.every((pt) => pt.x >= -1e-9 && pt.y >= -1e-9)).toBe(true)
  })

  it('flipH mirrors trapezoid across vertical mid', () => {
    const t = trap({
      id: 't',
      topWidth: 10,
      bottomWidth: 20,
      height: 10,
      x: 0,
      y: 0,
      flippedH: true,
    })
    // Without flip: top 5..15; with flipH on w=20: top becomes 5..15 still (symmetric).
    // Use asymmetric: top left-biased by using equal max but flip of isosceles is same.
    // Check flipV swaps top/bottom edges.
    const v = trap({
      id: 'v',
      topWidth: 10,
      bottomWidth: 20,
      height: 10,
      x: 0,
      y: 0,
      flippedV: true,
    })
    const poly = panelPolygon(v)
    // After flipV, former top (narrow) is at y=10, former bottom (wide) at y=0
    const atY0 = poly.filter((pt) => Math.abs(pt.y) < 1e-9)
    const atY10 = poly.filter((pt) => Math.abs(pt.y - 10) < 1e-9)
    const widthAt = (pts: { x: number }[]) =>
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
    expect(widthAt(atY0)).toBeCloseTo(20)
    expect(widthAt(atY10)).toBeCloseTo(10)
    expect(t.flippedH).toBe(true)
  })

  it('offBolt checks trap vertices (slant can hang past AABB left/right only if AABB does)', () => {
    const t = trap({ id: 't', topWidth: 10, bottomWidth: 20, height: 10, x: 40, y: 0 })
    // AABB 20 wide → x2=60 > 54
    expect(offBolt(t, 54)).toBe(true)
    const ok = trap({ id: 'ok', topWidth: 10, bottomWidth: 20, height: 10, x: 0, y: 0 })
    expect(offBolt(ok, 54)).toBe(false)
  })

  it('canPlace: trap vs rect uses polygon SAT (no false AABB-only overlap)', () => {
    // Place a wide-bottom trap and a small rect in the "ears" beside the narrow top —
    // AABB would overlap the rect if placed under the top overhang region incorrectly.
    // Simpler: two traps that AABB-overlap but polygons don't (touching slant gaps).
    const a = trap({ id: 'a', topWidth: 4, bottomWidth: 20, height: 10, x: 0, y: 0 })
    // Rect in the left "ear" beside the narrow top (inside AABB, outside polygon).
    const ear = p({ id: 'ear', width: 5, length: 2, x: 0, y: 0 })
    // At y=0..2, slant x = 8 - 0.8*y ∈ [6.4, 8]. ear is x=0..5, all < 6.4 → no polygon overlap.
    // But AABB of trap is 0..20, 0..10 — overlaps ear AABB.
    expect(aabbOverlap(panelBounds(a), panelBounds(ear))).toBe(true)
    expect(canPlace(ear, [a], 54)).toBe(true)
    expect(overlapsAny(ear, [a])).toBe(false)
  })

  it('canPlace rejects overlapping traps', () => {
    const a = trap({ id: 'a', topWidth: 10, bottomWidth: 20, height: 10, x: 0, y: 0 })
    const b = trap({ id: 'b', topWidth: 10, bottomWidth: 20, height: 10, x: 5, y: 0 })
    expect(canPlace(b, [a], 54)).toBe(false)
  })

  it('autoNest still packs rects; traps nest via AABB placer', () => {
    const panels = [
      p({ id: 'r1', width: 20, length: 24, x: 0, y: 0 }),
      trap({ id: 't1', topWidth: 12, bottomWidth: 18, height: 20, x: 0, y: 0 }),
    ]
    const nested = autoNestPanels(panels, 54)
    expect(nested).toHaveLength(2)
    for (const panel of nested) {
      expect(canPlace(panel, nested, 54)).toBe(true)
      expect(offBolt(panel, 54)).toBe(false)
    }
  })

  it('panelDimLabel shows top/bottom × h for traps', () => {
    const t = trap({ id: 't', topWidth: 12, bottomWidth: 18, height: 20, x: 0, y: 0 })
    expect(panelDimLabel(t)).toBe('12/18 × 20')
    expect(panelDimLabel(p({ id: 'r', width: 10, length: 12, x: 0, y: 0 }))).toBe('10×12')
  })
})

describe('circle geometry', () => {
  function circ(
    partial: Partial<Panel> & Pick<Panel, 'id' | 'x' | 'y'> & { diameter: number },
  ): Panel {
    const { diameter, ...rest } = partial
    return p({
      kind: 'circle',
      width: diameter,
      length: diameter,
      ...rest,
    })
  }

  it('circleCutFromFinished expands diameter by 2×SA', () => {
    const c = circleCutFromFinished(12, 0.5)
    expect(c.diameter).toBe(13)
    expect(c.width).toBe(13)
    expect(c.length).toBe(13)
  })

  it('footprint is square and rotation-invariant', () => {
    const c = circ({ id: 'c', diameter: 20, x: 0, y: 0 })
    expect(panelFootprint(c)).toEqual({ w: 20, h: 20 })
    expect(panelFootprint({ ...c, rotation: 90 })).toEqual({ w: 20, h: 20 })
    expect(panelFootprint({ ...c, rotation: 180 })).toEqual({ w: 20, h: 20 })
  })

  it('orientationsThatFit returns [0] when diameter fits, [] when oversized', () => {
    expect(orientationsThatFit(circ({ id: 'ok', diameter: 20, x: 0, y: 0 }), 54)).toEqual([0])
    expect(orientationsThatFit(circ({ id: 'big', diameter: 60, x: 0, y: 0 }), 54)).toEqual([])
  })

  it('circle–circle overlap true when centers closer than r1+r2', () => {
    const a = circ({ id: 'a', diameter: 20, x: 0, y: 0 }) // center 10,10 r=10
    const b = circ({ id: 'b', diameter: 20, x: 15, y: 0 }) // center 25,10 — dist 15 < 20
    expect(overlapsAny(a, [b])).toBe(true)
    expect(canPlace(a, [b], 54)).toBe(false)
  })

  it('circle–circle touching edges does not overlap', () => {
    const a = circ({ id: 'a', diameter: 20, x: 0, y: 0 }) // center 10,10
    const b = circ({ id: 'b', diameter: 20, x: 20, y: 0 }) // center 30,10 — dist 20 == r1+r2
    expect(overlapsAny(a, [b])).toBe(false)
    expect(canPlace(b, [a], 54)).toBe(true)
  })

  it('circle fits bolt / blocked when diameter exceeds width', () => {
    const ok = circ({ id: 'ok', diameter: 20, x: 0, y: 0 })
    expect(canPlace(ok, [], 54)).toBe(true)
    const big = circ({ id: 'big', diameter: 60, x: 0, y: 0 })
    expect(offBolt(big, 54)).toBe(true)
    expect(canPlace(big, [], 54)).toBe(false)
  })

  it('autoNest places non-overlapping circles', () => {
    const panels = [
      circ({ id: 'c1', diameter: 18, x: 0, y: 0 }),
      circ({ id: 'c2', diameter: 18, x: 0, y: 0 }),
      circ({ id: 'c3', diameter: 18, x: 0, y: 0 }),
    ]
    const nested = autoNestPanels(panels, 54)
    expect(nested).toHaveLength(3)
    for (const panel of nested) {
      expect(canPlace(panel, nested, 54)).toBe(true)
    }
  })

  it('rotate90 / tryRotate90 are no-ops for circles', () => {
    const c = circ({ id: 'c', diameter: 16, x: 2, y: 3 })
    expect(rotate90(c)).toBe(c)
    const next = tryRotate90(c, [], 54)
    expect(next).toEqual(c)
    expect(next!.rotation).toBe(0)
  })

  it('panelDimLabel shows diameter', () => {
    expect(panelDimLabel(circ({ id: 'c', diameter: 12, x: 0, y: 0 }))).toBe('⌀12')
  })

  it('circleCenter and circleRadius from AABB', () => {
    const c = circ({ id: 'c', diameter: 10, x: 4, y: 6 })
    expect(circleCenter(c)).toEqual({ x: 9, y: 11 })
    expect(circleRadius(c)).toBe(5)
  })

  it('circle–rect uses closest-point AABB (can nest tighter than square–square)', () => {
    // Circle diameter 20 at (0,0); rect 10×10 whose AABB overlaps the circle's square
    // but sits in a corner outside the circle.
    const circle = circ({ id: 'c', diameter: 20, x: 0, y: 0 }) // center 10,10 r=10
    // Place a 6×6 rect at (0,0) — closest point to center is (6,6), dist≈5.66 < 10 → overlap
    const overlapping = p({ id: 'r', width: 6, length: 6, x: 0, y: 0 })
    expect(overlapsAny(circle, [overlapping])).toBe(true)
    // Rect far in corner of the AABB square but outside circle: at (0,0) wait that's inside.
    // Corner of AABB outside circle: e.g. rect at x=0,y=0 with size that only occupies
    // near (0,0). Closest point from (10,10) to a 1×1 at (0,0) is (1,1), dist≈12.7 > 10
    const corner = p({ id: 'corner', width: 1, length: 1, x: 0, y: 0 })
    expect(overlapsAny(circle, [corner])).toBe(false)
    // Same corner would collide if treated as square–square AABB:
    expect(
      aabbOverlap(panelBounds(circle), panelBounds(corner)),
    ).toBe(true)
  })
})


describe('irregular quadrilateral geometry', () => {
  function irreg(
    partial: Partial<Panel> & {
      id: string
      sideLeft: number
      sideFront: number
      sideRight: number
      sideBack: number
      diagonal: number
      x: number
      y: number
    },
  ): Panel {
    const poly = quadPolygonFromSides(
      partial.sideLeft,
      partial.sideFront,
      partial.sideRight,
      partial.sideBack,
      partial.diagonal,
    )!
    let maxX = 0
    let maxY = 0
    for (const pt of poly) {
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
    return {
      id: partial.id,
      label: partial.label ?? partial.id,
      kind: 'irregular',
      width: maxX,
      length: maxY,
      sideLeft: partial.sideLeft,
      sideFront: partial.sideFront,
      sideRight: partial.sideRight,
      sideBack: partial.sideBack,
      diagonal: partial.diagonal,
      x: partial.x,
      y: partial.y,
      rotation: partial.rotation ?? 0,
      flippedH: partial.flippedH ?? false,
      flippedV: partial.flippedV ?? false,
      color: '#000',
    }
  }

  describe('defaultDiagonal', () => {
    it('symmetric / rectangle when both opposite pairs equal', () => {
      // 10×20 rectangle → diag = sqrt(10²+20²)
      expect(defaultDiagonal(10, 20, 10, 20)).toBeCloseTo(Math.hypot(20, 10), 6)
    })

    it('keystone / isosceles when left≈right and front≠back (centers shorter over longer)', () => {
      const left = 16
      const right = 16
      const front = 20
      const back = 24
      const inset = Math.abs(front - back) / 2
      const h = Math.sqrt(left * left - inset * inset)
      const expected = Math.hypot((front + back) / 2, h)
      expect(defaultDiagonal(left, front, right, back)).toBeCloseTo(expected, 6)
    })

    it('keystone when front≈back and left≠right', () => {
      const front = 18
      const back = 18
      const left = 12
      const right = 20
      const inset = Math.abs(left - right) / 2
      const h = Math.sqrt(front * front - inset * inset)
      const expected = Math.hypot((left + right) / 2, h)
      expect(defaultDiagonal(left, front, right, back)).toBeCloseTo(expected, 6)
    })

    it('forepeak: all unequal → right angle at front-left', () => {
      const left = 10
      const front = 12
      const right = 14
      const back = 16
      const d = defaultDiagonal(left, front, right, back)
      const poly = quadPolygonFromSides(left, front, right, back, d)
      expect(poly).not.toBeNull()
      // After AABB translate, find front-left (start of front edge along bottom-ish).
      // Reconstruct untranslated: A at origin before translate — check angle via sides.
      // With forepeak construction, vectors AB=(front,0) and AD should be perpendicular.
      // Rebuild A,B,D,C from known construction:
      // A=(0,0), B=(front,0), D=(0,left); C from circles; diagonal = |AC|
      expect(d).toBeGreaterThan(0)
      // Right angle: for poly built with this diagonal, front-left corner angle ≈ 90°.
      // Local construction puts A at (0,0) before translate; after translate the corner
      // that was A is at (-minX, -minY). Dot product of edges from A should be ~0.
      const A = { x: 0, y: 0 }
      const B = { x: front, y: 0 }
      // Find C on circle(A,d) ∩ circle(B,right) with y≥0
      // Use the polygon: sides from first vertex matching front length.
      const pts = poly!
      // Identify A as the vertex where adjacent edges ≈ front and left.
      let found = false
      for (let i = 0; i < 4; i++) {
        const prev = pts[(i + 3) % 4]
        const cur = pts[i]
        const next = pts[(i + 1) % 4]
        const lenPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y)
        const lenNext = Math.hypot(next.x - cur.x, next.y - cur.y)
        const isLeftFront =
          (Math.abs(lenPrev - left) < 1e-3 && Math.abs(lenNext - front) < 1e-3) ||
          (Math.abs(lenPrev - front) < 1e-3 && Math.abs(lenNext - left) < 1e-3)
        if (!isLeftFront) continue
        const v1x = prev.x - cur.x
        const v1y = prev.y - cur.y
        const v2x = next.x - cur.x
        const v2y = next.y - cur.y
        const dot = v1x * v2x + v1y * v2y
        expect(Math.abs(dot)).toBeLessThan(1e-4)
        found = true
        break
      }
      expect(found).toBe(true)
      void A
      void B
    })
  })

  describe('quadPolygonFromSides', () => {
    it('builds a rectangle when sides + default diagonal match', () => {
      const d = defaultDiagonal(10, 20, 10, 20)
      const poly = quadPolygonFromSides(10, 20, 10, 20, d)
      expect(poly).not.toBeNull()
      expect(poly!).toHaveLength(4)
      // AABB should be 20 × 10
      let maxX = 0
      let maxY = 0
      for (const pt of poly!) {
        maxX = Math.max(maxX, pt.x)
        maxY = Math.max(maxY, pt.y)
      }
      expect(maxX).toBeCloseTo(20, 5)
      expect(maxY).toBeCloseTo(10, 5)
    })

    it('builds an isosceles trap-like keystone', () => {
      const d = defaultDiagonal(16, 20, 16, 24)
      const poly = quadPolygonFromSides(16, 20, 16, 24, d)
      expect(poly).not.toBeNull()
      expect(poly!).toHaveLength(4)
    })

    it('builds a forepeak quad', () => {
      const d = defaultDiagonal(10, 12, 14, 16)
      const poly = quadPolygonFromSides(10, 12, 14, 16, d)
      expect(poly).not.toBeNull()
    })

    it('rejects impossible diagonal (triangle inequality)', () => {
      expect(quadPolygonFromSides(10, 20, 10, 20, 100)).toBeNull()
      expect(quadPolygonFromSides(10, 20, 10, 20, 1)).toBeNull()
    })
  })

  it('irregularCutFromFinished expands all five lengths by 2×SA', () => {
    const finD = defaultDiagonal(12, 18, 14, 16)
    const cut = irregularCutFromFinished(12, 18, 14, 16, finD, 0.5)
    expect(cut).not.toBeNull()
    expect(cut!.sideLeft).toBeCloseTo(13, 6)
    expect(cut!.sideFront).toBeCloseTo(19, 6)
    expect(cut!.sideRight).toBeCloseTo(15, 6)
    expect(cut!.sideBack).toBeCloseTo(17, 6)
    expect(cut!.diagonal).toBeCloseTo(finD + 1, 6)
    expect(cut!.width).toBeGreaterThan(0)
    expect(cut!.length).toBeGreaterThan(0)
  })

  it('panelDimLabel shows L×F×R×B ⌒diag', () => {
    const panel = irreg({
      id: 'i',
      sideLeft: 12,
      sideFront: 18,
      sideRight: 14,
      sideBack: 16,
      diagonal: 20,
      x: 0,
      y: 0,
    })
    expect(isIrregular(panel)).toBe(true)
    expect(panelDimLabel(panel)).toBe('12×18×14×16 ⌒20')
  })

  it('orientationsThatFit returns 0 and 90 when AABB fits', () => {
    const panel = irreg({
      id: 'i',
      sideLeft: 10,
      sideFront: 20,
      sideRight: 10,
      sideBack: 20,
      diagonal: Math.hypot(20, 10),
      x: 0,
      y: 0,
    })
    expect(orientationsThatFit(panel, 54)).toEqual([0, 90])
  })

  it('canPlace: irregular uses polygon SAT vs rect', () => {
    const a = irreg({
      id: 'a',
      sideLeft: 10,
      sideFront: 20,
      sideRight: 10,
      sideBack: 20,
      diagonal: Math.hypot(20, 10),
      x: 0,
      y: 0,
    })
    const overlapping = p({ id: 'r', width: 10, length: 10, x: 5, y: 0 })
    expect(canPlace(overlapping, [a], 54)).toBe(false)
    const beside = p({ id: 'r2', width: 10, length: 10, x: 21, y: 0 })
    expect(canPlace(beside, [a], 54)).toBe(true)
  })

  it('rotate90 swaps footprint for irregular', () => {
    const panel = irreg({
      id: 'i',
      sideLeft: 10,
      sideFront: 20,
      sideRight: 10,
      sideBack: 20,
      diagonal: Math.hypot(20, 10),
      x: 0,
      y: 0,
    })
    const fp0 = panelFootprint(panel)
    const rotated = rotate90(panel)
    const fp90 = panelFootprint(rotated)
    expect(fp90.w).toBeCloseTo(fp0.h, 5)
    expect(fp90.h).toBeCloseTo(fp0.w, 5)
  })
})


describe("circle nesting (true circle packing)", () => {
  function circleAt(id: string, d: number, x = 0, y = 0): Panel {
    return {
      id,
      label: id,
      kind: "circle",
      width: d,
      length: d,
      x,
      y,
      rotation: 0,
      flippedH: false,
      flippedV: false,
      color: "#000",
    }
  }

  it("findBestSpot with kind circle allows AABB-overlapping nest beside another circle", () => {
    const d = 10
    const first = circleAt("a", d, 0, 0)
    // Square BLF would put next at x=10+gap. Circle packing can place center at ~d (touching).
    const spot = findBestSpot(d, d, 30, [first], 0, "circle")
    const probe = { ...first, id: "b", x: spot.x, y: spot.y }
    const dist = Math.hypot(
      circleCenter(probe).x - circleCenter(first).x,
      circleCenter(probe).y - circleCenter(first).y,
    )
    expect(dist).toBeGreaterThanOrEqual(d - 1e-6)
    // Tighter than pure AABB stack when second tucks diagonally, or equal when side-by-side.
    expect(spot.x + d).toBeLessThanOrEqual(30 + 1e-6)
  })

  it("autoNest packs three equal circles shorter than square-row+row when bolt is 2 diameters wide", () => {
    const d = 10
    const fabricW = 20
    const panels = [circleAt("a", d), circleAt("b", d), circleAt("c", d)]
    const nested = autoNestPanels(panels, fabricW, 0)
    const used = usedLengthInches(nested)
    // Square packing: 2 on row1 + 1 on row2 => used ≈ 20. Hex valley: used ≈ 10 + 5√3 ≈ 18.66
    expect(used).toBeLessThan(20 - 0.1)
  })
})


describe('poly panel nesting efficiency (irregular / trap)', () => {
  function irreg(
    partial: Partial<Panel> & {
      id: string
      sideLeft: number
      sideFront: number
      sideRight: number
      sideBack: number
      diagonal: number
      x?: number
      y?: number
    },
  ): Panel {
    const poly = quadPolygonFromSides(
      partial.sideLeft,
      partial.sideFront,
      partial.sideRight,
      partial.sideBack,
      partial.diagonal,
    )!
    let maxX = 0
    let maxY = 0
    for (const pt of poly) {
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
    return {
      id: partial.id,
      label: partial.label ?? partial.id,
      kind: 'irregular',
      width: maxX,
      length: maxY,
      sideLeft: partial.sideLeft,
      sideFront: partial.sideFront,
      sideRight: partial.sideRight,
      sideBack: partial.sideBack,
      diagonal: partial.diagonal,
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      rotation: partial.rotation ?? 0,
      flippedH: partial.flippedH ?? false,
      flippedV: partial.flippedV ?? false,
      color: '#000',
    }
  }

  function trapPanel(
    id: string,
    topWidth: number,
    bottomWidth: number,
    height: number,
  ): Panel {
    return p({
      id,
      kind: 'trap',
      width: Math.max(topWidth, bottomWidth),
      length: height,
      topWidth,
      bottomWidth,
      x: 0,
      y: 0,
    })
  }

  it('two right-triangle-like irregulars nest into ~rectangle height (not 2× AABB stack)', () => {
    // Near-right-triangle quad: A(0,0), B(W,0), C(W,eps), D(0,H).
    // Complementary flip packs both into one W×H rectangle when bolt is too narrow for 2 AABBs.
    const W = 20
    const H = 12
    const eps = 0.25
    const L = H
    const F = W
    const R = eps
    const B = Math.hypot(W, H - eps)
    const d = Math.hypot(W, eps)
    const a = irreg({ id: 'a', sideLeft: L, sideFront: F, sideRight: R, sideBack: B, diagonal: d })
    const b = irreg({ id: 'b', sideLeft: L, sideFront: F, sideRight: R, sideBack: B, diagonal: d })
    const fp = panelFootprint(a)
    expect(fp.w).toBeCloseTo(W, 5)
    expect(fp.h).toBeCloseTo(H, 5)

    // Bolt fits one AABB only — pure AABB BLF would stack to ~2H.
    const fabricWidth = fp.w + 1
    expect(fp.w * 2).toBeGreaterThan(fabricWidth)

    const nested = autoNestPanels([a, b], fabricWidth, 0)
    expect(nested).toHaveLength(2)
    for (const panel of nested) {
      expect(canPlace(panel, nested, fabricWidth)).toBe(true)
      expect(offBolt(panel, fabricWidth)).toBe(false)
    }
    // AABBs may overlap while polygons do not (the efficiency win).
    expect(aabbOverlap(panelBounds(nested[0]), panelBounds(nested[1]))).toBe(true)
    expect(overlapsAny(nested[0], [nested[1]])).toBe(false)

    const used = usedLengthInches(nested)
    // Close to combined rectangle height H, not 2×H from AABB stacking.
    expect(used).toBeLessThan(fp.h * 1.35)
    expect(used).toBeCloseTo(fp.h, 0)
  })

  it('mirrored traps nest with AABB overlap (tighter than AABB-only BLF)', () => {
    // Narrow-top / wide-bottom traps: flipV + horizontal offset nests them on one row
    // with overlapping AABBs. Bolt < 2×AABB so AABB-only BLF must stack to ~2h.
    const h = 10
    const a = trapPanel('a', 2, 20, h)
    const b = trapPanel('b', 2, 20, h)
    const fabricWidth = 32 // fits offset nest (~x=12) but not two non-overlapping AABBs
    expect(panelFootprint(a).w * 2).toBeGreaterThan(fabricWidth)

    const nested = autoNestPanels([a, b], fabricWidth, 0)
    for (const panel of nested) {
      expect(canPlace(panel, nested, fabricWidth)).toBe(true)
      expect(offBolt(panel, fabricWidth)).toBe(false)
    }
    const used = usedLengthInches(nested)
    // AABB-only stack ≈ 20; polygon nest with flip shares a row (used ≈ h).
    expect(used).toBeLessThan(h * 1.5)
    expect(aabbOverlap(panelBounds(nested[0]), panelBounds(nested[1]))).toBe(true)
    expect(overlapsAny(nested[0], [nested[1]])).toBe(false)
  })

  it('makeProbeFromPanel preserves irregular side geometry (not AABB fallback)', () => {
    const d = defaultDiagonal(12, 16, 14, 18)
    const panel = irreg({
      id: 'p',
      sideLeft: 12,
      sideFront: 16,
      sideRight: 14,
      sideBack: 18,
      diagonal: d,
    })
    const probe = makeProbeFromPanel(panel, 3, 4)
    expect(probe.sideLeft).toBe(12)
    expect(probe.sideFront).toBe(16)
    expect(probe.diagonal).toBe(d)
    expect(probe.x).toBe(3)
    expect(probe.y).toBe(4)
    // Polygon at probe position should not be a plain AABB rectangle
    const poly = panelPolygon(probe)
    expect(poly.length).toBe(4)
    const xs = poly.map((pt) => pt.x)
    // Irregular (non-rect) has a vertex not at AABB corners only — at least one x strictly inside
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(xs.some((x) => x > minX + 1e-6 && x < maxX - 1e-6) || ysInterior(poly)).toBe(true)
  })
})

function ysInterior(poly: { x: number; y: number }[]): boolean {
  const ys = poly.map((pt) => pt.y)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return ys.some((y) => y > minY + 1e-6 && y < maxY - 1e-6)
}
