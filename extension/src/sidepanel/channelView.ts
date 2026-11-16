import type { ChannelReport, ChannelVerdict } from '../../../core/channel';
import { TECHNIQUE_LABEL } from '../../../core/labels';
import { esc } from './markdown';

export type HistoryView = 'videos' | 'channels';

const VERDICT_CLASS: Record<ChannelVerdict, string> = {
  fiable: 'ok',
  orientee: 'warn',
  mitigee: 'warn',
  peu_fiable: 'bad',
  commerciale: 'bad',
  insuffisant: 'na',
};
const CONFIDENCE_ICON = { haute: '🟢', moyenne: '🟠', faible: '🔴' } as const;
const scoreClass = (n: number | null) => (n === null ? 'na' : n >= 75 ? 'ok' : n >= 50 ? 'warn' : 'bad');
export const SAMPLE_CHOICES = [3, 5, 8];

/** Bascule Vidéos / Chaînes, en tête de l'onglet Historique. */
export function historyToggle(view: HistoryView): string {
  return `<div class="segmented lex-modes"><button data-action="history-view" data-view="videos" class="${view === 'videos' ? 'active' : ''}">Vidéos</button><button data-action="history-view" data-view="channels" class="${view === 'channels' ? 'active' : ''}">Chaînes</button></div>`;
}

export interface Target {
  /** Nom à afficher (auteur de la vidéo ouverte, ou « cette chaîne »). */
  label: string;
  /** Vrai si la chaîne a déjà été analysée. */
  known: boolean;
}

export interface Running {
  done: number;
  total: number;
  detail: string;
}

export interface ChannelsView {
  target: Target | null;
  sample: number;
  running: Running | null;
  error: string | null;
  channels: ChannelReport[];
  kbConfigured: boolean;
}

function launcher(v: ChannelsView): string {
  if (v.running) {
    const pct = v.running.total ? Math.round((100 * v.running.done) / v.running.total) : 0;
    return `<div class="lex-extract"><p>⏳ Analyse de la chaîne : <strong>${v.running.done} / ${v.running.total}</strong> vidéos${v.running.detail ? ` · ${esc(v.running.detail)}` : ''}</p>
      <div class="bar"><div class="fill" style="width:${pct}%;background:var(--accent)"></div></div>
      <div class="actions"><button data-action="channel-cancel">Arrêter</button></div>
      <p class="muted">Chaque vidéo prend 1 à 3 minutes. Les rapports déjà faits sont gardés : tu peux arrêter et reprendre plus tard.</p></div>`;
  }
  const options = SAMPLE_CHOICES.map((n) => `<option value="${n}" ${n === v.sample ? 'selected' : ''}>${n} vidéos</option>`).join('');
  const error = v.error ? `<p class="error-text">⚠️ ${esc(v.error)}</p>` : '';
  if (!v.target) return `<div class="lex-extract">${error}<p class="muted">Ouvre une vidéo ou la page d’une chaîne YouTube pour l’analyser.</p></div>`;
  return `<div class="lex-extract">${error}
    <div class="lex-add"><select id="channel-sample" title="Nombre de vidéos analysées : plus il y en a, plus la note est fiable, mais plus c’est long">${options}</select>
    <button class="primary" data-action="channel-analyze" style="flex:1">${v.target.known ? '🔄 Mettre à jour' : '📺 Analyser'} ${esc(v.target.label)}</button></div>
    <p class="muted">Un échantillon des dernières vidéos (récentes et populaires). Les vidéos de moins de 3 minutes ou sans sous-titres sont écartées, et celles déjà analysées ne sont pas refaites.</p></div>`;
}

function card(c: ChannelReport): string {
  const s = c.summary;
  return `<article class="history-item" data-action="channel-open" data-id="${esc(c.channelId)}" title="Voir le détail">
    <div class="history-body">
      <div class="history-title">${esc(c.name)}</div>
      <div class="muted">${c.videos.length} vidéo(s) analysée(s) · ${new Date(c.createdAt).toLocaleDateString('fr-FR')}</div>
      <div class="history-chips"><span class="chip ${VERDICT_CLASS[s.verdict]}">${esc(s.label)}</span>
        <span class="chip ${scoreClass(s.facts)}">Faits ${s.facts ?? '—'}${s.facts === null ? '' : ' %'}</span>
        <span class="chip ${scoreClass(s.discourse)}">Discours ${s.discourse} %</span></div>
    </div>
    <button class="small history-delete" data-action="channel-delete" data-id="${esc(c.channelId)}" title="Retirer cette analyse de l’extension">🗑</button>
  </article>`;
}

