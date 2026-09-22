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

export type PanelKind = 'rect' | 'trap' | 'circle' | 'irregular'

export interface Point {
  x: number
  y: number
}

export interface Panel {
  id: string
  label: string
  /**
   * Shape discriminant. Undefined / omitted treated as `'rect'` for backward compat.
   * - `'rect'`: axis-aligned rectangle from `width` × `length` (cut sizes).
   * - `'trap'`: trapezoid with parallel top & bottom (across bolt at rotation=0).
   *   Stores cut `topWidth` / `bottomWidth`; `length` is cut height; `width` is
   *   unrotated AABB width = max(topWidth, bottomWidth).
   * - `'circle'`: circle from finished diameter; `width` = `length` = cut diameter.
   *   `topWidth` / `bottomWidth` unused. Rotation-invariant (footprint always square).
   * - `'irregular'`: general quad from four side lengths + one diagonal (fabric-calculator
   *   model). Stores cut `sideLeft`/`sideFront`/`sideRight`/`sideBack`/`diagonal`;
   *   `width`/`length` are the unrotated AABB of the oriented cut polygon.
   */
  kind?: PanelKind
  /** Unrotated cut width (across bolt when rotation=0). For traps: max(top,bottom). For circles: cut diameter. For irregular: AABB width. */
  width: number
  /** Unrotated cut length (down bolt when rotation=0). For traps: cut height. For circles: cut diameter (= width). For irregular: AABB height. */
  length: number
  /** Trap only: cut top parallel-edge width (local y=0). Unused for circles/irregular. */
  topWidth?: number
  /** Trap only: cut bottom parallel-edge width (local y=length). Unused for circles/irregular. */
  bottomWidth?: number
  /** Irregular only: cut left edge length (front-left → back-left). */
  sideLeft?: number
  /** Irregular only: cut front edge length (front-left → front-right). */
  sideFront?: number
  /** Irregular only: cut right edge length (front-right → back-right). */
  sideRight?: number
  /** Irregular only: cut back edge length (back-right → back-left). */
  sideBack?: number
  /** Irregular only: cut diagonal front-left → back-right (left-bottom → top-right). */
  diagonal?: number
  /** Top-left X on bolt (inches) — AABB of the oriented cut polygon */
  x: number
  /** Top-left Y on bolt (inches) — down the roll */
  y: number
  /** Multiples of 90° clockwise */
  rotation: 0 | 90 | 180 | 270
  flippedH: boolean
  flippedV: boolean
  color: string
}

/** True when panel is a trapezoid (explicit kind). */
export function isTrap(p: Panel): boolean {
  return p.kind === 'trap'
}

/** True when panel is a circle (explicit kind). */
export function isCircle(p: Panel): boolean {
  return p.kind === 'circle'
}

/** True when panel is an irregular quadrilateral (explicit kind). */
export function isIrregular(p: Panel): boolean {
  return p.kind === 'irregular'
}

/** Trap or irregular: convex cut polygon (SAT / clip path), not AABB-only. */
export function isPolyPanel(p: Panel): boolean {
  return isTrap(p) || isIrregular(p)
}

/** N-gon sides used when a circle needs a polygon (e.g. circle–trap overlap, PDF fallback). */
export const CIRCLE_APPROX_SIDES = 32

/**
 * Seam allowance for circles: cut diameter = finished diameter + 2×SA
 * (same expand-each-dim rule as rect/trap). Returns width=length=diameter.
 */
export function circleCutFromFinished(
  finishedDiameter: number,
  seamAllowance: number,
): { diameter: number; width: number; length: number } {
  const sa = Math.max(0, seamAllowance)
  const diameter = finishedDiameter + 2 * sa
  return { diameter, width: diameter, length: diameter }
}

/** World-space center of a circle panel (AABB center = geometric center). */
export function circleCenter(p: Panel): Point {
  const d = p.width
  return { x: p.x + d / 2, y: p.y + d / 2 }
}

/** Cut radius from stored cut diameter (`width`). */
export function circleRadius(p: Panel): number {
  return p.width / 2
}

/**
 * Local cut circle as regular N-gon (CCW), AABB origin at (0,0), diameter = width.
 * Used for circle–trap SAT and any helper that needs a polygon outline.
 */
export function localCirclePolygon(p: Panel, sides = CIRCLE_APPROX_SIDES): Point[] {
  const d = p.width
  const r = d / 2
  const cx = r
  const cy = r
  const pts: Point[] = []
  for (let i = 0; i < sides; i++) {
    // Start at top (−90°) so the first vertex is centered on the top edge.
    const ang = (i / sides) * Math.PI * 2 - Math.PI / 2
    pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) })
  }
  return pts
}

/**
 * Seam-allowance rule for trapezoids (MVP):
 * Expand each finished dimension by 2×SA, same as rectangles:
 *   cutTop = finishedTop + 2×SA
 *   cutBottom = finishedBottom + 2×SA
 *   cutHeight = finishedHeight + 2×SA
 * Then build an isosceles trapezoid from those cut sizes (centered in its AABB).
 * Prefer this over a full polygon outward-offset for simplicity and consistency.
 */
export function trapCutFromFinished(
  finishedTop: number,
  finishedBottom: number,
  finishedHeight: number,
  seamAllowance: number,
): { topWidth: number; bottomWidth: number; height: number; width: number; length: number } {
  const sa = Math.max(0, seamAllowance)
  const topWidth = finishedTop + 2 * sa
  const bottomWidth = finishedBottom + 2 * sa
  const height = finishedHeight + 2 * sa
  const width = Math.max(topWidth, bottomWidth)
  return { topWidth, bottomWidth, height, width, length: height }
}

