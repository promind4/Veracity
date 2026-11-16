import type { ChatTurn } from '../../../core/chat';
import {
  buildTutorMessages,
  defineTerm,
  dueTerms,
  extractTerms,
  filterTerms,
  type Lexicon,
  lexiconDomains,
  lexiconToMarkdown,
  type LexiconFilter,
  mergeTerms,
  type LexiconTerm,
  reviewTerm,
  setDomain,
  setStatus,
  termKey,
  tutorAnswer,
  TUTOR_PROMPTS,
} from '../../../core/lexicon';
import { generateQuizzes } from '../../../core/quiz';
import type { VideoInput } from '../../../core/types';
import { getKbRoot, kbAccess } from '../shared/kb';
import { deleteTutorChat, getCachedVideo, getLexicon, getTutorChat, loadConfig, saveLexicon, saveTutorChat } from '../shared/storage';
import { backupLexicon } from './knowledge';
import {
  type ExtractState,
  type LexiconMode,
  type ReviewStyle,
  renderLibrary,
  renderReview,
  renderTermList,
  renderTutor,
  type Scope,
  tutorStreamingHtml,
  backupHtml,
  type BackupState,
} from './lexiconView';

export interface LexiconContext {
  content: HTMLElement;
  current(): { tabId: number; videoId: string | null };
  isVisible(): boolean;
  toast(message: string): void;
  rerender(): Promise<void>;
  loadVideo(tabId: number, videoId: string): Promise<VideoInput>;
}

interface Review {
  ids: string[];
  index: number;
  revealed: boolean;
  correct: number;
  picked: number | null;
  preparing: boolean;
}

