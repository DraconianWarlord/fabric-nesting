/** Units are always inches internally.
 *
 * Geometry helpers are unit-tested via vitest (`npm test`). See geometry.test.ts
 * and src/lib/README.md.
 */

export type Unit = 'in' | 'mm'

export const MM_PER_IN = 25.4

export function toInches(value: number, unit: Unit): number {
  return unit === 'in' ? value : value / MM_PER_IN
}

export function fromInches(inches: number, unit: Unit): number {
  return unit === 'in' ? inches : inches * MM_PER_IN
}

/** Cut size = finished + 2×seam allowance (per side). */
export function cutSize(finished: number, seamAllowance: number): number {
  return finished + 2 * seamAllowance
}

export interface Panel {
  id: string
  label: string
  /** Unrotated cut width (across bolt when rotation=0) */
  width: number
  /** Unrotated cut length (down bolt when rotation=0) */
  length: number
  /** Top-left X on bolt (inches) */
  x: number
  /** Top-left Y on bolt (inches) — down the roll */
  y: number
  /** Multiples of 90° clockwise */
  rotation: 0 | 90 | 180 | 270
  flippedH: boolean
  flippedV: boolean
  color: string
}

export function panelFootprint(p: Panel): { w: number; h: number } {
  const quarter = p.rotation === 90 || p.rotation === 270
  return quarter ? { w: p.length, h: p.width } : { w: p.width, h: p.length }
}

export function panelBounds(p: Panel): { x1: number; y1: number; x2: number; y2: number } {
  const { w, h } = panelFootprint(p)
  return { x1: p.x, y1: p.y, x2: p.x + w, y2: p.y + h }
}

export function usedLengthInches(panels: Panel[]): number {
  if (panels.length === 0) return 0
  return Math.max(...panels.map((p) => panelBounds(p).y2))
}

export function exactYards(usedInches: number, wastePercent = 0): number {
  return (usedInches / 36) * (1 + wastePercent / 100)
}

/** Sailrite sells full yards — default step is 1. */
export function orderYards(exact: number, step = 1): number {
  if (exact <= 0) return 0
  return Math.ceil(exact / step - 1e-9) * step
}

export function aabbOverlap(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
  eps = 1e-6,
): boolean {
  return a.x1 < b.x2 - eps && a.x2 > b.x1 + eps && a.y1 < b.y2 - eps && a.y2 > b.y1 + eps
}

export function overlapsAny(panel: Panel, others: Panel[]): boolean {
  const a = panelBounds(panel)
  return others.some((o) => o.id !== panel.id && aabbOverlap(a, panelBounds(o)))
}

export function offBolt(panel: Panel, fabricWidth: number, eps = 1e-6): boolean {
  const b = panelBounds(panel)
  return b.x1 < -eps || b.x2 > fabricWidth + eps || b.y1 < -eps
}

/** True when panel fits on bolt without overlapping others. */
export function canPlace(panel: Panel, others: Panel[], fabricWidth: number): boolean {
  return !offBolt(panel, fabricWidth) && !overlapsAny(panel, others)
}

export function rotate90(panel: Panel): Panel {
  const next = ((panel.rotation + 90) % 360) as 0 | 90 | 180 | 270
  return { ...panel, rotation: next }
}

export function flipH(panel: Panel): Panel {
  return { ...panel, flippedH: !panel.flippedH }
}

export function flipV(panel: Panel): Panel {
  return { ...panel, flippedV: !panel.flippedV }
}

export function clampPanelToBolt(panel: Panel, fabricWidth: number): Panel {
  const { w } = panelFootprint(panel)
  const x = Math.min(Math.max(0, panel.x), Math.max(0, fabricWidth - w))
  const y = Math.max(0, panel.y)
  return { ...panel, x, y }
}

/** Rotations 0/90 whose footprint width fits on the bolt. */
export function orientationsThatFit(panel: Panel, fabricWidth: number): Array<0 | 90> {
  const out: Array<0 | 90> = []
  for (const rotation of [0, 90] as const) {
    const fp = panelFootprint({ ...panel, rotation })
    if (fp.w <= fabricWidth + 1e-6) out.push(rotation)
  }
  return out
}

