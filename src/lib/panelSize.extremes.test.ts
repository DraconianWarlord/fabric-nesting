import { describe, expect, it } from 'vitest'
import {
  autoNestPanels,
  cutSize,
  orientationsThatFit,
  panelFootprint,
  suggestSplit,
  trapCutFromFinished,
  usedLengthInches,
  type Panel,
} from './geometry'
import {
  PANEL_TOO_LARGE_RESIZE,
  PANEL_TOO_LARGE_SPLIT,
  panelAddBlockMessage,
} from './panelAddGate'

const BOLT = 54
const SA = 0.5

function rectPanel(id: string, cutW: number, cutL: number): Panel {
  return {
    id,
    label: id,
    kind: 'rect',
    width: cutW,
    length: cutL,
    x: 0,
    y: 0,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#24285e',
  }
}

function trapPanel(
  id: string,
  cut: ReturnType<typeof trapCutFromFinished>,
): Panel {
  return {
    id,
    label: id,
    kind: 'trap',
    width: cut.width,
    length: cut.length,
    topWidth: cut.topWidth,
    bottomWidth: cut.bottomWidth,
    x: 0,
    y: 0,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#8DC63F',
  }
}

describe('extreme panel sizes — tiny + huge rect/trap', () => {
  describe('very small rectangle', () => {
    const finW = 0.25
    const finL = 0.5
    const cutW = cutSize(finW, SA)
    const cutL = cutSize(finL, SA)

    it('cut sizes are finished + 2×SA', () => {
      expect(cutW).toBeCloseTo(1.25, 6)
      expect(cutL).toBeCloseTo(1.5, 6)
    })

    it('does not block add (no error message)', () => {
      expect(panelAddBlockMessage('rect', cutW, cutL, BOLT, SA)).toBeNull()
    })

    it('fits in both orientations and nests near the origin', () => {
      const panel = rectPanel('tiny-rect', cutW, cutL)
      expect(orientationsThatFit(panel, BOLT)).toEqual([0, 90])
      const nested = autoNestPanels([panel], BOLT)
      expect(nested).toHaveLength(1)
      expect(nested[0].x).toBeLessThan(1)
      expect(nested[0].y).toBeLessThan(1)
      expect(usedLengthInches(nested)).toBeGreaterThan(0)
      expect(usedLengthInches(nested)).toBeLessThan(3)
    })
  })

  describe('very large rectangle', () => {
    const finW = 90
    const finL = 120
    const cutW = cutSize(finW, SA)
    const cutL = cutSize(finL, SA)

    it('cut sizes are finished + 2×SA', () => {
      expect(cutW).toBeCloseTo(91, 6)
      expect(cutL).toBeCloseTo(121, 6)
    })

    it('blocks add with the split-or-resize error message', () => {
      expect(panelAddBlockMessage('rect', cutW, cutL, BOLT, SA)).toBe(
        PANEL_TOO_LARGE_SPLIT,
      )
    })

    it('suggestSplit returns a usable strip plan', () => {
      const split = suggestSplit(cutW, cutL, BOLT, SA)
      expect(split).not.toBeNull()
      expect(split!.pieceCount).toBeGreaterThanOrEqual(2)
      expect(split!.pieceCutApprox).toBeLessThanOrEqual(BOLT + 1e-6)
      // Each piece should fit across the bolt in at least one orientation
      const pieceW = cutSize(split!.pieceFinishedW, SA)
      const pieceL = cutSize(split!.pieceFinishedL, SA)
      const fits =
        pieceW <= BOLT + 1e-6 || pieceL <= BOLT + 1e-6
      expect(fits).toBe(true)
    })

    it('fits no orientation on the bolt', () => {
      const panel = rectPanel('huge-rect', cutW, cutL)
      expect(orientationsThatFit(panel, BOLT)).toEqual([])
      const fp0 = panelFootprint(panel)
      const fp90 = panelFootprint({ ...panel, rotation: 90 })
      expect(fp0.w).toBeGreaterThan(BOLT)
      expect(fp90.w).toBeGreaterThan(BOLT)
    })
  })

  describe('very small trapezoid', () => {
    const cut = trapCutFromFinished(0.5, 0.75, 1, SA)

    it('trapCutFromFinished expands each edge by 2×SA', () => {
      expect(cut.topWidth).toBeCloseTo(1.5, 6)
      expect(cut.bottomWidth).toBeCloseTo(1.75, 6)
      expect(cut.height).toBeCloseTo(2, 6)
      expect(cut.width).toBeCloseTo(1.75, 6)
      expect(cut.length).toBeCloseTo(2, 6)
    })

    it('does not block add (no error message)', () => {
      expect(
        panelAddBlockMessage('trap', cut.width, cut.length, BOLT, SA),
      ).toBeNull()
    })

    it('fits and nests as a tiny trap', () => {
      const panel = trapPanel('tiny-trap', cut)
      expect(orientationsThatFit(panel, BOLT).length).toBeGreaterThan(0)
      const nested = autoNestPanels([panel], BOLT)
      expect(nested).toHaveLength(1)
      expect(usedLengthInches(nested)).toBeLessThan(5)
    })
  })

  describe('very large trapezoid', () => {
    const cut = trapCutFromFinished(80, 100, 90, SA)

    it('cut AABB exceeds the bolt in both dimensions', () => {
      expect(cut.width).toBeGreaterThan(BOLT)
      expect(cut.length).toBeGreaterThan(BOLT)
      expect(cut.topWidth).toBeCloseTo(81, 6)
      expect(cut.bottomWidth).toBeCloseTo(101, 6)
      expect(cut.height).toBeCloseTo(91, 6)
    })

    it('blocks add with the resize-only error message (no rect split path)', () => {
      expect(
        panelAddBlockMessage('trap', cut.width, cut.length, BOLT, SA),
      ).toBe(PANEL_TOO_LARGE_RESIZE)
      // Same geometry as a rect would suggest split — trap path must still say resize
      expect(
        panelAddBlockMessage('rect', cut.width, cut.length, BOLT, SA),
      ).toBe(PANEL_TOO_LARGE_SPLIT)
    })

    it('fits no orientation on the bolt', () => {
      const panel = trapPanel('huge-trap', cut)
      expect(orientationsThatFit(panel, BOLT)).toEqual([])
    })
  })
})