const now = () => new Date().toISOString();

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Onglet Lexique : bibliothèque de termes, révision par cartes et tuteur par terme. */
export function createLexicon(ctx: LexiconContext) {
  let mode: LexiconMode = 'library';
  let filter: LexiconFilter = { status: 'todo' };
  let scope: Scope = 'all';
  let tutorId: string | null = null;
  let review: Review | null = null;
  let reviewStyle: ReviewStyle = 'cards';
  let adding = false;
  const extracting = new Map<string, ExtractState>();
  const tutorStreaming = new Map<string, string>();

  let backupTimer: ReturnType<typeof setTimeout> | undefined;
  let backupState: BackupState = 'ok';
  let backupAt = '';

  const visible = () => ctx.isVisible();
  const redraw = () => (visible() ? ctx.rerender() : Promise.resolve());

  /** Écrit la sauvegarde dans la base ; `interactive` (clic de l'utilisateur) peut redemander l'autorisation du dossier. */
  async function runBackup(interactive: boolean): Promise<'saved' | 'none' | 'denied'> {
    let result: 'saved' | 'none' | 'denied' = 'denied';
    try {
      result = await backupLexicon(await getLexicon(), interactive);
    } catch (e) {
      ctx.toast(`⚠️ Sauvegarde du lexique impossible : ${(e as Error).message}`);
    }
    backupState = result === 'saved' ? 'ok' : result === 'none' ? 'none' : 'locked';
    if (result === 'saved') backupAt = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    paintBackup();
    return result;
  }

  /** Sauvegarde automatique, groupée : plusieurs modifications rapprochées ne donnent qu'une écriture. */
  function scheduleBackup(): void {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => void runBackup(false), 1500);
  }

  const persist = async (lexicon: Lexicon) => {
    await saveLexicon(lexicon);
    scheduleBackup();
  };

  function paintBackup(): void {
    const el = document.getElementById('lex-backup');
    if (el) el.innerHTML = backupHtml(backupState, backupAt);
  }

  async function extract(): Promise<void> {
    const { tabId, videoId } = ctx.current();
    if (!videoId || extracting.get(videoId)?.status === 'running') return;
    const set = (state: ExtractState | null) => {
      if (state) extracting.set(videoId, state);
      else extracting.delete(videoId);
      void redraw();
    };
    set({ status: 'running', detail: '' });
    try {
      const [config, video, lexicon] = await Promise.all([loadConfig(), ctx.loadVideo(tabId, videoId), getLexicon()]);
      const { terms } = await extractTerms(video, lexicon, config.userProfile, config);
      const merged = mergeTerms(await getLexicon(), terms, video, now());
      await persist(merged.lexicon);
      if (merged.added || merged.linked) {
        scope = 'video';
        filter = { ...filter, status: 'todo', query: undefined };
      }
      ctx.toast(
        merged.added || merged.linked
          ? `📚 ${merged.added} nouveau(x) terme(s)${merged.linked ? `, ${merged.linked} déjà dans ta bibliothèque rattaché(s) à cette vidéo` : ''}`
          : terms.length
            ? 'Tous les termes repérés sont déjà dans ta bibliothèque.'
            : 'Aucun terme à expliquer n’a été repéré.',
      );
      set(null);
    } catch (e) {
      set({ status: 'error', detail: (e as Error).message });
    }
  }

  /**
   * Ajoute un terme saisi ou sélectionné. `fromPassage` : le terme vient d'un texte de la vidéo ouverte (discussion,
   * transcription…) ; ce passage précise le sens et la vidéo est rattachée au terme.
   */
  async function addTerm(raw: string, fromPassage?: string): Promise<void> {
    const name = raw.trim().slice(0, 80);
    if (!name || adding) return;
    const { tabId, videoId } = ctx.current();
    const lexicon = await getLexicon();
    const existing = lexicon[termKey(name)];
    const linkable = fromPassage !== undefined && videoId !== null;
    if (existing) {
      if (linkable) {
        const video = await ctx.loadVideo(tabId, videoId).catch(() => null);
        if (video) {
          const base = { term: existing.term, full: '', definition: existing.definition, example: '', domain: existing.domain, related: [], why: fromPassage.slice(0, 200), t: 0 };
          await persist(mergeTerms(lexicon, [base], video, now()).lexicon);
        }
      }
      filter = { ...filter, query: existing.term, status: undefined };
      scope = 'all';
      ctx.toast(`« ${existing.term} » est déjà dans ta bibliothèque.`);
      return void redraw();
    }
    adding = true;
    void redraw();
    try {
      const config = await loadConfig();
      const video = videoId ? await ctx.loadVideo(tabId, videoId).catch(() => null) : null;
      const { term } = await defineTerm(name, lexicon, config.userProfile, config, { video: video ?? undefined, context: fromPassage });
      const merged = mergeTerms(await getLexicon(), [term], linkable ? video : null, now());
      await persist(merged.lexicon);
      filter = { ...filter, query: term.term, status: undefined };
      scope = 'all';
      ctx.toast(`📚 « ${term.term} » ajouté au lexique`);
    } catch (e) {
      ctx.toast(`⚠️ ${(e as Error).message}`);
    } finally {
      adding = false;
      await redraw();
    }
  }

  async function startReview(): Promise<void> {
    const due = dueTerms(await getLexicon());
    review = { ids: due.map((t) => t.id), index: 0, revealed: false, correct: 0, picked: null, preparing: false };
    if (reviewStyle === 'quiz') void prepareQuiz(review, due.filter((t) => !t.quiz));
  }

  /** Une requête pour toutes les questions manquantes de la séance ; les termes sans question retombent sur les cartes. */
  async function prepareQuiz(session: Review, missing: LexiconTerm[]): Promise<void> {
    if (!missing.length) return;
    session.preparing = true;
    try {
      const config = await loadConfig();
      const quizzes = await generateQuizzes(missing, config.userProfile, config);
      const lexicon = await getLexicon();
      for (const [id, quiz] of Object.entries(quizzes)) if (lexicon[id]) lexicon[id] = { ...lexicon[id], quiz };
      await persist(lexicon);
    } catch (e) {
      ctx.toast(`⚠️ QCM indisponible (${(e as Error).message}) : révision par cartes.`);
    } finally {
      session.preparing = false;
      await redraw();
    }
  }

  async function answer(correct: boolean): Promise<void> {
    if (!review) return;
    const id = review.ids[review.index];
    if (!id) return;
    await persist(reviewTerm(await getLexicon(), id, correct, now()));
    if (correct) review.correct++;
    review.index++;
    review.revealed = false;
    review.picked = null;
    await redraw();
  }

  async function sendTutor(question: string): Promise<void> {
    const id = tutorId;
    const text = question.trim();
    if (!id || !text || tutorStreaming.has(id)) return;
    const lexicon = await getLexicon();
    const term = lexicon[id];
    if (!term) return;
    const turns = await getTutorChat(id);
    const history: ChatTurn[] = [...turns];
    turns.push({ role: 'user', content: text, at: now() });
    await saveTutorChat(id, turns);
    tutorStreaming.set(id, '');
    void redraw();
    try {
      const config = await loadConfig();
      const { text: reply, model } = await tutorAnswer(buildTutorMessages(term, lexicon, config.userProfile, history, text), config, (delta) => {
        const sofar = (tutorStreaming.get(id) ?? '') + delta;
        tutorStreaming.set(id, sofar);
        const bubble = visible() && tutorId === id ? document.querySelector('#lex-streaming .body') : null;
        if (bubble) {
          bubble.innerHTML = tutorStreamingHtml(sofar);
          ctx.content.scrollTop = ctx.content.scrollHeight;
        }
      });
      turns.push({ role: 'assistant', content: reply, at: now(), model });
    } catch (e) {
      turns.push({ role: 'assistant', content: `⚠️ ${(e as Error).message}`, at: now(), error: true });
    } finally {
      tutorStreaming.delete(id);
      await saveTutorChat(id, turns);
      scheduleBackup();
      void redraw();
    }
  }

  async function backupNow(): Promise<void> {
    const result = await runBackup(true);
    if (result === 'saved') return ctx.toast('💾 Lexique sauvegardé dans ta base de connaissances');
    const lexicon = await getLexicon();
    download('LEXIQUE.md', lexiconToMarkdown(lexicon, new Date().toISOString().slice(0, 10)));
    ctx.toast(result === 'none' ? 'Pas de dossier de base choisi : fichier téléchargé.' : 'Accès au dossier refusé : fichier téléchargé.');
  }

  async function renderTab(stale: () => boolean): Promise<void> {
    const lexicon = await getLexicon();
    if (stale()) return;
    const { videoId } = ctx.current();

    if (tutorId && lexicon[tutorId]) {
      const turns = await getTutorChat(tutorId);
      if (stale()) return;
      const busy = tutorStreaming.has(tutorId);
      renderTutor(ctx.content, { term: lexicon[tutorId], turns, streaming: tutorStreaming.get(tutorId), busy });
      ctx.content.scrollTop = ctx.content.scrollHeight;
      return;
    }
    tutorId = null;

    const all = Object.values(lexicon);
    const root = await getKbRoot();
    const access = await kbAccess(root);
    if (stale()) return;
    if (access === 'none') backupState = 'none';
    else if (access === 'prompt') backupState = 'locked';
    else if (backupState !== 'ok') backupState = 'ok';
    const videoTerms = videoId ? all.filter((t) => t.videos.some((v) => v.videoId === videoId)).length : 0;
    const title = videoId ? await currentTitle(videoId) : null;
    if (stale()) return;
    const domains = lexiconDomains(lexicon);
    // Un domaine vidé (dernier terme déplacé ou supprimé) ne doit pas rester comme filtre invisible.
    if (filter.domain && !domains.includes(filter.domain)) filter = { ...filter, domain: undefined };
    renderLibrary(ctx.content, {
      mode,
      reviewStyle,
      total: all.length,
      todo: all.filter((t) => t.status !== 'known').length,
      known: all.filter((t) => t.status === 'known').length,
      reviewable: dueTerms(lexicon).length,
      domains,
      filter,
      scope: videoId ? scope : 'all',
      video: videoId ? { videoId, title: title ?? '', terms: videoTerms, extract: extracting.get(videoId) } : null,
      backup: { state: backupState, at: backupAt, folder: root?.name },
      adding,
    });
    if (stale()) return;

    (document.getElementById('lex-add') as HTMLFormElement).addEventListener('submit', (event) => {
      event.preventDefault();
      const input = (event.target as HTMLFormElement).elements.namedItem('term') as HTMLInputElement;
      const value = input.value;
      input.value = '';
      void addTerm(value);
    });

    if (mode === 'review') {
      if (!review) await startReview();
      const r = review!;
      renderReview(document.getElementById('lex-review')!, {
        term: lexicon[r.ids[r.index]] ?? null,
        index: r.index,
        total: r.ids.length,
        revealed: r.revealed,
        correct: r.correct,
        style: reviewStyle,
        picked: r.picked,
        preparing: r.preparing,
      });
      return;
    }

    const list = document.getElementById('lex-list')!;
    // `scope` est relu à chaque dessin : le sélecteur « Cette vidéo / Toutes vidéos » le change sans redessiner l'onglet.
    const draw = () => {
      const onlyVideo = videoId !== null && scope === 'video';
      const terms = filterTerms(lexicon, { ...filter, videoId: onlyVideo ? videoId : undefined });
      const empty = !all.length
        ? 'Ta bibliothèque est vide : extrais le vocabulaire d’une vidéo ou ajoute un terme.'
        : onlyVideo && !videoTerms
          ? 'Aucun terme n’est encore lié à cette vidéo : extrais son vocabulaire ci-dessus.'
          : 'Aucun terme ne correspond à ces filtres.';
      renderTermList(list, terms, videoId, empty);
    };
    draw();
    (document.getElementById('lex-search') as HTMLInputElement).addEventListener('input', (event) => {
      filter = { ...filter, query: (event.target as HTMLInputElement).value };
      draw();
    });
    document.getElementById('lex-status')!.addEventListener('change', (event) => {
      filter = { ...filter, status: ((event.target as HTMLSelectElement).value || undefined) as LexiconFilter['status'] };
      draw();
    });
    document.getElementById('lex-domain')!.addEventListener('change', (event) => {
      filter = { ...filter, domain: (event.target as HTMLSelectElement).value || undefined };
      draw();
    });
    document.getElementById('lex-scope')?.addEventListener('change', (event) => {
      scope = (event.target as HTMLSelectElement).value as Scope;
      draw();
    });
  }

  const currentTitle = async (videoId: string) => (await getCachedVideo(videoId))?.title ?? null;

  /** Renvoie vrai si l'action appartient au Lexique. */
  async function handle(el: HTMLElement): Promise<boolean> {
    const action = el.dataset.action ?? '';
    if (!action.startsWith('lex-')) return false;
    const id = el.dataset.id ?? '';
    switch (action) {
      case 'lex-extract':
        void extract();
        break;
      case 'lex-mode':
        mode = el.dataset.mode as LexiconMode;
        review = null;
        await ctx.rerender();
        break;
      case 'lex-status': {
        const status = el.dataset.status as 'known' | 'learning';
        await persist(setStatus(await getLexicon(), id, status, now()));
        await ctx.rerender();
        break;
      }
      case 'lex-tutor':
        tutorId = id;
        await ctx.rerender();
        break;
      case 'lex-back':
        tutorId = null;
        await ctx.rerender();
        break;
      case 'lex-delete': {
        const term = (await getLexicon())[id];
        if (term && confirm(`Retirer « ${term.term} » de ta bibliothèque (définition et discussion comprises) ?`)) {
          const { [id]: _removed, ...rest } = await getLexicon();
          await persist(rest as Lexicon);
          await deleteTutorChat(id);
          await ctx.rerender();
        }
        break;
      }
      case 'lex-domain': {
        const lexicon = await getLexicon();
        const term = lexicon[id];
        if (!term) break;
        const others = lexiconDomains(lexicon).filter((d) => d !== term.domain);
        const answer = prompt(
          `Domaine de « ${term.term} » (actuellement : ${term.domain}).${others.length ? `\nDomaines existants : ${others.join(', ')}` : ''}`,
          term.domain,
        );
        if (answer?.trim() && answer.trim() !== term.domain) {
          const next = setDomain(lexicon, id, answer, now());
          await persist(next);
          ctx.toast(`🏷 « ${term.term} » rangé dans ${next[id].domain}`);
          await ctx.rerender();
        }
        break;
      }
      case 'lex-related': {
        const name = el.dataset.term ?? '';
        const known = (await getLexicon())[termKey(name)];
        if (known) {
          tutorId = known.id;
          await ctx.rerender();
        } else void addTerm(name);
        break;
      }
      case 'lex-style':
        reviewStyle = el.dataset.style as ReviewStyle;
        review = null;
        await ctx.rerender();
        break;
      case 'lex-pick':
        if (review && review.picked === null) review.picked = Number(el.dataset.index);
        await ctx.rerender();
        break;
      case 'lex-next': {
        const quiz = review ? (await getLexicon())[review.ids[review.index]]?.quiz : undefined;
        if (review && quiz && review.picked !== null) await answer(review.picked === quiz.answer);
        break;
      }
      case 'lex-reveal':
        if (review) review.revealed = true;
        await ctx.rerender();
        break;
      case 'lex-answer':
        await answer(el.dataset.ok === '1');
        break;
      case 'lex-quick':
        await sendTutor(TUTOR_PROMPTS[Number(el.dataset.index)].prompt);
        break;
      case 'lex-clear-tutor':
        if (confirm('Effacer cette discussion ?')) {
          await deleteTutorChat(id);
          scheduleBackup();
          await ctx.rerender();
        }
        break;
      case 'lex-backup':
        await backupNow();
        break;
    }
    return true;
  }

  return {
    renderTab,
    handle,
    submitTutor: sendTutor,
    /** Terme sélectionné dans un texte de la vidéo (hors de l'onglet Lexique). */
    addFromSelection: (term: string, passage: string) => addTerm(term, passage),
    /** Le champ de saisie du bas sert au tuteur quand une discussion est ouverte. */
    tutorActive: () => tutorId !== null,
  };
}
