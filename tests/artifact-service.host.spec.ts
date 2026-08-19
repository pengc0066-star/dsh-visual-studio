import { describe, expect, it } from 'vitest'
import { ArtifactRegistry, classifyKind, isExcludedPath } from '../src/host/artifact-service.ts'

describe('isExcludedPath', () => {
  it('excludes dependency, cache, build, test, and hidden paths', () => {
    expect(isExcludedPath('/proj/node_modules/a.js')).toBe(true)
    expect(isExcludedPath('/proj/.git/config')).toBe(true)
    expect(isExcludedPath('/proj/dist/app.js')).toBe(true)
    expect(isExcludedPath('/proj/coverage/lcov.info')).toBe(true)
    expect(isExcludedPath('/proj/.cache/x')).toBe(true)
    expect(isExcludedPath('/proj/src/a.test.ts')).toBe(true)
    expect(isExcludedPath('/proj/.env')).toBe(true)
  })

  it('keeps deliverable files', () => {
    expect(isExcludedPath('/proj/index.html')).toBe(false)
    expect(isExcludedPath('/proj/logo.svg')).toBe(false)
    expect(isExcludedPath('/proj/app.js')).toBe(false)
    expect(isExcludedPath('/proj/photo.png')).toBe(false)
    expect(isExcludedPath('/proj/README.md')).toBe(false)
  })
})

describe('classifyKind', () => {
  it('classifies by extension', () => {
    expect(classifyKind('/p/a.html')).toBe('html')
    expect(classifyKind('/p/a.svg')).toBe('svg')
    expect(classifyKind('/p/a.png')).toBe('image')
    expect(classifyKind('/p/a.webp')).toBe('image')
    expect(classifyKind('/p/a.md')).toBe('text')
    expect(classifyKind('/p/a.json')).toBe('text')
    expect(classifyKind('/p/a.bin')).toBe('other')
  })
})

describe('ArtifactRegistry', () => {
  it('merges repeated writes to one path and increments version', () => {
    const registry = new ArtifactRegistry()
    registry.observe('s1', '/p/index.html', 100)
    registry.observe('s1', '/p/index.html', 200)
    registry.observe('s1', '/p/logo.svg', 150)
    const artifacts = registry.list('s1')
    expect(artifacts).toHaveLength(2)
    const html = artifacts.find(a => a.path === '/p/index.html')
    expect(html?.version).toBe(2)
    expect(html?.createdAt).toBe(100)
    expect(html?.updatedAt).toBe(200)
  })

  it('scopes artifacts per session and skips excluded paths', () => {
    const registry = new ArtifactRegistry()
    registry.observe('s1', '/p/a.html', 100)
    registry.observe('s2', '/p/b.html', 100)
    registry.observe('s1', '/p/node_modules/x.js', 100)
    expect(registry.list('s1')).toHaveLength(1)
    expect(registry.list('s2')).toHaveLength(1)
    expect(registry.list('none')).toEqual([])
  })

  it('sorts newest first', () => {
    const registry = new ArtifactRegistry()
    registry.observe('s1', '/p/a.html', 100)
    registry.observe('s1', '/p/b.svg', 300)
    registry.observe('s1', '/p/c.png', 200)
    expect(registry.list('s1').map(a => a.path)).toEqual(['/p/b.svg', '/p/c.png', '/p/a.html'])
  })
})
