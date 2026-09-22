import { describe, expect, it } from 'vitest'
import {
  autoNestPanels,
  circleCutFromFinished,
  cutSize,
  orientationsThatFit,
  panelFootprint,
  suggestSplit,
  trapCutFromFinished,
  tryRotate90,
  usedLengthInches,
  irregularCutFromFinished,
  defaultDiagonal,
  type Panel,
} from './geometry'
import {
  PANEL_TOO_LARGE_RESIZE,
  PANEL_TOO_LARGE_SPLIT,
  WONT_FIT_AT_90,
  panelAddBlockMessage,
  rotate90BlockMessage,
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


function circlePanel(id: string, cutDiameter: number): Panel {
  return {
    id,
    label: id,
    kind: 'circle',
    width: cutDiameter,
    length: cutDiameter,
    x: 0,
    y: 0,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '#00796b',
  }
}

describe('extreme circle sizes', () => {
  describe('very small circle', () => {
    const finD = 0.5
    const cut = circleCutFromFinished(finD, SA)

    it('cut diameter is finished + 2×SA', () => {
      expect(cut.diameter).toBeCloseTo(1.5, 6)
      expect(cut.width).toBe(cut.diameter)
      expect(cut.length).toBe(cut.diameter)
    })

    it('does not block add', () => {
      expect(panelAddBlockMessage('circle', cut.diameter, cut.diameter, BOLT, SA)).toBeNull()
    })

    it('fits and nests', () => {
      const panel = circlePanel('tiny-circ', cut.diameter)
      expect(orientationsThatFit(panel, BOLT)).toEqual([0])
      const nested = autoNestPanels([panel], BOLT)
      expect(nested).toHaveLength(1)
    })
  })

  describe('very large circle', () => {
    const cut = circleCutFromFinished(80, SA)

    it('cut diameter exceeds the bolt', () => {
      expect(cut.diameter).toBeGreaterThan(BOLT)
    })

    it('blocks add with the resize-only error message (no split path)', () => {
      expect(
        panelAddBlockMessage('circle', cut.diameter, cut.diameter, BOLT, SA),
      ).toBe(PANEL_TOO_LARGE_RESIZE)
    })

    it('fits no orientation on the bolt', () => {
      expect(orientationsThatFit(circlePanel('huge-circ', cut.diameter), BOLT)).toEqual([])
    })
  })
})

describe('tall panel rotate 90°', () => {
  it('blocks 90° when length exceeds bolt width, with the wont-fit message', () => {
    // 20″ across × 80″ down — fits at 0°, but 90° needs 80″ across > 54″ bolt
    const panel = rectPanel('tall', 20, 80)
    // only 0° fits: rotated footprint would be 80″ across > 54″ bolt
    expect(orientationsThatFit(panel, BOLT)).toEqual([0])
    expect(panelFootprint({ ...panel, rotation: 90 }).w).toBeGreaterThan(BOLT)

    const rotated = tryRotate90(panel, [], BOLT)
    expect(rotated).toBeNull()
    expect(rotate90BlockMessage(rotated != null)).toBe(WONT_FIT_AT_90)
    expect(WONT_FIT_AT_90).toBe("Won't fit at 90° on this bolt — split or resize")
  })

  it('allows 90° when the tall side still fits across the bolt', () => {
    // 20×40 — at 90° footprint width is 40 ≤ 54
    const panel = rectPanel('tall-ok', 20, 40)
    expect(orientationsThatFit(panel, BOLT)).toEqual([0, 90])
    const rotated = tryRotate90(panel, [], BOLT)
    expect(rotated).not.toBeNull()
    expect(rotated!.rotation).toBe(90)
    expect(rotate90BlockMessage(rotated != null)).toBeNull()
  })

  it('same wont-fit message for a tall trapezoid that cannot rotate', () => {
    const cut = trapCutFromFinished(18, 22, 70, SA) // height 71 cut, width ~23
    const panel = trapPanel('tall-trap', cut)
    expect(cut.length).toBeGreaterThan(BOLT)
    expect(cut.width).toBeLessThanOrEqual(BOLT)
    expect(orientationsThatFit(panel, BOLT)).toEqual([0])
    const rotated = tryRotate90(panel, [], BOLT)
    expect(rotated).toBeNull()
    expect(rotate90BlockMessage(false)).toBe(WONT_FIT_AT_90)
  })
})


function irregularPanel(
  id: string,
  cut: NonNullable<ReturnType<typeof irregularCutFromFinished>>,
): Panel {
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
    color: '#c45c26',
  }
}

describe('extreme irregular sizes', () => {
  describe('very small irregular', () => {
    const finD = defaultDiagonal(0.5, 0.75, 0.5, 0.9)
    const cut = irregularCutFromFinished(0.5, 0.75, 0.5, 0.9, finD, SA)!

    it('expands all five lengths by 2×SA', () => {
      expect(cut.sideLeft).toBeCloseTo(1.5, 6)
      expect(cut.sideFront).toBeCloseTo(1.75, 6)
      expect(cut.diagonal).toBeCloseTo(finD + 1, 6)
    })

    it('does not block add', () => {
      expect(panelAddBlockMessage('irregular', cut.width, cut.length, BOLT, SA)).toBeNull()
    })

    it('fits and nests', () => {
      const panel = irregularPanel('tiny-irr', cut)
      expect(orientationsThatFit(panel, BOLT).length).toBeGreaterThan(0)
      const nested = autoNestPanels([panel], BOLT)
      expect(nested).toHaveLength(1)
    })
  })

  describe('very large irregular', () => {
    const finD = defaultDiagonal(80, 90, 80, 100)
    const cut = irregularCutFromFinished(80, 90, 80, 100, finD, SA)!

    it('AABB exceeds the bolt in both dims', () => {
      expect(cut.width).toBeGreaterThan(BOLT)
      expect(cut.length).toBeGreaterThan(BOLT)
    })

    it('blocks add with resize-only message (no split)', () => {
      expect(panelAddBlockMessage('irregular', cut.width, cut.length, BOLT, SA)).toBe(
        PANEL_TOO_LARGE_RESIZE,
      )
    })

    it('fits no orientation', () => {
      expect(orientationsThatFit(irregularPanel('huge-irr', cut), BOLT)).toEqual([])
    })
  })
})
