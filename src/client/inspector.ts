/**
 * The sandboxed-preview inspector script and the srcdoc wrapper. The script is
 * a self-contained string injected into every preview document; it runs inside
 * the sandboxed iframe (unique origin, no parent DOM/cookie access) and talks
 * to the parent only through `postMessage`. The wrapper centers previewed
 * content on a light checkerboard canvas so a tiny SVG does not appear broken.
 * @module @deepseek-ai/dsh-visual-studio/client/inspector
 */

/** Inspect-mode toggle the parent posts into the preview iframe. */
export const INSPECT_TOGGLE = 'vs:enable-inspect'

/** Inspect result the preview posts back to the parent. */
export const INSPECT_EVENT = 'vs:inspect'

/** Selector-query request the parent posts to re-check an annotation. */
export const QUERY_REQUEST = 'vs:query'

/** Selector-query reply the preview posts back. */
export const QUERY_REPLY = 'vs:query-result'

/** Zoom request the parent posts to scale the preview canvas. */
export const ZOOM_EVENT = 'vs:zoom'

/**
 * The inspector script body, wrapped in a `<script>` tag by {@link previewDocument}.
 * It computes a stable selector and breadcrumb for the clicked element, keeps a
 * highlight overlay, applies the canvas zoom, and reports through `postMessage`.
 */
const INSPECTOR_SCRIPT = `
(function () {
  var enabled = false
  var highlight = null

  function cssEscape(value) {
    if (typeof window.CSS !== 'undefined' && window.CSS.escape) return window.CSS.escape(value)
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
  }

  function stableSelector(el) {
    var parts = []
    var node = el
    while (node && node.nodeType === 1) {
      var part = node.tagName.toLowerCase()
      if (node.id) {
        part += '#' + cssEscape(node.id)
        parts.unshift(part)
        break
      }
      var parent = node.parentElement
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName })
        if (siblings.length > 1) {
          var index = Array.prototype.indexOf.call(siblings, node) + 1
          part += ':nth-of-type(' + index + ')'
        }
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }

  function breadcrumb(el) {
    var parts = []
    var node = el
    var depth = 0
    while (node && node.nodeType === 1 && depth < 12) {
      var part = node.tagName.toLowerCase()
      if (node.id) part += '#' + node.id
      else if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\\s+/)[0]
        if (cls) part += '.' + cls
      }
      parts.unshift(part)
      node = node.parentElement
      depth += 1
    }
    return parts.join(' > ')
  }

  function rect(el) {
    var r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  }

  function styles(el) {
    var cs = window.getComputedStyle(el)
    var keys = ['display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height',
      'margin', 'padding', 'color', 'background-color', 'font-size', 'font-family', 'border',
      'border-radius', 'gap', 'flex-direction', 'align-items', 'justify-content', 'overflow']
    var out = {}
    for (var i = 0; i < keys.length; i++) {
      var v = cs.getPropertyValue(keys[i])
      if (v) out[keys[i]] = v
    }
    return out
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      path: breadcrumb(el),
      selector: stableSelector(el),
      html: el.outerHTML ? el.outerHTML.slice(0, 2000) : '',
      text: (el.textContent || '').trim().slice(0, 500),
      styles: styles(el),
      rect: rect(el),
    }
  }

  function showHighlight(el) {
    if (!highlight) {
      highlight = document.createElement('div')
      highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
        'outline:2px solid #e23b3b;outline-offset:-2px;background:rgba(226,59,59,0.12);'
      document.body.appendChild(highlight)
    }
    var r = el.getBoundingClientRect()
    highlight.style.left = r.left + 'px'
    highlight.style.top = r.top + 'px'
    highlight.style.width = r.width + 'px'
    highlight.style.height = r.height + 'px'
  }

  function onClick(event) {
    if (!enabled) return
    event.preventDefault()
    event.stopPropagation()
    var el = event.target
    showHighlight(el)
    window.parent.postMessage({ type: '${INSPECT_EVENT}', payload: describe(el) }, '*')
  }

  function onMessage(event) {
    var data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === '${INSPECT_TOGGLE}') {
      enabled = !!data.enabled
      if (!enabled && highlight) {
        highlight.remove()
        highlight = null
      }
    } else if (data.type === '${ZOOM_EVENT}') {
      document.documentElement.style.setProperty('--vs-zoom', String(data.scale ?? 1))
    } else if (data.type === '${QUERY_REQUEST}') {
      var match = false
      try { match = !!document.querySelector(data.selector) } catch (e) { match = false }
      window.parent.postMessage({ type: '${QUERY_REPLY}', id: data.id, match: match }, '*')
    }
  }

  document.addEventListener('click', onClick, true)
  window.addEventListener('message', onMessage)
})()
`

/** The centered-canvas styles applied to fragment previews. */
const CANVAS_CSS = `
  :root { --vs-zoom: 1; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: repeating-conic-gradient(#f6f7f9 0% 25%, #f2f4f7 0% 50%) 0 0 / 24px 24px;
  }
  #vs-stage {
    transform: scale(var(--vs-zoom));
    transform-origin: center center;
    background: #ffffff;
    box-shadow: 0 1px 10px rgba(0, 0, 0, 0.10);
  }
`

/** Checkerboard background style injected into full-document previews. */
const FULL_DOC_STYLE = `<style>html,body{margin:0;padding:0;background:repeating-conic-gradient(#f6f7f9 0% 25%, #f2f4f7 0% 50%) 0 0/24px 24px;}</style>`

/**
 * Build the sandboxed preview `srcdoc`: the source content plus the inspector
 * script. Fragments (including standalone SVG) are centered on a light
 * checkerboard canvas; full documents keep their own layout and only gain the
 * canvas background. The user's content is never rewritten.
 * @param content - the HTML/SVG source text.
 * @returns the srcdoc string.
 */
export function previewDocument(content: string): string {
  const scriptTag = `<script>${INSPECTOR_SCRIPT}</script>`
  const trimmed = content.trimStart().toLowerCase()
  const isFullDocument = trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
  if (isFullDocument) {
    const bodyClose = /<\/body\s*>/i.exec(content)
    if (bodyClose !== null) {
      return `${content.slice(0, bodyClose.index)}${scriptTag}${content.slice(bodyClose.index)}`
    }
    const headClose = /<\/head\s*>/i.exec(content)
    if (headClose !== null) {
      return `${content.slice(0, headClose.index)}${FULL_DOC_STYLE}${content.slice(headClose.index)}${scriptTag}`
    }
    return `${content}${scriptTag}`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CANVAS_CSS}</style></head><body><div id="vs-stage">${content}</div>${scriptTag}</body></html>`
}