/**
 * Local cut trapezoid vertices (unrotated, unflipped), AABB origin at (0,0).
 * Order CCW: top-left, top-right, bottom-right, bottom-left.
 * Isosceles: both parallel edges centered on the AABB width.
 */
export function localTrapPolygon(p: Panel): Point[] {
  const top = p.topWidth ?? p.width
  const bottom = p.bottomWidth ?? p.width
  const h = p.length
  const w = Math.max(top, bottom, p.width)
  const topX = (w - top) / 2
  const botX = (w - bottom) / 2
  return [
    { x: topX, y: 0 },
    { x: topX + top, y: 0 },
    { x: botX + bottom, y: h },
    { x: botX, y: h },
  ]
}

/** Epsilon (inches) for opposite-side “equal” checks in defaultDiagonal. */
export const IRREGULAR_SIDE_EPS = 1e-4

function nearlyEqualSides(a: number, b: number, eps = IRREGULAR_SIDE_EPS): boolean {
  return Math.abs(a - b) <= eps
}

function triangleInequality(a: number, b: number, c: number, eps = 1e-9): boolean {
  return a + b >= c - eps && a + c >= b - eps && b + c >= a - eps && a > 0 && b > 0 && c > 0
}

/** Two-circle intersection. Returns 0–2 points, or null when coincident/invalid. */
function circleCircleIntersect(
  c0: Point,
  r0: number,
  c1: Point,
  r1: number,
): Point[] | null {
  const dx = c1.x - c0.x
  const dy = c1.y - c0.y
  const d = Math.hypot(dx, dy)
  if (!(r0 > 0) || !(r1 > 0) || d < 1e-12) return null
  if (d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return null
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h2 = r0 * r0 - a * a
  if (h2 < -1e-9) return null
  const h = Math.sqrt(Math.max(0, h2))
  const xm = c0.x + (a * dx) / d
  const ym = c0.y + (a * dy) / d
  const rx = (-dy * h) / d
  const ry = (dx * h) / d
  if (h < 1e-12) return [{ x: xm, y: ym }]
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ]
}

function signedPolyArea(pts: Point[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function segmentsProperIntersect(a: Point, b: Point, c: Point, d: Point, eps = 1e-9): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
      ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
    return true
  }
  return false
}

function quadSelfIntersects(A: Point, B: Point, C: Point, D: Point): boolean {
  return segmentsProperIntersect(A, B, C, D) || segmentsProperIntersect(B, C, D, A)
}

/**
 * Default diagonal (finished or cut — same geometry) for irregular quads,
 * matching fabric-calculator.com Fabric Nesting rules:
 *
 * a/c. **Symmetric / keystone**: if either opposite pair is equal (`left≈right`
 *     OR `front≈back`), choose the diagonal that makes an isosceles-style quad
 *     centering the shorter side of the unequal pair over the longer.
 *     (Keystone = one opposite pair equal and the other unequal.)
 * b. **Forepeak**: if left, front, right, back are all mutually unequal, default
 *     so the front-left corner is a right angle (front ⊥ left); diagonal is then
 *     |A→C| with D at (0,left) and C from right/back circle intersection.
 *
 * Uses IRREGULAR_SIDE_EPS for “equal”. Returns 0 when inputs are non-positive.
 */
export function defaultDiagonal(
  left: number,
  front: number,
  right: number,
  back: number,
): number {
  if (!(left > 0) || !(front > 0) || !(right > 0) || !(back > 0)) return 0

  const oppLR = nearlyEqualSides(left, right)
  const oppFB = nearlyEqualSides(front, back)

  if (oppLR || oppFB) {
    // Isosceles / keystone: center shorter base over longer; diagonal from mid-span.
    if (oppLR) {
      // Legs left≈right; bases front/back (may differ).
      const inset = Math.abs(front - back) / 2
      const leg = (left + right) / 2
      const h2 = leg * leg - inset * inset
      if (h2 < 0) return Math.hypot(front, left)
      const h = Math.sqrt(h2)
      return Math.hypot((front + back) / 2, h)
    }
    // Legs front≈back; bases left/right (may differ).
    const inset = Math.abs(left - right) / 2
    const leg = (front + back) / 2
    const h2 = leg * leg - inset * inset
    if (h2 < 0) return Math.hypot(front, left)
    const h = Math.sqrt(h2)
    return Math.hypot((left + right) / 2, h)
  }

  // Forepeak: right angle at front-left A between front (→B) and left (→D).
  const A = { x: 0, y: 0 }
  const B = { x: front, y: 0 }
  const D = { x: 0, y: left }
  const hits = circleCircleIntersect(B, right, D, back)
  if (!hits || hits.length === 0) return Math.hypot(front, left)
  // Prefer C in the first quadrant (convex quad with y≥0).
  let best: Point | null = null
  let bestScore = -Infinity
  for (const C of hits) {
    if (C.y < -1e-6) continue
    const area = signedPolyArea([A, B, C, D])
    const score = (C.x >= -1e-6 ? 1e6 : 0) + Math.abs(area)
    if (score > bestScore) {
      bestScore = score
      best = C
    }
  }
  const C = best ?? hits[0]
  return Math.hypot(C.x - A.x, C.y - A.y)
}

/**
 * Build a local cut quad from four side lengths + diagonal (front-left→back-right).
 * Corners: A front-left, B front-right, C back-right, D back-left.
 * Returns CCW polygon with AABB min at (0,0), or null if impossible / degenerate.
 */
