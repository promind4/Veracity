import { analyzeVideo } from '../../../core/pipeline';
import { type VideoInput } from '../../../core/types';
import { loadConfig } from '../shared/storage';

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
  root.append(button, status, output);
  button.addEventListener('click', async () => {
    button.disabled = true;
    output.replaceChildren();
    try {
      status.textContent = 'Lecture de la publication…';
      const post = await readXPost(tabId, id);
      if (!post.text && !post.cues.length) throw new Error('Aucun texte ni sous-titre accessible. La vidéo ne peut pas encore être transcrite automatiquement.');
      const video: VideoInput = { platform: 'x', videoId: `x-${id}`, title: 'Publication X', author: post.author, description: post.text, durationS: post.duration, publishedAt: post.publishedAt, language: post.lang, segments: post.cues };
      status.textContent = 'Recherche et vérification des affirmations…';
      const report = await analyzeVideo(video, await loadConfig(), (step, detail) => { status.textContent = `Analyse : ${step}${detail ? ` ${detail}` : ''}`; });
      status.textContent = '';
      output.append(node('h2', 'Portée de l’analyse'), node('p', post.hasVideo ? post.cues.length ? 'Texte de la publication et sous-titres accessibles analysés. Les images et les autres sons de la vidéo ne sont pas vérifiés.' : 'Seul le texte de la publication a été analysé. La vidéo et son audio n’ont pas été analysés.' : 'Texte de la publication analysé.'));
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
