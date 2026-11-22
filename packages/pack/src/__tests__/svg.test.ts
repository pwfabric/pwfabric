import { describe, expect, it } from 'vitest'
import { packFromRecord, publicScriptReason, svgUnsafeReason, validatePack } from '../index.js'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const reason = (s: string): string | undefined => svgUnsafeReason(enc(s))
const NS = 'xmlns="http://www.w3.org/2000/svg"'
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"'

describe('svgUnsafeReason', () => {
  it('accepts plain pictures', () => {
    const ok = [
      `<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#0f766e"/></svg>`,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n<svg ${NS} ${XL}><defs><linearGradient id="g"><stop offset="0"/></linearGradient><path id="p" d="M0 0h10"/></defs><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#p"/><use href="#p"/></svg>`,
      `<svg ${NS}><style><![CDATA[ .a > .b { fill: url(#g) } ]]></style><text x="1" y="2">A &amp; B &#169; &#x263A;</text></svg>`,
      `<svg ${NS}><rect width="1" height="1"><animate attributeName="opacity" from="0" to="1" dur="1s"/></rect></svg>`,
      `<svg ${NS}><filter id="f"><feGaussianBlur stdDeviation="2"/></filter><g style="filter: url(#f); opacity: .5"/></svg>`,
    ]
    for (const svg of ok) expect(reason(svg), svg).toBeUndefined()
  })

  it('refuses the known bypasses, however they are spelled', () => {
    const bad: [string, RegExp][] = [
      [`<svg ${NS}><script>alert(1)</script></svg>`, /<script>/],
      [`<svg ${NS}><SCRIPT>alert(1)</SCRIPT></svg>`, /<SCRIPT>/],
      [`<svg ${NS} onload="alert(1)"/>`, /event attribute onload/],
      [`<svg ${NS} OnLoad="alert(1)"/>`, /event attribute OnLoad/],
      [`<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;alert(1)&#60;/script&#62;">]><svg ${NS}>&x;</svg>`, /DOCTYPE/],
      [`<svg ${NS}>&x;</svg>`, /entity reference &x;/],
      [`<svg ${NS}><a href="jav&#x61;script:alert(1)"><text>x</text></a></svg>`, /only a fragment/],
      [`<svg ${NS}><a href="&#106;avascript:alert(1)"/></svg>`, /only a fragment/],
      [`<svg ${NS} ${XL}><a xlink:href="javascript:alert(1)"/></svg>`, /only a fragment/],
      [`<svg ${NS}><use href="https://evil.example/s.svg#x"/></svg>`, /only a fragment/],
      [`<svg ${NS}><use href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`, /only a fragment/],
      [`<svg ${NS}><image href="https://evil.example/a.png"/></svg>`, /<image> is not part/],
      [`<svg ${NS}><filter><feImage href="https://evil.example/a.png"/></filter></svg>`, /<feImage> is not part/],
      [`<svg ${NS}><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>`, /foreignObject/],
      [`<svg ${NS}><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>`, /animates href/],
      [`<svg ${NS}><a><set attributeName="xlink:href" to="javascript:alert(1)"/></a></svg>`, /animates xlink:href/],
      [`<svg ${NS}><rect><set attributeName="onmouseover" to="alert(1)"/></rect></svg>`, /animates onmouseover/],
      [`<svg ${NS}><rect style="fill: url(https://evil.example/t)"/></svg>`, /url\(https/],
      [`<svg ${NS}><rect fill="url('https://evil.example/t')"/></svg>`, /url\('https/],
      [`<svg ${NS}><style>@import url(https://evil.example/x.css);</style></svg>`, /@import/],
      [`<svg ${NS}><rect style="width: expression(alert(1))"/></svg>`, /expression\(/],
      [`<svg ${NS}><style>.a { background: u\\72l(https://evil.example) }</style></svg>`, /CSS escape/],
      [`<?xml-stylesheet href="https://evil.example/x.xsl"?><svg ${NS}/>`, /processing instruction/],
      [`<svg ${NS}><?php echo 1 ?></svg>`, /processing instruction/],
      [`<svg ${NS}><x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script></svg>`, /namespace prefix/],
      [`<svg xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></svg>`, /declares the namespace/],
      [`<svg ${NS}><iframe src="https://evil.example"/></svg>`, /<iframe> is not part/],
      [`<svg ${NS}><rect/>`, /<svg> is not closed/],
      [`<svg ${NS}><rect x="1" x="2"/></svg>`, /twice/],
      [`<html><svg ${NS}/></html>`, /<html> is not part/],
      [`<svg ${NS}/><script>alert(1)</script>`, /more than one root|<script>/],
    ]
    for (const [svg, why] of bad) expect(reason(svg), svg).toMatch(why)
  })

  it('refuses CSS in any attribute that loads something, however it is written', () => {
    const bad: [string, RegExp][] = [
      [`<svg ${NS}><rect fill="u\\72l(https://evil.example/t)"/></svg>`, /backslash/],
      [`<svg ${NS}><rect fill="ur/**/l(https://evil.example/t)"/></svg>`, /CSS comment/],
      [`<svg ${NS}><rect fill="url(/*x*/https://evil.example/t)"/></svg>`, /CSS comment/],
      [`<svg ${NS}><rect fill="image-set('https://evil.example/t' 1x)"/></svg>`, /image-set\(/],
      [`<svg ${NS}><rect fill="-webkit-image-set(url(https://e.example) 1x)"/></svg>`, /image-set\(/],
      [`<svg ${NS}><rect fill="image('https://evil.example/t')"/></svg>`, /image\(/],
      [`<svg ${NS}><rect fill="cross-fade(url(#a), url(https://e.example), 50%)"/></svg>`, /cross-fade\(/],
      [`<svg ${NS}><rect fill="src('https://evil.example/t')"/></svg>`, /src\(/],
      [`<svg ${NS}><rect fill="element(#x)"/></svg>`, /element\(/],
      [`<svg ${NS}><rect mask="URL( https://evil.example/m )"/></svg>`, /url\(https/],
      [`<svg ${NS}><rect clip-path="@import 'x'"/></svg>`, /@import/],
      [`<svg ${NS}><rect style="font-family: 'x'; background: image-set('https://e.example' 1x)"/></svg>`, /image-set\(|quoted/],
      [`<svg ${NS}><rect style="content: 'x'"/></svg>`, /quoted string/],
    ]
    for (const [svg, why] of bad) expect(reason(svg), svg).toMatch(why)
    expect(reason(`<svg ${NS}><rect fill="url('#g')" stroke='url("#h")' mask="url( #m )"/></svg>`)).toBeUndefined()
  })

  it('checks a style as a whole and allows no element inside it', () => {
    const bad: [string, RegExp][] = [
      [`<svg ${NS}><style>@import url(https://evil.example/a.css);<style>.a{}</style></style></svg>`, /<style> inside <style>/],
      [`<svg ${NS}><style>.a{fill:red}<g/>@import url(https://evil.example/a.css);</style></svg>`, /<g> inside <style>/],
      [`<svg ${NS}><style>.a { background: url(<![CDATA[https://evil.example]]>) }</style></svg>`, /url\(https/],
      [`<svg ${NS}><style>.a { background: url(https:<!-- -->//evil.example) }</style></svg>`, /url\(https/],
      [`<svg ${NS}><style>.a { fill: red } /* x */</style></svg>`, /CSS comment/],
    ]
    for (const [svg, why] of bad) expect(reason(svg), svg).toMatch(why)
  })

  it('is the screen validation applies to public/ and media/ SVGs', () => {
    expect(publicScriptReason('logo.svg', enc(`<svg ${NS}><use href="https://evil.example/x"/></svg>`))).toMatch(/plain SVG/)
    const result = validatePack(
      packFromRecord({
        'pwpack.json': JSON.stringify({ id: '@pwpack/example/kit', version: '1.0.0' }),
        'media/logo.svg': `<svg ${NS} onload="alert(1)"/>`,
        'media/ok.svg': `<svg ${NS}/>`,
      })
    )
    const unsafe = result.issues.filter((i) => i.code === 'MEDIA_SVG_UNSAFE')
    expect(unsafe.map((i) => [i.severity, i.path])).toEqual([['error', 'media/logo.svg']])
  })
})
