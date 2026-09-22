import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import type { Panel } from './geometry'
import { panelFootprint, panelPolygon } from './geometry'
import {
  DEFAULT_PT_PER_IN,
  FIRST_NEST_PAGE,
  chooseNestPageScale,
  clipPolygonToXRange,
  clipPolygonToYRange,
  computeNestSlices,
  drawNest,
  fabricToPdf,
  fitNestScale,
  formatPanelNestDim,
  inchesToPdfPt,
  layoutPanelPdfLabel,
  nestBoltHeightIn,
  pdfFilename,
} from './exportPdf'

describe('exportPdf scale helpers', () => {
  it('inchesToPdfPt multiplies by ptPerIn', () => {
    expect(inchesToPdfPt(10, { ptPerIn: 4 })).toBe(40)
    expect(inchesToPdfPt(0, { ptPerIn: 4 })).toBe(0)
    expect(inchesToPdfPt(36, { ptPerIn: DEFAULT_PT_PER_IN })).toBe(36 * DEFAULT_PT_PER_IN)
  })

  it('fabricToPdf offsets from origin', () => {
    const scale = { originX: 40, originY: 100, ptPerIn: 2 }
    expect(fabricToPdf(0, 0, scale)).toEqual({ x: 40, y: 100 })
    expect(fabricToPdf(10, 5, scale)).toEqual({ x: 60, y: 110 })
  })

  it('fabricToPdf respects sliceStartIn', () => {
    const scale = { originX: 40, originY: 100, ptPerIn: 2 }
    expect(fabricToPdf(0, 36, scale, 36)).toEqual({ x: 40, y: 100 })
  })

  it('fitNestScale fits fabric width into the box', () => {
    const box = { x: 40, y: 200, w: 500, h: 400 }
    const scale = fitNestScale(54, 48, box)
    expect(scale.originX).toBe(40)
    expect(scale.originY).toBe(200)
    expect(scale.ptPerIn).toBeGreaterThan(0)
    expect(54 * scale.ptPerIn).toBeLessThanOrEqual(box.w + 1e-6)
  })

  it('pdfFilename uses YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 21) // Sep 21 2026 local
    expect(pdfFilename(d)).toBe('sailrite-nesting-2026-09-21.pdf')
  })
})

describe('computeNestSlices', () => {
  it('returns one slice when bolt fits first page (short nest ends at boltH)', () => {
    const used = 24
    const ptPerIn = 4
    const boltH = nestBoltHeightIn(used)
    const firstH = boltH * ptPerIn + 10
    const slices = computeNestSlices(used, ptPerIn, firstH, 600)
    expect(slices).toHaveLength(1)
    expect(slices[0].startIn).toBe(0)
    expect(slices[0].endIn).toBeCloseTo(boltH)
  })

  it('paginates tall nests with yard-aligned non-final breaks', () => {
    const used = 36 * 8 // 8 yards used
    const ptPerIn = 6
    // ~2 yd per full page: 500/6 ≈ 83.3" → floor = 2 yd
    const firstH = 500
    const fullH = 500
    const slices = computeNestSlices(used, ptPerIn, firstH, fullH)
    expect(slices.length).toBeGreaterThan(1)
    expect(slices[0].startIn).toBe(0)

    // contiguous coverage
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startIn).toBeCloseTo(slices[i - 1].endIn)
    }
    expect(slices[slices.length - 1].endIn).toBeCloseTo(nestBoltHeightIn(used))

    // every non-final endIn and every startIn after the first is a multiple of 36
    for (let i = 0; i < slices.length - 1; i++) {
      expect(slices[i].endIn % 36).toBeCloseTo(0)
    }
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startIn % 36).toBeCloseTo(0)
    }

    // ~2 yd/page → ends at 72, 144, …
    expect(slices[0].endIn).toBe(72)
    expect(slices[1].endIn).toBe(144)
    expect(slices[0].label).toBe('Nest 0–2 yd')
    expect(slices[1].label).toBe('Nest 2–4 yd')
  })

  it('non-final slices land on yard marks; height fits usable (or 1-yd min)', () => {
    const used = 200
    const ptPerIn = 5
    const firstH = 150 // usable inches = 30 < 36 → still take 1 yd
    const fullH = 400 // usable inches = 80 → floor = 2 yd
    const slices = computeNestSlices(used, ptPerIn, firstH, fullH)
    expect(slices.length).toBeGreaterThan(1)

    for (let i = 0; i < slices.length - 1; i++) {
      expect(slices[i].endIn % 36).toBeCloseTo(0)
    }
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startIn).toBeCloseTo(slices[i - 1].endIn)
      expect(slices[i].startIn % 36).toBeCloseTo(0)
    }
    expect(slices[slices.length - 1].endIn).toBeCloseTo(nestBoltHeightIn(used))

    slices.forEach((sl, i) => {
      const usable = i === 0 ? firstH : fullH
      const hPt = (sl.endIn - sl.startIn) * ptPerIn
      const isLast = i === slices.length - 1
      if (!isLast) {
        // Non-final: either fits usable, or is the 1-yard minimum on a tight page
        const oneYardPt = 36 * ptPerIn
        expect(hPt <= usable + 1e-6 || Math.abs(hPt - oneYardPt) < 1e-6).toBe(true)
      }
    })
  })

  it('covers bolt contiguously from 0 to nestBoltHeightIn', () => {
    const used = 36 * 5 + 10
    const slices = computeNestSlices(used, 4, 300, 500)
    expect(slices[0].startIn).toBe(0)
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startIn).toBeCloseTo(slices[i - 1].endIn)
    }
    expect(slices[slices.length - 1].endIn).toBeCloseTo(nestBoltHeightIn(used))
  })
})

