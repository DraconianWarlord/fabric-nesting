import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PANEL_COLORS,
  type Panel,
  type PanelKind,
  type SplitSuggestion,
  type Unit,
  applyNestLayoutById,
  autoNestCandidates,
  canPlace,
  clampPanelToBolt,
  cutSize,
  exactYards,
  flipH,
  flipV,
  fromInches,
  circleCutFromFinished,
  defaultDiagonal,
  irregularCutFromFinished,
  isCircle,
  isGenericLabel,
  isIrregular,
  isPolyPanel,
  isTrap,
  nextSequentialLabel,
  offBolt,
  orderYards,
  orientationsThatFit,
  overlapsAny,
  panelBounds,
  panelFootprint,
  panelPolygon,
  patternEnabled,
  patternHOffset,
  placeSpot,
  snapCenterToPattern,
  suggestSplit,
  toInches,
  trapCutFromFinished,
  tryRotate90,
  usedLengthInches,
} from './lib/geometry'
import { wrapSvgText } from './lib/wrapSvgText'
import { exportNestingPdf } from './lib/exportPdf'
import { panelAddBlockMessage, rotate90BlockMessage } from './lib/panelAddGate'
import { CalculatorNav, MobileMoreCalculators } from './CalculatorNav'
import { SHOP } from './shopLinks'
import './App.css'

/** Minimum px per fabric inch so a tiny pane still draws. No max — bolt fills the middle pane. */
const PX_PER_IN_MIN = 1
const MAX_FABRIC_WIDTH_IN = 80

/** Scale so bolt width fills the canvas-wrap (available width ÷ fabric width). */
function computeCanvasPxPerIn(availableWidthPx: number, fabricWidthIn: number): number {
  return Math.max(PX_PER_IN_MIN, availableWidthPx / Math.max(fabricWidthIn, 1e-6))
}

function PanelLabel({
  label,
  widthPx,
  heightPx,
}: {
  label: string
  widthPx: number
  heightPx: number
}) {
  const pad = 4
  const boxW = Math.max(0, widthPx - pad * 2)
  const boxH = Math.max(0, heightPx - pad * 2)
  const { lines, fontSize, lineHeight } = wrapSvgText(label, boxW, boxH, 12, 7)
  if (lines.length === 0) return null
  const startY = pad + fontSize * 0.85
  return (
    <text
      x={pad}
      y={startY}
      className="panel-label"
      style={{ fontSize }}
      pointerEvents="none"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={pad} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

/** Identity of panel set for nest-cycle reset (ids/count/dims). */
function panelSetIdentity(panels: Panel[]): string {
  return [...panels]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) =>
      isCircle(p)
        ? `${p.id}:circle:${p.width}`
        : isIrregular(p)
          ? `${p.id}:irregular:${p.sideLeft}x${p.sideFront}x${p.sideRight}x${p.sideBack}x${p.diagonal}`
          : isTrap(p)
            ? `${p.id}:trap:${p.topWidth}x${p.bottomWidth}x${p.length}`
            : `${p.id}:rect:${p.width}x${p.length}`,
    )
    .join('|')
}

function Collapsible({
  title,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  badge?: string | number
}) {
  return (
    <section className={`collapsible${open ? ' open' : ''}`}>
      <button type="button" className="collapse-header" onClick={onToggle} aria-expanded={open}>
        <span className="collapse-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="collapse-title">{title}</span>
        {badge !== undefined && <span className="collapse-badge">{badge}</span>}
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </section>
  )
}

