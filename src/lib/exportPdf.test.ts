import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PT_PER_IN,
  FIRST_NEST_PAGE,
  computeNestSlices,
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
