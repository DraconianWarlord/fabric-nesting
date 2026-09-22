import { describe, expect, it } from 'vitest'
import { wrapSvgText, wrapWords } from './wrapSvgText'

describe('wrapWords', () => {
  it('keeps short text on one line', () => {
    expect(wrapWords('Panel A', 20, 3)).toEqual(['Panel A'])
  })

  it('wraps on word boundaries', () => {
    expect(wrapWords('Left seat back cushion', 10, 5)).toEqual([
      'Left seat',
      'back',
      'cushion',
    ])
  })

  it('hard-breaks very long tokens', () => {
    const lines = wrapWords('ABCDEFGHIJKLMNOP', 5, 4)
    expect(lines[0]).toBe('ABCDE')
    expect(lines[1]).toBe('FGHIJ')
    expect(lines.join('').replace(/…/g, '').length).toBeGreaterThan(5)
  })

  it('ellipsis when exceeding maxLines', () => {
    const lines = wrapWords('one two three four five six', 5, 2)
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(lines[lines.length - 1]).toMatch(/…$/)
  })
})

describe('wrapSvgText', () => {
  it('returns lines that fit the box', () => {
    const r = wrapSvgText('Long panel name for cushion', 80, 40, 12, 7)
    expect(r.lines.length).toBeGreaterThan(0)
    expect(r.fontSize).toBeGreaterThanOrEqual(7)
    expect(r.lines.length * r.lineHeight).toBeLessThanOrEqual(40 + 1)
  })

  it('shrinks font for tight boxes', () => {
    const roomy = wrapSvgText('Hi', 100, 40, 12, 7)
    const tight = wrapSvgText('Somewhat longer label text here', 40, 18, 12, 7)
    expect(tight.fontSize).toBeLessThanOrEqual(roomy.fontSize)
  })

  it('handles empty text', () => {
    expect(wrapSvgText('', 50, 20).lines).toEqual([])
  })
})