function ColorPicker({
  value,
  onChange,
  idPrefix = 'color',
}: {
  value: string
  onChange: (c: string) => void
  idPrefix?: string
}) {
  return (
    <div className="color-picker">
      <div className="color-swatches" role="listbox" aria-label="Panel color">
        {PANEL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="option"
            aria-selected={value.toLowerCase() === c.toLowerCase()}
            className={`color-swatch${value.toLowerCase() === c.toLowerCase() ? ' selected' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
      <label className="color-custom">
        Custom
        <input
          id={`${idPrefix}-custom`}
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#24285e'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  )
}

/** Controlled number input that allows "" while editing (no sticky 0 on backspace). */
function SoftNumberInput({
  value,
  onValueChange,
  onBlurValue,
  emptyIncrement = 1,
  ...rest
}: {
  value: number | ''
  onValueChange: (v: number | '') => void
  onBlurValue?: (v: number | '') => void
  emptyIncrement?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <input
      {...rest}
      type="number"
      value={value === '' ? '' : value}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') {
          onValueChange('')
          return
        }
        const n = Number(raw)
        if (!Number.isNaN(n)) onValueChange(n)
      }}
      onBlur={(e) => {
        onBlurValue?.(value)
        rest.onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
          return
        }
        if (value === '' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          onValueChange(e.key === 'ArrowUp' ? emptyIncrement : 0)
        }
        rest.onKeyDown?.(e)
      }}
      enterKeyHint="done"
    />
  )
}

function formatSplitMessage(
  cutW: number,
  cutL: number,
  fabricWidth: number,
  s: SplitSuggestion,
  displayFn: (inches: number) => string,
  unit: Unit,
  seamAllowance: number,
): string {
  const saNote = seamAllowance > 0 ? ' (plus seam allowance on joins)' : ''
  return `This cut piece (${displayFn(cutW)}×${displayFn(cutL)} ${unit}) is wider than the ${displayFn(fabricWidth)} ${unit} bolt in both orientations. Split the ${displayFn(s.overSize)} ${unit} side into ${s.pieceCount} panels of ~${displayFn(s.pieceCutApprox)} ${unit}${saNote} and nest the strips.`
}


function exportNestingPdfClick(opts: {
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
}): string | null {
  try {
    // Static import keeps download inside the user-gesture (critical on mobile Safari).
    return exportNestingPdf(opts)
  } catch (err) {
    console.error('Export PDF failed', err)
    return null
  }
}

export default function App() {
  const [unit, setUnit] = useState<Unit>('in')
  const [fabricWidthIn, setFabricWidthIn] = useState(54)
  const [seamAllowanceIn, setSeamAllowanceIn] = useState(0.5)
  const [waste, setWaste] = useState(0)
  const [patterned, setPatterned] = useState(false)
  const [hRepeatIn, setHRepeatIn] = useState(0)
  const [vRepeatIn, setVRepeatIn] = useState(0)
  const [panels, setPanels] = useState<Panel[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftW, setDraftW] = useState<number | ''>(20)
  const [draftL, setDraftL] = useState<number | ''>(24)
  const [draftQty, setDraftQty] = useState<number | ''>(1)
  const [draftLabel, setDraftLabel] = useState('Panel')
  const [draftColor, setDraftColor] = useState<string | null>(null)
  const [draftKind, setDraftKind] = useState<PanelKind>('rect')
  const [draftTop, setDraftTop] = useState<number | ''>(12)
  const [draftBottom, setDraftBottom] = useState<number | ''>(18)
  const [draftHeight, setDraftHeight] = useState<number | ''>(20)
  const [draftDiameter, setDraftDiameter] = useState<number | ''>(12)
  const [draftLeft, setDraftLeft] = useState<number | ''>(16)
  const [draftFront, setDraftFront] = useState<number | ''>(20)
  const [draftRight, setDraftRight] = useState<number | ''>(16)
  const [draftBack, setDraftBack] = useState<number | ''>(24)
  const [draftDiagonal, setDraftDiagonal] = useState<number | ''>(27.13)
  const [diagonalDirty, setDiagonalDirty] = useState(false)
  const [fabricWidthDraft, setFabricWidthDraft] = useState<number | ''>(54)
  const [seamDraft, setSeamDraft] = useState<number | ''>(0.5)
  const [wasteDraft, setWasteDraft] = useState<number | ''>(0)
  const [hRepeatDraft, setHRepeatDraft] = useState<number | ''>(0)
  const [vRepeatDraft, setVRepeatDraft] = useState<number | ''>(0)
  const [nestCycleIndex, setNestCycleIndex] = useState(0)
  const [nestHint, setNestHint] = useState<string | null>(null)
  const [actionHint, setActionHint] = useState<string | null>(null)
  const [openFabric, setOpenFabric] = useState(true)
  const [openAdd, setOpenAdd] = useState(true)
  const [openSelected, setOpenSelected] = useState(true)
  const [openList, setOpenList] = useState(true)
  /** Narrow-screen segmented view: Controls | Bolt | Panels */
  const [mobileView, setMobileView] = useState<'controls' | 'bolt' | 'panels'>('bolt')
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 800px)').matches,
  )
  const dragRef = useRef<{
    id: string
    ox: number
    oy: number
    lastValidX: number
    lastValidY: number
  } | null>(null)
  const canvasWrapRef = useRef<HTMLElement | null>(null)
  const [pxPerIn, setPxPerIn] = useState(PX_PER_IN_MIN)

  const used = usedLengthInches(panels)
  const exact = exactYards(used, waste)
  const order = orderYards(exact)
  const selected = panels.find((p) => p.id === selectedId) ?? null
  const saDisplay = fromInches(seamAllowanceIn, unit)

  const effectiveH = patterned ? hRepeatIn : 0
  const effectiveV = patterned ? vRepeatIn : 0
  const hasPattern = patternEnabled(effectiveH, effectiveV)

  const setIdentity = panelSetIdentity(panels)

  useEffect(() => {
    setNestCycleIndex(0)
    setNestHint(null)
  }, [setIdentity, fabricWidthIn, effectiveH, effectiveV])

  useEffect(() => {
    setFabricWidthDraft(Number(fromInches(fabricWidthIn, unit).toFixed(unit === 'in' ? 3 : 1)))
  }, [fabricWidthIn, unit])
  useEffect(() => {
    setSeamDraft(Number(fromInches(seamAllowanceIn, unit).toFixed(unit === 'in' ? 3 : 1)))
  }, [seamAllowanceIn, unit])
  useEffect(() => {
    setWasteDraft(waste)
  }, [waste])
  useEffect(() => {
    setHRepeatDraft(Number(fromInches(hRepeatIn, unit).toFixed(unit === 'in' ? 3 : 1)))
  }, [hRepeatIn, unit])
  useEffect(() => {
    setVRepeatDraft(Number(fromInches(vRepeatIn, unit).toFixed(unit === 'in' ? 3 : 1)))
  }, [vRepeatIn, unit])

  // Auto-fill diagonal from sides unless the user has manually overridden it.
  useEffect(() => {
    if (diagonalDirty) return
    if (draftLeft === '' || draftFront === '' || draftRight === '' || draftBack === '') return
    const L = Number(draftLeft)
    const F = Number(draftFront)
    const R = Number(draftRight)
    const B = Number(draftBack)
    if (!(L > 0) || !(F > 0) || !(R > 0) || !(B > 0)) return
    const d = defaultDiagonal(
      toInches(L, unit),
      toInches(F, unit),
      toInches(R, unit),
      toInches(B, unit),
    )
    if (!(d > 0)) return
    const displayD = Number(fromInches(d, unit).toFixed(unit === 'in' ? 2 : 1))
    setDraftDiagonal(displayD)
  }, [draftLeft, draftFront, draftRight, draftBack, diagonalDirty, unit])

  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el) return
    const update = () => {
      const cs = getComputedStyle(el)
      const pad =
        parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
      // .bolt has 2px border each side — leave room so fit-width never forces H scroll
      const boltBorderX = 4
      const available = Math.max(40, el.clientWidth - pad - boltBorderX)
      setPxPerIn(computeCanvasPxPerIn(available, fabricWidthIn))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fabricWidthIn])

  const boltHeightIn = Math.max(used + 12, 72)
  const svgW = fabricWidthIn * pxPerIn
  const svgH = boltHeightIn * pxPerIn

  function display(inches: number) {
    const v = fromInches(inches, unit)
    return unit === 'in' ? String(Number(v.toFixed(2))) : String(Number(v.toFixed(1)))
  }

  function setFabricWidthClamped(inches: number) {
    const v = Math.min(MAX_FABRIC_WIDTH_IN, Math.max(1, inches || 0))
    setFabricWidthIn(v)
  }

  function spotFor(width: number, length: number, existing: Panel[]): { x: number; y: number } {
    return placeSpot(width, length, fabricWidthIn, existing, 0.25, effectiveH, effectiveV)
  }

  /** Apply transform; refuse if result would stay off-bolt. */
  function updatePanelSafe(id: string, fn: (p: Panel) => Panel) {
    setPanels((prev) => {
      const others = prev.filter((p) => p.id !== id)
      const current = prev.find((p) => p.id === id)
      if (!current) return prev
      let next = clampPanelToBolt(fn(current), fabricWidthIn)
      if (!canPlace(next, others, fabricWidthIn)) {
        const fp = panelFootprint(next)
        if (fp.w > fabricWidthIn + 1e-6) return prev
        const spot = spotFor(fp.w, fp.h, others)
        next = clampPanelToBolt({ ...next, x: spot.x, y: spot.y }, fabricWidthIn)
        if (!canPlace(next, others, fabricWidthIn)) return prev
      }
      return prev.map((p) => (p.id === id ? next : p))
    })
  }

  function rotateSelected90(id: string) {
    setPanels((prev) => {
      const current = prev.find((p) => p.id === id)
      if (!current) return prev
      const others = prev.filter((p) => p.id !== id)
      const next = tryRotate90(current, others, fabricWidthIn, (w, h, existing) =>
        spotFor(w, h, existing),
      )
      if (!next) {
        const msg = rotate90BlockMessage(false)
        if (msg) setActionHint(msg)
        return prev
      }
      setActionHint(null)
      return prev.map((p) => (p.id === id ? next : p))
    })
  }

  function renamePanel(id: string, label: string) {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)))
  }

  function setPanelColor(id: string, color: string) {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)))
  }

  function draftCutSizes(): { cutW: number; cutL: number; finW: number; finL: number } | null {
    if (draftKind === 'circle') {
      if (draftDiameter === '') return null
      const finD = toInches(Number(draftDiameter), unit)
      if (!(finD > 0)) return null
      const cut = circleCutFromFinished(finD, seamAllowanceIn)
      return {
        finW: finD,
        finL: finD,
        cutW: cut.diameter,
        cutL: cut.diameter,
      }
    }
    if (draftKind === 'irregular') {
      const cut = draftIrregularCut()
      if (!cut) return null
      return {
        finW: cut.width,
        finL: cut.length,
        cutW: cut.width,
        cutL: cut.length,
      }
    }
    if (draftKind === 'trap') {
      if (draftTop === '' || draftBottom === '' || draftHeight === '') return null
      const finTop = toInches(Number(draftTop), unit)
      const finBot = toInches(Number(draftBottom), unit)
      const finH = toInches(Number(draftHeight), unit)
      if (!(finTop > 0) || !(finBot > 0) || !(finH > 0)) return null
      const cut = trapCutFromFinished(finTop, finBot, finH, seamAllowanceIn)
      return {
        finW: Math.max(finTop, finBot),
        finL: finH,
        cutW: cut.width,
        cutL: cut.length,
      }
    }
    if (draftW === '' || draftL === '') return null
    const finW = toInches(Number(draftW), unit)
    const finL = toInches(Number(draftL), unit)
    if (!(finW > 0) || !(finL > 0)) return null
    return {
      finW,
      finL,
      cutW: cutSize(finW, seamAllowanceIn),
      cutL: cutSize(finL, seamAllowanceIn),
    }
  }

  function draftTrapCut(): ReturnType<typeof trapCutFromFinished> | null {
    if (draftKind !== 'trap') return null
    if (draftTop === '' || draftBottom === '' || draftHeight === '') return null
    const finTop = toInches(Number(draftTop), unit)
    const finBot = toInches(Number(draftBottom), unit)
    const finH = toInches(Number(draftHeight), unit)
    if (!(finTop > 0) || !(finBot > 0) || !(finH > 0)) return null
    return trapCutFromFinished(finTop, finBot, finH, seamAllowanceIn)
  }

  function draftCircleCut(): ReturnType<typeof circleCutFromFinished> | null {
    if (draftKind !== 'circle') return null
    if (draftDiameter === '') return null
    const finD = toInches(Number(draftDiameter), unit)
    if (!(finD > 0)) return null
    return circleCutFromFinished(finD, seamAllowanceIn)
  }

  function draftIrregularCut(): NonNullable<ReturnType<typeof irregularCutFromFinished>> | null {
    if (draftKind !== 'irregular') return null
    if (
      draftLeft === '' ||
      draftFront === '' ||
      draftRight === '' ||
      draftBack === '' ||
      draftDiagonal === ''
    ) {
      return null
    }
    const finL = toInches(Number(draftLeft), unit)
    const finF = toInches(Number(draftFront), unit)
    const finR = toInches(Number(draftRight), unit)
    const finB = toInches(Number(draftBack), unit)
    const finD = toInches(Number(draftDiagonal), unit)
    if (!(finL > 0) || !(finF > 0) || !(finR > 0) || !(finB > 0) || !(finD > 0)) return null
    return irregularCutFromFinished(finL, finF, finR, finB, finD, seamAllowanceIn)
  }

  const draftSplit = (() => {
    // Split helper is rect-oriented; traps/circles use resize-only messaging.
    if (draftKind === 'trap' || draftKind === 'circle' || draftKind === 'irregular') return null
    const sizes = draftCutSizes()
    if (!sizes) return null
    return suggestSplit(sizes.cutW, sizes.cutL, fabricWidthIn, seamAllowanceIn)
  })()

  const selectedSplit =
    selected && !isTrap(selected) && !isCircle(selected) && !isIrregular(selected)
      ? suggestSplit(selected.width, selected.length, fabricWidthIn, seamAllowanceIn)
      : null

  function placeOrientedPanel(base: Panel, existing: Panel[]): Panel {
    let best: Panel | null = null
    let bestUsed = Infinity
    let bestY = Infinity
    let bestX = Infinity
    const orients = orientationsThatFit(base, fabricWidthIn)
    const tryRots = orients.length > 0 ? orients : ([0] as Array<0 | 90>)
    for (const rotation of tryRots) {
      const fp = panelFootprint({ ...base, rotation })
      const spot = spotFor(fp.w, fp.h, existing)
      const candidate: Panel = { ...base, rotation, x: spot.x, y: spot.y }
      const u = usedLengthInches([...existing, candidate])
      const better =
        u < bestUsed - 1e-9 ||
        (Math.abs(u - bestUsed) <= 1e-9 &&
          (spot.y < bestY - 1e-9 ||
            (Math.abs(spot.y - bestY) <= 1e-9 && spot.x < bestX - 1e-9)))
      if (better) {
        best = candidate
        bestUsed = u
        bestY = spot.y
        bestX = spot.x
      }
    }
    return best!
  }

  function addSplitFromSuggestion(
    suggestion: SplitSuggestion,
    labelBase: string,
    replaceId?: string | null,
  ) {
    setPanels((prev) => {
      let next = replaceId ? prev.filter((p) => p.id !== replaceId) : [...prev]
      const useSequential = isGenericLabel(labelBase)
      for (let i = 0; i < suggestion.pieceCount; i++) {
        const w = cutSize(suggestion.pieceFinishedW, seamAllowanceIn)
        const l = cutSize(suggestion.pieceFinishedL, seamAllowanceIn)
        const color = PANEL_COLORS[next.length % PANEL_COLORS.length]
        const label = useSequential ? nextSequentialLabel(next) : `${labelBase} ${i + 1}`
        const base: Panel = {
          id: uid(),
          label,
          kind: 'rect',
          width: w,
          length: l,
          x: 0,
          y: 0,
          rotation: 0,
          flippedH: false,
          flippedV: false,
          color,
        }
        if (orientationsThatFit(base, fabricWidthIn).length === 0) continue
        next.push(placeOrientedPanel(base, next))
      }
      setSelectedId(next[next.length - 1]?.id ?? null)
      return next
    })
    setActionHint(null)
  }

  function addPanels() {
    const sizes = draftCutSizes()
    if (!sizes) return
    const { cutW: w, cutL: l } = sizes
    const block = panelAddBlockMessage(
      draftKind === 'trap'
        ? 'trap'
        : draftKind === 'circle'
          ? 'circle'
          : draftKind === 'irregular'
            ? 'irregular'
            : 'rect',
      w,
      l,
      fabricWidthIn,
      seamAllowanceIn,
    )
    if (block) {
      setActionHint(block)
      return
    }
    const trapCut = draftTrapCut()
    const circleCut = draftCircleCut()
    const irregularCut = draftIrregularCut()
    const qty =
      typeof draftQty === 'number' && draftQty > 0 ? Math.min(40, Math.floor(draftQty)) : 1
    const next = [...panels]
    const useSequential = isGenericLabel(draftLabel)
    for (let i = 0; i < qty; i++) {
      const color = draftColor ?? PANEL_COLORS[next.length % PANEL_COLORS.length]
      const label = useSequential
        ? nextSequentialLabel(next)
        : qty > 1
          ? `${draftLabel} ${i + 1}`
          : draftLabel
      let base: Panel
      if (draftKind === 'circle' && circleCut) {
        base = {
          id: uid(),
          label,
          kind: 'circle',
          width: circleCut.diameter,
          length: circleCut.diameter,
          x: 0,
          y: 0,
          rotation: 0,
          flippedH: false,
          flippedV: false,
          color,
        }
      } else if (draftKind === 'irregular' && irregularCut) {
        base = {
          id: uid(),
          label,
          kind: 'irregular',
          width: irregularCut.width,
          length: irregularCut.length,
          sideLeft: irregularCut.sideLeft,
          sideFront: irregularCut.sideFront,
          sideRight: irregularCut.sideRight,
          sideBack: irregularCut.sideBack,
          diagonal: irregularCut.diagonal,
          x: 0,
          y: 0,
          rotation: 0,
          flippedH: false,
          flippedV: false,
          color,
        }
      } else if (draftKind === 'trap' && trapCut) {
        base = {
          id: uid(),
          label,
          kind: 'trap',
          width: trapCut.width,
          length: trapCut.length,
          topWidth: trapCut.topWidth,
          bottomWidth: trapCut.bottomWidth,
          x: 0,
          y: 0,
          rotation: 0,
          flippedH: false,
          flippedV: false,
          color,
        }
      } else {
        base = {
          id: uid(),
          label,
          kind: 'rect',
          width: w,
          length: l,
          x: 0,
          y: 0,
          rotation: 0,
          flippedH: false,
          flippedV: false,
          color,
        }
      }
      next.push(placeOrientedPanel(base, next))
    }
    setPanels(next)
    setSelectedId(next[next.length - 1]?.id ?? null)
    setActionHint(null)
    setMobileView('bolt')
  }

  function updateSelectedFinishedDims(
    id: string,
    patch: {
      width?: number
      length?: number
      topWidth?: number
      bottomWidth?: number
      height?: number
      diameter?: number
      sideLeft?: number
      sideFront?: number
      sideRight?: number
      sideBack?: number
      diagonal?: number
    },
  ) {
    setPanels((prev) => {
      const current = prev.find((p) => p.id === id)
      if (!current) return prev
      const others = prev.filter((p) => p.id !== id)
      let next: Panel
      if (isCircle(current)) {
        const finD =
          patch.diameter !== undefined
            ? patch.diameter
            : Math.max(0, current.width - 2 * seamAllowanceIn)
        if (!(finD > 0)) return prev
        const cut = circleCutFromFinished(finD, seamAllowanceIn)
        next = {
          ...current,
          kind: 'circle',
          width: cut.diameter,
          length: cut.diameter,
        }
      } else if (isIrregular(current)) {
        const finLeft =
          patch.sideLeft !== undefined
            ? patch.sideLeft
            : Math.max(0, (current.sideLeft ?? 0) - 2 * seamAllowanceIn)
        const finFront =
          patch.sideFront !== undefined
            ? patch.sideFront
            : Math.max(0, (current.sideFront ?? 0) - 2 * seamAllowanceIn)
        const finRight =
          patch.sideRight !== undefined
            ? patch.sideRight
            : Math.max(0, (current.sideRight ?? 0) - 2 * seamAllowanceIn)
        const finBack =
          patch.sideBack !== undefined
            ? patch.sideBack
            : Math.max(0, (current.sideBack ?? 0) - 2 * seamAllowanceIn)
        const finDiag =
          patch.diagonal !== undefined
            ? patch.diagonal
            : Math.max(0, (current.diagonal ?? 0) - 2 * seamAllowanceIn)
        if (
          !(finLeft > 0) ||
          !(finFront > 0) ||
          !(finRight > 0) ||
          !(finBack > 0) ||
          !(finDiag > 0)
        ) {
          return prev
        }
        const cut = irregularCutFromFinished(
          finLeft,
          finFront,
          finRight,
          finBack,
          finDiag,
          seamAllowanceIn,
        )
        if (!cut) return prev
        next = {
          ...current,
          kind: 'irregular',
          sideLeft: cut.sideLeft,
          sideFront: cut.sideFront,
          sideRight: cut.sideRight,
          sideBack: cut.sideBack,
          diagonal: cut.diagonal,
          width: cut.width,
          length: cut.length,
        }
      } else if (isTrap(current)) {
        const finTop =
          patch.topWidth !== undefined
            ? patch.topWidth
            : Math.max(0, (current.topWidth ?? current.width) - 2 * seamAllowanceIn)
        const finBot =
          patch.bottomWidth !== undefined
            ? patch.bottomWidth
            : Math.max(0, (current.bottomWidth ?? current.width) - 2 * seamAllowanceIn)
        const finH =
          patch.height !== undefined
            ? patch.height
            : Math.max(0, current.length - 2 * seamAllowanceIn)
        if (!(finTop > 0) || !(finBot > 0) || !(finH > 0)) return prev
        const cut = trapCutFromFinished(finTop, finBot, finH, seamAllowanceIn)
        next = {
          ...current,
          kind: 'trap',
          topWidth: cut.topWidth,
          bottomWidth: cut.bottomWidth,
          width: cut.width,
          length: cut.length,
        }
      } else {
        const finW =
          patch.width !== undefined
            ? patch.width
            : Math.max(0, current.width - 2 * seamAllowanceIn)
        const finL =
          patch.length !== undefined
            ? patch.length
            : Math.max(0, current.length - 2 * seamAllowanceIn)
        if (!(finW > 0) || !(finL > 0)) return prev
        next = {
          ...current,
          kind: 'rect',
          width: cutSize(finW, seamAllowanceIn),
          length: cutSize(finL, seamAllowanceIn),
        }
      }
      next = clampPanelToBolt(next, fabricWidthIn)
      if (!canPlace(next, others, fabricWidthIn)) {
        const fp = panelFootprint(next)
        if (fp.w > fabricWidthIn + 1e-6) return prev
        const spot = spotFor(fp.w, fp.h, others)
        next = clampPanelToBolt({ ...next, x: spot.x, y: spot.y }, fabricWidthIn)
        if (!canPlace(next, others, fabricWidthIn)) return prev
      }
      return prev.map((p) => (p.id === id ? next : p))
    })
  }


  useEffect(() => {
    const mq = window.matchMedia('(max-width: 800px)')
    const sync = () => setIsNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  function runAutoNest() {
    if (panels.length === 0) return
    const candidates = autoNestCandidates(panels, fabricWidthIn, 0.25, effectiveH, effectiveV)
    if (candidates.length === 0) return
    const idx = nestCycleIndex % candidates.length
    const layout = candidates[idx]
    setPanels((prev) => applyNestLayoutById(prev, layout))
    const remapped = applyNestLayoutById(panels, layout)
    const usedYd = exactYards(usedLengthInches(remapped), waste)
    setNestHint(`Nest ${idx + 1} of ${candidates.length} · ${usedYd.toFixed(2)} yd`)
    setNestCycleIndex((idx + 1) % candidates.length)
  }

  function clearAllPanels() {
    if (!window.confirm("Clear all panels? This can't be undone.")) return
    setPanels([])
    setSelectedId(null)
    setNestHint(null)
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    const panel = panels.find((p) => p.id === id)
    if (!panel) return
    e.stopPropagation()
    setSelectedId(id)
    // Phones: tap to select only — no drag (Auto-Nest is the layout control).
    if (isNarrow || e.pointerType === 'touch') return
    const svg = (e.target as Element).closest('svg') as SVGSVGElement
    const pt = clientToSvg(svg, e.clientX, e.clientY)
    dragRef.current = {
      id,
      ox: pt.x / pxPerIn - panel.x,
      oy: pt.y / pxPerIn - panel.y,
      lastValidX: panel.x,
      lastValidY: panel.y,
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return
    const pt = clientToSvg(e.currentTarget, e.clientX, e.clientY)
    const { id, ox, oy, lastValidX, lastValidY } = dragRef.current

    setPanels((prev) => {
      const current = prev.find((p) => p.id === id)
      if (!current) return prev
      const others = prev.filter((p) => p.id !== id)
      const rawX = pt.x / pxPerIn - ox
      const rawY = pt.y / pxPerIn - oy
      const trial = clampPanelToBolt({ ...current, x: rawX, y: rawY }, fabricWidthIn)
      if (canPlace(trial, others, fabricWidthIn)) {
        dragRef.current = {
          ...dragRef.current!,
          lastValidX: trial.x,
          lastValidY: trial.y,
        }
        return prev.map((p) => (p.id === id ? trial : p))
      }
      return prev.map((p) => (p.id === id ? { ...p, x: lastValidX, y: lastValidY } : p))
    })
  }

  function onPointerUp() {
    if (!dragRef.current) return
    const { id } = dragRef.current
    dragRef.current = null
    if (!hasPattern) return
    setPanels((prev) => {
      const current = prev.find((p) => p.id === id)
      if (!current) return prev
      const others = prev.filter((p) => p.id !== id)
      const snapped = snapCenterToPattern(current, effectiveH, effectiveV, fabricWidthIn)
      const trial = clampPanelToBolt({ ...current, x: snapped.x, y: snapped.y }, fabricWidthIn)
      if (canPlace(trial, others, fabricWidthIn)) {
        return prev.map((p) => (p.id === id ? trial : p))
      }
      return prev
    })
  }

  const problems = useMemo(
    () =>
      panels.map((p) => ({
        id: p.id,
        overlap: overlapsAny(p, panels),
        off: offBolt(p, fabricWidthIn),
      })),
    [panels, fabricWidthIn],
  )

  const yardTicks = useMemo(() => {
    const majors: number[] = []
    const maxYd = Math.ceil(boltHeightIn / 36) + 1
    for (let yd = 0; yd <= maxYd; yd++) majors.push(yd * 36)
    return { majors }
  }, [boltHeightIn])

  const patternGrid = useMemo(() => {
    if (!hasPattern) return { verts: [] as number[], hors: [] as number[] }
    const verts: number[] = []
    const hors: number[] = []
    if (effectiveH > 0) {
      const hOff = patternHOffset(fabricWidthIn, effectiveH)
      for (let x = hOff; x <= fabricWidthIn + 1e-6; x += effectiveH) {
        if (x >= -1e-6) verts.push(x)
      }
    }
    if (effectiveV > 0) {
      for (let y = 0; y <= boltHeightIn + 1e-6; y += effectiveV) hors.push(y)
    }
    return { verts, hors }
  }, [hasPattern, effectiveH, effectiveV, fabricWidthIn, boltHeightIn])


  const draftSizes = draftCutSizes()

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-bar">
          <div className="app-header-identity">
            <img src="/sailrite-logo.png" alt="Sailrite" className="brand-logo" />
            <span className="current-tool" aria-current="page">
              Nesting
            </span>
            <MobileMoreCalculators />
          </div>

          <CalculatorNav />

          <div className="app-header-status">
            <div className="yards" aria-label="Yardage summary">
              <span className="yards-exact">{exact.toFixed(2)} yd</span>
              <span className="yards-order">Order {order} yd</span>
              <span className="yards-meta">
                Used {display(used)} {unit}
                {waste > 0 ? ` · +${waste}%` : ''}
              </span>
            </div>
            <a
              className="shop-sailrite"
              href={SHOP.home}
              target="_blank"
              rel="noopener noreferrer"
            >
              Shop Sailrite
            </a>
            <button
              type="button"
              className="export-pdf"
              title="Open nest PDF in a new tab"
              onClick={() => {
                const ok = exportNestingPdfClick({
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
                })
                if (ok == null) {
                  setActionHint('Export PDF failed — try again, or remove a panel and retry.')
                }
              }}
            >
              Export PDF
            </button>
          </div>
        </div>
      </header>

      {actionHint && (
        <div className="action-hint" role="alert">
          {actionHint}
          <button type="button" className="linkish" onClick={() => setActionHint(null)}>
            Dismiss
          </button>
        </div>
      )}

      <nav className="mobile-tabs" aria-label="Main sections">
        <button
          type="button"
          className={mobileView === 'controls' ? 'active' : ''}
          aria-pressed={mobileView === 'controls'}
          onClick={() => setMobileView('controls')}
        >
          Controls
        </button>
        <button
          type="button"
          className={mobileView === 'bolt' ? 'active' : ''}
          aria-pressed={mobileView === 'bolt'}
          onClick={() => setMobileView('bolt')}
        >
          Bolt
        </button>
        <button
          type="button"
          className={mobileView === 'panels' ? 'active' : ''}
          aria-pressed={mobileView === 'panels'}
          onClick={() => setMobileView('panels')}
        >
          Panels{panels.length > 0 ? ` (${panels.length})` : ''}
        </button>
      </nav>

      <div className={`layout mobile-${mobileView}`}>
        <aside className="sidebar left" data-mobile-pane="controls">
          <Collapsible title="Fabric" open={openFabric} onToggle={() => setOpenFabric((v) => !v)}>
            <label>
              Width ({unit})
              <SoftNumberInput
                min={1}
                max={Number(fromInches(MAX_FABRIC_WIDTH_IN, unit).toFixed(3))}
                step={1}
                value={fabricWidthDraft}
                onValueChange={(v) => {
                  setFabricWidthDraft(v)
                  if (v !== '') setFabricWidthClamped(toInches(v, unit))
                }}
                onBlurValue={(v) => {
                  if (v === '') {
                    setFabricWidthDraft(
                      Number(fromInches(fabricWidthIn, unit).toFixed(unit === 'in' ? 3 : 1)),
                    )
                  }
                }}
              />
            </label>
            <p className="hint">
              Max {display(MAX_FABRIC_WIDTH_IN)} {unit}
            </p>
            <label>
              Seam allowance ({unit})
              <SoftNumberInput
                min={0}
                step={1}
                emptyIncrement={0}
                value={seamDraft}
                onValueChange={(v) => {
                  setSeamDraft(v)
                  if (v !== '') setSeamAllowanceIn(toInches(Math.max(0, v), unit))
                }}
                onBlurValue={(v) => {
                  if (v === '') {
                    setSeamDraft(Number(saDisplay.toFixed(unit === 'in' ? 3 : 1)))
                  }
                }}
              />
            </label>
            <p className="hint">cut = finished + 2×SA on each side</p>
            <label>
              Waste %
              <SoftNumberInput
                min={0}
                max={50}
                step={1}
                emptyIncrement={0}
                value={wasteDraft}
                onValueChange={(v) => {
                  setWasteDraft(v)
                  if (v !== '') setWaste(Math.max(0, Math.min(50, v)))
                }}
                onBlurValue={(v) => {
                  if (v === '') setWasteDraft(waste)
                }}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={patterned}
                onChange={(e) => {
                  const on = e.target.checked
                  setPatterned(on)
                  if (on && hRepeatIn <= 0 && vRepeatIn <= 0) {
                    setHRepeatIn(unit === 'in' ? 12 : toInches(300, 'mm'))
                    setVRepeatIn(unit === 'in' ? 12 : toInches(300, 'mm'))
                  }
                }}
              />
              Patterned fabric
            </label>
            {patterned && (
              <>
                <label>
                  Horizontal repeat ({unit})
                  <SoftNumberInput
                    min={0}
                    step={1}
                    emptyIncrement={0}
                    value={hRepeatDraft}
                    onValueChange={(v) => {
                      setHRepeatDraft(v)
                      if (v !== '') setHRepeatIn(toInches(Math.max(0, v), unit))
                    }}
                    onBlurValue={(v) => {
                      if (v === '') {
                        setHRepeatDraft(
                          Number(fromInches(hRepeatIn, unit).toFixed(unit === 'in' ? 3 : 1)),
                        )
                      }
                    }}
                  />
                </label>
                <label>
                  Vertical repeat ({unit})
                  <SoftNumberInput
                    min={0}
                    step={1}
                    emptyIncrement={0}
                    value={vRepeatDraft}
                    onValueChange={(v) => {
                      setVRepeatDraft(v)
                      if (v !== '') setVRepeatIn(toInches(Math.max(0, v), unit))
                    }}
                    onBlurValue={(v) => {
                      if (v === '') {
                        setVRepeatDraft(
                          Number(fromInches(vRepeatIn, unit).toFixed(unit === 'in' ? 3 : 1)),
                        )
                      }
                    }}
                  />
                </label>
                <p className="hint">
                  Vertical repeat starts at the top of the bolt; horizontal repeat is centered on
                  the width. Set either axis to <strong>0</strong> for stripes (1D repeat on the
                  other axis). Nesting/snap align panel centers to the active pattern grid.
                </p>
              </>
            )}
            <div className="row">
              <button
                type="button"
                className={unit === 'in' ? 'active' : ''}
                onClick={() => setUnit('in')}
              >
                inches
              </button>
              <button
                type="button"
                className={unit === 'mm' ? 'active' : ''}
                onClick={() => setUnit('mm')}
              >
                mm
              </button>
            </div>
          </Collapsible>

          <Collapsible title="Add Panel" open={openAdd} onToggle={() => setOpenAdd((v) => !v)}>
            <label>
              Label
              <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} />
            </label>
            <div className="row shape-toggle" role="group" aria-label="Panel shape">
              <button
                type="button"
                className={draftKind === 'rect' ? 'active' : ''}
                onClick={() => setDraftKind('rect')}
              >
                Rectangle
              </button>
              <button
                type="button"
                className={draftKind === 'trap' ? 'active' : ''}
                onClick={() => setDraftKind('trap')}
              >
                Trapezoid
              </button>
              <button
                type="button"
                className={draftKind === 'circle' ? 'active' : ''}
                onClick={() => setDraftKind('circle')}
              >
                Circle
              </button>
              <button
                type="button"
                className={draftKind === 'irregular' ? 'active' : ''}
                onClick={() => {
                  setDraftKind('irregular')
                  setDiagonalDirty(false)
                }}
              >
                Irregular
              </button>
            </div>
            {draftKind === 'circle' && (
              <figure className="circle-dims-figure" aria-label="Circle finished diameter">
                <svg
                  className="circle-dims-svg"
                  viewBox="0 0 240 200"
                  role="img"
                  aria-hidden="true"
                >
                  <title>Finished diameter</title>
                  <circle
                    cx="120"
                    cy="95"
                    r="60"
                    fill="#f5f5f5"
                    stroke="#111"
                    strokeWidth="2.5"
                  />
                  <line x1="60" y1="95" x2="180" y2="95" stroke="#24285e" strokeWidth="2" />
                  <line x1="60" y1="89" x2="60" y2="101" stroke="#24285e" strokeWidth="2" />
                  <line x1="180" y1="89" x2="180" y2="101" stroke="#24285e" strokeWidth="2" />
                  <text
                    x="120"
                    y="175"
                    textAnchor="middle"
                    fill="#24285e"
                    fontSize="16"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                  >
                    Diameter
                  </text>
                </svg>
              </figure>
            )}
            {draftKind === 'trap' && (
              <figure className="trap-dims-figure" aria-label="Trapezoid finished dimensions">
                <svg
                  className="trap-dims-svg"
                  viewBox="0 0 320 235"
                  role="img"
                  aria-hidden="true"
                >
                  <title>Top width, bottom width, and height</title>
                  {/* shape */}
                  <polygon
                    points="95,55 225,55 275,175 45,175"
                    fill="#f5f5f5"
                    stroke="#111"
                    strokeWidth="2.5"
                  />
                  {/* top width */}
                  <line x1="95" y1="38" x2="225" y2="38" stroke="#24285e" strokeWidth="2" />
                  <line x1="95" y1="32" x2="95" y2="44" stroke="#24285e" strokeWidth="2" />
                  <line x1="225" y1="32" x2="225" y2="44" stroke="#24285e" strokeWidth="2" />
                  <text
                    x="160"
                    y="28"
                    textAnchor="middle"
                    fill="#24285e"
                    fontSize="16"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                  >
                    Top width
                  </text>
                  {/* bottom width */}
                  <line x1="45" y1="198" x2="275" y2="198" stroke="#24285e" strokeWidth="2" />
                  <line x1="45" y1="192" x2="45" y2="204" stroke="#24285e" strokeWidth="2" />
                  <line x1="275" y1="192" x2="275" y2="204" stroke="#24285e" strokeWidth="2" />
                  <text
                    x="160"
                    y="222"
                    textAnchor="middle"
                    fill="#24285e"
                    fontSize="16"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                  >
                    Bottom width
                  </text>
                  {/* height */}
                  <line x1="292" y1="55" x2="292" y2="175" stroke="#24285e" strokeWidth="2" />
                  <line x1="286" y1="55" x2="298" y2="55" stroke="#24285e" strokeWidth="2" />
                  <line x1="286" y1="175" x2="298" y2="175" stroke="#24285e" strokeWidth="2" />
                  <text
                    x="308"
                    y="120"
                    textAnchor="middle"
                    fill="#24285e"
                    fontSize="16"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                    transform="rotate(90 308 120)"
                  >
                    Height
                  </text>
                </svg>
              </figure>
            )}
            {draftKind === 'irregular' && (
              <figure className="irregular-dims-figure" aria-label="Irregular quadrilateral finished dimensions">
                <svg
                  className="irregular-dims-svg"
                  viewBox="0 0 320 240"
                  role="img"
                  aria-hidden="true"
                >
                  <title>Left, Bottom, Right, Top, and Diagonal</title>
                  <defs>
                    {/* Label paths sit just outside each edge so text follows the line */}
                    <path id="irreg-label-bottom" d="M 60 192 L 250 192" />
                    <path id="irreg-label-top" d="M 32 62 L 288 35" />
                    <path id="irreg-label-left" d="M 58 175 L 36 78" />
                    <path id="irreg-label-right" d="M 268 172 L 300 52" />
                    <path id="irreg-label-diag" d="M 72 162 L 268 68" />
                  </defs>
                  <polygon
                    points="60,170 250,170 280,55 40,80"
                    fill="#f5f5f5"
                    stroke="#111"
                    strokeWidth="2.5"
                  />
                  {/* dashed diagonal bottom-left → top-right */}
                  <line
                    x1="60"
                    y1="170"
                    x2="280"
                    y2="55"
                    stroke="#24285e"
                    strokeWidth="1.75"
                    strokeDasharray="6 4"
                  />
                  <text
                    fill="#24285e"
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <textPath href="#irreg-label-bottom" startOffset="50%">
                      Bottom
                    </textPath>
                  </text>
                  <text
                    fill="#24285e"
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <textPath href="#irreg-label-top" startOffset="50%">
                      Top
                    </textPath>
                  </text>
                  <text
                    fill="#24285e"
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <textPath href="#irreg-label-left" startOffset="50%">
                      Left
                    </textPath>
                  </text>
                  <text
                    fill="#24285e"
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="system-ui,sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <textPath href="#irreg-label-right" startOffset="50%">
                      Right
                    </textPath>
                  </text>
                  <text
                    fill="#24285e"
                    fontSize="13"
                    fontWeight="600"
                    fontFamily="system-ui,sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    <textPath href="#irreg-label-diag" startOffset="50%">
                      Diagonal
                    </textPath>
                  </text>
                </svg>
              </figure>
            )}
            {draftKind === 'rect' ? (
              <>
                <label>
                  Width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftW}
                    onValueChange={setDraftW}
                  />
                </label>
                <label>
                  Length ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftL}
                    onValueChange={setDraftL}
                  />
                </label>
              </>
            ) : draftKind === 'circle' ? (
              <>
                <label>
                  Diameter ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftDiameter}
                    onValueChange={setDraftDiameter}
                  />
                </label>
                <p className="hint">Finished diameter only. Cut diameter = finished + 2×seam allowance.</p>
              </>
            ) : draftKind === 'irregular' ? (
              <>
                <label>
                  Left ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftLeft}
                    onValueChange={(v) => {
                      setDraftLeft(v)
                      setDiagonalDirty(false)
                    }}
                  />
                </label>
                <label>
                  Bottom ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftFront}
                    onValueChange={(v) => {
                      setDraftFront(v)
                      setDiagonalDirty(false)
                    }}
                  />
                </label>
                <label>
                  Right ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftRight}
                    onValueChange={(v) => {
                      setDraftRight(v)
                      setDiagonalDirty(false)
                    }}
                  />
                </label>
                <label>
                  Top ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftBack}
                    onValueChange={(v) => {
                      setDraftBack(v)
                      setDiagonalDirty(false)
                    }}
                  />
                </label>
                <label>
                  Diagonal ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={0.01}
                    inputMode="decimal"
                    value={draftDiagonal}
                    onValueChange={(v) => {
                      setDraftDiagonal(v)
                      setDiagonalDirty(true)
                    }}
                  />
                </label>
                <p className="hint">
                  Auto from sides (symmetric / forepeak / keystone). Edit to match a measured
                  cross-corner.
                  {diagonalDirty && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setDiagonalDirty(false)}
                      >
                        Reset diagonal
                      </button>
                    </>
                  )}
                </p>
              </>
            ) : (
              <>
                <label>
                  Top width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftTop}
                    onValueChange={setDraftTop}
                  />
                </label>
                <label>
                  Bottom width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftBottom}
                    onValueChange={setDraftBottom}
                  />
                </label>
                <label>
                  Height ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                  <SoftNumberInput
                    min={1}
                    step={1}
                    inputMode="decimal"
                    value={draftHeight}
                    onValueChange={setDraftHeight}
                  />
                </label>
                <p className="hint">
                  Parallel top &amp; bottom across the bolt (at 0°). Equal widths act like a rectangle.
                </p>
              </>
            )}
            {seamAllowanceIn > 0 && draftSizes && (
              <p className="hint">
                {draftKind === 'circle' && draftCircleCut() ? (
                  <>Cut ≈ ⌀ {display(draftCircleCut()!.diameter)} {unit}</>
                ) : draftKind === 'irregular' && draftIrregularCut() ? (
                  <>
                    Cut ≈ {display(draftIrregularCut()!.sideLeft)}×
                    {display(draftIrregularCut()!.sideFront)}×
                    {display(draftIrregularCut()!.sideRight)}×
                    {display(draftIrregularCut()!.sideBack)} ⌒
                    {display(draftIrregularCut()!.diagonal)} {unit} (AABB{' '}
                    {display(draftIrregularCut()!.width)}×{display(draftIrregularCut()!.length)})
                  </>
                ) : draftKind === 'trap' && draftTrapCut() ? (
                  <>
                    Cut ≈ {display(draftTrapCut()!.topWidth)}/{display(draftTrapCut()!.bottomWidth)} ×{' '}
                    {display(draftTrapCut()!.height)} {unit}
                  </>
                ) : (
                  <>
                    Cut ≈ {display(draftSizes.cutW)} × {display(draftSizes.cutL)} {unit}
                  </>
                )}
              </p>
            )}
            <label>
              Quantity
              <SoftNumberInput
                min={1}
                max={40}
                step={1}
                value={draftQty}
                onValueChange={setDraftQty}
                onBlurValue={(v) => {
                  if (v === '' || (typeof v === 'number' && v < 1)) setDraftQty(1)
                }}
              />
            </label>
            {draftSplit && draftSizes && (
              <div className="warn-banner" role="alert">
                <p>
                  {formatSplitMessage(
                    draftSizes.cutW,
                    draftSizes.cutL,
                    fabricWidthIn,
                    draftSplit,
                    display,
                    unit,
                    seamAllowanceIn,
                  )}
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => addSplitFromSuggestion(draftSplit, draftLabel)}
                >
                  Split into {draftSplit.pieceCount} panels
                </button>
              </div>
            )}
            <div className="field-block">
              <span className="field-label">Color</span>
              <ColorPicker
                idPrefix="draft"
                value={draftColor ?? PANEL_COLORS[panels.length % PANEL_COLORS.length]}
                onChange={(c) => setDraftColor(c)}
              />
              {draftColor && (
                <button type="button" className="linkish" onClick={() => setDraftColor(null)}>
                  Use auto palette
                </button>
              )}
            </div>
            <button
              type="button"
              className="primary"
              onClick={addPanels}
              disabled={
                Boolean(draftSplit) ||
                (draftKind === 'rect'
                  ? draftW === '' || draftL === ''
                  : draftKind === 'circle'
                    ? draftDiameter === ''
                    : draftKind === 'irregular'
                      ? draftLeft === '' ||
                        draftFront === '' ||
                        draftRight === '' ||
                        draftBack === '' ||
                        draftDiagonal === '' ||
                        !draftIrregularCut()
                      : draftTop === '' || draftBottom === '' || draftHeight === '')
              }
            >
              Add to bolt
            </button>
            <button
              type="button"
              className="primary auto-nest add-panel-auto-nest"
              title="Cycle through ranked nest layouts"
              onClick={runAutoNest}
              disabled={panels.length === 0}
            >
              Auto-Nest
            </button>
            {nestHint && <p className="hint nest-hint">{nestHint}</p>}
            {!nestHint && panels.length > 0 && (
              <p className="hint">Each click cycles a different ranked layout.</p>
            )}
          </Collapsible>
        </aside>

        <main className="canvas-wrap" ref={canvasWrapRef} data-mobile-pane="bolt">
          {isNarrow && (
            <div className="bolt-mobile-bar">
              <button
                type="button"
                className="primary auto-nest"
                title="Cycle through ranked nest layouts"
                onClick={runAutoNest}
                disabled={panels.length === 0}
              >
                Auto-Nest
              </button>
              {nestHint && <p className="hint nest-hint">{nestHint}</p>}
            </div>
          )}
          <svg
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="bolt"
            style={{ touchAction: isNarrow ? 'auto' : 'none' }}
            onPointerMove={isNarrow ? undefined : onPointerMove}
            onPointerUp={isNarrow ? undefined : onPointerUp}
            onPointerLeave={isNarrow ? undefined : onPointerUp}
          >
            <rect
              x={0}
              y={0}
              width={fabricWidthIn * pxPerIn}
              height={svgH}
              className="fabric"
            />
            {hasPattern &&
              patternGrid.verts.map((xIn) => (
                <line
                  key={`pv-${xIn}`}
                  x1={xIn * pxPerIn}
                  x2={xIn * pxPerIn}
                  y1={0}
                  y2={svgH}
                  className="pattern-grid"
                />
              ))}
            {hasPattern &&
              patternGrid.hors.map((yIn) => (
                <line
                  key={`ph-${yIn}`}
                  x1={0}
                  x2={fabricWidthIn * pxPerIn}
                  y1={yIn * pxPerIn}
                  y2={yIn * pxPerIn}
                  className="pattern-grid"
                />
              ))}
            {yardTicks.majors.map((yIn) => {
              const yd = yIn / 36
              return (
                <g key={`y-${yIn}`}>
                  <line
                    x1={0}
                    x2={fabricWidthIn * pxPerIn}
                    y1={yIn * pxPerIn}
                    y2={yIn * pxPerIn}
                    className="tick tick-major"
                  />
                  <text x={4} y={Math.max(12, yIn * pxPerIn - 4)} className="tick-label">
                    {yd === 0 ? '0' : `${yd} yd`}
                  </text>
                </g>
              )
            })}
            {panels.map((p) => {
              const fp = panelFootprint(p)
              const b = panelBounds(p)
              const prob = problems.find((x) => x.id === p.id)
              const bad = Boolean(prob?.overlap || prob?.off)
              const stroke = p.id === selectedId ? '#24285e' : bad ? '#e75053' : '#333'
              const strokeWidth = p.id === selectedId ? 3.5 : bad ? 2.75 : 1.75
              const poly = isPolyPanel(p) ? panelPolygon(p) : null
              const points = poly
                ? poly.map((pt) => `${pt.x * pxPerIn},${pt.y * pxPerIn}`).join(' ')
                : ''
              const circ = isCircle(p)
              const cx = (p.x + fp.w / 2) * pxPerIn
              const cy = (p.y + fp.h / 2) * pxPerIn
              const r = (fp.w / 2) * pxPerIn
              return (
                <g
                  key={p.id}
                  onPointerDown={(e) => onPointerDown(e, p.id)}
                  style={{ cursor: 'grab' }}
                >
                  {circ ? (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={p.color}
                      opacity={0.9}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  ) : poly ? (
                    <polygon
                      points={points}
                      fill={p.color}
                      opacity={0.9}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      strokeLinejoin="miter"
                    />
                  ) : (
                    <rect
                      x={p.x * pxPerIn}
                      y={p.y * pxPerIn}
                      width={fp.w * pxPerIn}
                      height={fp.h * pxPerIn}
                      fill={p.color}
                      opacity={0.9}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  )}
                  <g transform={`translate(${p.x * pxPerIn}, ${p.y * pxPerIn})`}>
                    <PanelLabel
                      label={p.label}
                      widthPx={fp.w * pxPerIn}
                      heightPx={fp.h * pxPerIn}
                    />
                  </g>
                  <title>{`${p.label} @ ${b.x1.toFixed(1)},${b.y1.toFixed(1)}`}</title>
                </g>
              )
            })}
            {used > 0 && (
              <g>
                <line
                  x1={0}
                  x2={fabricWidthIn * pxPerIn}
                  y1={used * pxPerIn}
                  y2={used * pxPerIn}
                  className="used-line"
                />
                <text
                  x={fabricWidthIn * pxPerIn - 4}
                  y={used * pxPerIn - 4}
                  className="used-label"
                  textAnchor="end"
                >
                  {(used / 36).toFixed(2)} yd
                </text>
              </g>
            )}
          </svg>
        </main>

        <aside className="sidebar right" data-mobile-pane="panels">
          <Collapsible
            title="Selected"
            open={openSelected}
            onToggle={() => setOpenSelected((v) => !v)}
            badge={selected ? selected.label : undefined}
          >
            {selected ? (
              <>
                <label>
                  Name
                  <input
                    value={selected.label}
                    onChange={(e) => renamePanel(selected.id, e.target.value)}
                  />
                </label>
                <div className="field-block">
                  <span className="field-label">Color</span>
                  <ColorPicker
                    idPrefix="selected"
                    value={selected.color}
                    onChange={(c) => setPanelColor(selected.id, c)}
                  />
                </div>
                {isTrap(selected) ? (
                  <>
                    <p className="hint">Trapezoid (parallel top &amp; bottom)</p>
                    <label>
                      Top width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.topWidth ?? selected.width) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            topWidth: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Bottom width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(
                              0,
                              (selected.bottomWidth ?? selected.width) - 2 * seamAllowanceIn,
                            ),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            bottomWidth: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Height ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, selected.length - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            height: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                  </>
                ) : isCircle(selected) ? (
                  <>
                    <p className="hint">Circle</p>
                    <label>
                      Diameter ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, selected.width - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            diameter: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                  </>
                ) : isIrregular(selected) ? (
                  <>
                    <p className="hint">Irregular quad (L / F / R / B + diagonal)</p>
                    <label>
                      Left ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.sideLeft ?? 0) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            sideLeft: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Bottom ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.sideFront ?? 0) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            sideFront: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Right ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.sideRight ?? 0) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            sideRight: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Top ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.sideBack ?? 0) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            sideBack: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Diagonal ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={0.01}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, (selected.diagonal ?? 0) - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            diagonal: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Width ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, selected.width - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            width: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                    <label>
                      Length ({unit}){seamAllowanceIn > 0 ? ' — finished' : ''}
                      <SoftNumberInput
                        min={0.01}
                        step={1}
                        inputMode="decimal"
                        value={Number(
                          fromInches(
                            Math.max(0, selected.length - 2 * seamAllowanceIn),
                            unit,
                          ).toFixed(unit === 'in' ? 2 : 1),
                        )}
                        onValueChange={(v) => {
                          if (v === '' || !(v > 0)) return
                          updateSelectedFinishedDims(selected.id, {
                            length: toInches(v, unit),
                          })
                        }}
                      />
                    </label>
                  </>
                )}
                <div className="row wrap">
                  {!isCircle(selected) && (
                    <button type="button" onClick={() => rotateSelected90(selected.id)}>
                      Rotate 90°
                    </button>
                  )}
                  {isPolyPanel(selected) && (
                    <>
                      <button type="button" onClick={() => updatePanelSafe(selected.id, flipH)}>
                        Flip H
                      </button>
                      <button type="button" onClick={() => updatePanelSafe(selected.id, flipV)}>
                        Flip V
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const copyId = uid()
                      let best: Panel | null = null
                      let bestUsed = Infinity
                      let bestY = Infinity
                      let bestX = Infinity
                      const orients = orientationsThatFit(selected, fabricWidthIn)
                      const tryRots =
                        orients.length > 0
                          ? orients
                          : ([
                              selected.rotation === 90 || selected.rotation === 270 ? 90 : 0,
                            ] as Array<0 | 90>)
                      for (const rotation of tryRots) {
                        const fp = panelFootprint({ ...selected, rotation })
                        const spot = spotFor(fp.w, fp.h, panels)
                        const candidate: Panel = {
                          ...selected,
                          id: copyId,
                          label: `${selected.label} copy`,
                          rotation,
                          x: spot.x,
                          y: spot.y,
                          color: PANEL_COLORS[panels.length % PANEL_COLORS.length],
                        }
                        const u = usedLengthInches([...panels, candidate])
                        const better =
                          u < bestUsed - 1e-9 ||
                          (Math.abs(u - bestUsed) <= 1e-9 &&
                            (spot.y < bestY - 1e-9 ||
                              (Math.abs(spot.y - bestY) <= 1e-9 && spot.x < bestX - 1e-9)))
                        if (better) {
                          best = candidate
                          bestUsed = u
                          bestY = spot.y
                          bestX = spot.x
                        }
                      }
                      if (!best || orientationsThatFit(best, fabricWidthIn).length === 0) {
                        setActionHint("Can't duplicate — panel doesn't fit this bolt.")
                        return
                      }
                      const copy = clampPanelToBolt(best, fabricWidthIn)
                      setPanels((prev) => [...prev, copy])
                      setSelectedId(copy.id)
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setPanels((prev) => prev.filter((p) => p.id !== selected.id))
                      setSelectedId(null)
                    }}
                  >
                    Delete
                  </button>
                </div>
                {selectedSplit && (
                  <div className="warn-banner" role="alert">
                    <p>
                      {formatSplitMessage(
                        selected.width,
                        selected.length,
                        fabricWidthIn,
                        selectedSplit,
                        display,
                        unit,
                        seamAllowanceIn,
                      )}
                    </p>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        addSplitFromSuggestion(selectedSplit, selected.label, selected.id)
                      }
                    >
                      Split into {selectedSplit.pieceCount} panels
                    </button>
                  </div>
                )}
                <p className="hint">
                  {isCircle(selected) ? (
                    <>
                      Cut ⌀ {display(selected.width)} {unit}
                      {seamAllowanceIn > 0
                        ? ` · finished ⌀ ${display(Math.max(0, selected.width - 2 * seamAllowanceIn))} ${unit}`
                        : ''}
                    </>
                  ) : isIrregular(selected) ? (
                    <>
                      Cut {display(selected.sideLeft ?? 0)}×{display(selected.sideFront ?? 0)}×
                      {display(selected.sideRight ?? 0)}×{display(selected.sideBack ?? 0)} ⌒
                      {display(selected.diagonal ?? 0)} {unit}
                      {' · '}AABB {display(panelFootprint(selected).w)} ×{' '}
                      {display(panelFootprint(selected).h)} {unit}
                    </>
                  ) : (
                    <>
                      Cut footprint {display(panelFootprint(selected).w)} ×{' '}
                      {display(panelFootprint(selected).h)} {unit}
                      {isTrap(selected)
                        ? seamAllowanceIn > 0
                          ? ` · finished ${display((selected.topWidth ?? selected.width) - 2 * seamAllowanceIn)}/${display((selected.bottomWidth ?? selected.width) - 2 * seamAllowanceIn)} × ${display(selected.length - 2 * seamAllowanceIn)} ${unit}`
                          : ` · cut ${display(selected.topWidth ?? selected.width)}/${display(selected.bottomWidth ?? selected.width)} × ${display(selected.length)} ${unit}`
                        : seamAllowanceIn > 0
                          ? ` · finished ≈ ${display(selected.width - 2 * seamAllowanceIn)} × ${display(selected.length - 2 * seamAllowanceIn)} ${unit}`
                          : ''}
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="hint">Select a panel on the bolt or in the list.</p>
            )}
          </Collapsible>

          <Collapsible
            title="Panels"
            open={openList}
            onToggle={() => setOpenList((v) => !v)}
            badge={panels.length}
          >
            <ul className="panel-list">
              {panels.map((p) => {
                const prob = problems.find((x) => x.id === p.id)
                const fp = panelFootprint(p)
                return (
                  <li key={p.id}>
                    <div
                      className={`list-item${p.id === selectedId ? ' active' : ''}`}
                      onClick={() => setSelectedId(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setSelectedId(p.id)
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="swatch" style={{ background: p.color }} />
                      <div className="list-main">
                        <span className="list-name">{p.label}</span>
                        <span className="list-dims">
                          {isCircle(p)
                            ? `⌀ ${display(p.width)} ${unit}`
                            : isIrregular(p)
                              ? `${display(p.sideLeft ?? 0)}×${display(p.sideFront ?? 0)}×${display(p.sideRight ?? 0)}×${display(p.sideBack ?? 0)} ⌒${display(p.diagonal ?? 0)} ${unit}`
                              : isTrap(p)
                                ? `${display(p.topWidth ?? p.width)}/${display(p.bottomWidth ?? p.width)} × ${display(p.length)} ${unit}`
                                : `${display(fp.w)}×${display(fp.h)} ${unit}`}
                        </span>
                      </div>
                      <span className="list-flags">
                        {prob?.overlap ? 'overlap' : ''}
                        {prob?.off ? (prob?.overlap ? ' · off' : 'off-bolt') : ''}
                      </span>
                    </div>
                  </li>
                )
              })}
              {panels.length === 0 && <li className="hint">No panels yet.</li>}
            </ul>
            {panels.length > 0 && (
              <button type="button" className="danger clear-all" onClick={clearAllPanels}>
                Clear all
              </button>
            )}
          </Collapsible>
        </aside>
      </div>
    </div>
  )
}
