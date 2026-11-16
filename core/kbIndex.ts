// Table des matières (INDEX.md) de la base de connaissances, reconstruite à partir des fichiers.

export type FrontMatter = Record<string, string | number | string[]>;

/** Lit l'en-tête YAML écrit par `frontMatter` (valeurs au format JSON ; texte brut toléré). */
export function parseFrontMatter(md: string): FrontMatter {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: FrontMatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const raw = line.slice(i + 1).trim();
    try {
      out[line.slice(0, i).trim()] = JSON.parse(raw);
    } catch {
      out[line.slice(0, i).trim()] = raw;
    }
  }
  return out;
}

export interface KbVideo {
  category: string;
  folder: string;
  files: string[];
  meta: FrontMatter;
}

const FILE_ORDER = ['rapport.md', 'discussion.md', 'transcription.md', 'traduction.md'];

export function buildKbIndex(videos: KbVideo[], generatedAt: string): string {
  const categories = [...new Set(videos.map((v) => v.category))].sort((a, b) => a.localeCompare(b, 'fr'));
  const out = [`# Base de connaissances YouTube\n\n_${videos.length} vidéos · ${categories.length} catégories · mis à jour le ${generatedAt}_`];
  for (const category of categories) {
    const items = videos
      .filter((v) => v.category === category)
      .sort((a, b) => String(b.meta.enregistre_le ?? '').localeCompare(String(a.meta.enregistre_le ?? '')));
    out.push(`## ${category} (${items.length})`);
    out.push(
      items
        .map((v) => {
          const files = FILE_ORDER.filter((f) => v.files.includes(f));
          const link = (f: string) => `<${v.category}/${v.folder}/${f}>`;
          const m = v.meta;
          const title = String(m.titre ?? v.folder);
          const scores = m.score_faits !== undefined ? ` (faits ${m.score_faits} %, discours ${m.score_discours ?? '—'} %)` : '';
          const details = [m.chaine, m.enregistre_le, m.verdict ? `${m.verdict}${scores}` : ''].filter(Boolean).join(' · ');
          const lines = [`- **[${title}](${link(files[0] ?? '')})**${details ? ` — ${details}` : ''}`];
          lines.push(`  - Fichiers : ${files.map((f) => `[${f.replace(/\.md$/, '')}](${link(f)})`).join(' · ')}`);
          if (Array.isArray(m.tags) && m.tags.length) lines.push(`  - Mots-clés : ${m.tags.join(', ')}`);
          if (m.url) lines.push(`  - Vidéo : ${m.url}`);
          return lines.join('\n');
        })
        .join('\n'),
    );
  }
  return out.join('\n\n') + '\n';
}
