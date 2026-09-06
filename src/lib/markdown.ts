// Minimale, veilige Markdown -> HTML voor de AI-uitleg/chat. Bewust een kleine subset (koppen,
// vet/cursief, inline-code, lijsten, horizontale lijn). De tekst wordt EERST ge-escaped, daarna
// voegen we onze eigen tags toe — zo kan het model-antwoord geen eigen HTML injecteren.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline opmaak binnen een regel (op reeds ge-escapete tekst). */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
}

/** Zet een Markdown-string om naar een veilige HTML-string (subset). */
export function mdToHtml(md: string): string {
  const lines = escapeHtml(md).replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      closeList()
      continue
    }
    // Horizontale lijn (---, ***, ___).
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList()
      out.push('<hr>')
      continue
    }
    // Kop (# .. ######), één niveau kleiner geschaald voor in het paneel.
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const lvl = Math.min(6, h[1].length + 1)
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`)
      continue
    }
    // Genummerde lijst.
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    // Opsommingslijst.
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    // Gewone alinearegel.
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
