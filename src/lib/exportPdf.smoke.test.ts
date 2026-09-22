/**
 * @vitest-environment jsdom
 *
 * These call the real exportNestingPdf path (jsPDF + autotable). Helper-only tests
 * in exportPdf.test.ts will not catch runtime breaks in the download builder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Panel } from './geometry'
import { exportNestingPdf } from './exportPdf'

function rect(partial: Partial<Panel> & Pick<Panel, 'id'>): Panel {
  return {
    label: 'A',
    width: 20,
    length: 24,
    x: 0,
    y: 0,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#24285e',
    kind: 'rect',
    ...partial,
  }
}

describe('exportNestingPdf smoke (must exercise full builder)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', configurable: true })
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
    }
  })

  it('returns a .pdf filename for an empty nest', () => {
    const name = exportNestingPdf({
      panels: [],
      fabricWidthIn: 54,
      seamAllowanceIn: 0.5,
      waste: 0,
      unit: 'in',
      exact: 0,
      order: 0,
      patterned: false,
      hRepeatIn: 0,
      vRepeatIn: 0,
    })
    expect(name).toMatch(/\.pdf$/)
  })

  it('builds a multi-page PDF for a rectangular panel', () => {
    const name = exportNestingPdf({
      panels: [rect({ id: '1' })],
      fabricWidthIn: 54,
      seamAllowanceIn: 0.5,
      waste: 10,
      unit: 'in',
      exact: 0.67,
      order: 1,
      patterned: false,
      hRepeatIn: 0,
      vRepeatIn: 0,
    })
    expect(name).toMatch(/sailrite-nesting-.*\.pdf/)
  })

  it('builds a PDF for a trapezoid + pattern without throwing', () => {
    expect(() =>
      exportNestingPdf({
        panels: [
          rect({
            id: '2',
            kind: 'trap',
            label: 'Trap',
            topWidth: 12,
            bottomWidth: 18,
            length: 20,
            width: 18,
            color: '#8DC63F',
          }),
        ],
        fabricWidthIn: 54,
        seamAllowanceIn: 0.5,
        waste: 0,
        unit: 'mm',
        exact: 1.2,
        order: 2,
        patterned: true,
        hRepeatIn: 4,
        vRepeatIn: 4,
      }),
    ).not.toThrow()
  })
})