export function quadPolygonFromSides(
  left: number,
  front: number,
  right: number,
  back: number,
  diagonal: number,
): Point[] | null {
  if (
    !(left > 0) ||
    !(front > 0) ||
    !(right > 0) ||
    !(back > 0) ||
    !(diagonal > 0)
  ) {
    return null
  }
  // Triangles formed by the diagonal: ABC (front, right, diag) and ADC (left, back, diag).
  if (!triangleInequality(front, right, diagonal) || !triangleInequality(left, back, diagonal)) {
    return null
  }

  const A: Point = { x: 0, y: 0 }
  const B: Point = { x: front, y: 0 }

  const cHits = circleCircleIntersect(A, diagonal, B, right)
  if (!cHits || cHits.length === 0) return null
  // Prefer C with y ≥ 0.
  let C = cHits[0]
  for (const cand of cHits) {
    if (cand.y >= -1e-9 && (C.y < -1e-9 || cand.y >= C.y - 1e-12)) C = cand
  }
  if (C.y < -1e-6) return null

  const dHits = circleCircleIntersect(A, left, C, back)
  if (!dHits || dHits.length === 0) return null

  let best: Point[] | null = null
  let bestArea = 0
  for (const D of dHits) {
    if (!Number.isFinite(D.x) || !Number.isFinite(D.y)) continue
    if (quadSelfIntersects(A, B, C, D)) continue
    let pts = [A, B, C, D]
    let area = signedPolyArea(pts)
    if (area < -1e-8) {
      pts = [A, D, C, B]
      area = signedPolyArea(pts)
    }
    if (area <= 1e-8) continue
    if (quadSelfIntersects(pts[0], pts[1], pts[2], pts[3])) continue
    if (area > bestArea) {
      bestArea = area
      best = pts
    }
  }
  if (!best) return null

  // Translate so AABB min is (0,0).
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of best) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!(maxX - minX > 1e-9) || !(maxY - minY > 1e-9)) return null
  const out = best.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  if (out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  return out
}

/**
 * Seam-allowance rule for irregular quads (MVP): expand each finished length by
 * 2×SA (four sides + diagonal), same expand-each-dim rule as rect/trap. Then build
 * the cut polygon from those lengths. Returns null if the cut quad is impossible.
 */
export function irregularCutFromFinished(
  finLeft: number,
  finFront: number,
  finRight: number,
  finBack: number,
  finDiagonal: number,
  seamAllowance: number,
): {
  sideLeft: number
  sideFront: number
  sideRight: number
  sideBack: number
  diagonal: number
  width: number
  length: number
} | null {
  const sa = Math.max(0, seamAllowance)
  const sideLeft = finLeft + 2 * sa
  const sideFront = finFront + 2 * sa
  const sideRight = finRight + 2 * sa
  const sideBack = finBack + 2 * sa
  const diagonal = finDiagonal + 2 * sa
  const poly = quadPolygonFromSides(sideLeft, sideFront, sideRight, sideBack, diagonal)
  if (!poly) return null
  let maxX = 0
  let maxY = 0
  for (const p of poly) {
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    sideLeft,
    sideFront,
    sideRight,
    sideBack,
    diagonal,
    width: maxX,
    length: maxY,
  }
}

/**
 * Local cut irregular quad (unrotated, unflipped), AABB origin at (0,0).
 * Falls back to the stored AABB rectangle if side data is missing/invalid.
 */
export function localIrregularPolygon(p: Panel): Point[] {
  const left = p.sideLeft
  const front = p.sideFront
  const right = p.sideRight
  const back = p.sideBack
  const diag = p.diagonal
  if (
    left != null &&
    front != null &&
    right != null &&
    back != null &&
    diag != null
  ) {
    const poly = quadPolygonFromSides(left, front, right, back, diag)
    if (poly) return poly
  }
  return localRectPolygon(p)
}


/** Local rectangle corners CCW from top-left. */
export function localRectPolygon(p: Panel): Point[] {
  return [
    { x: 0, y: 0 },
    { x: p.width, y: 0 },
    { x: p.width, y: p.length },
    { x: 0, y: p.length },
  ]
}

function applyFlip(pts: Point[], w: number, h: number, flipH: boolean, flipV: boolean): Point[] {
  return pts.map((pt) => ({
    x: flipH ? w - pt.x : pt.x,
    y: flipV ? h - pt.y : pt.y,
  }))
}

/** Rotate points 90° CW around origin, then shift so AABB min is (0,0). */
function rotateCwNormalize(pts: Point[], rotation: 0 | 90 | 180 | 270): Point[] {
  if (rotation === 0) return pts.map((p) => ({ ...p }))
  const rot = pts.map((p) => {
    if (rotation === 90) return { x: p.y, y: -p.x }
    if (rotation === 180) return { x: -p.x, y: -p.y }
    return { x: -p.y, y: p.x } // 270
  })
  let minX = Infinity
  let minY = Infinity
  for (const p of rot) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
  }
  return rot.map((p) => ({ x: p.x - minX, y: p.y - minY }))
}

/**
 * World-space cut outline (CCW). Applies flip → rotate → translate to (x,y)
 * as the top-left of the oriented AABB (same anchor as rectangles).
 */
export function panelPolygon(p: Panel): Point[] {
  const local = isCircle(p)
    ? localCirclePolygon(p)
    : isIrregular(p)
      ? localIrregularPolygon(p)
      : isTrap(p)
        ? localTrapPolygon(p)
        : localRectPolygon(p)
  const w = isTrap(p)
    ? Math.max(p.topWidth ?? 0, p.bottomWidth ?? 0, p.width)
    : p.width
  const h = p.length
  const flipped = applyFlip(local, w, h, p.flippedH, p.flippedV)
  const oriented = rotateCwNormalize(flipped, p.rotation)
  return oriented.map((pt) => ({ x: pt.x + p.x, y: pt.y + p.y }))
}

