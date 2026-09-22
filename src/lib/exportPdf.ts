/**
 * PDF export for Sailrite Fabric Nesting (jsPDF + autotable).
 * Pure scale helpers are unit-tested; PDF binary itself is not asserted.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  type Panel,
  type Unit,
  circleCenter,
  circleRadius,
  fromInches,
  isCircle,
  isIrregular,
  isPolyPanel,
  isTrap,
  panelFootprint,
  panelPolygon,
  usedLengthInches,
} from './geometry'
import { wrapWords } from './wrapSvgText'

const SHOP_FABRIC_PDF =
  'https://www.sailrite.com/Fabrics?utm_source=sailrite_calculators&utm_medium=nesting&utm_campaign=fabric_nesting&utm_content=pdf_shop_button'

/** PDF points per inch of fabric when drawing the nest (before fit-to-page). */
export const DEFAULT_PT_PER_IN = 4

export interface NestDrawScale {
  /** PDF x of bolt left edge */
  originX: number
  /** PDF y of bolt top edge */
  originY: number
  /** PDF points per fabric inch */
  ptPerIn: number
}

/** Map fabric inches → PDF points for nest drawing. */
export function inchesToPdfPt(
  inches: number,
  scale: Pick<NestDrawScale, 'ptPerIn'>,
): number {
  return inches * scale.ptPerIn
}

/** Fabric (x,y) in inches → PDF page coordinates (y relative to slice start if set). */
export function fabricToPdf(
  xIn: number,
  yIn: number,
  scale: NestDrawScale,
  sliceStartIn = 0,
): { x: number; y: number } {
  return {
    x: scale.originX + xIn * scale.ptPerIn,
    y: scale.originY + (yIn - sliceStartIn) * scale.ptPerIn,
  }
}


/** Point in fabric inches (or any linear space). */
export interface PolyPt {
  x: number
  y: number
}

/**
 * Sutherland–Hodgman clip of a polygon against one half-plane.
 * `inside` / `intersect` define the clip edge.
 */
