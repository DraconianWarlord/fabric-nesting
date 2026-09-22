/** Fabric Calculator roadmap — Nesting is this app; others may be live or coming soon. */
export type CalculatorStatus = 'active' | 'soon' | 'live'

export type Calculator = {
  id: string
  label: string
  status: CalculatorStatus
  /** External URL when status === 'live' */
  href?: string
  /** Reserved for future primary-pill layouts; unused by current nav. */
  primary?: boolean
}

export const CALCULATORS: Calculator[] = [
  { id: 'nesting', label: 'Nesting', status: 'active', primary: true },
  { id: 'foam-nesting', label: 'Foam Nesting', status: 'soon', primary: true },
  { id: 'cushions', label: 'Cushions', status: 'soon', primary: true },
  {
    id: 'pillows',
    label: 'Pillows',
    status: 'live',
    href: 'https://sailrite-pillows.vercel.app',
    primary: true,
  },
  { id: 'awnings', label: 'Awnings', status: 'soon', primary: true },
  { id: 'tarps', label: 'Tarps', status: 'soon', primary: true },
  { id: 'sail-shades', label: 'Sail Shades', status: 'soon' },
  { id: 'window-treatments', label: 'Window Treatments', status: 'soon' },
  { id: 'upholstery', label: 'Upholstery', status: 'soon' },
  { id: 'boat-covers', label: 'Boat Covers', status: 'soon' },
  { id: 'wire-hung-canopies', label: 'Wire Hung Canopies', status: 'soon' },
  { id: 'sling-chairs', label: 'Sling Chairs', status: 'soon' },
  { id: 'umbrellas', label: 'Umbrellas', status: 'soon' },
  { id: 'porch-panels', label: 'Porch Panels', status: 'soon' },
  { id: 'slip-covers', label: 'Slip Covers', status: 'soon' },
  { id: 'flat-cone', label: 'Flat Cone', status: 'soon' },
]

export const ACTIVE_CALCULATOR = CALCULATORS.find((c) => c.status === 'active')!

/** Every calculator except the one currently open (shown in More dropdowns). */
export const OTHER_CALCULATORS = CALCULATORS.filter((c) => c.id !== ACTIVE_CALCULATOR.id)
