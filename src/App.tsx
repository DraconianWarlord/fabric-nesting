import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PANEL_COLORS,
  type Panel,
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
  isGenericLabel,
  nextSequentialLabel,
  offBolt,
  orderYards,
  orientationsThatFit,
  overlapsAny,
  panelBounds,
  panelFootprint,
  patternEnabled,
  patternHOffset,
  placeSpot,
  snapCenterToPattern,
  suggestSplit,
  toInches,
  tryRotate90,
  usedLengthInches,
} from './lib/geometry'
import { wrapSvgText } from './lib/wrapSvgText'
import './App.css'

/** Floor / cap for responsive bolt scale (px per fabric inch). */
const PX_PER_IN_MIN = 8
const PX_PER_IN_MAX = 12
const MAX_FABRIC_WIDTH_IN = 80

/** Scale so bolt width fills most of the canvas-wrap; floor ~8, cap ~12. */
function computeCanvasPxPerIn(availableWidthPx: number, fabricWidthIn: number): number {
  const target = availableWidthPx / Math.max(fabricWidthIn, 1e-6)
  return Math.max(PX_PER_IN_MIN, Math.min(target, PX_PER_IN_MAX))
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
    .map((p) => `${p.id}:${p.width}x${p.length}`)
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
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1a237e'}
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
        if (value === '' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          onValueChange(e.key === 'ArrowUp' ? emptyIncrement : 0)
        }
        rest.onKeyDown?.(e)
      }}
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
  const [fabricWidthDraft, setFabricWidthDraft] = useState<number | ''>(54)
  const [seamDraft, setSeamDraft] = useState<number | ''>(0.5)
  const [wasteDraft, setWasteDraft] = useState<number | ''>(0)
  const [hRepeatDraft, setHRepeatDraft] = useState<number | ''>(0)
  const [vRepeatDraft, setVRepeatDraft] = useState<number | ''>(0)
  const [nestCycleIndex, setNestCycleIndex] = useState(0)
  const [nestHint, setNestHint] = useState<string | null>(null)
  const [actionHint, setActionHint] = useState<string | null>(null)
  const [openAutoNest, setOpenAutoNest] = useState(true)
  const [openFabric, setOpenFabric] = useState(true)
  const [openAdd, setOpenAdd] = useState(true)
  const [openSelected, setOpenSelected] = useState(true)
  const [openList, setOpenList] = useState(true)
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

  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el) return
    const update = () => {
      // Account for .canvas-wrap padding (1rem each side ≈ 32px)
      const pad = 32
      const available = Math.max(80, el.clientWidth - pad)
      setPxPerIn(computeCanvasPxPerIn(available, fabricWidthIn))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fabricWidthIn])

  const boltHeightIn = Math.max(used + 12, 72)
  const svgW = fabricWidthIn * pxPerIn + 2
  const svgH = boltHeightIn * pxPerIn + 2

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
        setActionHint("Won't fit at 90° on this bolt — split or resize")
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

  const draftSplit = (() => {
    const sizes = draftCutSizes()
    if (!sizes) return null
    return suggestSplit(sizes.cutW, sizes.cutL, fabricWidthIn, seamAllowanceIn)
  })()

  const selectedSplit = selected
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
    if (suggestSplit(w, l, fabricWidthIn, seamAllowanceIn)) {
      setActionHint('Panel is too large for this bolt — split or resize before adding.')
      return
    }
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
      const base: Panel = {
        id: uid(),
        label,
        width: w,
        length: l,
        x: 0,
        y: 0,
        rotation: 0,
        flippedH: false,
        flippedV: false,
        color,
      }
      next.push(placeOrientedPanel(base, next))
    }
    setPanels(next)
    setSelectedId(next[next.length - 1]?.id ?? null)
    setActionHint(null)
  }

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

  const disclaimer =
    seamAllowanceIn > 0 ? (
      <>
        Estimate only. Double-check before cutting or ordering. Entered panel sizes are{' '}
        <strong>finished sizes</strong>; cut size = finished + 2×seam allowance (
        {display(seamAllowanceIn)} {unit} per side). Sailrite sells full yards.
      </>
    ) : (
      <>
        Estimate only. Double-check before cutting or ordering. Panel sizes are{' '}
        <strong>cut sizes</strong> (seam allowance is 0). Sailrite sells full yards.
      </>
    )

  const draftSizes = draftCutSizes()

  return (
    <div className="app">
      <header className="top">
        <div className="top-brand">
          <div className="brand-mark">
            <img src="/sailrite-logo.png" alt="Sailrite" className="brand-logo" />
            <span className="brand-sub">Calculators</span>
          </div>
          <nav className="calc-nav" aria-label="Calculators">
            <button type="button" className="calc-tab active" aria-current="page">
              Nesting
            </button>
            <button type="button" className="calc-tab" disabled title="Coming soon">
              Yardage
            </button>
            <button type="button" className="calc-tab" disabled title="Coming soon">
              Bias
            </button>
            <button type="button" className="calc-tab" disabled title="Coming soon">
              Foam
            </button>
            <span className="calc-more" title="More calculators coming soon">
              More soon
            </span>
          </nav>
        </div>
        <div className="top-actions">
          <div className="yards">
            <span className="yards-exact">{exact.toFixed(2)} yd</span>
            <span className="yards-order">Order {order} yd</span>
            <span className="yards-meta">
              Used {display(used)} {unit}
              {waste > 0 ? ` · +${waste}%` : ''}
            </span>
          </div>
          <button
            type="button"
            className="export-pdf"
            title="Download nest as PDF"
            onClick={() => {
              void import('./lib/exportPdf').then(({ exportNestingPdf }) => {
                exportNestingPdf({
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
              })
            }}
          >
            Export PDF
          </button>
        </div>
      </header>

      <div className="disclaimer">{disclaimer}</div>
      {actionHint && (
        <div className="action-hint" role="status">
          {actionHint}
          <button type="button" className="linkish" onClick={() => setActionHint(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="sidebar left">
          <Collapsible
            title="Auto-Nest"
            open={openAutoNest}
            onToggle={() => setOpenAutoNest((v) => !v)}
          >
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
            {!nestHint && (
              <p className="hint">Each click cycles a different ranked layout.</p>
            )}
          </Collapsible>

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
            {seamAllowanceIn > 0 && draftSizes && (
              <p className="hint">
                Cut ≈ {display(draftSizes.cutW)} × {display(draftSizes.cutL)} {unit}
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
              disabled={Boolean(draftSplit) || draftW === '' || draftL === ''}
            >
              Add to bolt
            </button>
          </Collapsible>
        </aside>

        <main className="canvas-wrap" ref={canvasWrapRef}>
          <svg
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="bolt"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
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
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x * pxPerIn}, ${p.y * pxPerIn})`}
                  onPointerDown={(e) => onPointerDown(e, p.id)}
                  style={{ cursor: 'grab' }}
                >
                  <rect
                    width={fp.w * pxPerIn}
                    height={fp.h * pxPerIn}
                    fill={p.color}
                    opacity={0.9}
                    stroke={p.id === selectedId ? '#24258e' : bad ? '#e75053' : '#333'}
                    strokeWidth={p.id === selectedId ? 3.5 : bad ? 2.75 : 1.75}
                  />
                  <PanelLabel
                    label={p.label}
                    widthPx={fp.w * pxPerIn}
                    heightPx={fp.h * pxPerIn}
                  />
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

        <aside className="sidebar right">
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
                <div className="row wrap">
                  <button type="button" onClick={() => rotateSelected90(selected.id)}>
                    Rotate 90°
                  </button>
                  <button type="button" onClick={() => updatePanelSafe(selected.id, flipH)}>
                    Flip H
                  </button>
                  <button type="button" onClick={() => updatePanelSafe(selected.id, flipV)}>
                    Flip V
                  </button>
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
                  Cut footprint {display(panelFootprint(selected).w)} ×{' '}
                  {display(panelFootprint(selected).h)} {unit}
                  {seamAllowanceIn > 0
                    ? ` · finished ≈ ${display(selected.width - 2 * seamAllowanceIn)} × ${display(selected.length - 2 * seamAllowanceIn)} ${unit}`
                    : ''}
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
                          {display(fp.w)}×{display(fp.h)} {unit}
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
