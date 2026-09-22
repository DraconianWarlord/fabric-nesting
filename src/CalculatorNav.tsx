import { useEffect, useRef, useState } from 'react'
import {
  ACTIVE_CALCULATOR,
  CALCULATORS,
  MORE_ONLY,
  PRIMARY_SOON,
  type Calculator,
} from './calculators'

/** Wide enough for Nesting + primary soon pills + More without wrapping. */
const PRIMARY_PILLS_MQ = '(min-width: 1101px)'

function SoonItem({ calc, className }: { calc: Calculator; className?: string }) {
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

/** Desktop: Nesting + optional primary pills + More ▾. Mobile uses MobileMoreCalculators. */
export function CalculatorNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const [showPrimaryPills, setShowPrimaryPills] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PRIMARY_PILLS_MQ).matches,
  )
  const moreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia(PRIMARY_PILLS_MQ)
    const sync = () => setShowPrimaryPills(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

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

  const moreItems = showPrimaryPills ? MORE_ONLY : [...PRIMARY_SOON, ...MORE_ONLY]

  return (
    <nav className="calc-switch" aria-label="Calculators">
      <button type="button" className="calc-switch-tab active" aria-current="page">
        {ACTIVE_CALCULATOR.label}
      </button>
      {showPrimaryPills &&
        PRIMARY_SOON.map((c) => (
          <button
            key={c.id}
            type="button"
            className="calc-switch-tab calc-switch-tab--future"
            disabled
            title="Coming soon"
          >
            {c.label}
          </button>
        ))}
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
            {moreItems.map((c) => (
              <li key={c.id} role="none">
                <SoonItem calc={c} className="calc-more-item" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}

/** Mobile (≤800px): compact control opening the full roadmap. */
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
          {CALCULATORS.map((c) => (
            <li key={c.id} role="none">
              {c.status === 'active' ? (
                <button
                  type="button"
                  className="calc-more-item calc-more-item--current"
                  role="menuitem"
                  aria-current="page"
                  disabled
                >
                  <span>{c.label}</span>
                  <span className="calc-more-soon">Current</span>
                </button>
              ) : (
                <SoonItem calc={c} className="calc-more-item" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
