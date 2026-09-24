import type { ReactNode } from 'react'

// Minimal Markdown renderer for admin-edited documentation. Supports
// headings (#, ##, ###), bullet lists (- or *), numbered lists (1.),
// paragraphs, and inline **bold**, *italic*, `code`, and [links](https://…).
// Builds React elements directly — never raw HTML — so admin-entered text
// can't inject markup or scripts.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; text: string }

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+\.\s+(.*)$/

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') })
    paragraph = []
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }
    const heading = HEADING_RE.exec(line)
    const ul = UL_RE.exec(line)
    const ol = OL_RE.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
    } else if (ul || ol) {
      flushParagraph()
      const kind = ul ? 'ul' : 'ol'
      const item = (ul ?? ol)![1]
      const last = blocks[blocks.length - 1]
      if (last && last.kind === kind) last.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else {
      paragraph.push(line)
    }
  }
  flushParagraph()
  return blocks
}

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const SAFE_URL_RE = /^(https?:\/\/|mailto:)/i

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }
    const link = LINK_RE.exec(part)
    if (link) {
      return SAFE_URL_RE.test(link[2]) ? (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        link[1]
      )
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            // # -> h2, ## -> h3, ### -> h4: the modal/page already owns h1.
            const Tag = `h${block.level + 1}` as 'h2' | 'h3' | 'h4'
            return <Tag key={i}>{renderInline(block.text)}</Tag>
          }
          case 'ul':
          case 'ol': {
            const List = block.kind
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </List>
            )
          }
          case 'p':
            return <p key={i}>{renderInline(block.text)}</p>
        }
      })}
    </>
  )
}
