/** Fabric Calculator roadmap — Nesting is this app; others are coming soon. */
export type CalculatorStatus = 'active' | 'soon'

export type Calculator = {
  id: string
  label: string
  status: CalculatorStatus
  /** Shown as a desktop tab pill when space allows; otherwise only in More. */
  primary?: boolean
}

export const CALCULATORS: Calculator[] = [
  { id: 'nesting', label: 'Nesting', status: 'active', primary: true },
  { id: 'foam-nesting', label: 'Foam Nesting', status: 'soon', primary: true },
  { id: 'cushions', label: 'Cushions', status: 'soon', primary: true },
  { id: 'pillows', label: 'Pillows', status: 'soon', primary: true },
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

export const PRIMARY_SOON = CALCULATORS.filter((c) => c.primary && c.status === 'soon')

export const MORE_ONLY = CALCULATORS.filter((c) => !c.primary && c.status === 'soon')