describe('FIRST_NEST_PAGE / nest page policy', () => {
  it('nest always starts on page 2 (summary/table alone on page 1)', () => {
    expect(FIRST_NEST_PAGE).toBe(2)
  })

  it('when nest starts on a fresh page, first and full usable heights are equal', () => {
    // Mirrors exportNestingPdf: firstUsableH = fullUsableH after explicit addPage()
    const pageH = 792
    const margin = 40
    const titleBlock = 22
    const footerReserve = 28
    const widthNoteReserve = 14
    const fullContentTop = margin + titleBlock
    const fullUsableH = Math.max(
      80,
      pageH - fullContentTop - margin - footerReserve - widthNoteReserve,
    )
    const firstUsableH = fullUsableH
    expect(firstUsableH).toBe(fullUsableH)

    const used = 36 * 4
    const ptPerIn = 4
    const slices = computeNestSlices(used, ptPerIn, firstUsableH, fullUsableH)
    expect(slices[0].startIn).toBe(0)
    // With equal usable heights, page-0 and page-1 packs use the same yard budget
    if (slices.length > 2) {
      const h0 = slices[0].endIn - slices[0].startIn
      const h1 = slices[1].endIn - slices[1].startIn
      expect(h0).toBe(h1)
    }
  })
})

describe('formatPanelNestDim', () => {
  const base = {
    id: '1',
    label: 'A',
    width: 24,
    length: 36,
    x: 0,
    y: 0,
    rotation: 0 as const,
    flippedH: false,
    flippedV: false,
    color: '#24285e',
  }

  it('shows panel size when seam allowance is 0', () => {
    expect(formatPanelNestDim(base, 'in', 0)).toBe('24×36 in')
  })

  it('shows cut size including seam allowance when SA > 0', () => {
    // panel width/length are cut dims (finished + SA on each side)
    expect(formatPanelNestDim(base, 'in', 0.5)).toBe('24×36 in')
  })

  it('includes mm unit abbreviation', () => {
    const s = formatPanelNestDim(base, 'mm', 0)
    expect(s.endsWith(' mm')).toBe(true)
    expect(s).toContain('×')
  })
})

describe('layoutPanelPdfLabel', () => {
  it('puts name then dims on separate lines when space allows', () => {
    const r = layoutPanelPdfLabel('Seat back', '23×35 in', 120, 40, 9, 5)
    expect(r.lines.length).toBeGreaterThanOrEqual(2)
    expect(r.lines[r.lines.length - 1]).toBe('23×35 in')
    expect(r.lines.some((l) => l.includes('Seat'))).toBe(true)
    expect(r.lines.length * r.lineHeight).toBeLessThanOrEqual(40 + 1)
  })

  it('prioritizes dims when only one line fits', () => {
    const r = layoutPanelPdfLabel('Very Long Panel Name Here', '12×18 in', 80, 8, 9, 5)
    expect(r.lines.length).toBe(1)
    expect(r.lines[0]).toContain('12×18 in')
  })

  it('returns empty lines for tiny boxes', () => {
    expect(layoutPanelPdfLabel('A', '1×1 in', 1, 1).lines).toEqual([])
  })

  it('keeps all lines within box height after font shrink', () => {
    const r = layoutPanelPdfLabel(
      'Left seat back cushion panel piece',
      '20.5×30 in',
      50,
      22,
      9,
      5,
    )
    expect(r.fontSize).toBeGreaterThanOrEqual(5)
    expect(r.lines.length * r.lineHeight).toBeLessThanOrEqual(22 + 1)
    expect(r.lines[r.lines.length - 1]).toMatch(/in$/)
  })
})

