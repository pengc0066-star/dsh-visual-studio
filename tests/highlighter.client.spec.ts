import { describe, expect, it } from 'vitest'
import { highlightHtml, TOKEN_CLASS } from '../src/client/highlighter.ts'

describe('highlightHtml', () => {
  it('escapes and highlights a tag, attribute name, and string value', () => {
    const html = highlightHtml('<div class="card" id="x">hi</div>')
    expect(html).toContain(`<span class="${TOKEN_CLASS.tag}">div</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.attr}">class</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.string}">"card"</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.punct}">&lt;</span>`)
    expect(html).toContain('hi')
  })

  it('highlights comments and tags, escaping delimiters', () => {
    const html = highlightHtml('<!-- note --><p>text</p>')
    expect(html).toContain(`<span class="${TOKEN_CLASS.comment}">&lt;!-- note --&gt;</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.tag}">p</span>`)
    expect(html).toContain('text')
  })

  it('escapes ampersands in plain text', () => {
    const html = highlightHtml('AT&T and >')
    expect(html).toContain('AT&amp;T')
  })

  it('handles a self-closing SVG tag', () => {
    const html = highlightHtml('<circle cx="1" cy="2" r="3"/>')
    expect(html).toContain(`<span class="${TOKEN_CLASS.tag}">circle</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.string}">"3"</span>`)
    expect(html).toContain(`<span class="${TOKEN_CLASS.punct}">/&gt;</span>`)
  })
})