function acrossCount(fpW: number, fabricWidth: number, gap: number): number {
  if (fpW <= 0) return 0
  return Math.floor((fabricWidth + gap) / (fpW + gap))
}

function makeProbe(width: number, length: number, x: number, y: number): Panel {
  return {
    id: '__probe__',
    label: '',
    width,
    length,
    x,
    y,
    rotation: 0,
    flippedH: false,
    flippedV: false,
    color: '',
  }
}

/** True when horizontal pattern repeat is active (vertical stripes / 2D). */
export function hasHRepeat(hRepeat: number): boolean {
  return hRepeat > 0
}

/** True when vertical pattern repeat is active (horizontal stripes / 2D). */
export function hasVRepeat(vRepeat: number): boolean {
  return vRepeat > 0
}

/**
 * Pattern packing/snap is active when at least one axis repeat is > 0.
 * H>0 & V=0 → vertical stripes (snap X only).
 * H=0 & V>0 → horizontal stripes (snap Y only).
 * Both > 0 → 2D cell centers. Both 0 → off.
 */
export function patternEnabled(hRepeat: number, vRepeat: number): boolean {
  return hasHRepeat(hRepeat) || hasVRepeat(vRepeat)
}

/**
 * Horizontal offset that centers the pattern tile block on the bolt width.
 * Leftover width (fabricWidth % hRepeat) is split equally left/right.
 * Example: patternHOffset(54, 10) === 2 (remainder 4 → 2 each side).
 */
export function patternHOffset(fabricWidth: number, hRepeat: number): number {
  if (hRepeat <= 0) return 0
  return (fabricWidth % hRepeat) / 2
}

/**
 * Pattern cell / stripe centers for placement search.
 * 2D: cx = hOffset+(i+0.5)*h, cy = (j+0.5)*v
 * Vertical stripes (H only): one row of X stripe centers at cy=0 (Y unconstrained by caller).
 * Horizontal stripes (V only): Y stripe centers at cx=fabricWidth/2 (X unconstrained by caller).
 */
export function patternCellCenters(
  hRepeat: number,
  vRepeat: number,
  fabricWidth: number,
  maxLength: number,
): { cx: number; cy: number }[] {
  if (!patternEnabled(hRepeat, vRepeat)) return []
  const centers: { cx: number; cy: number }[] = []
  const hasH = hasHRepeat(hRepeat)
  const hasV = hasVRepeat(vRepeat)

  if (hasH && hasV) {
    const hOffset = patternHOffset(fabricWidth, hRepeat)
    const iMax = Math.ceil(fabricWidth / hRepeat) + 1
    const jMax = Math.ceil(Math.max(maxLength, vRepeat) / vRepeat) + 2
    for (let j = 0; j < jMax; j++) {
      for (let i = 0; i < iMax; i++) {
        const cx = hOffset + (i + 0.5) * hRepeat
        const cy = (j + 0.5) * vRepeat
        if (cx >= -1e-6 && cx <= fabricWidth + 1e-6 && cy <= maxLength + vRepeat + 1e-6) {
          centers.push({ cx, cy })
        }
      }
    }
    return centers
  }

  if (hasH) {
    const hOffset = patternHOffset(fabricWidth, hRepeat)
    const iMax = Math.ceil(fabricWidth / hRepeat) + 1
    for (let i = 0; i < iMax; i++) {
      const cx = hOffset + (i + 0.5) * hRepeat
      if (cx >= -1e-6 && cx <= fabricWidth + 1e-6) {
        centers.push({ cx, cy: 0 })
      }
    }
    return centers
  }

  // V only — horizontal stripes
  const jMax = Math.ceil(Math.max(maxLength, vRepeat) / vRepeat) + 2
  for (let j = 0; j < jMax; j++) {
    const cy = (j + 0.5) * vRepeat
    if (cy <= maxLength + vRepeat + 1e-6) {
      centers.push({ cx: fabricWidth / 2, cy })
    }
  }
  return centers
}

