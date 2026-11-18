import type { ChatTurn } from '../../../core/chat';
import type { HistoryEntry, HistoryFilter } from '../../../core/history';
import { hostOf, TECHNIQUE_LABEL, VERDICT_LABEL } from '../../../core/labels';
import type { Claim, ClaimVerdict, Evidence, ProgressStep, Report, Scores, Segment, Verdict } from '../../../core/types';
import { formatTime } from '../../../core/youtube';
import { historyToggle } from './channelView';
import { esc, renderMarkdown } from './markdown';

export type Tab = 'report' | 'chat' | 'transcript' | 'lexicon' | 'history';

const VERDICT_CLASS: Record<Verdict, string> = {
  vrai: 'ok',
  plutot_vrai: 'ok2',
  exagere: 'warn',
  trompeur: 'warn2',
  faux: 'bad',
  inverifiable: 'na',
};

const STEPS: [ProgressStep, string][] = [
  ['transcript', 'Lecture des sous-titres'],
  ['extract', 'Extraction des affirmations (IA)'],
  ['search', 'Recherche de sources'],
  ['verify', 'Vérification des affirmations (IA)'],
];

const TABS: [Tab, string][] = [
  ['report', 'Rapport'],
  ['chat', 'Discussion'],
  ['transcript', 'Transcription'],
  ['lexicon', 'Lexique'],
  ['history', 'Historique'],
];

const scoreClass = (n: number | null) => (n === null ? 'na' : n >= 75 ? 'ok' : n >= 50 ? 'warn' : 'bad');

const timestampButton = (t: number) => `<button class="ts" data-t="${t}" title="Aller à ce moment de la vidéo">▶ ${formatTime(t)}</button>`;

/** `enabled` : une vidéo est ouverte (l'historique reste accessible sans vidéo). */
export function renderTabs(root: HTMLElement, active: Tab, enabled: boolean): void {
  root.innerHTML = TABS.map(
    ([key, label]) =>
      `<button class="tab${key === active ? ' active' : ''}" data-tab="${key}" ${enabled || key === 'history' || key === 'lexicon' ? '' : 'disabled'}>${label}</button>`,
  ).join('');
}

function gauge(title: string, value: number | null, hint: string): string {
  return `<div class="gauge">
    <div class="gauge-head"><span>${title}</span><strong class="${scoreClass(value)}">${value === null ? '—' : `${value} %`}</strong></div>
    <div class="bar"><div class="fill ${scoreClass(value)}" style="width:${value ?? 0}%"></div></div>
    <small class="muted">${hint}</small>
  </div>`;
}

function evidenceItem(e: Evidence): string {
  const factcheck = e.source === 'factcheck' ? ` <span class="badge">Fact-check ${esc(e.publisher ?? '')} : ${esc(e.rating ?? '')}</span>` : '';
  return `<li><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title || hostOf(e.url))}</a>
    <span class="muted">${esc(hostOf(e.url))}${e.date ? ` · ${esc(e.date)}` : ''}</span>${factcheck}</li>`;
}

