import { buildChatMessages, QUICK_PROMPTS } from '../../../core/chat';
import { parseChannelUrl } from '../../../core/channel';
import { buildCues, type Cue } from '../../../core/cues';
import { geminiKeys } from '../../../core/gemini';
import type { DubCue } from '../../../core/dub';
import { buildHistory, filterHistory, historyCategories, type HistoryFilter } from '../../../core/history';
import { detectSpeakers, type SpeakerMap } from '../../../core/speakers';
import { chatToMarkdown, reportToMarkdown, slugify, transcriptToMarkdown, transcriptToText } from '../../../core/export';
import type { KbKind } from '../../../core/kb';
import { answerText } from '../../../core/engine';
import { analyzeVideo } from '../../../core/pipeline';
import { type Config, type ProgressStep, type VideoInput } from '../../../core/types';
import { transcribeYouTube } from '../../../core/transcribe';
import { TARGET_LANGUAGES, translateCues, type Translation, translationEngine } from '../../../core/translate';
import { fetchVideo, groupSegments, parseVideoId, type TranscriptFallback } from '../../../core/youtube';
import { getKbRoot, kbAccess, listCategories, requestKbAccess } from '../shared/kb';
import { makePageFetch, seekInTab } from '../shared/pageFetch';
import {
  getCachedReport,
  getCachedVideo,
  getChat,
  getSpeakers,
  getTranslation,
  getVideoMeta,
  loadConfig,
  saveChat,
  saveConfig,
  saveReport,
  saveSpeakers,
  saveTranslation,
  saveVideo,
  deleteVideoData,
  getAllItems,
  markVisited,
} from '../shared/storage';
import { showSubtitles } from '../shared/subtitles';
import { DubController } from './dubbing';
import { changeCategory, grantedCategories, rebuildKbIndex, restoreFromKb, saveToKb } from './knowledge';
import { createChannels } from './channels';
import type { HistoryView } from './channelView';
import { createLexicon } from './lexicon';
import {
  type TranscriptItem,
  type TranscriptMode,
  renderChat,
  renderError,
  renderHistory,
  renderHistoryList,
  renderIdle,
  renderLoading,
  renderMetaBar,
  renderNotice,
  renderProgress,
  renderReport,
  renderTabs,
  renderTranscript,
  renderTranscriptLines,
  streamingHtml,
  type Tab,
  updateDubStatus,
} from './render';

type AnalysisState = { status: 'running'; step: ProgressStep; detail?: string } | { status: 'error'; message: string };

const tabsEl = document.getElementById('tabs')!;
const content = document.getElementById('content')!;
const composer = document.getElementById('composer') as HTMLFormElement;
const questionInput = composer.elements.namedItem('question') as HTMLTextAreaElement;
const metaBar = document.getElementById('meta-bar')!;
const toastEl = document.getElementById('toast')!;

const analyses = new Map<string, AnalysisState>();
const streaming = new Map<string, string>();
const videoLoads = new Map<string, Promise<VideoInput>>();
let current: { tabId: number; videoId: string | null; channelUrl: string | null } = { tabId: -1, videoId: null, channelUrl: null };
let tab: Tab = 'report';
let renderToken = 0;
let editingCategory = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
// Traduction : tâches en cours par vidéo, mode d'affichage, sous-titres affichés sur la vidéo.
const translating = new Map<string, { status: 'running' | 'error'; detail: string }>();
let transcriptMode: TranscriptMode = 'translated';
const subtitlesOn = new Set<string>();

/** Lignes de l'onglet Transcription : blocs de 30 s, en original, traduits ou bilingues. */
function transcriptItems(video: VideoInput, translation: Translation | null, mode: TranscriptMode): TranscriptItem[] {
  if (!translation || mode === 'original') return groupSegments(video.segments, 30);
  const items: TranscriptItem[] = [];
  for (const cue of translation.cues) {
    const last = items.at(-1);
    if (last && cue.start - last.start < 30) {
      last.text += ' ' + cue.text;
      if (last.sub !== undefined) last.sub += ' ' + cue.orig;
    } else {
      items.push({ start: cue.start, text: cue.text, sub: mode === 'bilingual' ? cue.orig : undefined });
    }
  }
  return items;
}