/**
 * Snap panel center onto the pattern grid.
 * 2D: both axes. Vertical stripes (V=0): X only. Horizontal stripes (H=0): Y only.
 * Clamped onto the bolt. Returns adjusted top-left x,y.
 */
export function snapCenterToPattern(
  panel: Panel,
  hRepeat: number,
  vRepeat: number,
  fabricWidth: number,
): { x: number; y: number } {
  if (!patternEnabled(hRepeat, vRepeat)) return { x: panel.x, y: panel.y }
  const { w, h } = panelFootprint(panel)
  let x = panel.x
  let y = panel.y
  const cx = panel.x + w / 2
  const cy = panel.y + h / 2

  if (hasHRepeat(hRepeat)) {
    const hOffset = patternHOffset(fabricWidth, hRepeat)
    const i = Math.max(0, Math.round((cx - hOffset) / hRepeat - 0.5))
    const ncx = hOffset + (i + 0.5) * hRepeat
    x = ncx - w / 2
  }
  if (hasVRepeat(vRepeat)) {
    const j = Math.max(0, Math.round(cy / vRepeat - 0.5))
    const ncy = (j + 0.5) * vRepeat
    y = ncy - h / 2
  }

  x = Math.min(Math.max(0, x), Math.max(0, fabricWidth - w))
  y = Math.max(0, y)
  return { x, y }
}

/**
 * True bottom-left-fill: evaluate all candidate positions and pick the one
 * minimizing (y+h, y, x) among non-overlapping on-bolt fits.
 */
export function findBestSpot(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
): { x: number; y: number } {
  const xs = new Set<number>([0, Math.max(0, fabricWidth - width)])
  const ys = new Set<number>([0])
  for (const p of existing) {
    const b = panelBounds(p)
    xs.add(b.x1)
    xs.add(b.x2 + gap)
    ys.add(b.y1)
    ys.add(b.y2 + gap)
  }
  const xCands = [...xs].filter((x) => x >= -1e-9).sort((a, b) => a - b)
  const yCands = [...ys].filter((y) => y >= -1e-9).sort((a, b) => a - b)

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const y of yCands) {
    for (const x of xCands) {
      if (x < -1e-9 || x + width > fabricWidth + 1e-6) continue
      if (y < -1e-9) continue
      const probe = makeProbe(width, length, x, y)
      if (overlapsAny(probe, existing)) continue
      const yh = y + length
      const better =
        yh < bestYh - 1e-9 ||
        (Math.abs(yh - bestYh) <= 1e-9 &&
          (y < bestY - 1e-9 || (Math.abs(y - bestY) <= 1e-9 && x < bestX - 1e-9)))
      if (better) {
        best = { x, y }
        bestYh = yh
        bestY = y
        bestX = x
      }
    }
  }

  if (best) return best
  const y = existing.length ? usedLengthInches(existing) + gap : 0
  return { x: 0, y }
}

/**
 * Prefer placements whose panel center sits on the pattern grid.
 * 2D: cell centers. Vertical stripes: snap X to H stripes, free Y candidates.
 * Horizontal stripes: snap Y to V stripes, free X candidates.
 * Among candidates, pick bottom-left-ish (min y+h, then y, then x).
 * Falls back to findBestSpot when no patterned spot fits.
 */
