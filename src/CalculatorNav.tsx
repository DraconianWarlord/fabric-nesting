import { useEffect, useRef, useState } from 'react'
import {
  ACTIVE_CALCULATOR,
  OTHER_CALCULATORS,
  type Calculator,
} from './calculators'

function MoreItem({ calc, className }: { calc: Calculator; className?: string }) {
  if (calc.status === 'live' && calc.href) {
    return (
      <a
        className={className}
        href={calc.href}
        target="_blank"
        rel="noopener noreferrer"
        role="menuitem"
      >
        <span>{calc.label}</span>
        <span className="calc-more-live">Open</span>
      </a>
    )
  }
  return (
    <button
      type="button"
      className={className}
      disabled
      title="Coming soon"
      role="menuitem"
    >
      <span>{calc.label}</span>
      <span className="calc-more-soon">Coming soon</span>
    </button>
  )
}

/** Desktop: current calculator title + More ▾ listing every other calculator. */
export function CalculatorNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  return (
    <nav className="calc-switch" aria-label="Calculators">
      <button type="button" className="calc-switch-tab active" aria-current="page">
        {ACTIVE_CALCULATOR.label}
      </button>
      <div className="calc-more" ref={moreRef}>
        <button
          type="button"
          className={`calc-more-btn${moreOpen ? ' open' : ''}`}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          onClick={() => setMoreOpen((o) => !o)}
        >
          More <span aria-hidden>▾</span>
        </button>
        {moreOpen && (
          <ul className="calc-more-menu" role="menu">
            {OTHER_CALCULATORS.map((c) => (
              <li key={c.id} role="none">
                <MoreItem calc={c} className="calc-more-item" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}

/** Mobile (≤800px): Nesting title nearby + More calculators (others only). */
export function MobileMoreCalculators() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="calc-more-mobile" ref={ref}>
      <button
        type="button"
        className={`calc-more-mobile-btn${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        More calculators <span aria-hidden>▾</span>
      </button>
      {open && (
        <ul className="calc-more-menu calc-more-menu--mobile" role="menu">
          {OTHER_CALCULATORS.map((c) => (
            <li key={c.id} role="none">
              <MoreItem calc={c} className="calc-more-item" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
