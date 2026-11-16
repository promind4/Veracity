import type { ChatTurn } from '../../../core/chat';
import { type LexiconFilter, type LexiconTerm, type Quiz, TUTOR_PROMPTS } from '../../../core/lexicon';
import { formatTime } from '../../../core/youtube';
import { esc, renderMarkdown } from './markdown';

export type LexiconMode = 'library' | 'review';
export type Scope = 'all' | 'video';
export type ReviewStyle = 'cards' | 'quiz';
export type BackupState = 'ok' | 'locked' | 'none';

export function backupHtml(state: BackupState, at: string, folder?: string): string {
  if (state === 'locked') return '🔒 Le dossier de la base doit être réautorisé pour sauvegarder. <button class="small" data-action="lex-backup">Autoriser</button>';
  if (state === 'none') return '⚠️ Aucun dossier de base choisi (options) : le lexique n’est sauvegardé que dans l’extension. <button class="small" data-action="lex-backup">Télécharger LEXIQUE.md</button>';
  const where = `${folder ? `${esc(folder)}\\` : ''}_Lexique`;
  return `💾 Sauvegarde automatique dans ${where}${at ? ` · ${esc(at)}` : ''} <button class="small" data-action="lex-backup">Sauvegarder maintenant</button>`;
}

const STATUS_LABEL = { new: '🆕 Nouveau', learning: '📖 En cours', known: '✅ Connu' } as const;

export interface ExtractState {
  status: 'running' | 'error';
  detail: string;
}

export interface LibraryView {
  mode: LexiconMode;
  reviewStyle: ReviewStyle;
  total: number;
  todo: number;
  known: number;
  reviewable: number;
  domains: string[];
  filter: LexiconFilter;
  scope: Scope;
  video: { videoId: string; title: string; terms: number; extract?: ExtractState } | null;
  backup: { state: BackupState; at: string; folder?: string };
  adding: boolean;
}

const STATUS_OPTIONS: [string, string][] = [
  ['todo', 'À apprendre'],
  ['known', 'Connus'],
  ['', 'Tous'],
];

function extractBox(v: NonNullable<LibraryView['video']>): string {
  const e = v.extract;
  if (e?.status === 'running') return `<div class="lex-extract"><p class="muted">⏳ Recherche du vocabulaire de la vidéo… ${esc(e.detail)} (10 à 30 s)</p></div>`;
  const error = e?.status === 'error' ? `<p class="error-text">⚠️ ${esc(e.detail)}</p>` : '';
  const label = v.terms ? '📚 Chercher d’autres termes dans cette vidéo' : '📚 Extraire le vocabulaire de cette vidéo';
  return `<div class="lex-extract">${error}<button class="primary" data-action="lex-extract">${label}</button>${
    v.terms ? `<p class="muted">${v.terms} terme(s) déjà liés à « ${esc(v.title)} ».</p>` : '<p class="muted">Une requête à l’IA, uniquement quand tu cliques.</p>'
  }</div>`;
}