function claimCard(c: Claim, v: ClaimVerdict | undefined, evidenceById: Map<string, Evidence>): string {
  const isOpinion = c.type === 'opinion';
  const verdict = v?.verdict ?? 'inverifiable';
  const chip = isOpinion ? '<span class="chip na">Opinion</span>' : `<span class="chip ${VERDICT_CLASS[verdict]}">${VERDICT_LABEL[verdict]}</span>`;
  const sources = (v?.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter((e): e is Evidence => e !== undefined);
  return `<article class="claim">
    <div class="claim-head">${chip}${v ? `<span class="muted">confiance ${Math.round(v.confidence * 100)} %</span>` : ''}${timestampButton(c.timestampS)}</div>
    <p class="claim-text">${esc(c.claim)}</p>
    ${c.quote ? `<blockquote>« ${esc(c.quote)} »</blockquote>` : ''}
    ${v?.explanation ? `<p>${esc(v.explanation)}</p>` : ''}
    ${v?.correction ? `<p class="correction"><strong>Correction :</strong> ${esc(v.correction)}</p>` : ''}
    ${sources.length ? `<ul class="sources">${sources.map(evidenceItem).join('')}</ul>` : ''}
  </article>`;
}

const RELIABILITY_ICON = { haute: '🟢', moyenne: '🟠', faible: '🔴' } as const;
const RELIABILITY_HINT = {
  haute: 'plusieurs passages concordants, assez d’affirmations vérifiées',
  moyenne: 'note correcte mais à nuancer (un seul passage, peu d’affirmations vérifiées ou couverture limitée)',
  faible: 'peu d’affirmations vérifiées ou passages divergents : à ne pas prendre au pied de la lettre',
} as const;

/** Confiance dans la note elle-même, avec l'écart entre passages de vérification quand il existe. */
function reliabilityLine(s: Scores): string {
  if (!s.reliability) return '';
  const range = s.range && s.range[0] !== s.range[1] ? ` · écart entre passages : ${s.range[0]}–${s.range[1]} %` : '';
  return `<p class="reliability" title="${esc(RELIABILITY_HINT[s.reliability])}">${RELIABILITY_ICON[s.reliability]} Fiabilité de la note : <strong>${s.reliability}</strong>${range}<br><small class="muted">${esc(RELIABILITY_HINT[s.reliability])}</small></p>`;
}

export function renderReport(root: HTMLElement, r: Report): void {
  const verdictById = new Map(r.verdicts.map((v) => [v.claimId, v]));
  const evidenceById = new Map(r.evidence.map((e) => [e.id, e]));
  const facts = r.claims.filter((c) => c.type !== 'opinion');
  const opinions = r.claims.filter((c) => c.type === 'opinion');
  const rhetoric = r.rhetoric
    .map(
      (x) => `<article class="claim">
        <div class="claim-head"><span class="chip warn">${TECHNIQUE_LABEL[x.technique]}</span>${timestampButton(x.timestampS)}</div>
        ${x.quote ? `<blockquote>« ${esc(x.quote)} »</blockquote>` : ''}
        <p>${esc(x.explanation)}</p>
      </article>`,
    )
    .join('');
  root.innerHTML = `
    <header class="summary-card ${scoreClass(r.scores.facts)}">
      <h1>${esc(r.scores.label)}</h1>
      <p class="muted">${esc(r.title)} — ${esc(r.author)}</p>
      <div class="scores-grid">
        ${gauge('Exactitude des faits', r.scores.facts, `${Math.round(r.scores.coverage * 100)} % des affirmations vérifiables ont pu être vérifiées`)}
        ${gauge('Honnêteté du discours', r.scores.discourse, `${r.rhetoric.length} procédé(s) de persuasion détecté(s)`)}
      </div>
      ${reliabilityLine(r.scores)}
      ${r.modelsByStage ? `<details><summary>Services utilisés</summary><p>Extraction : ${esc(r.modelsByStage.extraction)}<br>Vérification : ${esc(r.modelsByStage.verification.join(', '))}</p>${r.searchUsage ? `<ul>${Object.entries(r.searchUsage).map(([name, stats]) => `<li>${esc(name)} : ${stats.requests} appel(s), ${stats.failed} échec(s)</li>`).join('')}</ul><small class="muted">Appels de recherche et de lecture, sans estimation de facturation.</small>` : ''}</details>` : ''}
      <div class="actions"><button data-action="reanalyze">Ré-analyser</button><button data-action="export-report">Exporter (.md)</button><button data-action="open-channels" title="Note la chaîne sur un échantillon de ses vidéos">📺 Chaîne</button><button data-action="options">Options</button></div>
      <small class="muted">${new Date(r.createdAt).toLocaleString('fr-FR')} · ${esc(r.models.join(', '))}</small>
    </header>
    ${r.warnings.length ? `<div class="warnings">${r.warnings.map((w) => `<p>⚠️ ${esc(w)}</p>`).join('')}</div>` : ''}
    <section><h2>Résumé</h2><p>${esc(r.summary)}</p></section>
    <section><h2>Affirmations (${facts.length})</h2>${facts.map((c) => claimCard(c, verdictById.get(c.id), evidenceById)).join('') || '<p class="muted">Aucune affirmation vérifiable.</p>'}</section>
    ${rhetoric ? `<section><h2>Discours et persuasion</h2>${rhetoric}</section>` : ''}
    ${opinions.length ? `<section><h2>Opinions (non vérifiées)</h2>${opinions.map((c) => claimCard(c, undefined, evidenceById)).join('')}</section>` : ''}`;
}

export function renderProgress(root: HTMLElement, step: ProgressStep, detail?: string): void {
  const index = STEPS.findIndex(([key]) => key === step);
  const items = STEPS.map(([, label], i) => {
    const state = i < index ? 'done' : i === index ? 'active' : '';
    const icon = i < index ? '✅' : i === index ? '⏳' : '•';
    return `<li class="${state}">${icon} ${label}${i === index && detail ? ` <span class="muted">(${esc(detail)})</span>` : ''}</li>`;
  }).join('');
  root.innerHTML = `<div class="progress"><h1>Analyse en cours…</h1><ol>${items}</ol>
    <p class="muted">Compte 1 à 3 minutes avec les modèles gratuits. Garde ce panneau ouvert ; tu peux utiliser les autres onglets en attendant.</p></div>`;
}

export function renderIdle(root: HTMLElement, message?: string): void {
  root.innerHTML = message
    ? `<div class="idle"><h1>Veracity</h1><p class="muted">${esc(message)}</p></div>`
    : `<div class="idle"><h1>Veracity</h1><p>Vérifie les affirmations de cette vidéo et la façon dont elles sont présentées.</p>
       <button class="primary" data-action="analyze">Analyser cette vidéo</button>
       <p><button data-action="open-channels">📺 Évaluer toute la chaîne</button></p>
       <p class="muted">Tu peux aussi discuter de la vidéo ou lire sa transcription sans lancer la vérification.</p></div>`;
}

export function renderError(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="error"><h1>Analyse impossible</h1><p>${esc(message)}</p>
    <div class="actions center"><button data-action="reanalyze">Réessayer</button><button data-action="options">Options</button></div></div>`;
}

export function renderNotice(root: HTMLElement, title: string, message: string): void {
  root.innerHTML = `<div class="error"><h1>${esc(title)}</h1><p>${esc(message)}</p>
    <div class="actions center"><button data-action="retry-load">Réessayer</button><button data-action="options">Options</button></div></div>`;
}

export function renderLoading(root: HTMLElement, message: string): void {
  root.innerHTML = `<div class="idle"><p class="muted">⏳ ${esc(message)}</p></div>`;
}

function turnHtml(t: ChatTurn, index: number): string {
  if (t.role === 'user') return `<div class="msg user"><div class="body">${esc(t.content).replace(/\n/g, '<br>')}</div></div>`;
  const footer = t.error
    ? ''
    : `<div class="msg-actions"><button data-action="copy-turn" data-index="${index}">Copier</button>${t.model ? `<span class="muted">${esc(t.model.split('/').pop() ?? t.model)}</span>` : ''}</div>`;
  return `<div class="msg assistant${t.error ? ' failed' : ''}"><div class="body">${renderMarkdown(t.content)}</div>${footer}</div>`;
}

export function streamingHtml(text: string): string {
  return text ? renderMarkdown(text) : '<span class="muted">L’IA lit la transcription et réfléchit… (5 à 30 s avec Gemini, 1 à 3 min avec les modèles gratuits d’OpenRouter)</span>';
}

export function renderChat(
  root: HTMLElement,
  turns: ChatTurn[],
  opts: { streaming?: string; busy: boolean; hasReport: boolean; prompts: { label: string }[] },
): void {
  const intro = turns.length || opts.streaming !== undefined ? '' : '<p class="muted">Pose une question sur la vidéo, ou choisis une demande ci-dessous.</p>';
  const streaming = opts.streaming !== undefined ? `<div class="msg assistant" id="streaming"><div class="body">${streamingHtml(opts.streaming)}</div></div>` : '';
  const quick = opts.prompts
    .map((p, i) => `<button class="chip-btn" data-action="quick" data-index="${i}" ${opts.busy ? 'disabled' : ''}>${esc(p.label)}</button>`)
    .join('');
  root.innerHTML = `<div class="chat">
    ${intro}
    <div class="messages">${turns.map(turnHtml).join('')}${streaming}</div>
    <div class="quick">${quick}</div>
    ${turns.length ? '<div class="actions"><button data-action="export-chat">Exporter la discussion (.md)</button><button data-action="clear-chat">Effacer</button></div>' : ''}
    ${opts.hasReport ? '' : '<p class="muted">Astuce : lance la vérification (onglet Rapport) pour que l’IA tienne compte de la fiabilité des affirmations.</p>'}
  </div>`;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export type TranscriptMode = 'original' | 'translated' | 'bilingual';

export interface TranscriptView {
  title: string;
  blockCount: number;
  source?: 'captions' | 'gemini';
  videoLang: string;
  targetLang: string;
  languages: Record<string, string>;
  translation: { status: 'none' | 'running' | 'done' | 'error'; detail?: string };
  mode: TranscriptMode;
  subtitles: boolean;
  dub: { on: boolean; text?: string; error?: boolean };
}

const MODES: [TranscriptMode, string][] = [
  ['original', 'Original'],
  ['translated', 'Traduction'],
  ['bilingual', 'Bilingue'],
];

function translateBar(v: TranscriptView): string {
  const options = Object.entries(v.languages)
    .map(([code, name]) => `<option value="${code}" ${code === v.targetLang ? 'selected' : ''}>${esc(name)}</option>`)
    .join('');
  const t = v.translation;
  const state =
    t.status === 'running'
      ? `<span class="muted">⏳ Traduction… ${esc(t.detail ?? '')}</span>`
      : t.status === 'error'
        ? `<span class="error-text">${esc(t.detail ?? 'Erreur')}</span> <button class="small" data-action="translate">Réessayer</button>`
        : t.status === 'done'
          ? `<span class="segmented">${MODES.map(([m, label]) => `<button class="small${m === v.mode ? ' active' : ''}" data-action="set-mode" data-mode="${m}">${label}</button>`).join('')}</span>`
          : v.videoLang === v.targetLang
            ? `<span class="muted">Vidéo déjà dans cette langue</span>`
            : '<button class="primary small" data-action="translate">Traduire</button>';
  return `<div class="translate-bar">🌐 <select id="target-lang" title="Langue de traduction">${options}</select>${state}</div>`;
}

export function renderTranscript(root: HTMLElement, v: TranscriptView): void {
  const origin = v.source === 'gemini' ? 'transcription audio par IA (Gemini), horodatages approximatifs' : 'sous-titres YouTube';
  const language = v.languages[v.videoLang] ?? v.videoLang.toUpperCase();
  root.innerHTML = `<div class="transcript">
    <p class="muted">${esc(v.title)} · ${v.blockCount} passages · ${origin} · langue : ${esc(language)}</p>
    ${translateBar(v)}
    <div class="actions">
      <button data-action="toggle-subtitles" class="${v.subtitles ? 'active' : ''}" title="Afficher les sous-titres synchronisés sur le lecteur YouTube">💬 Sous-titres sur la vidéo : ${v.subtitles ? 'activés' : 'désactivés'}</button>
      <button data-action="toggle-dub" class="${v.dub.on ? 'active' : ''}" title="Lire la traduction à voix haute, synchronisée avec la vidéo (moteur et voix dans les options)">🔊 Doublage : ${v.dub.on ? 'activé' : 'désactivé'}</button>
    </div>
    <p id="dub-status" class="${v.dub.error ? 'error-text' : 'muted'}">${esc(v.dub.text ?? '')}</p>
    <input type="search" id="transcript-search" placeholder="Rechercher dans la transcription…" />
    <div class="actions"><button data-action="copy-transcript">Copier</button><button data-action="download-transcript" data-format="txt">Télécharger .txt</button><button data-action="download-transcript" data-format="md">Télécharger .md</button></div>
    <div id="transcript-lines"></div>
  </div>`;
}

/** Met à jour la ligne d'état du doublage sans redessiner l'onglet (préserve la recherche en cours). */
export function updateDubStatus(text: string, error: boolean): boolean {
  const el = document.getElementById('dub-status');
  if (!el) return false;
  el.textContent = text;
  el.className = error ? 'error-text' : 'muted';
  return true;
}

export interface TranscriptItem extends Segment {
  /** Texte secondaire (l'original en mode bilingue). */
  sub?: string;
}

export function renderTranscriptLines(root: HTMLElement, items: TranscriptItem[], filter: string): void {
  const query = normalize(filter.trim());
  const shown = query ? items.filter((b) => normalize(`${b.text} ${b.sub ?? ''}`).includes(query)) : items;
  root.innerHTML = shown.length
    ? shown
        .map((b) => `<p class="line">${timestampButton(b.start)} ${esc(b.text)}${b.sub ? `<br><span class="muted">${esc(b.sub)}</span>` : ''}</p>`)
        .join('')
    : '<p class="muted">Aucun passage ne correspond.</p>';
}

export interface MetaBarState {
  category: string | null;
  tags: string[];
  provisional: boolean;
  access: 'none' | 'prompt' | 'granted';
  rootName?: string;
  editing: boolean;
  categories: string[];
}

export function renderMetaBar(root: HTMLElement, s: MetaBarState): void {
  if (s.editing) {
    root.innerHTML = `<form id="category-form" class="meta-edit">
      <input name="category" list="category-list" value="${esc(s.category ?? '')}" placeholder="Catégorie" required />
      <datalist id="category-list">${s.categories.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      <button type="submit" class="primary small">OK</button><button type="button" data-action="cancel-category">Annuler</button>
    </form>`;
    return;
  }
  const label = s.category
    ? `📁 <strong>${esc(s.category)}</strong>${s.provisional ? ' <span class="muted">(proposée)</span>' : ''}${s.tags.length ? ` <span class="muted">· ${esc(s.tags.join(', '))}</span>` : ''}`
    : '<span class="muted">📁 Non classée</span>';
  const access =
    s.access === 'none'
      ? '<button data-action="options" title="Choisir le dossier de la base de connaissances">Configurer la base</button>'
      : s.access === 'prompt'
        ? `<button data-action="kb-authorize">🔒 Autoriser ${esc(s.rootName ?? 'le dossier')}</button>`
        : '<button data-action="kb-save-all" title="Enregistrer rapport, discussion et transcription dans la base">💾 Enregistrer</button>';
  root.innerHTML = `<div class="meta-label">${label}</div><div class="meta-actions"><button data-action="edit-category">Modifier</button><button data-action="kb-pick" title="Choisir où enregistrer rapports, discussions et transcriptions">Choisir le dossier</button>${access}</div>`;
}

const ONLY_OPTIONS: [string, string][] = [
  ['', 'Toutes les vidéos'],
  ['analyzed', 'Analysées'],
  ['chat', 'Avec discussion'],
  ['translated', 'Traduites'],
];

export function renderHistory(root: HTMLElement, v: { total: number; categories: string[]; filter: HistoryFilter; kbConfigured: boolean }): void {
  const categories = [['', 'Toutes les catégories'], ...v.categories.map((c) => [c, c])]
    .map(([value, label]) => `<option value="${esc(value)}" ${value === (v.filter.category ?? '') ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
  const only = ONLY_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === (v.filter.only ?? '') ? 'selected' : ''}>${label}</option>`).join('');
  root.innerHTML = `<div class="history">
    ${historyToggle('videos')}
    <p class="muted">${v.total} vidéo(s) dans l'historique</p>
    <input type="search" id="history-search" placeholder="Rechercher (titre, chaîne, catégorie, mot-clé)…" value="${esc(v.filter.query ?? '')}" />
    <div class="history-filters"><select id="history-category">${categories}</select><select id="history-only">${only}</select></div>
    ${v.kbConfigured ? '<div class="actions"><button data-action="rebuild-index" title="Table des matières de la base de connaissances">📑 Mettre à jour INDEX.md</button><button data-action="restore-kb" title="Réimporte dans l’extension les vidéos et le lexique sauvegardés dans la base (sans écraser du plus récent)">♻️ Restaurer depuis la base</button></div>' : ''}
    <div id="history-list"></div>
  </div>`;
}

function relativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return `aujourd'hui ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'hier';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

function historyItem(e: HistoryEntry, current: boolean, eager: boolean): string {
  const chips = [
    // Deux scores courts plutôt que le libellé (parfois long et trompeur d'un coup d'œil) ; libellé au survol.
    e.report
      ? `<span class="chip ${scoreClass(e.report.facts)}" title="${esc(e.report.label)}">Faits ${e.report.facts ?? '—'}${e.report.facts === null ? '' : ' %'}</span>` +
        `<span class="chip ${scoreClass(e.report.discourse)}" title="${esc(e.report.label)}">Discours ${e.report.discourse} %</span>`
      : '',
    e.category ? `<span class="tag">📁 ${esc(e.category)}</span>` : '',
    e.questions ? `<span class="tag">💬 ${e.questions}</span>` : '',
    ...e.translations.map((l) => `<span class="tag">🌐 ${esc(l.toUpperCase())}</span>`),
    e.transcriptSource === 'gemini' ? '<span class="tag" title="Transcription audio par IA">🎙️ audio</span>' : '',
    e.speakers && e.speakers > 1 ? `<span class="tag" title="Intervenants identifiés">🗣️ ${e.speakers}</span>` : '',
  ].join('');
  const details = [e.author, e.durationS ? formatTime(e.durationS) : '', relativeDate(e.lastActivity)].filter(Boolean).map(esc).join(' · ');
  return `<article class="history-item${current ? ' current' : ''}" data-action="open-video" data-video-id="${esc(e.videoId)}" title="Ouvrir la vidéo">
    <img class="thumb" src="https://i.ytimg.com/vi/${esc(e.videoId)}/mqdefault.jpg" alt="" loading="${eager ? 'eager' : 'lazy'}" crossorigin="anonymous" />
    <div class="history-body">
      <div class="history-title">${esc(e.title)}</div>
      <div class="muted">${details}</div>
      <div class="history-chips">${chips}</div>
    </div>
    <button class="small history-delete" data-action="delete-video" data-video-id="${esc(e.videoId)}" title="Effacer les données de cette vidéo dans l'extension">🗑</button>
  </article>`;
}

export function renderHistoryList(root: HTMLElement, entries: HistoryEntry[], currentVideoId: string | null): void {
  root.innerHTML = entries.length
    ? entries.map((e, i) => historyItem(e, e.videoId === currentVideoId, i < 8)).join('')
    : '<p class="muted">Aucune vidéo ne correspond.</p>';
}