export function polygonAabb(pts: Point[]): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const p of pts) {
    if (p.x < x1) x1 = p.x
    if (p.y < y1) y1 = p.y
    if (p.x > x2) x2 = p.x
    if (p.y > y2) y2 = p.y
  }
  return { x1, y1, x2, y2 }
}


/** Project polygon onto axis (nx,ny); return [min,max]. */
function projectPoly(pts: Point[], nx: number, ny: number): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    const d = p.x * nx + p.y * ny
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/**
 * Convex polygon overlap via Separating Axis Theorem.
 * Touching edges (zero-area contact) count as non-overlapping (eps).
 */
export function polygonsOverlap(a: Point[], b: Point[], eps = 1e-6): boolean {
  if (a.length < 3 || b.length < 3) return false
  const polys = [a, b]
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length
      const ex = poly[j].x - poly[i].x
      const ey = poly[j].y - poly[i].y
      // outward/inward normal — either works for SAT
      const nx = -ey
      const ny = ex
      const len = Math.hypot(nx, ny)
      if (len < 1e-12) continue
      const ux = nx / len
      const uy = ny / len
      const [amin, amax] = projectPoly(a, ux, uy)
      const [bmin, bmax] = projectPoly(b, ux, uy)
      if (amax <= bmin + eps || bmax <= amin + eps) return false
    }
  }
  return true
}

/** Human-readable size string for lists / labels. */
export function panelDimLabel(p: Panel): string {
  if (isCircle(p)) {
    return `⌀${p.width}`
  }
  if (isIrregular(p)) {
    const L = p.sideLeft ?? 0
    const F = p.sideFront ?? 0
    const R = p.sideRight ?? 0
    const B = p.sideBack ?? 0
    const d = p.diagonal ?? 0
    return `${L}×${F}×${R}×${B} ⌒${d}`
  }
  if (isTrap(p)) {
    const top = p.topWidth ?? p.width
    const bot = p.bottomWidth ?? p.width
    return `${top}/${bot} × ${p.length}`
  }
  return `${p.width}×${p.length}`
}

export function panelFootprint(p: Panel): { w: number; h: number } {
  if (isCircle(p)) {
    // Rotation-invariant: cut diameter square AABB.
    const d = p.width
    return { w: d, h: d }
  }
  if (isPolyPanel(p)) {
    // Oriented AABB from the cut polygon (handles flip + rotation).
    const b = polygonAabb(panelPolygon({ ...p, x: 0, y: 0 }))
    return { w: b.x2 - b.x1, h: b.y2 - b.y1 }
  }
  const quarter = p.rotation === 90 || p.rotation === 270
  return quarter ? { w: p.length, h: p.width } : { w: p.width, h: p.length }
}

export function panelBounds(p: Panel): { x1: number; y1: number; x2: number; y2: number } {
  if (isPolyPanel(p)) {
    return polygonAabb(panelPolygon(p))
  }
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

/**
 * Circle vs axis-aligned AABB: true when closest point on the box is inside the circle
 * (strict: touching counts as non-overlapping via eps, matching polygonsOverlap).
 */
export function circleOverlapsAabb(
  circle: Panel,
  box: { x1: number; y1: number; x2: number; y2: number },
  eps = 1e-6,
): boolean {
  const c = circleCenter(circle)
  const r = circleRadius(circle)
  const qx = Math.max(box.x1, Math.min(c.x, box.x2))
  const qy = Math.max(box.y1, Math.min(c.y, box.y2))
  const dist = Math.hypot(c.x - qx, c.y - qy)
  return dist < r - eps
}

/** Circle–circle: centers closer than r1+r2 (touching = non-overlap). */
export function circleOverlapsCircle(a: Panel, b: Panel, eps = 1e-6): boolean {
  const ca = circleCenter(a)
  const cb = circleCenter(b)
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y)
  return dist < circleRadius(a) + circleRadius(b) - eps
}

/**
 * Overlap dispatch (MVP):
 * - circle–circle: true circle math (center distance)
 * - circle–rect (axis-aligned footprint): closest-point-on-AABB
 * - circle–trap/irregular: N-gon / poly via polygonsOverlap(panelPolygon(circle), poly)
 * - trap/irregular–*: convex SAT; rect–rect: AABB
 */
export function overlapsAny(panel: Panel, others: Panel[]): boolean {
  const aBounds = panelBounds(panel)
  return others.some((o) => {
    if (o.id === panel.id) return false
    // Fast reject via AABB
    if (!aabbOverlap(aBounds, panelBounds(o))) return false

    const aCirc = isCircle(panel)
    const bCirc = isCircle(o)
    if (aCirc && bCirc) return circleOverlapsCircle(panel, o)
    if (aCirc && isPolyPanel(o)) return polygonsOverlap(panelPolygon(panel), panelPolygon(o))
    if (bCirc && isPolyPanel(panel)) return polygonsOverlap(panelPolygon(panel), panelPolygon(o))
    if (aCirc) return circleOverlapsAabb(panel, panelBounds(o))
    if (bCirc) return circleOverlapsAabb(o, panelBounds(panel))

    // Two axis-aligned rects: AABB is exact
    if (!isPolyPanel(panel) && !isPolyPanel(o)) return true
    // Trap / irregular involved: convex polygon SAT
    return polygonsOverlap(panelPolygon(panel), panelPolygon(o))
  })
}

