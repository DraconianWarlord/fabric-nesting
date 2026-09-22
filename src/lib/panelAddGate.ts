import { suggestSplit } from './geometry'

export type PanelAddKind = 'rect' | 'trap' | 'circle' | 'irregular'

/** User-facing block when a rect needs splitting (neither orientation fits). */
export const PANEL_TOO_LARGE_SPLIT =
  'Panel is too large for this bolt — split or resize before adding.'

/** User-facing block when both cut dims exceed the bolt (typical for oversized traps). */
export const PANEL_TOO_LARGE_RESIZE =
  'Panel is too large for this bolt — resize before adding.'

/**
 * Returns the action-hint string that should block Add-to-bolt, or null when OK.
 * Mirrors the gate in App.addPanels.
 */
export function panelAddBlockMessage(
  kind: PanelAddKind,
  cutW: number,
  cutL: number,
  fabricWidth: number,
  seamAllowance = 0,
): string | null {
  if (!(cutW > 0) || !(cutL > 0) || !(fabricWidth > 0)) return null
  if (kind === 'rect' && suggestSplit(cutW, cutL, fabricWidth, seamAllowance)) {
    return PANEL_TOO_LARGE_SPLIT
  }
  // Circles store cut diameter as both width & length; oversized → resize-only (no split).
  // Same string as oversized trap / irregular.
  if (kind === 'circle' && cutW > fabricWidth + 1e-6) {
    return PANEL_TOO_LARGE_RESIZE
  }
  // Trap / irregular / rect: both cut dims exceed bolt → resize (no split for trap/irregular).
  if (cutW > fabricWidth + 1e-6 && cutL > fabricWidth + 1e-6) {
    return PANEL_TOO_LARGE_RESIZE
  }
  return null
}

/** User-facing block when 90° rotation would hang off the bolt. */
export const WONT_FIT_AT_90 =
  "Won't fit at 90° on this bolt — split or resize"

/**
 * Message when tryRotate90 fails, or null when rotation is allowed.
 * `rotatedOk` should be whether tryRotate90 returned a panel.
 */
export function rotate90BlockMessage(rotatedOk: boolean): string | null {
  return rotatedOk ? null : WONT_FIT_AT_90
}
