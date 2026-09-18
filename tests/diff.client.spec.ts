import { describe, expect, it } from 'vitest'
import { diffLines } from '../src/client/diff.ts'

describe('diffLines', () => {
  it('returns a single context line for identical content', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { type: 'context', before: 1, after: 1, text: 'a' },
      { type: 'context', before: 2, after: 2, text: 'b' },
    ])
  })

  it('marks an added and a removed line', () => {
    const diff = diffLines('a\nb', 'a\nc')
    expect(diff).toEqual([
      { type: 'context', before: 1, after: 1, text: 'a' },
      { type: 'remove', before: 2, after: null, text: 'b' },
      { type: 'add', before: null, after: 2, text: 'c' },
    ])
  })

  it('handles a full replacement', () => {
    expect(diffLines('old', 'new')).toEqual([
      { type: 'remove', before: 1, after: null, text: 'old' },
      { type: 'add', before: null, after: 1, text: 'new' },
    ])
  })

  it('ignores the trailing newline when counting lines', () => {
    // "a\n" and "a" are the same single-line document.
    expect(diffLines('a\n', 'a')).toEqual([
      { type: 'context', before: 1, after: 1, text: 'a' },
    ])
  })

  it('reports an empty-to-populated addition', () => {
    expect(diffLines('', 'x\ny')).toEqual([
      { type: 'add', before: null, after: 1, text: 'x' },
      { type: 'add', before: null, after: 2, text: 'y' },
    ])
  })
})
