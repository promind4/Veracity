import type { FetchFn } from '../../../core/types';

/**
 * Exécute fetch() dans l'onglet YouTube : YouTube refuse les requêtes venant de l'origine
 * chrome-extension://, et cela fonctionne même si le content script n'est pas encore injecté.
 */
export function makePageFetch(tabId: number): FetchFn {
  return async (input, init) => {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      // Chrome ne sérialise pas `undefined` dans args : tout passe par un objet avec des null.
      func: async (req: { url: string; method: string | null; headers: Record<string, string> | null; body: string | null }) => {
        const res = await fetch(req.url, {
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
          body: req.body,
          credentials: 'include',
        });
        return { status: res.status, body: await res.text() };
      },
      args: [
        {
          url: String(input),
          method: init?.method ?? null,
          headers: (init?.headers as Record<string, string> | undefined) ?? null,
          body: typeof init?.body === 'string' ? init.body : null,
        },
      ],
    });
    const result = injection?.result as { status: number; body: string } | undefined;
    if (!result) throw new Error("Impossible d'exécuter la requête dans l'onglet YouTube.");
    return new Response(result.body, { status: result.status });
  };
}

export async function seekInTab(tabId: number, t: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (seconds: number) => {
      const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
      if (!video) return;
      video.currentTime = seconds;
      void video.play();
    },
    args: [t],
  });
}