/** Sous-titres affichés : la traduction dans la langue choisie si elle existe, sinon l'original. */
async function subtitleCues(tabId: number, videoId: string): Promise<Cue[]> {
  const { targetLang = 'fr' } = await loadConfig();
  const translation = await getTranslation(videoId, targetLang);
  return translation ? translation.cues : buildCues((await loadVideo(tabId, videoId)).segments);
}

async function refreshSubtitles(tabId: number, videoId: string): Promise<void> {
  try {
    await showSubtitles(tabId, videoId, subtitlesOn.has(videoId) ? await subtitleCues(tabId, videoId) : null);
  } catch (e) {
    subtitlesOn.delete(videoId);
    toast(`⚠️ Sous-titres impossibles : ${(e as Error).message}`);
  }
}

async function startTranslation(tabId: number, videoId: string): Promise<void> {
  if (translating.get(videoId)?.status === 'running') return;
  const update = (state: { status: 'running' | 'error'; detail: string } | null) => {
    if (state) translating.set(videoId, state);
    else translating.delete(videoId);
    if (isVisible(videoId, 'transcript')) void render();
  };
  update({ status: 'running', detail: 'préparation' });
  try {
    const config = await loadConfig();
    const lang = config.targetLang ?? 'fr';
    const video = await loadVideo(tabId, videoId);
    const out = await translateCues(buildCues(video.segments), lang, video.title, translationEngine(config), {
      onProgress: (done, total) => update({ status: 'running', detail: `lot ${done}/${total}` }),
    });
    await saveTranslation(videoId, { lang, ...out, createdAt: new Date().toISOString() });
    transcriptMode = 'translated';
    update(null);
    if (subtitlesOn.has(videoId)) await refreshSubtitles(tabId, videoId);
    if (config.autoSave !== false) await saveOrDownload(tabId, videoId, [], false);
  } catch (e) {
    update({ status: 'error', detail: (e as Error).message });
  }
}

const dub = new DubController(
  (videoId) => {
    if (!isVisible(videoId, 'transcript')) return;
    const view = dub.view(videoId);
    // Avant/après une session, l'état du bouton change : on redessine ; sinon on met juste la ligne à jour.
    if (!view || !updateDubStatus(view.text, view.error)) void render();
  },
  (message) => toast(message),
);

/** Doublage de la traduction (lancée d'abord si besoin) ou de l'original si la vidéo est déjà dans la langue cible. */
async function startDub(tabId: number, videoId: string): Promise<void> {
  const config = await loadConfig();
  const lang = config.targetLang ?? 'fr';
  const video = await loadVideo(tabId, videoId);
  let translation = await getTranslation(videoId, lang);
  if (!translation && video.language !== lang) {
    toast('Traduction avant le doublage…');
    await startTranslation(tabId, videoId);
    translation = await getTranslation(videoId, lang);
    if (!translation) return;
  }
  const cues: DubCue[] = translation?.cues ?? buildCues(video.segments);
  try {
    const speakers = await speakersFor(videoId, translation?.cues ?? cues, config);
    if (speakers) cues.forEach((c, i) => (c.speaker = speakers.byCue[i]));
    await dub.start(tabId, videoId, cues, config, speakers?.speakers);
  } catch (e) {
    toast(`⚠️ Doublage impossible : ${(e as Error).message}`);
  }
  await render();
}

/**
 * Intervenants de la vidéo (une requête Gemini, gardée en cache) pour donner une voix à chacun.
 * En cas d'échec, le doublage continue avec une seule voix.
 */
