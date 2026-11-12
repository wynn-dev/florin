// A small strict XML reader for IBKR's Flex responses, which are elements with
// attributes and nothing else (no text content, CDATA or namespaces). It
// throws on anything malformed instead of guessing. Errors name the position,
// never the content: a report carries personal details.

export type XmlElement = {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Text directly inside the element, trimmed (used by the short status answers). */
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, ref) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1))
      return String.fromCodePoint(code)
    }
    const char = ENTITIES[ref]
    if (char === undefined) throw new XmlError(`unknown entity ${whole}`)
    return char
  })
}

export class XmlError extends Error {}

const NAME = /[A-Za-z_][\w.:-]*/y
const ATTR = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y
const SPACE = /\s*/y

/** Parses a document and returns its root element. */
export function parseXml(xml: string): XmlElement {
  let i = 0
  const stack: XmlElement[] = []
  let root: XmlElement | undefined

  const fail = (what: string): never => {
    throw new XmlError(`malformed XML at character ${i}: ${what}`)
  }

  while (i < xml.length) {
    const lt = xml.indexOf("<", i)
    const text = xml.slice(i, lt < 0 ? xml.length : lt)
    if (text.trim()) {
      const top = stack.at(-1)
      if (!top) fail("text outside the root element")
      else top.text += decode(text).trim()
    }
    if (lt < 0) break
    i = lt
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i)
      if (end < 0) fail("unclosed declaration")
      i = end + 2
    } else if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i)
      if (end < 0) fail("unclosed comment")
      i = end + 3
    } else if (xml.startsWith("<!", i)) {
      fail("DTDs and CDATA are not expected")
    } else if (xml.startsWith("</", i)) {
      NAME.lastIndex = i + 2
      const name = NAME.exec(xml)?.[0]
      const open = stack.pop()
      if (!name || !open || open.name !== name) fail("mismatched closing tag")
      i = NAME.lastIndex
      SPACE.lastIndex = i
      SPACE.exec(xml)
      i = SPACE.lastIndex
      if (xml[i] !== ">") fail("expected >")
      i++
    } else {
      NAME.lastIndex = i + 1
      const name = NAME.exec(xml)?.[0]
      if (!name) fail("expected an element name")
      i = NAME.lastIndex
      const el: XmlElement = { name: name!, attrs: {}, children: [], text: "" }
      for (;;) {
        ATTR.lastIndex = i
        const m = ATTR.exec(xml)
        if (!m) break
        el.attrs[m[1]] = decode(m[2] ?? m[3])
        i = ATTR.lastIndex
      }
      SPACE.lastIndex = i
      SPACE.exec(xml)
      i = SPACE.lastIndex
      const parent = stack.at(-1)
      if (parent) parent.children.push(el)
      else if (root) fail("more than one root element")
      else root = el
      if (xml.startsWith("/>", i)) i += 2
      else if (xml[i] === ">") {
        stack.push(el)
        i++
      } else fail("expected > or />")
    }
  }
  if (stack.length) fail("unclosed element")
  if (!root) fail("no root element")
  return root!
}

/** The root element's name, read without parsing the whole document. */
export function rootName(xml: string): string | undefined {
  const start = xml
    .replace(/^\uFEFF/, "")
    .replace(/^(\s*<\?[\s\S]*?\?>|\s*<!--[\s\S]*?-->)*/, "")
  return /^\s*<([A-Za-z_][\w.:-]*)/.exec(start)?.[1]
}

/** Direct children of an element with a given name. */
export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name)
}

export function childNamed(
  el: XmlElement,
  name: string
): XmlElement | undefined {
  return el.children.find((c) => c.name === name)
}