export function findBestSpotOnPattern(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  hRepeat: number,
  vRepeat: number,
  gap = 0.25,
): { x: number; y: number } {
  if (!patternEnabled(hRepeat, vRepeat)) {
    return findBestSpot(width, length, fabricWidth, existing, gap)
  }

  const hasH = hasHRepeat(hRepeat)
  const hasV = hasVRepeat(vRepeat)
  const used = usedLengthInches(existing)

  let xCands: number[]
  let yCands: number[]

  if (hasH) {
    const hOffset = patternHOffset(fabricWidth, hRepeat)
    const iMax = Math.ceil(fabricWidth / hRepeat) + 1
    const xs: number[] = []
    for (let i = 0; i < iMax; i++) {
      const cx = hOffset + (i + 0.5) * hRepeat
      const x = cx - width / 2
      if (x >= -1e-9 && x + width <= fabricWidth + 1e-6) xs.push(x)
    }
    xCands = xs
  } else {
    const xs = new Set<number>([0, Math.max(0, fabricWidth - width)])
    for (const p of existing) {
      const b = panelBounds(p)
      xs.add(b.x1)
      xs.add(b.x2 + gap)
    }
    xCands = [...xs].filter((x) => x >= -1e-9).sort((a, b) => a - b)
  }

  if (hasV) {
    const maxLen = Math.max(used + length + gap + vRepeat * 3, length + vRepeat * 4, vRepeat * 8)
    const jMax = Math.ceil(maxLen / vRepeat) + 2
    const ys: number[] = []
    for (let j = 0; j < jMax; j++) {
      const cy = (j + 0.5) * vRepeat
      const y = cy - length / 2
      if (y >= -1e-9) ys.push(y)
    }
    yCands = ys
  } else {
    const ys = new Set<number>([0])
    for (const p of existing) {
      const b = panelBounds(p)
      ys.add(b.y1)
      ys.add(b.y2 + gap)
    }
    yCands = [...ys].filter((y) => y >= -1e-9).sort((a, b) => a - b)
  }

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const y of yCands) {
    for (const x of xCands) {
      if (x < -1e-9 || x + width > fabricWidth + 1e-6) continue
      if (y < -1e-9) continue
      const probe = makeProbe(width, length, x, y)
      if (overlapsAny(probe, existing)) continue
      const yh = y + length
      const better =
        yh < bestYh - 1e-9 ||
        (Math.abs(yh - bestYh) <= 1e-9 &&
          (y < bestY - 1e-9 || (Math.abs(y - bestY) <= 1e-9 && x < bestX - 1e-9)))
      if (better) {
        best = { x, y }
        bestYh = yh
        bestY = y
        bestX = x
      }
    }
  }

  if (best) return best
  return findBestSpot(width, length, fabricWidth, existing, gap)
}

/** Route to pattern-aware or normal placement. */
export function placeSpot(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
  hRepeat = 0,
  vRepeat = 0,
): { x: number; y: number } {
  if (patternEnabled(hRepeat, vRepeat)) {
    return findBestSpotOnPattern(width, length, fabricWidth, existing, hRepeat, vRepeat, gap)
  }
  return findBestSpot(width, length, fabricWidth, existing, gap)
}

/** Thin wrapper — prefer findBestSpot for new call sites. */
export function findOpenSpot(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
): { x: number; y: number } {
  return findBestSpot(width, length, fabricWidth, existing, gap)
}

function isValidPacking(panels: Panel[], fabricWidth: number): boolean {
  for (const p of panels) {
    if (offBolt(p, fabricWidth)) return false
    if (overlapsAny(p, panels)) return false
  }
  return true
}

function clonePanels(panels: Panel[]): Panel[] {
  return panels.map((p) => ({ ...p }))
}