async function speakersFor(videoId: string, cues: (Cue & { orig?: string })[], config: Config): Promise<SpeakerMap | null> {
  if (config.dubMultiVoice === false || !config.geminiKey || config.ttsEngine === 'browser') return null;
  const signature = `${cues.length}|${cues[0]?.start ?? 0}|${cues.at(-1)?.start ?? 0}`;
  const cached = await getSpeakers(videoId);
  if (cached?.signature === signature) return cached;
  toast('Identification des intervenants…');
  try {
    // Gemini écoute la vidéo : on lui donne le texte d'origine des sous-titres, pas la traduction.
    const detected = await detectSpeakers(videoId, cues.map((c) => ({ start: c.start, end: c.end, text: c.orig ?? c.text })), { key: geminiKeys(config) });
    const stored = { speakers: detected.speakers, byCue: detected.byCue, signature };
    await saveSpeakers(videoId, stored);
    return stored;
  } catch (e) {
    toast(`Intervenants non identifiés (${(e as Error).message}) : une seule voix.`);
    return null;
  }
}

async function changeTargetLang(lang: string): Promise<void> {
  const config = await loadConfig();
  await saveConfig({ ...config, targetLang: lang });
  const { tabId, videoId } = current;
  if (videoId && subtitlesOn.has(videoId)) await refreshSubtitles(tabId, videoId);
  await render();
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 5000);
}

/** Transcription : cache local, sinon lecture via l'onglet YouTube (aucun appel au LLM). */
function loadVideo(tabId: number, videoId: string): Promise<VideoInput> {
  let pending = videoLoads.get(videoId);
  if (!pending) {
    pending = (async () => {
      const cached = await getCachedVideo(videoId);
      if (cached) return cached;
      const keys = geminiKeys(await loadConfig());
      // Sans sous-titres : Gemini lit la vidéo depuis son URL (requête depuis l'extension, pas depuis la page).
      const fallback: TranscriptFallback | undefined = keys.length ? (v) => transcribeYouTube(v, { key: keys }) : undefined;
      const video = await fetchVideo(videoId, makePageFetch(tabId), 'fr', fallback);
      await saveVideo(video);
      return video;
    })().finally(() => videoLoads.delete(videoId));
    videoLoads.set(videoId, pending);
  }
  return pending;
}

const isVisible = (videoId: string, t: Tab) => current.videoId === videoId && tab === t;

let historyView: HistoryView = 'videos';

const channels = createChannels({
  content,
  current: () => current,
  isVisible: () => tab === 'history' && historyView === 'channels',
  toast: (message) => toast(message),
  rerender: () => render(),
});

const lexicon = createLexicon({
  content,
  current: () => current,
  isVisible: () => tab === 'lexicon',
  toast: (message) => toast(message),
  rerender: () => render(),
  loadVideo,
});

let historyFilter: HistoryFilter = {};
let historyShownAutomatically = false;

/** Onglet Historique : toutes les vidéos connues de l'extension, filtrables sans redessiner l'onglet. */
async function renderHistoryTab(stale: () => boolean): Promise<void> {
  if (historyView === 'channels') return channels.renderTab(stale);
  const [items, root] = await Promise.all([getAllItems(), getKbRoot()]);
  if (stale()) return;
  const entries = buildHistory(items);
  renderHistory(content, { total: entries.length, categories: historyCategories(entries), filter: historyFilter, kbConfigured: root !== null });
  const list = document.getElementById('history-list')!;
  const draw = () => renderHistoryList(list, filterHistory(entries, historyFilter), current.videoId);
  draw();
  const search = document.getElementById('history-search') as HTMLInputElement;
  search.addEventListener('input', () => {
    historyFilter = { ...historyFilter, query: search.value };
    draw();
  });
  document.getElementById('history-category')!.addEventListener('change', (event) => {
    historyFilter = { ...historyFilter, category: (event.target as HTMLSelectElement).value || undefined };
    draw();
  });
  document.getElementById('history-only')!.addEventListener('change', (event) => {
    historyFilter = { ...historyFilter, only: ((event.target as HTMLSelectElement).value || undefined) as HistoryFilter['only'] };
    draw();
  });
}