describe('formatPanelNestDim trapezoid', () => {
  it('shows top/bottom × height cut dims', () => {
    const trap = {
      id: '1',
      label: 'T',
      kind: 'trap' as const,
      width: 20,
      length: 16,
      topWidth: 12,
      bottomWidth: 20,
      x: 0,
      y: 0,
      rotation: 0 as const,
      flippedH: false,
      flippedV: false,
      color: '#24285e',
    }
    expect(formatPanelNestDim(trap, 'in', 0.5)).toBe('12/20 × 16 in')
  })
})

describe('chooseNestPageScale', () => {
  it('packs 2 yards (slightly smaller scale) when width-fit leaves ~0.7 yd empty', () => {
    // width scale 9.8pt/in, usable 600pt → 600/(9.8*36) ≈ 1.70 yd at width scale
    const { ptPerIn, yardsPerPage } = chooseNestPageScale(9.8, 600)
    expect(yardsPerPage).toBe(2)
    expect(ptPerIn).toBeLessThanOrEqual(9.8 + 1e-9)
    expect(yardsPerPage * 36 * ptPerIn).toBeCloseTo(600, 0)
  })

  it('scales a single yard up to fill height when width scale is large', () => {
    // narrow fabric / large width scale: only ~0.8 yd of height at width scale
    const { ptPerIn, yardsPerPage } = chooseNestPageScale(20, 600)
    expect(yardsPerPage).toBe(1)
    expect(ptPerIn).toBeCloseTo(600 / 36, 5)
  })

  it('keeps yard-aligned packing with the chosen scale', () => {
    const used = 36 * 5
    const { ptPerIn } = chooseNestPageScale(9.8, 600)
    const slices = computeNestSlices(used, ptPerIn, 600, 600)
    for (let i = 0; i < slices.length - 1; i++) {
      expect(slices[i].endIn % 36).toBeCloseTo(0)
      // each non-final slice should be about 2 yards with the 600/9.8 case
      expect(slices[i].endIn - slices[i].startIn).toBeGreaterThanOrEqual(36)
    }
  })
})

describe('clipPolygonToYRange', () => {
  it('clips a unit square spanning y=0..2 against slice 0.5..1.5 to a quadrilateral', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ]
    const clipped = clipPolygonToYRange(square, 0.5, 1.5)
    expect(clipped.length).toBe(4)
    for (const pt of clipped) {
      expect(pt.y).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(pt.y).toBeLessThanOrEqual(1.5 + 1e-9)
    }
    // Expected corners (order may vary with SH winding; compare as a set)
    const sorted = [...clipped].sort((a, b) => a.y - b.y || a.x - b.x)
    expect(sorted[0].y).toBeCloseTo(0.5)
    expect(sorted[1].y).toBeCloseTo(0.5)
    expect(sorted[2].y).toBeCloseTo(1.5)
    expect(sorted[3].y).toBeCloseTo(1.5)
    expect(sorted.filter((p) => Math.abs(p.y - 0.5) < 1e-9).map((p) => p.x).sort()).toEqual([
      0, 1,
    ])
    expect(sorted.filter((p) => Math.abs(p.y - 1.5) < 1e-9).map((p) => p.x).sort()).toEqual([
      0, 1,
    ])
  })

  it('clips a tall trap to a 36" yard slice leaving ≥3 points inside the strip', () => {
    // Trap taller than one yard: top narrow at y=0, bottom wide at y=48
    const trap = [
      { x: 5, y: 0 },
      { x: 15, y: 0 },
      { x: 20, y: 48 },
      { x: 0, y: 48 },
    ]
    const sliceStart = 36
    const sliceEnd = 72
    const clipped = clipPolygonToYRange(trap, sliceStart, sliceEnd)
    expect(clipped.length).toBeGreaterThanOrEqual(3)
    for (const pt of clipped) {
      expect(pt.y).toBeGreaterThanOrEqual(sliceStart - 1e-6)
      expect(pt.y).toBeLessThanOrEqual(sliceEnd + 1e-6)
    }
    // Only the portion from y=36..48 remains (trap ends at 48)
    expect(Math.max(...clipped.map((p) => p.y))).toBeCloseTo(48)
    expect(Math.min(...clipped.map((p) => p.y))).toBeCloseTo(36)
  })

  it('regression: every clipped vertex of a slice-spanning trap stays in [sliceStart, sliceEnd]', () => {
    const sliceStart = 36
    const sliceEnd = 72
    // Trap straddles the 36" break (y=20..50)
    const trap = [
      { x: 4, y: 20 },
      { x: 16, y: 20 },
      { x: 20, y: 50 },
      { x: 0, y: 50 },
    ]
    const clipped = clipPolygonToYRange(trap, sliceStart, sliceEnd)
    expect(clipped.length).toBeGreaterThanOrEqual(3)
    for (const pt of clipped) {
      expect(pt.y).toBeGreaterThanOrEqual(sliceStart - 1e-6)
      expect(pt.y).toBeLessThanOrEqual(sliceEnd + 1e-6)
    }
  })

  it('returns empty / <3 when polygon is entirely outside the strip', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    expect(clipPolygonToYRange(square, 2, 3).length).toBeLessThan(3)
  })
})

