import { analyzeVideo } from '../../../core/pipeline';
import { type VideoInput } from '../../../core/types';
import { loadConfig } from '../shared/storage';
import { startAudioCapture, transcribeXAudio, type AudioCapture } from './x-audio';

type XPost = { id: string; text: string; author: string; lang: string; publishedAt?: string; hasVideo: boolean; duration: number; cues: { start: number; text: string }[] };

/** Lit uniquement la publication ouverte et ses pistes de sous-titres accessibles au navigateur. */
export async function readXPost(tabId: number, id: string): Promise<XPost> {
  const [out] = await chrome.scripting.executeScript({ target: { tabId }, args: [id], func: (expectedId: string) => {
    if (!/^(x\.com|twitter\.com)$/.test(location.hostname) || !/^\d+$/.test(expectedId)) throw new Error('Publication X non valide.');
    const articles = Array.from(document.querySelectorAll('article'));
    const article = articles.find((a) => Array.from(a.querySelectorAll('a[href]')).some((link) => {
      const href = link.getAttribute('href') ?? '';
      return link.closest('article') === a && new RegExp(`/status/${expectedId}(?:[/?#]|$)`).test(href) && !!link.querySelector('time');
    }));
    if (!article) throw new Error('Publication non visible. Reviens à cette publication dans le fil puis réessaie.');
    const textElement = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).find((el) => el.closest('article') === article);
    const text = (textElement as HTMLElement | undefined)?.innerText?.trim() ?? '';
    const author = article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() ?? '';
    const time = article.querySelector('time')?.getAttribute('datetime') ?? undefined;
    const video = Array.from(article.querySelectorAll('video')).find((el) => el.closest('article') === article);
    const cues: { start: number; text: string }[] = [];
    if (video) for (const track of Array.from(video.textTracks)) {
      try {
        const old = track.mode;
        if (old === 'disabled') track.mode = 'hidden';
        for (const cue of Array.from(track.cues ?? [])) {
          const value = (cue as VTTCue).text?.trim();
          if (value) cues.push({ start: cue.startTime, text: value });
        }
        if (old === 'disabled') track.mode = old;
        if (cues.length) break;
      } catch { /* piste indisponible */ }
    }
    return { id: expectedId, text, author, lang: textElement?.getAttribute('lang') ?? 'fr', publishedAt: time, hasVideo: !!video, duration: Number.isFinite(video?.duration) ? video!.duration : 0, cues };
  } });
  if (!out?.result) throw new Error('Impossible de lire la publication.');
  return out.result as XPost;
}

const node = (tag: string, text: string) => { const e = document.createElement(tag); e.textContent = text; return e; };