async function render(): Promise<void> {
  const token = ++renderToken;
  const stale = () => token !== renderToken;
  const videoId = current.videoId;
  renderTabs(tabsEl, tab, videoId !== null);
  if (tab === 'history' || tab === 'lexicon') metaBar.hidden = true;
  else if (!editingCategory) void drawMetaBar();
  const tutor = tab === 'lexicon' && lexicon.tutorActive();
  composer.hidden = !((videoId && tab === 'chat') || tutor);
  questionInput.placeholder = tutor ? 'Pose ta question sur ce terme… (Entrée pour envoyer)' : 'Pose une question sur la vidéo… (Entrée pour envoyer)';
  if (tab === 'history') return renderHistoryTab(stale);
  if (tab === 'lexicon') return lexicon.renderTab(stale);
  if (!videoId) return renderIdle(content, 'Ouvre une vidéo YouTube pour l’analyser ou en discuter.');

  if (tab === 'report') {
    const state = analyses.get(videoId);
    if (state?.status === 'running') return renderProgress(content, state.step, state.detail);
    if (state?.status === 'error') return renderError(content, state.message);
    const report = await getCachedReport(videoId);
    if (stale()) return;
    return report ? renderReport(content, report) : renderIdle(content);
  }

  if (!(await getCachedVideo(videoId))) renderLoading(content, 'Lecture de la transcription… (sans sous-titres, transcription audio par Gemini : 20 s à 2 min)');
  let video: VideoInput;
  try {
    video = await loadVideo(current.tabId, videoId);
  } catch (e) {
    if (!stale()) renderNotice(content, 'Transcription indisponible', (e as Error).message);
    return;
  }
  if (stale()) return;

  if (tab === 'transcript') {
    const { targetLang = 'fr' } = await loadConfig();
    const translation = await getTranslation(videoId, targetLang);
    if (stale()) return;
    const job = translating.get(videoId);
    const mode = translation ? transcriptMode : 'original';
    const items = transcriptItems(video, translation, mode);
    renderTranscript(content, {
      title: video.title,
      blockCount: items.length,
      source: video.transcriptSource,
      videoLang: video.language,
      targetLang,
      languages: TARGET_LANGUAGES,
      translation: job
        ? { status: job.status, detail: job.detail }
        : { status: translation ? 'done' : 'none', detail: translation?.missing ? `${translation.missing} passage(s) non traduit(s)` : undefined },
      mode,
      subtitles: subtitlesOn.has(videoId),
      dub: { on: dub.isOn(videoId), ...dub.view(videoId) },
    });
    const search = document.getElementById('transcript-search') as HTMLInputElement;
    const lines = document.getElementById('transcript-lines')!;
    renderTranscriptLines(lines, items, '');
    search.addEventListener('input', () => renderTranscriptLines(lines, items, search.value));
    document.getElementById('target-lang')!.addEventListener('change', (event) => void changeTargetLang((event.target as HTMLSelectElement).value));
    return;
  }

  const [turns, report] = await Promise.all([getChat(videoId), getCachedReport(videoId)]);
  if (stale()) return;
  const busy = streaming.has(videoId);
  renderChat(content, turns, { streaming: streaming.get(videoId), busy, hasReport: report !== null, prompts: QUICK_PROMPTS });
  (composer.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = busy;
  content.scrollTop = content.scrollHeight;
}

/** Barre de catégorie : catégorie retenue (ou proposée par le rapport) et état d'accès au dossier. */
async function drawMetaBar(): Promise<void> {
  const videoId = current.videoId;
  if (!videoId) {
    metaBar.hidden = true;
    return;
  }
  const root = await getKbRoot();
  const [access, meta, report] = await Promise.all([kbAccess(root), getVideoMeta(videoId), getCachedReport(videoId)]);
  const categories = editingCategory && root && access === 'granted' ? await listCategories(root) : [];
  if (current.videoId !== videoId || tab === 'history' || tab === 'lexicon') return;
  metaBar.hidden = false;
  renderMetaBar(metaBar, {
    category: meta?.category ?? report?.category ?? null,
    tags: meta?.tags ?? report?.tags ?? [],
    provisional: !meta && Boolean(report?.category),
    access,
    rootName: root?.name,
    editing: editingCategory,
    categories,
  });
  if (editingCategory) (metaBar.querySelector('input') as HTMLInputElement | null)?.focus();
}

/** Enregistre dans la base ; sans dossier configuré (ou accès refusé), `fallback` télécharge le fichier. */
async function saveOrDownload(tabId: number, videoId: string, kinds: KbKind[], interactive: boolean, fallback?: () => void): Promise<void> {
  try {
    const result = await saveToKb(await loadVideo(tabId, videoId), kinds, interactive);
    if (result.saved) toast(`💾 Enregistré dans ${result.path}`);
    else if (fallback) fallback();
    else if (interactive) toast(result.reason === 'none' ? 'Choisis d’abord le dossier de la base dans les options.' : 'Accès au dossier refusé.');
    void drawMetaBar();
  } catch (e) {
    toast(`⚠️ Enregistrement impossible : ${(e as Error).message}`);
  }
}

async function autoSaveEnabled(): Promise<boolean> {
  return (await loadConfig()).autoSave !== false;
}

async function startAnalysis(tabId: number, videoId: string): Promise<void> {
  if (analyses.get(videoId)?.status === 'running') return;
  const update = (state: AnalysisState | null) => {
    if (state) analyses.set(videoId, state);
    else analyses.delete(videoId);
    if (isVisible(videoId, 'report')) void render();
  };
  update({ status: 'running', step: 'transcript' });
  try {
    const [config, video, categories] = await Promise.all([loadConfig(), loadVideo(tabId, videoId), grantedCategories()]);
    const report = await analyzeVideo(video, config, (step, detail) => update({ status: 'running', step, detail }), fetch, categories);
    await saveReport(report);
    update(null);
    if (config.autoSave !== false) await saveOrDownload(tabId, videoId, ['report'], false);
  } catch (e) {
    update({ status: 'error', message: (e as Error).message });
  }
}

async function sendChat(question: string): Promise<void> {
  const { tabId, videoId } = current;
  if (!videoId || streaming.has(videoId) || !question.trim()) return;
  const turns = await getChat(videoId);
  const history = [...turns];
  turns.push({ role: 'user', content: question.trim(), at: new Date().toISOString() });
  await saveChat(videoId, turns);
  streaming.set(videoId, '');
  void render();
  try {
    const [config, video, report] = await Promise.all([loadConfig(), loadVideo(tabId, videoId), getCachedReport(videoId)]);
    const { text, model } = await answerText(
      buildChatMessages(video, report, history, question.trim()),
      config,
      (delta) => {
        const sofar = (streaming.get(videoId) ?? '') + delta;
        streaming.set(videoId, sofar);
        const bubble = isVisible(videoId, 'chat') ? document.querySelector('#streaming .body') : null;
        if (bubble) {
          bubble.innerHTML = streamingHtml(sofar);
          content.scrollTop = content.scrollHeight;
        }
      },
    );
    turns.push({ role: 'assistant', content: text, at: new Date().toISOString(), model });
  } catch (e) {
    turns.push({ role: 'assistant', content: `⚠️ ${(e as Error).message}`, at: new Date().toISOString(), error: true });
  } finally {
    streaming.delete(videoId);
    await saveChat(videoId, turns);
    if (isVisible(videoId, 'chat')) void render();
  }
  if (!turns.at(-1)?.error && (await autoSaveEnabled())) await saveOrDownload(tabId, videoId, ['chat'], false);
}

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, button: HTMLElement): Promise<void> {
  await navigator.clipboard.writeText(text);
  const label = button.textContent;
  button.textContent = 'Copié ✓';
  setTimeout(() => (button.textContent = label), 1500);
}