describe('clipPolygonToXRange', () => {
  it('clips against an X strip', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]
    const clipped = clipPolygonToXRange(square, 0.5, 1.5)
    expect(clipped.length).toBe(4)
    for (const pt of clipped) {
      expect(pt.x).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(pt.x).toBeLessThanOrEqual(1.5 + 1e-9)
    }
  })
})

describe('drawNest trap slice clip', () => {
  it('straddling trap does not throw; clipped poly stays within slice Y before PDF convert', () => {
    const sliceStart = 36
    const sliceEnd = 72
    const trapPanel: Panel = {
      id: 't1',
      label: 'Trap',
      kind: 'trap',
      width: 20,
      length: 40,
      topWidth: 10,
      bottomWidth: 20,
      x: 5,
      y: 20, // spans 20..60 → crosses 36" break
      rotation: 0,
      flippedH: false,
      flippedV: false,
      color: '#ff0000',
    }
    const poly = panelPolygon(trapPanel)
    const clipped = clipPolygonToYRange(poly, sliceStart, sliceEnd)
    expect(clipped.length).toBeGreaterThanOrEqual(3)
    for (const pt of clipped) {
      expect(pt.y).toBeGreaterThanOrEqual(sliceStart - 1e-6)
      expect(pt.y).toBeLessThanOrEqual(sliceEnd + 1e-6)
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
    const scale = { originX: 40, originY: 60, ptPerIn: 4 }
    expect(() =>
      drawNest(doc, [trapPanel], 54, 60, scale, 'in', {
        sliceStartIn: sliceStart,
        sliceEndIn: sliceEnd,
        showWidthNote: false,
      }),
    ).not.toThrow()
  })

  it('panelPolygon trap vertices are correct for rotation 0 and 90', () => {
    const base: Panel = {
      id: 't',
      label: 'T',
      kind: 'trap',
      width: 20,
      length: 10,
      topWidth: 10,
      bottomWidth: 20,
      x: 0,
      y: 0,
      rotation: 0,
      flippedH: false,
      flippedV: false,
      color: '#000000',
    }
    const r0 = panelPolygon(base)
    expect(r0).toEqual([
      { x: 5, y: 0 },
      { x: 15, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ])
    const r90 = panelPolygon({ ...base, rotation: 90 })
    // 90° CW then normalize AABB to (0,0): footprint 10×20
    expect(panelFootprint({ ...base, rotation: 90 })).toEqual({ w: 10, h: 20 })
    expect(r90).toHaveLength(4)
    const ys = r90.map((p) => p.y)
    const xs = r90.map((p) => p.x)
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.max(...xs)).toBeCloseTo(10)
    expect(Math.max(...ys)).toBeCloseTo(20)
  })
})

describe('formatPanelNestDim circle', () => {
  it('shows diameter with ⌀', () => {
    const circle = {
      id: '1',
      label: 'C',
      kind: 'circle' as const,
      width: 14,
      length: 14,
      x: 0,
      y: 0,
      rotation: 0 as const,
      flippedH: false,
      flippedV: false,
      color: '#24285e',
    }
    expect(formatPanelNestDim(circle, 'in', 0.5)).toBe('⌀ 14 in')
  })
})

describe('formatPanelNestDim irregular', () => {
  it('shows L×F×R×B cut dims (short nest label)', () => {
    const irreg = {
      id: '1',
      label: 'I',
      kind: 'irregular' as const,
      width: 24,
      length: 16,
      sideLeft: 12,
      sideFront: 18,
      sideRight: 14,
      sideBack: 16,
      diagonal: 20,
      x: 0,
      y: 0,
      rotation: 0 as const,
      flippedH: false,
      flippedV: false,
      color: '#24285e',
    }
    expect(formatPanelNestDim(irreg, 'in', 0.5)).toBe('12×18×14×16 in')
  })
})
