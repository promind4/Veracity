import { analyzeVideo } from '../../../core/pipeline';
import { type VideoInput } from '../../../core/types';
import { loadConfig } from '../shared/storage';
import { startAudioCapture, transcribeXAudio, type AudioCapture } from './x-audio';

type XPost = { id: string; text: string; author: string; lang: string; publishedAt?: string; hasVideo: boolean; duration: number; cues: { start: number; text: string }[] };

/** Lit uniquement la publication ouverte et ses pistes de sous-titres accessibles au navigateur. */
export async function readXPost(tabId: number, id: string): Promise<XPost> {
  const [out] = await chrome.scripting.executeScript({ target: { tabId }, args: [id], func: async (expectedId: string) => {
    if (!/^(x\.com|twitter\.com)$/.test(location.hostname) || !/^\d+$/.test(expectedId)) throw new Error('Publication X non valide.');
    const articles = Array.from(document.querySelectorAll('article'));
    const article = articles.find((a) => Array.from(a.querySelectorAll('a[href]')).some((link) => {
      const href = link.getAttribute('href') ?? '';
      return link.closest('article') === a && new RegExp(`/status/${expectedId}(?:[/?#]|$)`).test(href) && !!link.querySelector('time');
    }));
    if (!article) throw new Error('Publication non visible. Reviens � cette publication dans le fil puis r�essaie.');
    const textElement = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).find((el) => el.closest('article') === article);
    const text = (textElement as HTMLElement | undefined)?.innerText?.trim() ?? '';
    const author = article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() ?? '';
    const time = article.querySelector('time')?.getAttribute('datetime') ?? undefined;
    const video = Array.from(article.querySelectorAll('video')).find((el) => el.closest('article') === article);
    const cues: { start: number; text: string }[] = [];
    const tracks = Array.from(video?.textTracks ?? []).filter((track) => track.kind === 'captions' || track.kind === 'subtitles');
    tracks.sort((a, b) => Number(b.mode === 'showing') - Number(a.mode === 'showing'));
    const deadline = Date.now() + 1500;
    for (const track of tracks) {
      const old = track.mode;
      try {
        if (old === 'disabled') track.mode = 'hidden';
        while (!track.cues?.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
        for (const cue of Array.from(track.cues ?? [])) {
          const value = (cue as VTTCue).text?.trim();
          if (value) cues.push({ start: cue.startTime, text: value });
        }
        if (cues.length) break;
      } catch { /* piste indisponible */ }
      finally { if (old === 'disabled') track.mode = old; }
    }
    return { id: expectedId, text, author, lang: textElement?.getAttribute('lang') ?? 'fr', publishedAt: time, hasVideo: !!video, duration: Number.isFinite(video?.duration) ? video!.duration : 0, cues };
  } });
  if (!out?.result) throw new Error('Impossible de lire la publication.');
  return out.result as XPost;
}

const node = (tag: string, text: string) => { const e = document.createElement(tag); e.textContent = text; return e; };