export function offBolt(panel: Panel, fabricWidth: number, eps = 1e-6): boolean {
  if (isPolyPanel(panel)) {
    const poly = panelPolygon(panel)
    for (const pt of poly) {
      if (pt.x < -eps || pt.x > fabricWidth + eps || pt.y < -eps) return true
    }
    return false
  }
  const b = panelBounds(panel)
  return b.x1 < -eps || b.x2 > fabricWidth + eps || b.y1 < -eps
}

/** True when panel fits on bolt without overlapping others. */
export function canPlace(panel: Panel, others: Panel[], fabricWidth: number): boolean {
  return !offBolt(panel, fabricWidth) && !overlapsAny(panel, others)
}

export function rotate90(panel: Panel): Panel {
  // Circles are rotation-invariant — keep pose (UI also hides Rotate 90).
  if (isCircle(panel)) return panel
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

/** Rotations 0/90 whose footprint width fits on the bolt. Circles: [0] only (90° identical). */
export function orientationsThatFit(panel: Panel, fabricWidth: number): Array<0 | 90> {
  if (isCircle(panel)) {
    return panel.width <= fabricWidth + 1e-6 ? [0] : []
  }
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

function makeProbe(
  width: number,
  length: number,
  x: number,
  y: number,
  kind: PanelKind = 'rect',
): Panel {
  return {
    id: '__probe__',
    label: '',
    kind,
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

/** Clone panel geometry at a candidate top-left (sides / trap widths / flips / rotation preserved). */
export function makeProbeFromPanel(panel: Panel, x: number, y: number): Panel {
  return {
    ...panel,
    id: '__probe__',
    label: '',
    x,
    y,
    color: '',
  }
}

const CAND_DEDUP_EPS = 1e-3

function dedupeSorted(vals: number[], eps = CAND_DEDUP_EPS): number[] {
  const sorted = [...vals].filter((v) => Number.isFinite(v) && v >= -1e-9).sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > eps) out.push(v)
  }
  return out
}

function dedupePoints(pts: { x: number; y: number }[], eps = CAND_DEDUP_EPS): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.x < -1e-9 || p.y < -1e-9) continue
    if (out.some((q) => Math.abs(q.x - p.x) <= eps && Math.abs(q.y - p.y) <= eps)) continue
    out.push(p)
  }
  return out
}

/** Extra top-left candidates so circles can nest into valleys (AABB-edge BLF alone packs like squares). */
function circleNestCandidates(
  diameter: number,
  fabricWidth: number,
  existing: Panel[],
  gap: number,
): { xs: number[]; ys: number[] } {
  const rNew = diameter / 2
  const xs = new Set<number>([0, Math.max(0, fabricWidth - diameter)])
  const ys = new Set<number>([0])
  // Hex-ish angles: cardinal + 60° so circles tuck into gaps when AABBs would overlap.
  const angles = [0, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (3 * Math.PI) / 2, (5 * Math.PI) / 3]
  for (const p of existing) {
    const b = panelBounds(p)
    xs.add(b.x1)
    xs.add(b.x2 + gap)
    ys.add(b.y1)
    ys.add(b.y2 + gap)
    if (!isCircle(p)) continue
    const rOld = circleRadius(p)
    const sep = rNew + rOld + gap
    const c = circleCenter(p)
    for (const a of angles) {
      const cx = c.x + sep * Math.cos(a)
      const cy = c.y + sep * Math.sin(a)
      const x = cx - rNew
      const y = cy - rNew
      if (x >= -1e-9 && x + diameter <= fabricWidth + 1e-6) xs.add(x)
      if (y >= -1e-9) ys.add(y)
    }
  }
  return {
    xs: dedupeSorted([...xs]),
    ys: dedupeSorted([...ys]),
  }
}

/** Standard AABB BLF edge candidates. */
function aabbBlfCandidates(
  fpW: number,
  fabricWidth: number,
  existing: Panel[],
  gap: number,
): { xs: number[]; ys: number[] } {
  const xs = new Set<number>([0, Math.max(0, fabricWidth - fpW)])
  const ys = new Set<number>([0])
  for (const p of existing) {
    const b = panelBounds(p)
    xs.add(b.x1)
    xs.add(b.x2 + gap)
    ys.add(b.y1)
    ys.add(b.y2 + gap)
  }
  return {
    xs: dedupeSorted([...xs]),
    ys: dedupeSorted([...ys]),
  }
}

/** Hard cap on poly nest (x,y) evaluations — prevents UI freezes. */
const POLY_SPOT_CANDIDATE_CAP = 1200

/**
 * Denser nest candidates for trap/irregular as explicit (x,y) pairs.
 * IMPORTANT: do NOT expand partial-overlap steps into separate x/y grids then
 * take the cartesian product — that froze Auto-Nest (tens of thousands of SAT checks).
 */