function clipPolyHalfPlane(
  poly: PolyPt[],
  inside: (p: PolyPt) => boolean,
  intersect: (a: PolyPt, b: PolyPt) => PolyPt,
): PolyPt[] {
  if (poly.length === 0) return []
  const out: PolyPt[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const prev = poly[(i + poly.length - 1) % poly.length]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

function lerpAtY(a: PolyPt, b: PolyPt, y: number): PolyPt {
  const dy = b.y - a.y
  if (Math.abs(dy) < 1e-15) return { x: a.x, y }
  const t = (y - a.y) / dy
  return { x: a.x + t * (b.x - a.x), y }
}

function lerpAtX(a: PolyPt, b: PolyPt, x: number): PolyPt {
  const dx = b.x - a.x
  if (Math.abs(dx) < 1e-15) return { x, y: a.y }
  const t = (x - a.x) / dx
  return { x, y: a.y + t * (b.y - a.y) }
}

/**
 * Clip a polygon to the closed horizontal strip y ∈ [yMin, yMax]
 * (Sutherland–Hodgman against y=yMin and y=yMax).
 * Returns [] if nothing remains; callers should skip draw when length < 3.
 */
export function clipPolygonToYRange(
  poly: PolyPt[],
  yMin: number,
  yMax: number,
): PolyPt[] {
  if (poly.length === 0) return []
  if (!(yMax >= yMin)) return []
  const eps = 1e-12
  let result = clipPolyHalfPlane(
    poly,
    (p) => p.y >= yMin - eps,
    (a, b) => lerpAtY(a, b, yMin),
  )
  result = clipPolyHalfPlane(
    result,
    (p) => p.y <= yMax + eps,
    (a, b) => lerpAtY(a, b, yMax),
  )
  return result
}

/**
 * Clip a polygon to the closed vertical strip x ∈ [xMin, xMax].
 */
export function clipPolygonToXRange(
  poly: PolyPt[],
  xMin: number,
  xMax: number,
): PolyPt[] {
  if (poly.length === 0) return []
  if (!(xMax >= xMin)) return []
  const eps = 1e-12
  let result = clipPolyHalfPlane(
    poly,
    (p) => p.x >= xMin - eps,
    (a, b) => lerpAtX(a, b, xMin),
  )
  result = clipPolyHalfPlane(
    result,
    (p) => p.x <= xMax + eps,
    (a, b) => lerpAtX(a, b, xMax),
  )
  return result
}

/**
 * Fit nest width into a page box. Height is not forced to fit — callers paginate
 * tall bolts with {@link computeNestSlices}.
 */
export function fitNestScale(
  fabricWidthIn: number,
  _usedLengthIn: number,
  box: { x: number; y: number; w: number; h: number },
  minPtPerIn = 1.5,
): NestDrawScale {
  const sx = box.w / Math.max(fabricWidthIn, 1e-6)
  const ptPerIn = Math.max(minPtPerIn, Math.min(sx, DEFAULT_PT_PER_IN * 2.5))
  return { originX: box.x, originY: box.y, ptPerIn }
}

/** Bolt draw height in fabric inches (used length + pad). */
export function nestBoltHeightIn(usedLengthIn: number): number {
  return Math.max(usedLengthIn, 12) + 6
}

export interface NestSlice {
  /** Fabric Y start (inches from bolt top) */
  startIn: number
  /** Fabric Y end (inches from bolt top) */
  endIn: number
  /** Short range label, e.g. "Nest 0–2.5 yd" */
  label: string
}

function formatYd(inches: number): string {
  const yd = inches / 36
  const s = yd.toFixed(2).replace(/\.?0+$/, '')
  return s === '' ? '0' : s
}

/**
 * Split a bolt into vertical page slices on whole-yard (36") boundaries.
 * `firstPageUsableH` / `fullPageUsableH` are in PDF points (content height available).
 *
 * Non-final slice ends land on multiples of 36". Packs as many whole yards as fit
 * in usable height (`floor(usableInches / 36)`). If usable inches < 36, still takes
 * 1 yard so breaks stay on yard marks (may slightly overflow a tight first page —
 * callers should size full pages so ≥1 yd fits at the chosen scale). The last page
 * may end at boltH even when that is not a whole yard.
 */

/**
 * Choose nest page scale + whole yards per page so the bolt uses the page.
 *
 * Width-fit alone often leaves a tall blank band (only 1 yd fits at full width
 * scale when ~1.7 yd of height is free). We pick the nearest whole-yard count
 * that can fill `usableHeightPt`, shrinking scale slightly below width-fit when
 * that packs another yard and fills the page.
 */
export function chooseNestPageScale(
  widthPtPerIn: number,
  usableHeightPt: number,
  minPtPerIn = 1.5,
): { ptPerIn: number; yardsPerPage: number } {
  const YARD = 36
  const widthScale = Math.max(minPtPerIn, widthPtPerIn)
  const usable = Math.max(YARD * minPtPerIn, usableHeightPt)
  const maxYards = Math.max(1, Math.floor(usable / (minPtPerIn * YARD)))
  // How many yards fit at pure width scale (fractional)
  const yardsAtWidth = usable / (widthScale * YARD)
  // Round to nearest whole yard so we fill height (e.g. 1.7 → 2 yd, scale down a bit)
  let yardsPerPage = Math.min(maxYards, Math.max(1, Math.round(yardsAtWidth)))
  // Prefer filling the page: if rounding down left >35% of a yard unused, bump up when possible
  if (yardsPerPage < maxYards && yardsAtWidth - Math.floor(yardsAtWidth) > 0.35) {
    yardsPerPage = Math.min(maxYards, Math.floor(yardsAtWidth) + 1)
  }
  const ptPerIn = Math.min(widthScale, usable / (yardsPerPage * YARD))
  return { ptPerIn, yardsPerPage }
}

export function computeNestSlices(
  usedLengthIn: number,
  ptPerIn: number,
  firstPageUsableH: number,
  fullPageUsableH: number,
): NestSlice[] {
  const YARD = 36
  const boltH = nestBoltHeightIn(usedLengthIn)
  const slices: NestSlice[] = []
  let y = 0
  let page = 0
  const maxPages = 50
  while (y < boltH - 1e-9 && page < maxPages) {
    const usableH = page === 0 ? firstPageUsableH : fullPageUsableH
    const usableInches = usableH / Math.max(ptPerIn, 1e-6)
    // Pack whole yards; if less than one yard fits, take 1 yd anyway (yard-aligned breaks)
    const yardsOnPage = Math.max(1, Math.floor(usableInches / YARD))
    const end = Math.min(boltH, y + yardsOnPage * YARD)
    slices.push({
      startIn: y,
      endIn: end,
      label: `Nest ${formatYd(y)}–${formatYd(end)} yd`,
    })
    if (end <= y + 1e-9) break
    y = end
    page += 1
  }
  return slices.length > 0 ? slices : [{ startIn: 0, endIn: boltH, label: 'Nest 0–0 yd' }]
}

export function pdfFilename(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `sailrite-nesting-${y}-${m}-${d}.pdf`
}

export interface ExportPdfInput {
  panels: Panel[]
  fabricWidthIn: number
  seamAllowanceIn: number
  waste: number
  unit: Unit
  exact: number
  order: number
  patterned: boolean
  hRepeatIn: number
  vRepeatIn: number
}

/** Nest diagram always begins on page 2 (page 1 = title, summary, panel table). */
export const FIRST_NEST_PAGE = 2

export function fmtDim(inches: number, unit: Unit): string {
  const v = fromInches(inches, unit)
  if (unit === 'in') return String(Number(v.toFixed(2)))
  return String(Number(v.toFixed(1)))
}

export function finishedSize(panel: Panel, seamAllowanceIn: number): { w: number; h: number } {
  if (isCircle(panel)) {
    const d =
      seamAllowanceIn <= 0
        ? panel.width
        : Math.max(0, panel.width - 2 * seamAllowanceIn)
    return { w: d, h: d }
  }
  if (isIrregular(panel)) {
    // AABB finished approx (table uses finishedIrregularSize for full side string).
    if (seamAllowanceIn <= 0) return { w: panel.width, h: panel.length }
    return {
      w: Math.max(0, panel.width - 2 * seamAllowanceIn),
      h: Math.max(0, panel.length - 2 * seamAllowanceIn),
    }
  }
  if (isTrap(panel)) {
    const top = panel.topWidth ?? panel.width
    const bot = panel.bottomWidth ?? panel.width
    if (seamAllowanceIn <= 0) {
      return { w: Math.max(top, bot), h: panel.length }
    }
    return {
      w: Math.max(0, Math.max(top, bot) - 2 * seamAllowanceIn),
      h: Math.max(0, panel.length - 2 * seamAllowanceIn),
    }
  }
  if (seamAllowanceIn <= 0) {
    return { w: panel.width, h: panel.length }
  }
  return {
    w: Math.max(0, panel.width - 2 * seamAllowanceIn),
    h: Math.max(0, panel.length - 2 * seamAllowanceIn),
  }
}

/** Finished trap dims for table display (top/bottom/height). */
export function finishedTrapSize(
  panel: Panel,
  seamAllowanceIn: number,
): { top: number; bottom: number; height: number } {
  const top = panel.topWidth ?? panel.width
  const bot = panel.bottomWidth ?? panel.width
  if (seamAllowanceIn <= 0) {
    return { top, bottom: bot, height: panel.length }
  }
  return {
    top: Math.max(0, top - 2 * seamAllowanceIn),
    bottom: Math.max(0, bot - 2 * seamAllowanceIn),
    height: Math.max(0, panel.length - 2 * seamAllowanceIn),
  }
}

/** Finished irregular side lengths for table display (L/F/R/B + diagonal). */
export function finishedIrregularSize(
  panel: Panel,
  seamAllowanceIn: number,
): { left: number; front: number; right: number; back: number; diagonal: number } {
  const sub = (v: number) =>
    seamAllowanceIn <= 0 ? v : Math.max(0, v - 2 * seamAllowanceIn)
  return {
    left: sub(panel.sideLeft ?? 0),
    front: sub(panel.sideFront ?? 0),
    right: sub(panel.sideRight ?? 0),
    back: sub(panel.sideBack ?? 0),
    diagonal: sub(panel.diagonal ?? 0),
  }
}

/**
 * Dimension string for nest panel labels: cut size (includes seam allowance).
 * Panel width/length are cut dimensions. Includes unit abbr.
 */
export function formatPanelNestDim(
  panel: Panel,
  unit: Unit,
  _seamAllowanceIn: number,
): string {
  if (isCircle(panel)) {
    return `⌀ ${fmtDim(panel.width, unit)} ${unit}`
  }
  if (isIrregular(panel)) {
    // Shorter nest label: L×F×R×B (omit diagonal to save space).
    const L = panel.sideLeft ?? 0
    const F = panel.sideFront ?? 0
    const R = panel.sideRight ?? 0
    const B = panel.sideBack ?? 0
    return `${fmtDim(L, unit)}×${fmtDim(F, unit)}×${fmtDim(R, unit)}×${fmtDim(B, unit)} ${unit}`
  }
  if (isTrap(panel)) {
    const top = panel.topWidth ?? panel.width
    const bot = panel.bottomWidth ?? panel.width
    return `${fmtDim(top, unit)}/${fmtDim(bot, unit)} × ${fmtDim(panel.length, unit)} ${unit}`
  }
  return `${fmtDim(panel.width, unit)}×${fmtDim(panel.length, unit)} ${unit}`
}

export interface PanelPdfLabelLayout {
  lines: string[]
  fontSize: number
  lineHeight: number
}

const PDF_LABEL_CHAR_W = 0.55
const PDF_LABEL_LH = 1.2

/**
 * Fit panel name + dimension lines inside a PDF rect (points).
 * Prefers keeping the dim line; truncates/wraps the name. Shrinks font as needed.
 * Nothing is returned that would need more height than boxH at the chosen font.
 */
export function layoutPanelPdfLabel(
  name: string,
  dimStr: string,
  boxW: number,
  boxH: number,
  startFontSize = 9,
  minFontSize = 5,
): PanelPdfLabelLayout {
  const dim = dimStr.trim()
  const rawName = name.trim()
  if (!(boxW > 2) || !(boxH > 2)) {
    return { lines: [], fontSize: minFontSize, lineHeight: minFontSize * PDF_LABEL_LH }
  }

  const start = Math.max(minFontSize, Math.min(startFontSize, Math.floor(boxH)))

  const buildLines = (fs: number): string[] => {
    const lh = fs * PDF_LABEL_LH
    const maxLines = Math.max(1, Math.floor(boxH / lh))
    const maxChars = Math.max(1, Math.floor(boxW / (fs * PDF_LABEL_CHAR_W)))
    const fitDim =
      dim.length <= maxChars
        ? dim
        : `${dim.slice(0, Math.max(1, maxChars - 1))}…`

    if (!rawName) return [fitDim]

    if (maxLines === 1) {
      // Prioritize dims; prepend truncated name if both fit on one line
      const combined = `${rawName} ${fitDim}`
      if (combined.length <= maxChars) return [combined]
      const nameBudget = maxChars - fitDim.length - 1
      if (nameBudget >= 2) {
        const trunc =
          rawName.length > nameBudget
            ? `${rawName.slice(0, Math.max(1, nameBudget - 1))}…`
            : rawName
        return [`${trunc} ${fitDim}`]
      }
      return [fitDim]
    }

    const nameLines = wrapWords(rawName, maxChars, maxLines - 1)
    return [...nameLines, fitDim]
  }

  for (let fs = start; fs >= minFontSize; fs -= 1) {
    const lh = fs * PDF_LABEL_LH
    const lines = buildLines(fs)
    if (lines.length * lh <= boxH + 0.5) {
      return { lines, fontSize: fs, lineHeight: lh }
    }
  }

  const fs = minFontSize
  const lh = fs * PDF_LABEL_LH
  return { lines: buildLines(fs).slice(0, Math.max(1, Math.floor(boxH / lh))), fontSize: fs, lineHeight: lh }
}

function contrastLabelColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#000000'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#111111' : '#ffffff'
}

export interface DrawNestSliceOpts {
  /** Inclusive fabric Y start of this page slice */
  sliceStartIn: number
  /** Exclusive-ish fabric Y end of this page slice */
  sliceEndIn: number
  /** Show width annotation under bolt (last slice only typically) */
  showWidthNote?: boolean
  /** Seam allowance (inches) for finished-size dim labels */
  seamAllowanceIn?: number
}

/**
 * Draw one vertical slice of the nest. Panels spanning the break are clipped
 * to the visible portion on this page.
 */
export function drawNest(
  doc: jsPDF,
  panels: Panel[],
  fabricWidthIn: number,
  used: number,
  scale: NestDrawScale,
  unit: Unit,
  slice?: DrawNestSliceOpts,
): void {
  const boltH = nestBoltHeightIn(used)
  const sliceStart = slice?.sliceStartIn ?? 0
  const sliceEnd = slice?.sliceEndIn ?? boltH
  const sliceH = Math.max(0, sliceEnd - sliceStart)
  const boltWpt = inchesToPdfPt(fabricWidthIn, scale)
  const boltHpt = inchesToPdfPt(sliceH, scale)

  // Bolt background for this slice
  doc.setFillColor(245, 245, 248)
  doc.setDrawColor(40, 40, 50)
  doc.setLineWidth(0.8)
  doc.rect(scale.originX, scale.originY, boltWpt, boltHpt, 'FD')

  // Yard marks within slice
  const firstYd = Math.floor(sliceStart / 36)
  const lastYd = Math.ceil(sliceEnd / 36)
  doc.setDrawColor(180, 140, 40)
  doc.setTextColor(100, 80, 0)
  doc.setFontSize(7)
  for (let yd = firstYd; yd <= lastYd; yd++) {
    const yIn = yd * 36
    if (yIn < sliceStart - 1e-6 || yIn > sliceEnd + 1e-6) continue
    const { y } = fabricToPdf(0, yIn, scale, sliceStart)
    doc.setLineWidth(yd === 0 ? 0.6 : 0.4)
    doc.line(scale.originX, y, scale.originX + boltWpt, y)
    const label = yd === 0 ? '0' : `${yd} yd`
    doc.text(label, scale.originX + 2, Math.max(scale.originY + 7, y - 1.5))
  }

  // Panels (clipped to slice)
  for (const p of panels) {
    const fp = panelFootprint(p)
    const py1 = p.y
    const py2 = p.y + fp.h
    if (py2 <= sliceStart + 1e-9 || py1 >= sliceEnd - 1e-9) continue

    const visY1 = Math.max(py1, sliceStart)
    const visY2 = Math.min(py2, sliceEnd)
    const { x } = fabricToPdf(p.x, visY1, scale, sliceStart)
    const y = scale.originY + (visY1 - sliceStart) * scale.ptPerIn
    const w = inchesToPdfPt(fp.w, scale)
    const h = inchesToPdfPt(visY2 - visY1, scale)
    if (h < 0.5 || w < 0.5) continue

    const fill = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#24285e'
    doc.setFillColor(fill)
    doc.setDrawColor(20, 20, 30)
    doc.setLineWidth(0.6)

    if (isCircle(p)) {
      // Draw true circle; bolt-slice clip handles panels that span page yards (MVP).
      const c = circleCenter(p)
      const r = circleRadius(p)
      const { x: cx, y: cy } = fabricToPdf(c.x, c.y, scale, sliceStart)
      const rPt = inchesToPdfPt(r, scale)
      doc.saveGraphicsState()
      doc.rect(scale.originX, scale.originY, boltWpt, boltHpt)
      doc.clip()
      doc.circle(cx, cy, rPt, 'FD')
      doc.restoreGraphicsState()
    } else if (isPolyPanel(p)) {
      // Trap / irregular: clip cut polygon to this page's fabric Y slice (and bolt X).
      // Without this, unclipped vertices map outside the bolt and draw huge skewed triangles.
      let poly = clipPolygonToYRange(panelPolygon(p), sliceStart, sliceEnd)
      poly = clipPolygonToXRange(poly, 0, fabricWidthIn)
      if (poly.length >= 3) {
        const pts = poly.map((pt) => fabricToPdf(pt.x, pt.y, scale, sliceStart))
        const deltas: number[][] = []
        for (let i = 1; i < pts.length; i++) {
          deltas.push([pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y])
        }
        // Belt-and-suspenders: PDF clip to bolt slice so nothing bleeds past the rect.
        doc.saveGraphicsState()
        doc.rect(scale.originX, scale.originY, boltWpt, boltHpt)
        doc.clip()
        doc.lines(deltas, pts[0].x, pts[0].y, [1, 1], 'FD', true)
        doc.restoreGraphicsState()
      }
    } else {
      doc.rect(x, y, w, h, 'FD')
    }

    // Label when enough of the panel top — or enough visible area — is on this slice.
    // Centered in the visible box; circles use the inscribed square so text stays in-disc.
    const topOnSlice = py1 >= sliceStart - 1e-6 && py1 < sliceEnd
    const enoughArea = h >= 14
    const showLabel = h >= 8 && (topOnSlice || enoughArea)
    if (showLabel) {
      const pad = 2
      const fullW = w
      const fullH = h
      const useInscribed = isCircle(p)
      const boxOuterW = useInscribed ? fullW / Math.SQRT2 : fullW
      const boxOuterH = useInscribed ? fullH / Math.SQRT2 : fullH
      const boxX = x + (fullW - boxOuterW) / 2
      const boxY = y + (fullH - boxOuterH) / 2
      const boxW = Math.max(0, boxOuterW - pad * 2)
      const boxH = Math.max(0, boxOuterH - pad * 2)
      const dimStr = formatPanelNestDim(p, unit, slice?.seamAllowanceIn ?? 0)
      const layout = layoutPanelPdfLabel(p.label, dimStr, boxW, boxH, 9, 5)
      if (layout.lines.length > 0 && boxW > 2 && boxH > 2) {
        doc.setTextColor(contrastLabelColor(fill))
        doc.setFontSize(layout.fontSize)
        doc.setFont('helvetica', 'normal')
        const blockH = layout.lines.length * layout.lineHeight
        let ty =
          boxY + boxOuterH / 2 - blockH / 2 + layout.fontSize * 0.85
        const cx = boxX + boxOuterW / 2
        const minY = boxY + pad * 0.5
        const maxY = boxY + boxOuterH - pad - 0.15 * layout.fontSize
        for (let i = 0; i < layout.lines.length; i++) {
          const lineY = ty + i * layout.lineHeight
          if (lineY > maxY + 0.5) break
          if (lineY < minY) continue
          doc.text(layout.lines[i], cx, lineY, {
            align: 'center',
            maxWidth: Math.max(2, boxW),
          })
        }
      }
    }
  }

  // Used line (if it falls in this slice)
  if (used > 0 && used >= sliceStart - 1e-6 && used <= sliceEnd + 1e-6) {
    const { y } = fabricToPdf(0, used, scale, sliceStart)
    doc.setDrawColor(200, 120, 0)
    doc.setLineWidth(1.2)
    doc.setLineDashPattern([3, 2], 0)
    doc.line(scale.originX, y, scale.originX + boltWpt, y)
    doc.setLineDashPattern([], 0)
    doc.setTextColor(36, 37, 142)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    const usedLabel = `${(used / 36).toFixed(2)} yd · ${fmtDim(used, unit)} ${unit}`
    doc.text(usedLabel, scale.originX + boltWpt - 2, y - 2, { align: 'right' })
    doc.setFont('helvetica', 'normal')
  }

  if (slice?.showWidthNote !== false && Math.abs(sliceEnd - boltH) < 1e-3) {
    doc.setTextColor(80, 80, 90)
    doc.setFontSize(7)
    doc.text(
      `Width ${fmtDim(fabricWidthIn, unit)} ${unit}`,
      scale.originX + boltWpt / 2,
      scale.originY + boltHpt + 10,
      { align: 'center' },
    )
  }
}

/** Clickable Sailrite-blue button linking to shop fabric. Returns bottom Y. */
function drawShopFabricButton(
  doc: jsPDF,
  x: number,
  y: number,
  opts?: { label?: string; width?: number },
): number {
  const label = opts?.label ?? 'Shop fabric at Sailrite'
  const w = opts?.width ?? 200
  const h = 28
  doc.setFillColor(36, 40, 94) // Sailrite Blue #24285e
  doc.roundedRect(x, y, w, h, 4, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text(label, x + w / 2, y + h / 2 + 3.5, { align: 'center' })
  doc.link(x, y, w, h, { url: SHOP_FABRIC_PDF })
  return y + h
}

function drawFooter(doc: jsPDF, margin: number, pageH: number): void {
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'Estimate only. Double-check before cutting or ordering. Sailrite sells full yards.',
    margin,
    pageH - 40,
  )
  drawShopFabricButton(doc, margin, pageH - 34, {
    label: 'Shop fabric at Sailrite',
    width: 190,
  })
}

/**
 * Build and download the nesting PDF. Returns the filename used.
 */
export function exportNestingPdf(input: ExportPdfInput): string {
  const {
    panels,
    fabricWidthIn,
    seamAllowanceIn,
    waste,
    unit,
    exact,
    order,
    patterned,
    hRepeatIn,
    vRepeatIn,
  } = input

  const used = usedLengthInches(panels)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const footerReserve = 48
  const widthNoteReserve = 14

  // Title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(36, 40, 94)
  doc.text('Sailrite Fabric Nesting', margin, margin)

  // Summary
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(40, 40, 40)
  let y = margin + 18
  const line = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, margin + 110, y)
    y += 12
  }
  line('Fabric width:', `${fmtDim(fabricWidthIn, unit)} ${unit}`)
  line(
    'Seam allowance:',
    seamAllowanceIn > 0 ? `${fmtDim(seamAllowanceIn, unit)} ${unit} per side` : '0 (cut sizes)',
  )
  line('Waste %:', `${waste}%`)
  if (patterned && (hRepeatIn > 0 || vRepeatIn > 0)) {
    const hStr = fmtDim(hRepeatIn, unit)
    const vStr = fmtDim(vRepeatIn, unit)
    let detail = `H ${hStr} × V ${vStr} ${unit}`
    if (hRepeatIn > 0 && vRepeatIn <= 0) detail += ' (vertical stripes)'
    else if (vRepeatIn > 0 && hRepeatIn <= 0) detail += ' (horizontal stripes)'
    line('Pattern repeats:', detail)
  } else {
    line('Pattern repeats:', 'Off')
  }
  line('Exact yards:', exact.toFixed(2))
  line('Order yards:', String(order))
  line('Used length:', `${fmtDim(used, unit)} ${unit} (${(used / 36).toFixed(2)} yd)`)
  line('Panels:', String(panels.length))

  y += 10
  const shopLabel =
    order > 0 ? `Shop ${order} yd of fabric at Sailrite` : 'Shop fabric at Sailrite'
  y = drawShopFabricButton(doc, margin, y, { label: shopLabel, width: 240 }) + 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(36, 40, 94)
  doc.text('Panel list', margin, y)
  y += 4

  const u = unit
  const tableBody = panels.map((p) => {
    const fp = panelFootprint(p)
    let finishedStr: string
    let cutStr: string
    if (isCircle(p)) {
      const fin = finishedSize(p, seamAllowanceIn)
      finishedStr = `⌀ ${fmtDim(fin.w, u)} ${u}`
      cutStr = `⌀ ${fmtDim(p.width, u)} ${u}`
    } else if (isIrregular(p)) {
      const ir = finishedIrregularSize(p, seamAllowanceIn)
      finishedStr = `${fmtDim(ir.left, u)}×${fmtDim(ir.front, u)}×${fmtDim(ir.right, u)}×${fmtDim(ir.back, u)} ⌒${fmtDim(ir.diagonal, u)} ${u}`
      cutStr = `${fmtDim(p.sideLeft ?? 0, u)}×${fmtDim(p.sideFront ?? 0, u)}×${fmtDim(p.sideRight ?? 0, u)}×${fmtDim(p.sideBack ?? 0, u)} ⌒${fmtDim(p.diagonal ?? 0, u)} ${u}`
    } else if (isTrap(p)) {
      const t = finishedTrapSize(p, seamAllowanceIn)
      finishedStr = `${fmtDim(t.top, u)}/${fmtDim(t.bottom, u)} × ${fmtDim(t.height, u)} ${u}`
      cutStr = `${fmtDim(p.topWidth ?? p.width, u)}/${fmtDim(p.bottomWidth ?? p.width, u)} × ${fmtDim(p.length, u)} ${u}`
    } else {
      const fin = finishedSize(p, seamAllowanceIn)
      finishedStr =
        seamAllowanceIn > 0
          ? `${fmtDim(fin.w, u)} × ${fmtDim(fin.h, u)} ${u}`
          : `${fmtDim(p.width, u)} × ${fmtDim(p.length, u)} ${u}`
      cutStr = `${fmtDim(fp.w, u)} × ${fmtDim(fp.h, u)} ${u}`
    }
    return [p.label, finishedStr, cutStr, '1']
  })

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [
      [
        'Name',
        seamAllowanceIn > 0 ? 'Finished size' : 'Size',
        'Cut size',
        'Qty',
      ],
    ],
    body: tableBody.length > 0 ? tableBody : [['—', '—', '—', '—']],
    styles: { fontSize: 8, cellPadding: 3, textColor: [30, 30, 30] },
    headStyles: {
      fillColor: [42, 51, 171],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [245, 246, 252] },
    columnStyles: {
      3: { halign: 'center', cellWidth: 36 },
    },
  })

  // Page 1 footer (summary + panel list only — nest always starts on a fresh page)
  drawFooter(doc, margin, pageH)

  // Nest diagram — always begin on page 2; paginate further on whole-yard slices
  doc.addPage()
  let nestTop = margin

  const usableWidth = pageW - margin * 2
  // Scale fits fabric width; height is sliced across pages
  const baseScale = fitNestScale(fabricWidthIn, used, {
    x: margin,
    y: nestTop,
    w: usableWidth,
    h: Math.max(80, pageH - margin * 2 - footerReserve),
  })

  const titleBlock = 22 // "Nest layout" + optional continued label
  // Nest always starts on a fresh page, so first-slice usable height = full-page usable height
  const fullContentTop = margin + titleBlock
  const fullUsableH = Math.max(
    80,
    pageH - fullContentTop - margin - footerReserve - widthNoteReserve,
  )
  const firstUsableH = fullUsableH

  // Pack whole yards and scale so each nest page fills vertically (avoids a
  // short 1-yd strip atop a mostly blank page).
  const { ptPerIn } = chooseNestPageScale(baseScale.ptPerIn, fullUsableH)

  const slices = computeNestSlices(used, ptPerIn, firstUsableH, fullUsableH)

  slices.forEach((sl, i) => {
    if (i > 0) {
      doc.addPage()
      nestTop = margin
    }

    const contentTop = nestTop + titleBlock
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(36, 40, 94)
    const title =
      slices.length === 1 ? 'Nest layout' : `Nest layout (${sl.label}${i > 0 ? ', continued' : ''})`
    doc.text(title, margin, nestTop + 10)

    if (slices.length > 1) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(80, 80, 90)
      doc.text(sl.label, margin, nestTop + 20)
    }

    const drawScale = { originX: margin, originY: contentTop, ptPerIn }
    const sliceHpt = inchesToPdfPt(sl.endIn - sl.startIn, drawScale)
    const scale: NestDrawScale = {
      originX: margin,
      originY: contentTop,
      ptPerIn,
    }

    // Guard: if slice somehow taller than page, shrink this page only (rare)
    const maxH = pageH - contentTop - margin - footerReserve - widthNoteReserve
    if (sliceHpt > maxH + 1e-6) {
      scale.ptPerIn = maxH / Math.max(sl.endIn - sl.startIn, 1e-6)
    }

    drawNest(doc, panels, fabricWidthIn, used, scale, unit, {
      sliceStartIn: sl.startIn,
      sliceEndIn: sl.endIn,
      showWidthNote: i === slices.length - 1,
      seamAllowanceIn,
    })

    drawFooter(doc, margin, pageH)
  })

  const name = pdfFilename()
  // Open in a new tab (keeps the user in-flow). Fall back to download if the
  // browser blocks the popup.
  const url = doc.output('bloburl')
  const opened =
    typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null
  if (!opened) {
    doc.save(name)
  }
  return name
}