/** Deterministic PRNG (Mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function stableSort(panels: Panel[], cmp: (a: Panel, b: Panel) => number): Panel[] {
  return [...panels].sort((a, b) => {
    const d = cmp(a, b)
    return d !== 0 ? d : a.id.localeCompare(b.id)
  })
}

type SortFn = (panels: Panel[]) => Panel[]

const SORT_ORDERS: SortFn[] = [
  (ps) => stableSort(ps, (a, b) => b.width * b.length - a.width * a.length),
  (ps) =>
    stableSort(
      ps,
      (a, b) => Math.max(b.width, b.length) - Math.max(a.width, a.length),
    ),
  (ps) =>
    stableSort(
      ps,
      (a, b) => Math.min(b.width, b.length) - Math.min(a.width, a.length),
    ),
  (ps) => stableSort(ps, (a, b) => b.length - a.length),
  (ps) => stableSort(ps, (a, b) => b.width - a.width),
  (ps) =>
    stableSort(ps, (a, b) => {
      const aspect = (p: Panel) => {
        const lo = Math.min(p.width, p.length)
        return lo <= 0 ? 0 : Math.max(p.width, p.length) / lo
      }
      return aspect(b) - aspect(a)
    }),
  (ps) => stableSort(ps, (a, b) => a.width * a.length - b.width * b.length),
]

function placeAtOrientation(
  panel: Panel,
  rotation: 0 | 90,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat = 0,
  vRepeat = 0,
): Panel {
  const oriented: Panel = { ...panel, rotation, x: 0, y: 0 }
  const fp = panelFootprint(oriented)
  const spot = placeSpot(fp.w, fp.h, fabricWidth, placed, gap, hRepeat, vRepeat)
  return { ...panel, rotation, x: spot.x, y: spot.y }
}

function tryOrientations(panel: Panel, fabricWidth: number): Array<0 | 90> {
  const orients = orientationsThatFit(panel, fabricWidth)
  return orients.length > 0 ? orients : ([0] as Array<0 | 90>)
}

/** Orientation chooser: min used length after place, then lower y, then lower x. */
function chooseMinUsed(
  panel: Panel,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat = 0,
  vRepeat = 0,
): Panel {
  let best: Panel | null = null
  let bestUsed = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const rotation of tryOrientations(panel, fabricWidth)) {
    const candidate = placeAtOrientation(panel, rotation, fabricWidth, placed, gap, hRepeat, vRepeat)
    const used = usedLengthInches([...placed, candidate])
    const better =
      used < bestUsed - 1e-9 ||
      (Math.abs(used - bestUsed) <= 1e-9 &&
        (candidate.y < bestY - 1e-9 ||
          (Math.abs(candidate.y - bestY) <= 1e-9 && candidate.x < bestX - 1e-9)))
    if (better) {
      best = candidate
      bestUsed = used
      bestY = candidate.y
      bestX = candidate.x
    }
  }
  return best!
}

/** Orientation chooser: max across, then min footprint height. */
function chooseMaxAcross(
  panel: Panel,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat = 0,
  vRepeat = 0,
): Panel {
  const tryRots = tryOrientations(panel, fabricWidth)
  let chosen: 0 | 90 = tryRots[0]
  let bestAcross = -1
  let bestH = Infinity
  for (const rotation of tryRots) {
    const fp = panelFootprint({ ...panel, rotation })
    const across = acrossCount(fp.w, fabricWidth, gap)
    if (across > bestAcross || (across === bestAcross && fp.h < bestH - 1e-9)) {
      bestAcross = across
      bestH = fp.h
      chosen = rotation
    }
  }
  return placeAtOrientation(panel, chosen, fabricWidth, placed, gap, hRepeat, vRepeat)
}

/** Orientation chooser: min footprint height, then max across. */
function chooseMinHeight(
  panel: Panel,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat = 0,
  vRepeat = 0,
): Panel {
  const tryRots = tryOrientations(panel, fabricWidth)
  let chosen: 0 | 90 = tryRots[0]
  let bestH = Infinity
  let bestAcross = -1
  for (const rotation of tryRots) {
    const fp = panelFootprint({ ...panel, rotation })
    const across = acrossCount(fp.w, fabricWidth, gap)
    if (fp.h < bestH - 1e-9 || (Math.abs(fp.h - bestH) <= 1e-9 && across > bestAcross)) {
      bestH = fp.h
      bestAcross = across
      chosen = rotation
    }
  }
  return placeAtOrientation(panel, chosen, fabricWidth, placed, gap, hRepeat, vRepeat)
}

type OrientChooser = (
  panel: Panel,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat?: number,
  vRepeat?: number,
) => Panel

const ORIENT_CHOOSERS: OrientChooser[] = [chooseMinUsed, chooseMaxAcross, chooseMinHeight]

function packOrdered(
  ordered: Panel[],
  fabricWidth: number,
  gap: number,
  choose: OrientChooser,
  hRepeat = 0,
  vRepeat = 0,
): Panel[] {
  const placed: Panel[] = []
  for (const panel of ordered) {
    placed.push(choose(panel, fabricWidth, placed, gap, hRepeat, vRepeat))
  }
  return placed
}