async function handleAction(el: HTMLElement): Promise<void> {
  const { tabId, videoId } = current;
  const action = el.dataset.action;
  if (action === 'options') return void chrome.runtime.openOptionsPage();
  // Actions du lexique, des chaînes et de l'historique : valables même sans vidéo ouverte.
  if (await lexicon.handle(el)) return;
  if (await channels.handle(el)) return;
  if (action === 'open-channels') {
    tab = 'history';
    historyView = 'channels';
    historyShownAutomatically = false;
    return render();
  }
  if (action === 'history-view') {
    historyView = el.dataset.view as HistoryView;
    return render();
  }
  if (action === 'open-video') return openVideo(el.dataset.videoId!);
  if (action === 'delete-video') {
    if (confirm('Effacer de l’extension le rapport, la discussion, la transcription et les traductions de cette vidéo ?\n(Les fichiers de la base de connaissances sont conservés.)')) {
      await deleteVideoData(el.dataset.videoId!);
      await render();
    }
    return;
  }
  if (action === 'rebuild-index') {
    const result = await rebuildKbIndex();
    toast(typeof result === 'number' ? `📑 INDEX.md mis à jour (${result} vidéos)` : result === 'none' ? 'Choisis d’abord le dossier de la base dans les options.' : 'Accès au dossier refusé.');
    return;
  }
  if (action === 'restore-kb') {
    toast('Restauration en cours…');
    const result = await restoreFromKb();
    toast(
      typeof result === 'object'
        ? `♻️ ${result.videos} vidéo(s) restaurée(s), ${result.terms} terme(s) de lexique et ${result.channels} chaîne(s) ajouté(s)`
        : result === 'none'
          ? 'Choisis d’abord le dossier de la base dans les options.'
          : 'Accès au dossier refusé.',
    );
    return render();
  }
  if (!videoId) return;
  switch (action) {
    case 'analyze':
    case 'reanalyze':
      return startAnalysis(tabId, videoId);
    case 'retry-load':
      return render();
    case 'quick':
      return sendChat(QUICK_PROMPTS[Number(el.dataset.index)].prompt);
    case 'copy-turn': {
      const turn = (await getChat(videoId))[Number(el.dataset.index)];
      if (turn) await copy(turn.content, el);
      return;
    }
    case 'export-chat': {
      const video = await loadVideo(tabId, videoId);
      const turns = await getChat(videoId);
      return saveOrDownload(tabId, videoId, ['chat'], true, () => download(`discussion-${slugify(video.title)}.md`, chatToMarkdown(video, turns), 'text/markdown'));
    }
    case 'clear-chat':
      if (confirm('Effacer toute la discussion sur cette vidéo ?')) {
        await saveChat(videoId, []);
        await render();
      }
      return;
    case 'export-report': {
      const report = await getCachedReport(videoId);
      if (!report) return;
      return saveOrDownload(tabId, videoId, ['report'], true, () => download(`veracity-${slugify(report.title)}.md`, reportToMarkdown(report), 'text/markdown'));
    }
    case 'kb-save-all':
      return saveOrDownload(tabId, videoId, ['report', 'chat'], true);
    case 'kb-authorize': {
      const root = await getKbRoot();
      if (root && (await requestKbAccess(root))) toast(`🔓 Accès à ${root.name} autorisé`);
      return drawMetaBar();
    }
    case 'translate':
      return startTranslation(tabId, videoId);
    case 'set-mode':
      transcriptMode = el.dataset.mode as TranscriptMode;
      return render();
    case 'toggle-dub':
      if (dub.isOn(videoId)) {
        await dub.stop(videoId);
        return render();
      }
      return startDub(tabId, videoId);
    case 'toggle-subtitles':
      if (subtitlesOn.has(videoId)) subtitlesOn.delete(videoId);
      else subtitlesOn.add(videoId);
      await refreshSubtitles(tabId, videoId);
      return render();
    case 'edit-category':
      editingCategory = true;
      return drawMetaBar();
    case 'cancel-category':
      editingCategory = false;
      return drawMetaBar();
    case 'copy-transcript':
      return copy(transcriptToText(await loadVideo(tabId, videoId)), el);
    case 'download-transcript': {
      const video = await loadVideo(tabId, videoId);
      if (el.dataset.format === 'md') {
        return saveOrDownload(tabId, videoId, [], true, () => download(`transcription-${slugify(video.title)}.md`, transcriptToMarkdown(video), 'text/markdown'));
      }
      return download(`transcription-${slugify(video.title)}.txt`, transcriptToText(video), 'text/plain');
    }
  }
}