export function renderX(root: HTMLElement, tabId: number, id: string): void {
  root.replaceChildren(node('h1', 'Vérifier une publication X'), node('p', 'Veracity examine le texte de la publication et les sous-titres accessibles de sa vidéo.'));
  root.append(node('p', 'Prototype X : le rapport est disponible ici. Les onglets Discussion, Transcription et Lexique restent disponibles sur YouTube.'));
  const postLink = node('a', 'Ouvrir la publication sélectionnée') as HTMLAnchorElement;
  postLink.href = `https://x.com/i/status/${encodeURIComponent(id)}`;
  postLink.target = '_blank';
  postLink.rel = 'noopener noreferrer';
  root.append(postLink);
  const button = node('button', 'Analyser cette publication') as HTMLButtonElement;
  button.className = 'primary';
  const status = node('p', '');
  const output = document.createElement('div');
  const record = node('button', 'Enregistrer l’audio de la vidéo') as HTMLButtonElement;
  const stop = node('button', 'Arrêter et transcrire') as HTMLButtonElement;
  stop.hidden = true;
  const audioStatus = node('p', 'Choisis l’onglet X et active « partager l’audio », puis lance la vidéo depuis son début. Maximum : 3 minutes. Le son capturé sera envoyé à Gemini pour transcription.');
  let capture: AudioCapture | undefined;
  let audioTranscript: { language: string; segments: { start: number; text: string }[] } | undefined;
  let recordedSeconds = 0;
  let busy = false;
  root.append(button, record, stop, audioStatus, status, output);
  record.addEventListener('click', async () => {
    try {
      // getDisplayMedia doit être lancé immédiatement après le clic.
      const pending = startAudioCapture();
      record.disabled = true;
      button.disabled = true;
      capture = await pending;
      if (!record.isConnected) { await capture.stop(); capture = undefined; return; }
      stop.hidden = false;
      audioStatus.textContent = 'Enregistrement en cours. Lance la vidéo, puis clique sur « Arrêter et transcrire ». Le partage s’arrête au bout de 3 minutes.';
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
      audioStatus.textContent = 'Transcription de l’audio par Gemini…';
      audioTranscript = await transcribeXAudio(recording.audio, recording.duration, await loadConfig());
      recordedSeconds = recording.duration;
      audioStatus.textContent = `${audioTranscript.segments.length} passages transcrits. Clique sur « Analyser cette publication ». Vérifie que la vidéo entière a bien été enregistrée.`;
    } catch (e) { audioStatus.textContent = (e as Error).message; }
    finally { busy = false; stop.hidden = true; stop.disabled = false; record.disabled = false; button.disabled = false; }
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    output.replaceChildren();
    try {
      status.textContent = 'Lecture de la publication…';
      const post = await readXPost(tabId, id);
      const cues = audioTranscript?.segments ?? post.cues;
      if (!post.text && !cues.length) throw new Error('Aucun texte ni sous-titre accessible. Enregistre l’audio de la vidéo pour obtenir une transcription.');
      const video: VideoInput = { platform: 'x', videoId: `x-${id}`, title: 'Publication X', author: post.author, description: post.text, durationS: post.duration, publishedAt: post.publishedAt, language: audioTranscript?.language ?? post.lang, segments: cues };
      status.textContent = 'Recherche et vérification des affirmations…';
      const report = await analyzeVideo(video, await loadConfig(), (step, detail) => { status.textContent = `Analyse : ${step}${detail ? ` ${detail}` : ''}`; });
      status.textContent = '';
      output.append(node('h2', 'Portée de l’analyse'), node('p', audioTranscript ? `Texte de la publication et transcription de ${Math.round(recordedSeconds)} secondes de son partagé. Les images ne sont pas analysées ; la transcription peut contenir des erreurs.` : post.hasVideo ? post.cues.length ? 'Texte de la publication et sous-titres accessibles analysés, éventuellement partiels. Les images et les autres sons de la vidéo ne sont pas vérifiés.' : 'Seul le texte de la publication a été analysé. La vidéo et son audio n’ont pas été analysés.' : 'Texte de la publication analysé.'));
      const sourceDetails = document.createElement('details');
      sourceDetails.append(node('summary', 'Voir le texte et la transcription utilisés'), node('h3', 'Texte de la publication'), node('p', post.text || 'Aucun texte accessible.'), node('h3', 'Transcription disponible'), node('p', cues.length ? cues.map((cue) => `[${Math.floor(cue.start)} s] ${cue.text}`).join('\n') : 'Aucune transcription récupérée.'));
      sourceDetails.style.whiteSpace = 'pre-wrap';
      output.append(sourceDetails);
      if (post.text.length > 5000) output.append(node('p', 'Seuls les 5 000 premiers caractères du texte ont été transmis à l’analyse.'));
      output.append(node('h2', report.scores.label), node('p', `Faits : ${report.scores.facts === null ? 'note indisponible' : `${report.scores.facts} %`} · Discours : ${report.scores.discourse} %`), node('p', report.summary));
      for (const claim of report.claims) {
        const verdict = report.verdicts.find((v) => v.claimId === claim.id);
        const card = document.createElement('article'); card.className = 'claim';
        card.append(node('strong', claim.claim), node('p', verdict ? `${verdict.verdict} — ${verdict.explanation}` : 'Opinion'));
        for (const evidenceId of verdict?.evidenceIds ?? []) {
          const evidence = report.evidence.find((e) => e.id === evidenceId);
          if (!evidence || !/^https?:\/\//i.test(evidence.url)) continue;
          const link = node('a', evidence.title || evidence.url) as HTMLAnchorElement; link.href = evidence.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link, document.createElement('br'));
        }
        output.append(card);
      }
      for (const warning of report.warnings) output.append(node('p', warning));
    } catch (e) { status.textContent = (e as Error).message; }
    finally { button.disabled = false; }
  });
}
