import type { Cue } from '../../../core/cues';

/**
 * Affiche (ou retire, avec `cues = null`) des sous-titres synchronisés sur le lecteur YouTube.
 * Le code est injecté directement : il fonctionne même si le content script n'est pas chargé.
 */
export async function showSubtitles(tabId: number, videoId: string, cues: Cue[] | null): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [videoId, cues],
    func: (id: string, list: Cue[] | null) => {
      type State = { stop: () => void };
      const w = window as unknown as { __veracitySubtitles?: State };
      w.__veracitySubtitles?.stop();
      w.__veracitySubtitles = undefined;
      if (!list) return;

      const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
      const player = document.querySelector<HTMLElement>('#movie_player') ?? video?.parentElement;
      if (!video || !player) return;
      // Bande pleine largeur centrée ; le fond suit chaque ligne de texte (comme les sous-titres YouTube).
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'absolute',
        left: '8%',
        right: '8%',
        bottom: '10%',
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: '60',
        display: 'none',
      });
      const line = document.createElement('span');
      Object.assign(line.style, {
        padding: '0.1em 0.45em',
        borderRadius: '4px',
        background: 'rgba(8, 8, 8, 0.78)',
        color: '#fff',
        fontFamily: 'Roboto, Arial, sans-serif',
        fontWeight: '500',
        lineHeight: '1.45',
        boxDecorationBreak: 'clone',
        webkitBoxDecorationBreak: 'clone',
      });
      box.appendChild(line);
      player.appendChild(box);
      // Masque les sous-titres natifs de YouTube pour éviter la superposition.
      const hideNative = document.createElement('style');
      hideNative.textContent = '#movie_player .ytp-caption-window-container { display: none !important; }';
      document.head.appendChild(hideNative);

      // Recherche dichotomique du sous-titre affiché à l'instant t (cues triés).
      const at = (t: number) => {
        let lo = 0;
        let hi = list.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (list[mid].start <= t) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return found >= 0 && t < list[found].end ? list[found].text : '';
      };
      let shown = '';
      const timer = window.setInterval(() => {
        // YouTube est une application monopage : on s'arrête si l'utilisateur change de vidéo.
        if (!location.href.includes(id)) return w.__veracitySubtitles?.stop();
        // Taille proportionnelle au lecteur (reste lisible en plein écran comme en mode réduit).
        line.style.fontSize = `${Math.max(14, Math.round(player.clientHeight * 0.042))}px`;
        // Pendant une publicité, le temps de la vidéo n'est pas celui du contenu.
        const inAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
        const text = inAd ? '' : at(video.currentTime);
        if (text === shown) return;
        shown = text;
        line.textContent = text;
        box.style.display = text ? 'block' : 'none';
      }, 150);
      w.__veracitySubtitles = {
        stop: () => {
          window.clearInterval(timer);
          box.remove();
          hideNative.remove();
          w.__veracitySubtitles = undefined;
        },
      };
    },
  });
}