document.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-tab], [data-t], [data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.dataset.tab) {
    tab = el.dataset.tab as Tab;
    historyShownAutomatically = false;
    void render();
  } else if (el.dataset.t !== undefined) {
    void seekInTab(current.tabId, Number(el.dataset.t));
  } else {
    void handleAction(el);
  }
});

metaBar.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { tabId, videoId } = current;
  const input = (event.target as HTMLFormElement).elements.namedItem('category') as HTMLInputElement;
  if (!videoId || !input.value.trim()) return;
  try {
    const category = await changeCategory(await loadVideo(tabId, videoId), input.value);
    toast(`📁 Catégorie : ${category}`);
  } catch (e) {
    toast(`⚠️ ${(e as Error).message}`);
  }
  editingCategory = false;
  void drawMetaBar();
});

// Un mot sélectionné dans une réponse, la transcription ou le rapport peut être ajouté au lexique.
const selAdd = document.getElementById('sel-add') as HTMLButtonElement;
const SELECTABLE = '#content .msg .body, #content .line, #content .claim, #content .md-card, #content .term-body, #content blockquote';
let selected: { text: string; passage: string } | null = null;

function updateSelection(): void {
  const sel = window.getSelection();
  const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
  const node = sel?.anchorNode;
  const block = (node instanceof Element ? node : node?.parentElement)?.closest(SELECTABLE);
  if (!sel || sel.isCollapsed || text.length < 2 || text.length > 80 || !block || !content.contains(block)) {
    selAdd.hidden = true;
    selected = null;
    return;
  }
  const full = (block.textContent ?? '').replace(/\s+/g, ' ').trim();
  const at = Math.max(0, full.indexOf(text));
  selected = { text, passage: full.slice(Math.max(0, at - 200), at + text.length + 200) };
  selAdd.textContent = `📚 Ajouter « ${text.length > 24 ? `${text.slice(0, 24)}…` : text} » au lexique`;
  selAdd.hidden = false;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const below = rect.bottom + 8 + selAdd.offsetHeight < window.innerHeight;
  selAdd.style.top = `${below ? rect.bottom + 8 : Math.max(4, rect.top - selAdd.offsetHeight - 8)}px`;
  selAdd.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - selAdd.offsetWidth - 8))}px`;
}
let selectionTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(updateSelection, 40);
});
selAdd.addEventListener('mousedown', (event) => event.preventDefault());
selAdd.addEventListener('click', () => {
  if (!selected) return;
  const { text, passage } = selected;
  window.getSelection()?.removeAllRanges();
  selAdd.hidden = true;
  void lexicon.addFromSelection(text, passage);
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = questionInput.value;
  questionInput.value = '';
  if (tab === 'lexicon') void lexicon.submitTutor(question);
  else void sendChat(question);
});
questionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

/** Ouvre une vidéo de l'historique : dans l'onglet YouTube courant, sinon dans un nouvel onglet. */
async function openVideo(videoId: string): Promise<void> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = 'report';
  historyShownAutomatically = false;
  if (activeTab?.id !== undefined && activeTab.url?.startsWith('https://www.youtube.com/')) await chrome.tabs.update(activeTab.id, { url });
  else await chrome.tabs.create({ url });
}

/** Fenêtre de ce panneau : chaque fenêtre Chrome a son propre panneau latéral. */
const panelWindowId = chrome.windows.getCurrent().then((w) => w.id ?? -1);
/** Onglet du panneau (Rapport, Discussion…) affiché pour chaque onglet YouTube, retrouvé quand on y revient. */
const viewByTab = new Map<number, Tab>();
/** Question en cours de saisie, par vidéo. */
const drafts = new Map<string, string>();
let refreshSeq = 0;

async function refresh(): Promise<void> {
  // Plusieurs changements d'onglet rapprochés : seul le dernier compte.
  const seq = ++refreshSeq;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (seq !== refreshSeq) return;
  const videoId = activeTab?.url ? parseVideoId(activeTab.url) : null;
  const tabId = activeTab?.id ?? -1;
  if (tabId !== current.tabId) {
    if (current.tabId >= 0 && current.videoId) viewByTab.set(current.tabId, tab);
    const saved = viewByTab.get(tabId);
    if (saved && videoId) {
      tab = saved;
      historyShownAutomatically = false;
    }
  }
  if (videoId !== current.videoId) {
    editingCategory = false;
    if (videoId) void markVisited(videoId);
    // Une question en cours de saisie reste attachée à sa vidéo.
    drafts.set(current.videoId ?? '', questionInput.value);
    questionInput.value = drafts.get(videoId ?? '') ?? '';
  }
  // Sans vidéo, on montre l'historique ; dès qu'une vidéo s'ouvre, on revient à l'onglet où l'on était.
  if (!videoId && tab !== 'history' && tab !== 'lexicon') {
    tab = 'history';
    historyShownAutomatically = true;
  } else if (videoId && historyShownAutomatically) {
    tab = 'report';
    historyShownAutomatically = false;
  }
  current = { tabId, videoId, channelUrl: !videoId && activeTab?.url && parseChannelUrl(activeTab.url) ? activeTab.url : null };
  const { pendingAnalysis } = (await chrome.storage.session.get('pendingAnalysis')) as { pendingAnalysis?: { videoId: string; tabId?: number } };
  if (seq !== refreshSeq) return;
  if (current.videoId && pendingAnalysis?.videoId === current.videoId && (pendingAnalysis.tabId ?? tabId) === tabId) {
    await chrome.storage.session.remove('pendingAnalysis');
    tab = 'report';
    // Le bouton de la page affiche le score d'une vidéo déjà analysée : on ouvre alors son rapport sans relancer l'analyse.
    if (!(await getCachedReport(current.videoId))) void startAnalysis(current.tabId, current.videoId);
  }
  await render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'start-analysis') return;
  void (async () => {
    // Le message est diffusé à tous les panneaux : seul celui de la fenêtre de la vidéo s'en occupe.
    if (msg.windowId !== undefined && msg.windowId !== (await panelWindowId)) return;
    void chrome.storage.session.remove('pendingAnalysis');
    if (current.tabId >= 0 && current.tabId !== msg.tabId && current.videoId) viewByTab.set(current.tabId, tab);
    current = { tabId: msg.tabId, videoId: msg.videoId, channelUrl: null };
    tab = 'report';
    const report = await getCachedReport(msg.videoId);
    if (report) await render();
    else await startAnalysis(msg.tabId, msg.videoId);
  })();
});
chrome.tabs.onActivated.addListener(({ windowId }) => {
  void panelWindowId.then((id) => {
    if (windowId === id) void refresh();
  });
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === current.tabId && info.url) void refresh();
});
chrome.tabs.onRemoved.addListener((tabId) => viewByTab.delete(tabId));

void refresh();