export function renderChannels(root: HTMLElement, v: ChannelsView): void {
  root.innerHTML = `<div class="history">
    ${historyToggle('channels')}
    ${launcher(v)}
    <p class="muted">${v.channels.length} chaîne(s) analysée(s)</p>
    ${v.channels.map(card).join('') || '<p class="muted">Aucune chaîne analysée pour l’instant.</p>'}
  </div>`;
}

export function renderChannelDetail(root: HTMLElement, c: ChannelReport, currentVideoId: string | null): void {
  const s = c.summary;
  const techniques = s.techniques
    .map((t) => `<li>${esc(TECHNIQUE_LABEL[t.technique])} <span class="muted">· ${t.videos} vidéo(s) sur ${c.videos.length}</span></li>`)
    .join('');
  const outliers = new Set(s.outliers ?? []);
  const videos = c.videos
    .map(
      (v) => `<article class="history-item${v.videoId === currentVideoId ? ' current' : ''}" data-action="open-video" data-video-id="${esc(v.videoId)}">
      <img class="thumb" src="https://i.ytimg.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="" loading="lazy" crossorigin="anonymous" />
      <div class="history-body"><div class="history-title">${esc(v.title)}</div>
        <div class="history-chips">${outliers.has(v.videoId) ? '<span class="tag" title="Nettement en dessous des autres vidéos">⚠️ à regarder de près</span>' : ''}<span class="chip ${scoreClass(v.facts)}">Faits ${v.facts ?? '—'}${v.facts === null ? '' : ' %'}</span><span class="chip ${scoreClass(v.discourse)}">Discours ${v.discourse} %</span>${
          v.reliability ? `<span class="tag" title="Fiabilité de la note">${CONFIDENCE_ICON[v.reliability]} note ${v.reliability}</span>` : ''
        }</div></div></article>`,
    )
    .join('');
  const skipped = c.skipped.length
    ? `<details><summary class="muted">${c.skipped.length} vidéo(s) écartée(s)</summary><ul class="muted">${c.skipped.map((x) => `<li>${esc(x.title)} — ${esc(x.reason)}</li>`).join('')}</ul></details>`
    : '';
  root.innerHTML = `<div class="history">
    <div class="tutor-head"><button class="small" data-action="channel-back">← Chaînes</button></div>
    <header class="summary-card ${VERDICT_CLASS[s.verdict]}">
      <h1>${esc(s.label)}</h1>
      <p class="muted">${esc(c.name)} · ${c.videos.length} vidéo(s) analysée(s)</p>
      <p><strong>${esc(s.advice)}</strong></p>
      <div class="gauge"><div class="gauge-head"><span>Exactitude des faits (médiane)</span><strong class="${scoreClass(s.facts)}">${s.facts === null ? '—' : `${s.facts} %`}</strong></div><div class="bar"><div class="fill ${scoreClass(s.facts)}" style="width:${s.facts ?? 0}%"></div></div>
        <small class="muted">${s.unevaluable ? `${s.unevaluable} vidéo(s) sans assez d’affirmations vérifiables · ` : ''}écart entre vidéos : ${s.spread} points</small></div>
      <div class="gauge"><div class="gauge-head"><span>Honnêteté du discours (médiane)</span><strong class="${scoreClass(s.discourse)}">${s.discourse} %</strong></div><div class="bar"><div class="fill ${scoreClass(s.discourse)}" style="width:${s.discourse}%"></div></div></div>
      <p class="reliability">${CONFIDENCE_ICON[s.confidence]} Confiance dans ce verdict : <strong>${s.confidence}</strong><br><small class="muted">${
        s.confidence === 'haute' ? 'au moins 6 vidéos, résultats homogènes' : s.confidence === 'moyenne' ? 'échantillon correct mais limité : analyse plus de vidéos pour l’affiner' : 'trop peu de vidéos pour conclure'
      }</small></p>
      <div class="actions"><button data-action="channel-refresh" data-id="${esc(c.channelId)}">🔄 Compléter</button><button data-action="channel-export" data-id="${esc(c.channelId)}">Exporter (.md)</button></div>
      <small class="muted">${new Date(c.createdAt).toLocaleString('fr-FR')}</small>
    </header>
    ${c.warnings.length ? `<div class="warnings">${c.warnings.map((w) => `<p>⚠️ ${esc(w)}</p>`).join('')}</div>` : ''}
    ${techniques ? `<section><h2>Procédés de persuasion les plus fréquents</h2><ul>${techniques}</ul></section>` : ''}
    <section><h2>Vidéos analysées</h2>${videos || '<p class="muted">Aucune.</p>'}${skipped}</section>
  </div>`;
}
