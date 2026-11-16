import { parseTimestamp } from '../../../core/schema';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
// [m:ss], [[m:ss]] (fréquent chez les modèles), (m:ss) et les plages avec tout type de tiret
// (trait d'union, demi-cadratin, tiret insécable U+2011, cadratin, signe moins).
const TIMESTAMP_RE = new RegExp(String.raw`(?:\[\[|\[|\()(${TIME})(?:\s*[-–‑—−]\s*(${TIME}))?(?:\]\]|\]|\))`, 'g');

function inline(text: string): string {
  return esc(text)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(TIMESTAMP_RE, (_all, start: string, end?: string) => `<button class="ts" data-t="${parseTimestamp(start)}">▶ ${start}${end ? `–${end}` : ''}</button>`);
}

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const EMPTY_CELL = /^\s*(—|-|–|n\/a)?\s*$/i;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Un tableau est illisible dans un panneau étroit : chaque ligne devient une fiche
 * (titre + « Colonne : valeur »). Une première colonne « # » ou numérique sert de numéro.
 */
function renderTable(rows: string[][]): string {
  const [header, ...body] = rows;
  return body
    .map((row) => {
      const numbered = /^(#|n°|no\.?|)$/i.test(header[0] ?? '') || /^\d+$/.test(row[0] ?? '');
      const titleIndex = numbered && row.length > 1 ? 1 : 0;
      const title = `${numbered && titleIndex === 1 ? `${inline(row[0])}. ` : ''}${inline(row[titleIndex] ?? '')}`;
      const fields = row
        .map((value, i) => ({ value, label: header[i] ?? '' }))
        .slice(titleIndex + 1)
        .filter((f) => !EMPTY_CELL.test(f.value))
        .map((f) => `<div class="md-field"><span class="md-label">${inline(f.label)} :</span> ${inline(f.value)}</div>`)
        .join('');
      return `<div class="md-card"><div class="md-card-title">${title}</div>${fields}</div>`;
    })
    .join('');
}

/** Markdown des réponses du LLM → HTML sûr (tout le texte est échappé). */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  const stack: { kind: 'ul' | 'ol'; indent: number }[] = [];
  const closeDeeper = (indent: number) => {
    while (stack.length && stack[stack.length - 1].indent > indent) out.push(`</li></${stack.pop()!.kind}>`);
  };
  const closeLists = () => closeDeeper(-1);
  const openList = (kind: 'ul' | 'ol', indent: number, start: number) => {
    out.push(kind === 'ol' && start !== 1 ? `<ol start="${start}">` : `<${kind}>`);
    stack.push({ kind, indent });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trimEnd();
    const line = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    let m: RegExpMatchArray | null;

    if (line.startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1]?.trim() ?? '')) {
      closeLists();
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      out.push(renderTable(rows));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeLists();
      out.push('<hr>');
    } else if (line.startsWith('>')) {
      closeLists();
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quoted.push(lines[i++].trim().replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeLists();
      const level = Math.min(6, m[1].length + 2);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^(?:([-*•])|(\d+)[.)])\s+(.*)$/))) {
      const kind = m[1] ? 'ul' : 'ol';
      closeDeeper(indent);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && top.kind === kind) {
        out.push('</li>');
      } else {
        if (top && top.indent === indent) out.push(`</li></${stack.pop()!.kind}>`);
        openList(kind, indent, Number(m[2] ?? 1));
      }
      out.push(`<li>${inline(m[3])}`);
    } else if (!line) {
      closeLists();
    } else if (stack.length && indent > 0) {
      // Ligne de continuation d'un élément de liste.
      out.push(`<br>${inline(line)}`);
    } else {
      closeLists();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeLists();
  return out.join('');
}