const CANDIDATE_CAP = 12

/** Round layout signature so near-identical packs collapse. */
function layoutKey(panels: Panel[]): string {
  return [...panels]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const x = Math.round(p.x * 100) / 100
      const y = Math.round(p.y * 100) / 100
      return `${p.id}:${x},${y},${p.rotation}`
    })
    .join('|')
}

/**
 * Generate unique ranked nest layouts (used length ascending).
 * Dedupes near-identical packs; caps at ~12 for UX cycling.
 * When at least one of hRepeat/vRepeat is > 0, placements snap to pattern (2D or 1D stripes).
 */
export function autoNestCandidates(
  panels: Panel[],
  fabricWidth: number,
  gap = 0.25,
  hRepeat = 0,
  vRepeat = 0,
): Panel[][] {
  if (panels.length === 0) return []

  const raw: Panel[][] = []

  if (isValidPacking(panels, fabricWidth)) {
    raw.push(clonePanels(panels))
  }

  for (const sortFn of SORT_ORDERS) {
    const ordered = sortFn(panels)
    for (const choose of ORIENT_CHOOSERS) {
      raw.push(packOrdered(ordered, fabricWidth, gap, choose, hRepeat, vRepeat))
    }
  }

  for (let seed = 1; seed <= 24; seed++) {
    const shuffled = seededShuffle(panels, seed)
    raw.push(packOrdered(shuffled, fabricWidth, gap, chooseMinUsed, hRepeat, vRepeat))
  }

  const seen = new Set<string>()
  const unique: { panels: Panel[]; used: number }[] = []

  for (const result of raw) {
    if (!isValidPacking(result, fabricWidth)) continue
    const key = layoutKey(result)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ panels: result, used: usedLengthInches(result) })
  }

  unique.sort((a, b) => a.used - b.used || layoutKey(a.panels).localeCompare(layoutKey(b.panels)))

  return unique.slice(0, CANDIDATE_CAP).map((u) => u.panels)
}

/**
 * Re-pack panels tightly: returns the shortest candidate layout.
 * Never worsens a valid current layout (baseline preference on ties).
 */
export function autoNestPanels(
  panels: Panel[],
  fabricWidth: number,
  gap = 0.25,
  hRepeat = 0,
  vRepeat = 0,
): Panel[] {
  const candidates = autoNestCandidates(panels, fabricWidth, gap, hRepeat, vRepeat)
  if (candidates.length === 0) return clonePanels(panels)

  // Prefer baseline if it ties the shortest used length.
  const bestUsed = usedLengthInches(candidates[0])
  if (isValidPacking(panels, fabricWidth)) {
    const baselineUsed = usedLengthInches(panels)
    if (Math.abs(baselineUsed - bestUsed) <= 1e-9) {
      return clonePanels(panels)
    }
  }
  return candidates[0]
}

/**
 * Next sequential integer label for blank/generic panel names.
 * Choice: max existing pure-numeric label + 1 (non-numeric labels ignored).
 * Example: panels labeled "3","Front","7" → "8".
 */
export function nextSequentialLabel(panels: { label: string }[]): string {
  let max = 0
  for (const p of panels) {
    const t = p.label.trim()
    if (/^[1-9]\d*$/.test(t)) {
      max = Math.max(max, Number(t))
    }
  }
  return String(max + 1)
}

/** True when label is blank or the generic placeholder "Panel" (no unique id). */
export function isGenericLabel(label: string): boolean {
  const t = label.trim()
  return t === '' || /^panel$/i.test(t)
}

/** Panel fill palette — Sailrite-ish navy/indigo/teal/coral/amber/olive. */
export const PANEL_COLORS = [
  '#1a237e', // navy
  '#2a33ab', // indigo
  '#00796b', // teal
  '#e75053', // coral
  '#f1a500', // amber
  '#558b2f', // olive
  '#007dc6', // accent blue
]

/**
 * Map nest positions/rotations onto panels by id, preserving the original
 * array order (entry order). Does not reorder or replace the panels array.
 */