function polyNestCandidates(
  panel: Panel,
  fabricWidth: number,
  existing: Panel[],
  gap: number,
): { xs: number[]; ys: number[]; pairs: { x: number; y: number }[] } {
  const fp = panelFootprint(panel)
  const { xs: baseXs, ys: baseYs } = aabbBlfCandidates(fp.w, fabricWidth, existing, gap)
  // Keep classic BLF grid small (AABB corners only — already in baseXs/baseYs).
  const xs = dedupeSorted(baseXs.filter((x) => x + fp.w <= fabricWidth + 1e-6))
  const ys = dedupeSorted(baseYs.filter((y) => y >= -1e-9))
  const pairs: { x: number; y: number }[] = []

  const pushPair = (x: number, y: number) => {
    if (x >= -1e-9 && y >= -1e-9 && x + fp.w <= fabricWidth + 1e-6) pairs.push({ x, y })
  }

  // Partial-overlap as PAIRS against each existing AABB (not a full x×y grid).
  const stepX = Math.max(0.75, Math.min(1.5, fp.w / 3))
  const stepY = Math.max(0.75, Math.min(1.5, fp.h / 3))
  for (const p of existing) {
    const b = panelBounds(p)
    const yAnchors = [0, Math.max(0, b.y1), Math.max(0, b.y2 + gap), Math.max(0, b.y2 + gap - fp.h)]
    for (let x = b.x1 - fp.w + stepX; x < b.x2 + gap + 1e-9; x += stepX) {
      for (const y of yAnchors) pushPair(x, y)
    }
    const xAnchors = [
      0,
      Math.max(0, b.x1),
      Math.max(0, b.x2 + gap),
      Math.max(0, b.x1 - fp.w + gap),
      Math.max(0, b.x2 + gap - fp.w),
    ].filter((x) => x + fp.w <= fabricWidth + 1e-6)
    for (let y = b.y1 - fp.h + stepY; y < b.y2 + gap + 1e-9; y += stepY) {
      if (y < -1e-9) continue
      for (const x of xAnchors) pushPair(x, y)
    }
  }

  const localPoly = panelPolygon({ ...panel, x: 0, y: 0 })

  for (const other of existing) {
    const otherPoly =
      isPolyPanel(other) || isCircle(other)
        ? panelPolygon(other)
        : (() => {
            const b = panelBounds(other)
            return [
              { x: b.x1, y: b.y1 },
              { x: b.x2, y: b.y1 },
              { x: b.x2, y: b.y2 },
              { x: b.x1, y: b.y2 },
            ] as Point[]
          })()

    // Vertex-to-vertex translations.
    for (const ev of otherPoly) {
      for (const lv of localPoly) {
        pushPair(ev.x - lv.x, ev.y - lv.y)
      }
    }

    // Edge-against-edge (near-parallel), gap along normal.
    if (!isPolyPanel(other) && !isCircle(other)) continue
    for (let i = 0; i < otherPoly.length; i++) {
      const e0 = otherPoly[i]
      const e1 = otherPoly[(i + 1) % otherPoly.length]
      const edx = e1.x - e0.x
      const edy = e1.y - e0.y
      const elen = Math.hypot(edx, edy)
      if (elen < 1e-9) continue
      const eux = edx / elen
      const euy = edy / elen
      const normals: Point[] = [
        { x: -euy, y: eux },
        { x: euy, y: -eux },
      ]
      for (let j = 0; j < localPoly.length; j++) {
        const n0 = localPoly[j]
        const n1 = localPoly[(j + 1) % localPoly.length]
        const ndx = n1.x - n0.x
        const ndy = n1.y - n0.y
        const nlen = Math.hypot(ndx, ndy)
        if (nlen < 1e-9) continue
        const nux = ndx / nlen
        const nuy = ndy / nlen
        const align = eux * nux + euy * nuy
        if (Math.abs(Math.abs(align) - 1) > 0.02) continue
        for (const nrm of normals) {
          for (const [ea, na] of [
            [e0, n0],
            [e0, n1],
            [e1, n0],
            [e1, n1],
          ] as const) {
            pushPair(ea.x + nrm.x * gap - na.x, ea.y + nrm.y * gap - na.y)
          }
        }
      }
    }
  }

  return { xs, ys, pairs: dedupePoints(pairs) }
}

