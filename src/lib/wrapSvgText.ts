/**
 * Approximate SVG text wrapping for panel labels (no DOM measure).
 * Uses a fixed char-width factor for sans-serif; good enough for nesting UI.
 */

const DEFAULT_CHAR_W = 0.55
const DEFAULT_LH = 1.2

export interface WrapSvgTextResult {
  lines: string[]
  fontSize: number
  lineHeight: number
}

/** Split text into lines of at most maxChars; hard-break long tokens; ellipsis if over maxLines. */
export function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars))
  const lineCap = Math.max(1, Math.floor(maxLines))
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const lines: string[] = []
  let cur = ''

  const pushLine = (s: string) => {
    lines.push(s)
  }

  const finishWithEllipsis = () => {
    const last = lines[lines.length - 1] ?? ''
    const trimmed = last.endsWith('…')
      ? last
      : `${last.slice(0, Math.max(1, limit - 1))}…`
    lines[lines.length - 1] = trimmed
    return lines.slice(0, lineCap)
  }

  for (const word of words) {
    const pieces: string[] =
      word.length > limit
        ? Array.from({ length: Math.ceil(word.length / limit) }, (_, i) =>
            word.slice(i * limit, (i + 1) * limit),
          )
        : [word]

    for (const piece of pieces) {
      const next = cur ? `${cur} ${piece}` : piece
      if (next.length <= limit) {
        cur = next
        continue
      }
      if (cur) pushLine(cur)
      cur = piece
      if (lines.length >= lineCap) {
        return finishWithEllipsis()
      }
    }
  }

  if (cur) {
    if (lines.length >= lineCap) {
      return finishWithEllipsis()
    }
    if (cur.length > limit) {
      pushLine(`${cur.slice(0, Math.max(1, limit - 1))}…`)
    } else {
      pushLine(cur)
    }
  }

  // If we still have more words than fit (ellipsis path already returned), ensure cap
  if (lines.length > lineCap) {
    return finishWithEllipsis()
  }
  return lines
}

/**
 * Wrap `text` to fit boxW × boxH (px). Shrinks font from startFontSize down to minFontSize.
 * Last resort: ellipsis on the final line.
 */
export function wrapSvgText(
  text: string,
  boxW: number,
  boxH: number,
  startFontSize = 12,
  minFontSize = 7,
  charWidthFactor = DEFAULT_CHAR_W,
  lineHeightFactor = DEFAULT_LH,
): WrapSvgTextResult {
  const raw = text.trim()
  if (!raw || !(boxW > 2) || !(boxH > 2)) {
    return {
      lines: raw ? [raw.length > 3 ? `${raw.slice(0, 2)}…` : raw] : [],
      fontSize: minFontSize,
      lineHeight: minFontSize * lineHeightFactor,
    }
  }

  const start = Math.max(minFontSize, Math.min(startFontSize, Math.floor(boxH)))
  for (let fs = start; fs >= minFontSize; fs -= 1) {
    const maxChars = Math.max(1, Math.floor(boxW / (fs * charWidthFactor)))
    const maxLines = Math.max(1, Math.floor(boxH / (fs * lineHeightFactor)))
    const lines = wrapWords(raw, maxChars, maxLines)
    const usedH = lines.length * fs * lineHeightFactor
    const truncated = lines.some((l) => l.includes('…'))
    const fits = usedH <= boxH + 0.5
    if (fits && (!truncated || fs === minFontSize)) {
      return { lines, fontSize: fs, lineHeight: fs * lineHeightFactor }
    }
  }

  const fs = minFontSize
  const maxChars = Math.max(1, Math.floor(boxW / (fs * charWidthFactor)))
  const maxLines = Math.max(1, Math.floor(boxH / (fs * lineHeightFactor)))
  return {
    lines: wrapWords(raw, maxChars, maxLines),
    fontSize: fs,
    lineHeight: fs * lineHeightFactor,
  }
}