export function applyNestLayoutById(panels: Panel[], nested: Panel[]): Panel[] {
  return panels.map((p) => {
    const n = nested.find((x) => x.id === p.id)
    return n ? { ...p, x: n.x, y: n.y, rotation: n.rotation } : p
  })
}

export type SplitDim = 'width' | 'length'

export interface SplitSuggestion {
  /** Which cut dimension to split (the one that exceeds the bolt most usefully). */
  splitDim: SplitDim
  /** Cut size of the dimension being split. */
  overSize: number
  /** Cut size of the unsplit dimension. */
  otherCut: number
  /** Number of strips: ceil(overSize / fabricWidth). */
  pieceCount: number
  /** Approximate cut size of each strip along the split dim (overSize / n). */
  pieceCutApprox: number
  /** Finished width of each suggested panel (SA removed from cut, then split). */
  pieceFinishedW: number
  /** Finished length of each suggested panel. */
  pieceFinishedL: number
}

/**
 * When neither 0° nor 90° footprint fits on the bolt (both cut sides > fabricWidth),
 * recommend splitting the longer excess dimension into N ≈ ceil(over/F) strips.
 * Returns null when at least one orientation fits.
 *
 * Finished piece sizes divide the finished over-dim by N (cut = finished + 2×SA).
 * Callers should mention adding seam allowance along join edges when SA > 0.
 */
export function suggestSplit(
  cutW: number,
  cutL: number,
  fabricWidth: number,
  seamAllowance = 0,
): SplitSuggestion | null {
  if (!(fabricWidth > 0) || !(cutW > 0) || !(cutL > 0)) return null
  const fits0 = cutW <= fabricWidth + 1e-6
  const fits90 = cutL <= fabricWidth + 1e-6
  if (fits0 || fits90) return null

  // Prefer splitting the longer side (both exceed F).
  const splitDim: SplitDim = cutW >= cutL ? 'width' : 'length'
  const overSize = splitDim === 'width' ? cutW : cutL
  const otherCut = splitDim === 'width' ? cutL : cutW
  const pieceCount = Math.max(2, Math.ceil(overSize / fabricWidth - 1e-12))
  const pieceCutApprox = overSize / pieceCount

  const sa = Math.max(0, seamAllowance)
  const finW = Math.max(0, cutW - 2 * sa)
  const finL = Math.max(0, cutL - 2 * sa)

  let pieceFinishedW: number
  let pieceFinishedL: number
  if (splitDim === 'width') {
    pieceFinishedW = finW / pieceCount
    pieceFinishedL = finL
  } else {
    pieceFinishedW = finW
    pieceFinishedL = finL / pieceCount
  }

  return {
    splitDim,
    overSize,
    otherCut,
    pieceCount,
    pieceCutApprox,
    pieceFinishedW,
    pieceFinishedL,
  }
}

/**
 * Attempt a 90° rotation. Returns the rotated (and possibly re-spotted) panel
 * only when the new footprint width fits the bolt and canPlace succeeds.
 * Returns null when rotation would hang off the bolt — caller should keep prior pose.
 */
export function tryRotate90(
  panel: Panel,
  others: Panel[],
  fabricWidth: number,
  spotFn: (
    width: number,
    length: number,
    existing: Panel[],
  ) => { x: number; y: number } = (w, h, existing) => findBestSpot(w, h, fabricWidth, existing),
): Panel | null {
  const rotated = rotate90(panel)
  const fp = panelFootprint(rotated)
  // Rotated cut width must fit across the bolt.
  if (fp.w > fabricWidth + 1e-6) return null

  let next = clampPanelToBolt(rotated, fabricWidth)
  const rest = others.filter((o) => o.id !== panel.id)
  if (canPlace(next, rest, fabricWidth)) return next

  const spot = spotFn(fp.w, fp.h, rest)
  next = clampPanelToBolt({ ...rotated, x: spot.x, y: spot.y }, fabricWidth)
  if (canPlace(next, rest, fabricWidth)) return next

  return null
}