export function renderLibrary(root: HTMLElement, v: LibraryView): void {
  const select = (id: string, options: [string, string][], value: string) =>
    `<select id="${id}">${options.map(([val, label]) => `<option value="${esc(val)}" ${val === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const scope = v.video ? select('lex-scope', [['all', 'Toutes vidéos'], ['video', 'Cette vidéo']], v.scope) : '';
  const library =
    v.mode === 'library'
      ? `<input type="search" id="lex-search" placeholder="Rechercher un terme ou une définition…" value="${esc(v.filter.query ?? '')}" />
    <div class="history-filters">${select('lex-status', STATUS_OPTIONS, v.filter.status ?? '')}${select('lex-domain', [['', 'Domaines'], ...v.domains.map((d): [string, string] => [d, d])], v.filter.domain ?? '')}${scope}</div>
    <div id="lex-list"></div>
`
      : `<div class="segmented lex-modes lex-styles">
      <button data-action="lex-style" data-style="cards" class="${v.reviewStyle === 'cards' ? 'active' : ''}">Cartes</button>
      <button data-action="lex-style" data-style="quiz" class="${v.reviewStyle === 'quiz' ? 'active' : ''}">QCM</button>
    </div><div id="lex-review"></div>`;
  root.innerHTML = `<div class="lexicon">
    <p class="muted">${v.total} terme(s) · ${v.todo} à apprendre · ${v.known} connu(s)</p>
    ${v.video ? extractBox(v.video) : '<p class="muted">Ouvre une vidéo pour en extraire le vocabulaire ; la bibliothèque, elle, reste consultable partout.</p>'}
    <form id="lex-add" class="lex-add"><input type="text" name="term" placeholder="Ajouter un terme entendu (ex. Zigbee)…" autocomplete="off" ${v.adding ? 'disabled' : ''} /><button type="submit" ${v.adding ? 'disabled' : ''}>${v.adding ? '⏳' : 'Ajouter'}</button></form>
    <div class="segmented lex-modes">
      <button data-action="lex-mode" data-mode="library" class="${v.mode === 'library' ? 'active' : ''}">Bibliothèque</button>
      <button data-action="lex-mode" data-mode="review" class="${v.mode === 'review' ? 'active' : ''}">Réviser (${v.reviewable})</button>
    </div>
    ${library}
    <p id="lex-backup" class="muted lex-backup">${backupHtml(v.backup.state, v.backup.at, v.backup.folder)}</p>
  </div>`;
}

function videoLinks(t: LexiconTerm, currentVideoId: string | null): string {
  return t.videos
    .map((v) => {
      const where = v.videoId === currentVideoId && v.t ? `<button class="ts" data-t="${v.t}" title="Aller à ce moment de la vidéo">▶ ${formatTime(v.t)}</button> ` : '';
      const title =
        v.videoId === currentVideoId
          ? '<em>cette vidéo</em>'
          : `<button class="link" data-action="open-video" data-video-id="${esc(v.videoId)}" title="Ouvrir la vidéo">${esc(v.title)}</button>`;
      return `<li>${where}${title}${v.why ? ` — ${esc(v.why)}` : ''}</li>`;
    })
    .join('');
}

function termCard(t: LexiconTerm, currentVideoId: string | null, open: boolean): string {
  const links = videoLinks(t, currentVideoId);
  const related = t.related.map((r) => `<button class="chip-btn" data-action="lex-related" data-term="${esc(r)}">${esc(r)}</button>`).join('');
  const known = t.status === 'known';
  return `<details class="term ${t.status}" ${open ? 'open' : ''}>
    <summary><strong>${esc(t.term)}</strong>${t.full ? ` <span class="muted">${esc(t.full)}</span>` : ''}<span class="tag">${esc(t.domain)}</span><span class="term-status">${STATUS_LABEL[t.status].split(' ')[0]}</span></summary>
    <div class="term-body">
      <p>${esc(t.definition)}</p>
      ${t.example ? `<p class="term-example"><span class="md-label">Exemple :</span> ${esc(t.example)}</p>` : ''}
      ${links ? `<ul class="term-videos">${links}</ul>` : ''}
      ${related ? `<div class="quick">${related}</div>` : ''}
      <div class="actions">
        <button class="small primary" data-action="lex-tutor" data-id="${esc(t.id)}">💬 Explique-moi</button>
        <button class="small" data-action="lex-status" data-id="${esc(t.id)}" data-status="${known ? 'learning' : 'known'}">${known ? '↩︎ À réapprendre' : '✅ Je connais'}</button>
        <button class="small" data-action="lex-domain" data-id="${esc(t.id)}" title="Ranger ce terme dans un autre domaine">🏷 Domaine</button>
        <button class="small" data-action="lex-delete" data-id="${esc(t.id)}" title="Retirer de la bibliothèque">🗑</button>
      </div>
    </div>
  </details>`;
}

export function renderTermList(root: HTMLElement, terms: LexiconTerm[], currentVideoId: string | null, emptyHint: string): void {
  root.innerHTML = terms.length
    ? terms.map((t) => termCard(t, currentVideoId, terms.length <= 3)).join('')
    : `<p class="muted">${esc(emptyHint)}</p>`;
}

export interface ReviewView {
  term: LexiconTerm | null;
  index: number;
  total: number;
  revealed: boolean;
  correct: number;
  style: ReviewStyle;
  /** Réponse choisie au QCM (indice), tant que la question n'est pas validée. */
  picked: number | null;
  preparing: boolean;
}

function renderQuizCard(root: HTMLElement, v: ReviewView, t: LexiconTerm, q: Quiz): void {
  const done = v.picked !== null;
  const choices = q.choices
    .map((c, i) => {
      const state = !done ? '' : i === q.answer ? ' right' : i === v.picked ? ' wrong' : '';
      return `<button class="choice${state}" data-action="lex-pick" data-index="${i}" ${done ? 'disabled' : ''}>${esc(c)}</button>`;
    })
    .join('');
  const verdict = done
    ? `<p class="${v.picked === q.answer ? 'quiz-ok' : 'quiz-ko'}"><strong>${v.picked === q.answer ? '✅ Bonne réponse' : '❌ Pas tout à fait'}</strong></p>
       <p>${esc(q.explanation)}</p>
       <div class="actions center"><button class="primary" data-action="lex-next">${v.index + 1 < v.total ? 'Suivant →' : 'Terminer'}</button><button class="small" data-action="lex-tutor" data-id="${esc(t.id)}">💬 Explique-moi</button></div>`
    : '';
  root.innerHTML = `<div class="quiz">
    <p class="muted">Question ${v.index + 1} / ${v.total} · <strong>${esc(t.term)}</strong> <span class="tag">${esc(t.domain)}</span></p>
    <h3 class="quiz-q">${esc(q.question)}</h3>
    <div class="choices">${choices}</div>
    ${verdict}
  </div>`;
}

export function renderReview(root: HTMLElement, v: ReviewView): void {
  if (!v.term) {
    root.innerHTML = v.total
      ? `<div class="idle"><h2>Séance terminée 🎉</h2><p>${v.correct} / ${v.total} termes sus.</p><div class="actions center"><button data-action="lex-mode" data-mode="review">Nouvelle séance</button></div></div>`
      : '<p class="muted">Rien à réviser : extrais le vocabulaire d’une vidéo, ou ajoute un terme.</p>';
    return;
  }
  const t = v.term;
  if (v.style === 'quiz' && v.preparing) {
    root.innerHTML = '<div class="idle"><p class="muted">⏳ Préparation des questions… (5 à 20 s, une seule requête pour la séance)</p></div>';
    return;
  }
  if (v.style === 'quiz' && t.quiz) return renderQuizCard(root, v, t, t.quiz);
  const answer = v.revealed
    ? `<p>${esc(t.definition)}</p>${t.example ? `<p class="term-example"><span class="md-label">Exemple :</span> ${esc(t.example)}</p>` : ''}
       <div class="actions center"><button class="primary" data-action="lex-answer" data-ok="1">✅ Je savais</button><button data-action="lex-answer" data-ok="0">🔁 À revoir</button></div>
       <div class="actions center"><button class="small" data-action="lex-tutor" data-id="${esc(t.id)}">💬 Explique-moi</button></div>`
    : '<div class="actions center"><button class="primary" data-action="lex-reveal">Afficher la définition</button></div>';
  root.innerHTML = `<div class="flashcard">
    <p class="muted">Carte ${v.index + 1} / ${v.total} · dis-toi la définition avant de l’afficher</p>
    <h2 class="flash-term">${esc(t.term)}</h2>
    ${t.full ? `<p class="muted center">${esc(t.full)}</p>` : ''}<p class="center"><span class="tag">${esc(t.domain)}</span> <span class="tag">${STATUS_LABEL[t.status]}</span></p>
    ${answer}
  </div>`;
}

function tutorTurn(t: ChatTurn): string {
  if (t.role === 'user') return `<div class="msg user"><div class="body">${esc(t.content).replace(/\n/g, '<br>')}</div></div>`;
  return `<div class="msg assistant${t.error ? ' failed' : ''}"><div class="body">${renderMarkdown(t.content)}</div></div>`;
}

export const tutorStreamingHtml = (text: string) => (text ? renderMarkdown(text) : '<span class="muted">Le tuteur réfléchit…</span>');

export function renderTutor(root: HTMLElement, v: { term: LexiconTerm; turns: ChatTurn[]; streaming?: string; busy: boolean }): void {
  const t = v.term;
  const intro =
    v.turns.length || v.streaming !== undefined
      ? ''
      : `<div class="msg assistant"><div class="body"><p><strong>${esc(t.term)}</strong>${t.full ? ` (${esc(t.full)})` : ''} : ${esc(t.definition)}</p>${
          t.example ? `<p><em>${esc(t.example)}</em></p>` : ''
        }<p class="muted">Pose ta question ci-dessous, ou choisis une demande.</p></div></div>`;
  const streaming = v.streaming !== undefined ? `<div class="msg assistant" id="lex-streaming"><div class="body">${tutorStreamingHtml(v.streaming)}</div></div>` : '';
  const quick = TUTOR_PROMPTS.map((p, i) => `<button class="chip-btn" data-action="lex-quick" data-index="${i}" ${v.busy ? 'disabled' : ''}>${esc(p.label)}</button>`).join('');
  root.innerHTML = `<div class="chat tutor">
    <div class="tutor-head"><button class="small" data-action="lex-back">← Lexique</button><strong>${esc(t.term)}</strong><span class="tag">${esc(t.domain)}</span>
      <button class="small" data-action="lex-status" data-id="${esc(t.id)}" data-status="${t.status === 'known' ? 'learning' : 'known'}">${t.status === 'known' ? '↩︎ À réapprendre' : '✅ Je connais'}</button></div>
    <div class="messages">${intro}${v.turns.map(tutorTurn).join('')}${streaming}</div>
    <div class="quick">${quick}</div>
    ${v.turns.length ? '<div class="actions"><button data-action="lex-clear-tutor" data-id="' + esc(t.id) + '">Effacer cette discussion</button></div>' : ''}
  </div>`;
}
