import { describe, expect, it } from 'vitest'
import { INSPECT_EVENT, previewDocument } from '../src/client/inspector.ts'
import { formatAnnotationMessage, middleTruncate, relativePathOf, truncate } from '../src/client/studio.ts'

describe('truncate', () => {
  it('keeps short strings and truncates long ones', () => {
    expect(truncate('abc', 10)).toBe('abc')
    expect(truncate('abcdefghij', 5)).toBe('abcde…')
  })
})

describe('middleTruncate', () => {
  it('keeps short basenames intact', () => {
    expect(middleTruncate('index.html', 24)).toBe('index.html')
  })

  it('middle-truncates long stems and preserves the extension', () => {
    const out = middleTruncate('very-long-component-name-for-dashboard.html', 24)
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out).toContain('…')
    expect(out.endsWith('.html')).toBe(true)
  })

  it('middle-truncates extensionless names', () => {
    const out = middleTruncate('someextremelylongfilenamewithoutanymextension', 24)
    expect(out).toContain('…')
    expect(out.length).toBeLessThanOrEqual(24)
  })
})

describe('relativePathOf', () => {
  it('strips the workspace root and normalizes separators', () => {
    expect(relativePathOf('E:\\proj', 'E:\\proj\\a\\b.html')).toBe('a/b.html')
    expect(relativePathOf('E:/proj/', 'E:/proj/index.html')).toBe('index.html')
  })

  it('keeps the path when outside the root', () => {
    expect(relativePathOf('E:/proj', 'D:/other/x.html')).toBe('D:/other/x.html')
  })

  it('keeps the path when the root is undefined', () => {
    expect(relativePathOf(undefined, 'E:/proj/a.html')).toBe('E:/proj/a.html')
  })
})

describe('formatAnnotationMessage', () => {
  it('formats an element annotation with every field', () => {
    const message = formatAnnotationMessage('E:/proj/a.html', {
      tag: 'div',
      path: 'html > body > div#app',
      selector: 'div#app',
      html: '<div id="app">x</div>',
      text: 'hello',
      styles: { color: 'red', 'font-size': '12px' },
      rect: { x: 1, y: 2, width: 3, height: 4 },
    }, '这里间距太大')
    expect(message).toContain('[Visual HTML/SVG Studio 批注]')
    expect(message).toContain('文件: E:/proj/a.html')
    expect(message).toContain('Selector: div#app')
    expect(message).toContain('元素路径: html > body > div#app')
    expect(message).toContain('元素 HTML/SVG: <div id="app">x</div>')
    expect(message).toContain('位置尺寸: x=1 y=2 width=3 height=4')
    expect(message).toContain('Computed styles: color: red; font-size: 12px')
    expect(message).toContain('批注: 这里间距太大')
  })

  it('formats a coordinate-only note without element fields', () => {
    const message = formatAnnotationMessage('E:/proj/a.svg', null, '这个图标不对')
    expect(message).toContain('文件: E:/proj/a.svg')
    expect(message).toContain('批注: 这个图标不对')
    expect(message).not.toContain('Selector:')
  })

  it('formats a text-selection note with version, kind, location, and selected text', () => {
    const message = formatAnnotationMessage('E:/proj/a.html', null, '这段要改', {
      version: 3,
      kind: 'html',
      location: 'L2:5-L2:20',
      selection: 'the selected text',
    })
    expect(message).toContain('版本: v3')
    expect(message).toContain('类型: html')
    expect(message).toContain('定位: L2:5-L2:20')
    expect(message).toContain('选中文本: the selected text')
    expect(message).toContain('批注: 这段要改')
    expect(message).not.toContain('Selector:')
  })
})

describe('previewDocument', () => {
  it('wraps a fragment and injects the inspector script', () => {
    const doc = previewDocument('<div>hi</div>')
    expect(doc).toContain('<div>hi</div>')
    expect(doc).toContain(INSPECT_EVENT)
    expect(doc).toContain('<!doctype html>')
  })

  it('injects the script before </body> in a full document', () => {
    const doc = previewDocument('<!doctype html><html><body><p>x</p></body></html>')
    expect(doc).toContain(INSPECT_EVENT)
    expect(doc.indexOf(INSPECT_EVENT)).toBeLessThan(doc.indexOf('</body>'))
  })
})
