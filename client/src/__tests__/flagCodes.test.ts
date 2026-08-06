import { describe, expect, it } from 'vitest'
import { FLAG_CODES } from '../constants/flagCodes'

describe('FLAG_CODES', () => {
  it('has exactly 26 entries, one per letter A-Z, each with a non-empty description', () => {
    expect(FLAG_CODES).toHaveLength(26)
    const codes = FLAG_CODES.map((f) => f.code)
    expect(new Set(codes).size).toBe(26)
    for (let i = 0; i < 26; i++) {
      expect(codes[i]).toBe(String.fromCharCode(65 + i))
    }
    for (const { description } of FLAG_CODES) {
      expect(description.length).toBeGreaterThan(0)
    }
  })

  it('includes the specific codes referenced elsewhere in the app', () => {
    const byCode = Object.fromEntries(FLAG_CODES.map((f) => [f.code, f.description]))
    expect(byCode.K).toBe('Suspect/Caution')
    expect(byCode.Z).toBe('Good data')
  })
})