function scoreBetter(
  yh: number,
  y: number,
  x: number,
  bestYh: number,
  bestY: number,
  bestX: number,
): boolean {
  return (
    yh < bestYh - 1e-9 ||
    (Math.abs(yh - bestYh) <= 1e-9 &&
      (y < bestY - 1e-9 || (Math.abs(y - bestY) <= 1e-9 && x < bestX - 1e-9)))
  )
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
 * Prefer findBestSpotForPanel when the panel has full geometry (irregular/trap).
 */
export function findBestSpot(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
  kind: PanelKind = 'rect',
): { x: number; y: number } {
  let xCands: number[]
  let yCands: number[]
  if (kind === 'circle') {
    const c = circleNestCandidates(width, fabricWidth, existing, gap)
    xCands = c.xs
    yCands = c.ys
  } else {
    const c = aabbBlfCandidates(width, fabricWidth, existing, gap)
    xCands = c.xs
    yCands = c.ys
  }

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const y of yCands) {
    for (const x of xCands) {
      if (x < -1e-9 || x + width > fabricWidth + 1e-6) continue
      if (y < -1e-9) continue
      const probe = makeProbe(width, length, x, y, kind)
      if (overlapsAny(probe, existing)) continue
      const yh = y + length
      if (scoreBetter(yh, y, x, bestYh, bestY, bestX)) {
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
 * Panel-aware BLF: probe is a full clone of `panel` at (x,y) so irregular/trap
 * polygon SAT works (sides, diagonal, trap widths, flips, rotation preserved).
 * Poly panels also get denser nest candidates (partial AABB + vertex/edge).
 */
export function findBestSpotForPanel(
  panel: Panel,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
): { x: number; y: number } {
  const fp = panelFootprint(panel)
  const h = fp.h
  const w = fp.w

  const candidatePoints: { x: number; y: number }[] = []

  if (isCircle(panel)) {
    const c = circleNestCandidates(w, fabricWidth, existing, gap)
    for (const y of c.ys) for (const x of c.xs) candidatePoints.push({ x, y })
  } else if (isPolyPanel(panel)) {
    const c = polyNestCandidates(panel, fabricWidth, existing, gap)
    // Small AABB BLF grid only (xs/ys are corner-based, not stepped).
    for (const y of c.ys) for (const x of c.xs) candidatePoints.push({ x, y })
    for (const pt of c.pairs) candidatePoints.push(pt)
  } else {
    const c = aabbBlfCandidates(w, fabricWidth, existing, gap)
    for (const y of c.ys) for (const x of c.xs) candidatePoints.push({ x, y })
  }

  // Prefer lower-y first; cap evaluations so Auto-Nest never freezes the UI.
  let unique = dedupePoints(candidatePoints).filter(
    (c) => c.x >= -1e-9 && c.y >= -1e-9 && c.x + w <= fabricWidth + 1e-6,
  )
  unique.sort((a, b) => a.y - b.y || a.x - b.x)
  if (unique.length > POLY_SPOT_CANDIDATE_CAP) {
    unique = unique.slice(0, POLY_SPOT_CANDIDATE_CAP)
  }

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const { x, y } of unique) {
    // Prune: nothing at this y (or below) can beat current best used-length.
    if (y + h >= bestYh - 1e-9 && y > bestY + 1e-9) continue
    const probe = makeProbeFromPanel(panel, x, y)
    if (offBolt(probe, fabricWidth) || overlapsAny(probe, existing)) continue
    const yh = y + h
    if (scoreBetter(yh, y, x, bestYh, bestY, bestX)) {
      best = { x, y }
      bestYh = yh
      bestY = y
      bestX = x
    }
  }

  if (best) return best
  const y = existing.length ? usedLengthInches(existing) + gap : 0
  return { x: 0, y }
}

/**
 * Prefer placements whose panel center sits on the pattern grid.
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
  kind: PanelKind = 'rect',
): { x: number; y: number } {
  if (!patternEnabled(hRepeat, vRepeat)) {
    return findBestSpot(width, length, fabricWidth, existing, gap, kind)
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
    const c = aabbBlfCandidates(width, fabricWidth, existing, gap)
    xCands = c.xs
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
    const c = aabbBlfCandidates(width, fabricWidth, existing, gap)
    yCands = c.ys
  }

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const y of yCands) {
    for (const x of xCands) {
      if (x < -1e-9 || x + width > fabricWidth + 1e-6) continue
      if (y < -1e-9) continue
      const probe = makeProbe(width, length, x, y, kind)
      if (overlapsAny(probe, existing)) continue
      const yh = y + length
      if (scoreBetter(yh, y, x, bestYh, bestY, bestX)) {
        best = { x, y }
        bestYh = yh
        bestY = y
        bestX = x
      }
    }
  }

  if (best) return best
  return findBestSpot(width, length, fabricWidth, existing, gap, kind)
}

/** Pattern-aware placement using a full panel probe (geometry preserved). */
export function findBestSpotOnPatternForPanel(
  panel: Panel,
  fabricWidth: number,
  existing: Panel[],
  hRepeat: number,
  vRepeat: number,
  gap = 0.25,
): { x: number; y: number } {
  if (!patternEnabled(hRepeat, vRepeat)) {
    return findBestSpotForPanel(panel, fabricWidth, existing, gap)
  }

  const fp = panelFootprint(panel)
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
      const x = cx - fp.w / 2
      if (x >= -1e-9 && x + fp.w <= fabricWidth + 1e-6) xs.push(x)
    }
    xCands = xs
  } else {
    const c = isPolyPanel(panel)
      ? polyNestCandidates(panel, fabricWidth, existing, gap)
      : aabbBlfCandidates(fp.w, fabricWidth, existing, gap)
    xCands = c.xs
  }

  if (hasV) {
    const maxLen = Math.max(used + fp.h + gap + vRepeat * 3, fp.h + vRepeat * 4, vRepeat * 8)
    const jMax = Math.ceil(maxLen / vRepeat) + 2
    const ys: number[] = []
    for (let j = 0; j < jMax; j++) {
      const cy = (j + 0.5) * vRepeat
      const y = cy - fp.h / 2
      if (y >= -1e-9) ys.push(y)
    }
    yCands = ys
  } else {
    const c = isPolyPanel(panel)
      ? polyNestCandidates(panel, fabricWidth, existing, gap)
      : aabbBlfCandidates(fp.w, fabricWidth, existing, gap)
    yCands = c.ys
  }

  let best: { x: number; y: number } | null = null
  let bestYh = Infinity
  let bestY = Infinity
  let bestX = Infinity

  for (const y of yCands) {
    for (const x of xCands) {
      if (x < -1e-9 || x + fp.w > fabricWidth + 1e-6) continue
      if (y < -1e-9) continue
      const probe = makeProbeFromPanel(panel, x, y)
      if (offBolt(probe, fabricWidth) || overlapsAny(probe, existing)) continue
      const yh = y + fp.h
      if (scoreBetter(yh, y, x, bestYh, bestY, bestX)) {
        best = { x, y }
        bestYh = yh
        bestY = y
        bestX = x
      }
    }
  }

  if (best) return best
  return findBestSpotForPanel(panel, fabricWidth, existing, gap)
}

/** Route to pattern-aware or normal placement (width/length/kind — AABB/circle). */
export function placeSpot(
  width: number,
  length: number,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
  hRepeat = 0,
  vRepeat = 0,
  kind: PanelKind = 'rect',
): { x: number; y: number } {
  if (patternEnabled(hRepeat, vRepeat)) {
    return findBestSpotOnPattern(width, length, fabricWidth, existing, hRepeat, vRepeat, gap, kind)
  }
  return findBestSpot(width, length, fabricWidth, existing, gap, kind)
}

/** Panel-aware placeSpot — prefer this for irregular/trap auto-nest. */
export function placeSpotForPanel(
  panel: Panel,
  fabricWidth: number,
  existing: Panel[],
  gap = 0.25,
  hRepeat = 0,
  vRepeat = 0,
): { x: number; y: number } {
  if (patternEnabled(hRepeat, vRepeat)) {
    return findBestSpotOnPatternForPanel(panel, fabricWidth, existing, hRepeat, vRepeat, gap)
  }
  return findBestSpotForPanel(panel, fabricWidth, existing, gap)
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

type NestPose = {
  rotation: 0 | 90 | 180 | 270
  flippedH: boolean
  flippedV: boolean
}

function placeAtOrientation(
  panel: Panel,
  pose: NestPose,
  fabricWidth: number,
  placed: Panel[],
  gap: number,
  hRepeat = 0,
  vRepeat = 0,
): Panel {
  const oriented: Panel = {
    ...panel,
    rotation: pose.rotation,
    flippedH: pose.flippedH,
    flippedV: pose.flippedV,
    x: 0,
    y: 0,
  }
  const spot = placeSpotForPanel(oriented, fabricWidth, placed, gap, hRepeat, vRepeat)
  return { ...oriented, x: spot.x, y: spot.y }
}

/**
 * Poses to try when nesting.
 * Circles: [0] only. Rects: 0/90. Poly (trap/irregular): 0/90/180/270 × flip variants.
 */
function posesToTry(panel: Panel, fabricWidth: number): NestPose[] {
  if (isCircle(panel)) {
    return panel.width <= fabricWidth + 1e-6
      ? [{ rotation: 0, flippedH: false, flippedV: false }]
      : [{ rotation: 0, flippedH: false, flippedV: false }]
  }

  if (isPolyPanel(panel)) {
    // Keep pose count modest (UI freeze risk): 0/90/180 × identity/flipH.
    const rots: Array<0 | 90 | 180 | 270> = [0, 90, 180]
    const flips: Array<{ flippedH: boolean; flippedV: boolean }> = [
      { flippedH: false, flippedV: false },
      { flippedH: true, flippedV: false },
    ]
    const out: NestPose[] = []
    for (const rotation of rots) {
      for (const f of flips) {
        const fp = panelFootprint({ ...panel, rotation, ...f })
        if (fp.w <= fabricWidth + 1e-6) out.push({ rotation, ...f })
      }
    }
    return out.length > 0
      ? out
      : [{ rotation: 0, flippedH: panel.flippedH, flippedV: panel.flippedV }]
  }

  // Rect: 0/90 only, preserve existing flips.
  const out: NestPose[] = []
  for (const rotation of [0, 90] as const) {
    const fp = panelFootprint({ ...panel, rotation })
    if (fp.w <= fabricWidth + 1e-6) {
      out.push({ rotation, flippedH: panel.flippedH, flippedV: panel.flippedV })
    }
  }
  return out.length > 0
    ? out
    : [{ rotation: 0, flippedH: panel.flippedH, flippedV: panel.flippedV }]
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

  for (const pose of posesToTry(panel, fabricWidth)) {
    const candidate = placeAtOrientation(panel, pose, fabricWidth, placed, gap, hRepeat, vRepeat)
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
  const poses = posesToTry(panel, fabricWidth)
  let chosen = poses[0]
  let bestAcross = -1
  let bestH = Infinity
  for (const pose of poses) {
    const fp = panelFootprint({
      ...panel,
      rotation: pose.rotation,
      flippedH: pose.flippedH,
      flippedV: pose.flippedV,
    })
    const across = acrossCount(fp.w, fabricWidth, gap)
    if (across > bestAcross || (across === bestAcross && fp.h < bestH - 1e-9)) {
      bestAcross = across
      bestH = fp.h
      chosen = pose
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
  const poses = posesToTry(panel, fabricWidth)
  let chosen = poses[0]
  let bestH = Infinity
  let bestAcross = -1
  for (const pose of poses) {
    const fp = panelFootprint({
      ...panel,
      rotation: pose.rotation,
      flippedH: pose.flippedH,
      flippedV: pose.flippedV,
    })
    const across = acrossCount(fp.w, fabricWidth, gap)
    if (fp.h < bestH - 1e-9 || (Math.abs(fp.h - bestH) <= 1e-9 && across > bestAcross)) {
      bestH = fp.h
      bestAcross = across
      chosen = pose
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

const CANDIDATE_CAP = 6

/** Round layout signature so near-identical packs collapse. */
function layoutKey(panels: Panel[]): string {
  return [...panels]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const x = Math.round(p.x * 100) / 100
      const y = Math.round(p.y * 100) / 100
      const fh = p.flippedH ? 'H' : ''
      const fv = p.flippedV ? 'V' : ''
      return `${p.id}:${x},${y},${p.rotation}${fh}${fv}`
    })
    .join('|')
}

/**
 * Generate unique ranked nest layouts (used length ascending).
 * Dedupes near-identical packs; caps at 6 most-efficient for UX cycling.
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

  // Fewer shuffles when trap/irregular present — each pack is much heavier.
  const hasPoly = panels.some(isPolyPanel)
  const shuffleN = hasPoly ? 4 : 24
  for (let seed = 1; seed <= shuffleN; seed++) {
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
  '#24285e', // SR Blue
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
    return n
      ? {
          ...p,
          x: n.x,
          y: n.y,
          rotation: n.rotation,
          flippedH: n.flippedH,
          flippedV: n.flippedV,
        }
      : p
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
  // Circles: rotate is a visual no-op — return the same panel (UI hides the control).
  if (isCircle(panel)) return panel

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