export function renderX(root: HTMLElement, tabId: number, id: string): void {
  root.replaceChildren(node('h1', 'V�rifier une publication X'), node('p', 'Veracity examine le texte de la publication et les sous-titres accessibles de sa vid�o.'));
  root.append(node('p', 'Prototype X : le rapport est disponible ici. Les onglets Discussion, Transcription et Lexique restent disponibles sur YouTube.'));
  const postLink = node('a', 'Ouvrir la publication s�lectionn�e') as HTMLAnchorElement;
  postLink.href = `https://x.com/i/status/${encodeURIComponent(id)}`;
  postLink.target = '_blank';
  postLink.rel = 'noopener noreferrer';
  root.append(postLink);
  const button = node('button', 'Analyser cette publication') as HTMLButtonElement;
  button.className = 'primary';
  const textOnly = node('button', 'Analyser uniquement le texte') as HTMLButtonElement;
  textOnly.hidden = true;
  const status = node('p', '');
  const output = document.createElement('div');
  const record = node('button', 'Enregistrer l'audio de la vid�o') as HTMLButtonElement;
  const stop = node('button', 'Arr�ter et transcrire') as HTMLButtonElement;
  stop.hidden = true;
  const audioStatus = node('p', 'Choisis l'onglet X et active � partager l'audio �, puis lance la vid�o depuis son d�but. Maximum : 3 minutes. Le son captur� sera envoy� � Gemini pour transcription.');
  let capture: AudioCapture | undefined;
  let audioTranscript: { language: string; segments: { start: number; text: string }[] } | undefined;
  let recordedSeconds = 0;
  let busy = false;
  root.append(button, textOnly, record, stop, audioStatus, status, output);
  record.addEventListener('click', async () => {
    try {
      // getDisplayMedia doit �tre lanc� imm�diatement apr�s le clic.
      const pending = startAudioCapture();
      record.disabled = true;
      button.disabled = true;
      textOnly.hidden = true;
      capture = await pending;
      if (!record.isConnected) { await capture.stop(); capture = undefined; return; }
      audioTranscript = undefined;
      recordedSeconds = 0;
      stop.hidden = false;
      audioStatus.textContent = 'Enregistrement en cours. Lance la vid�o, puis clique sur � Arr�ter et transcrire �. Le partage s'arr�te au bout de 3 minutes.';
    } catch (e) { record.disabled = false; button.disabled = false; audioStatus.textContent = (e as Error).message; }
  });
  const cleanup = new MutationObserver(() => {
    if (!record.isConnected) {
      cleanup.disconnect();
      if (capture) { void capture.stop().catch(() => {}); capture = undefined; }
    }
  });
  cleanup.observe(document.body, { childList: true, subtree: true });
  stop.addEventListener('click', async () => {
    if (!capture || busy) return;
    busy = true;
    stop.disabled = true;
    try {
      const recording = await capture.stop();
      capture = undefined;
      if (!record.isConnected) return;
      audioStatus.textContent = 'Transcription de l'audio par Gemini.';
      audioTranscript = await transcribeXAudio(recording.audio, recording.duration, await loadConfig());
      recordedSeconds = recording.duration;
      audioStatus.textContent = `${audioTranscript.segments.length} passages transcrits. Clique sur � Analyser cette publication �. V�rifie que la vid�o enti�re a bien �t� enregistr�e.`;
    } catch (e) { audioStatus.textContent = (e as Error).message; }
    finally { busy = false; stop.hidden = true; stop.disabled = false; record.disabled = false; button.disabled = false; }
  });
  async function analyze(allowTextOnly: boolean): Promise<void> {
    button.disabled = true;
    record.disabled = true;
    textOnly.hidden = true;
    output.replaceChildren();
    try {
      status.textContent = 'Lecture de la publication.';
      const post = await readXPost(tabId, id);
      const cues = allowTextOnly ? [] : audioTranscript?.segments ?? post.cues;
      if (post.hasVideo && !cues.length && !allowTextOnly) {
        status.textContent = 'Aucune transcription accessible. Enregistre l'audio ou choisis d'analyser uniquement le texte du tweet.';
        textOnly.hidden = !post.text;
        return;
      }
      if (!post.text && !cues.length) throw new Error('Aucun texte ni sous-titre accessible. Enregistre l'audio de la vid�o pour obtenir une transcription.');
      const video: VideoInput = { platform: 'x', videoId: `x-${id}`, title: 'Publication X', author: post.author, description: post.text, durationS: post.duration, publishedAt: post.publishedAt, language: (allowTextOnly ? undefined : audioTranscript?.language) ?? post.lang, segments: cues };
      status.textContent = 'Recherche et v�rification des affirmations.';
      const report = await analyzeVideo(video, await loadConfig(), (step, detail) => { status.textContent = `Analyse : ${step}${detail ? ` ${detail}` : ''}`; });
      status.textContent = '';
      output.append(node('h2', 'Port�e de l'analyse'), node('p', audioTranscript ? `Texte de la publication et transcription de ${Math.round(recordedSeconds)} secondes de son partag�. Les images ne sont pas analys�es ; la transcription peut contenir des erreurs.` : post.hasVideo ? post.cues.length ? 'Texte de la publication et sous-titres accessibles analys�s, �ventuellement partiels. Les images et les autres sons de la vid�o ne sont pas v�rifi�s.' : 'Seul le texte de la publication a �t� analys�. La vid�o et son audio n'ont pas �t� analys�s.' : 'Texte de la publication analys�.'));
      const sourceDetails = document.createElement('details');
      sourceDetails.append(node('summary', 'Voir le texte et la transcription utilis�s'), node('h3', 'Texte de la publication'), node('p', post.text || 'Aucun texte accessible.'), node('h3', 'Transcription disponible'), node('p', cues.length ? cues.map((cue) => `[${Math.floor(cue.start)} s] ${cue.text}`).join('\n') : 'Aucune transcription r�cup�r�e.'));
      sourceDetails.style.whiteSpace = 'pre-wrap';
      output.append(sourceDetails);
      if (post.text.length > 5000) output.append(node('p', 'Seuls les 5 000 premiers caract�res du texte ont �t� transmis � l'analyse.'));
      output.append(node('h2', report.scores.label), node('p', `Faits : ${report.scores.facts === null ? 'note indisponible' : `${report.scores.facts} %`} � Discours : ${report.scores.discourse} %`), node('p', report.summary));
      for (const claim of report.claims) {
        const verdict = report.verdicts.find((v) => v.claimId === claim.id);
        const card = document.createElement('article'); card.className = 'claim';
        card.append(node('strong', claim.claim), node('p', verdict ? `${verdict.verdict} - ${verdict.explanation}` : 'Opinion'));
        for (const evidenceId of verdict?.evidenceIds ?? []) {
          const evidence = report.evidence.find((e) => e.id === evidenceId);
          if (!evidence || !/^https?:\/\//i.test(evidence.url)) continue;
          const link = node('a', evidence.title || evidence.url) as HTMLAnchorElement; link.href = evidence.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link, document.createElement('br'));
        }
        output.append(card);
      }
      for (const warning of report.warnings) output.append(node('p', warning));
    } catch (e) { status.textContent = (e as Error).message; }
    finally { button.disabled = false; record.disabled = false; }
  }
  button.addEventListener('click', () => void analyze(false));
  textOnly.addEventListener('click', () => void analyze(true));
}
