import {
  analyzeChannel,
  type ChannelReport,
  channelIdFromHtml,
  channelKey,
  channelToMarkdown,
  feedUrl,
  parseChannelUrl,
  parseFeed,
} from '../../../core/channel';
import { analyzeVideo } from '../../../core/pipeline';
import type { FetchFn, VideoInput } from '../../../core/types';
import { fetchVideo } from '../../../core/youtube';
import { makePageFetch } from '../shared/pageFetch';
import { deleteChannel, getCachedReport, getCachedVideo, getChannel, listChannels, loadConfig, saveReport, saveVideo, saveChannel } from '../shared/storage';
import { renderChannelDetail, renderChannels, type Running, SAMPLE_CHOICES } from './channelView';
import { backupChannel, grantedCategories, saveToKb } from './knowledge';

export interface ChannelsContext {
  content: HTMLElement;
  current(): { tabId: number; videoId: string | null; channelUrl: string | null };
  /** Vrai si l'onglet Historique est affiché en mode « Chaînes ». */
  isVisible(): boolean;
  toast(message: string): void;
  rerender(): Promise<void>;
}

/** Une vidéo plus courte est un « short » : pas assez de contenu à vérifier. */
const MIN_DURATION_S = 180;

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Analyse d'une chaîne entière : échantillon de vidéos notées une à une, puis verdict de chaîne. */
export function createChannels(ctx: ChannelsContext) {
  let sample = 5;
  let detailId: string | null = null;
  let error: string | null = null;
  const running = new Map<string, Running & { cancelled: boolean }>();
  let runningId: string | null = null;

  /** Identifiant de la chaîne visée : celle de la vidéo ouverte, ou celle de la page de chaîne. */
  async function resolveTarget(): Promise<{ channelId: string; label: string } | null> {
    const { tabId, videoId, channelUrl } = ctx.current();
    const page = makePageFetch(tabId);
    if (videoId) {
      const cached = await getCachedVideo(videoId);
      if (cached?.channelId) return { channelId: cached.channelId, label: cached.author };
      const fresh = await fetchVideo(videoId, page, 'fr');
      return fresh.channelId ? { channelId: fresh.channelId, label: fresh.author } : null;
    }
    const ref = channelUrl ? parseChannelUrl(channelUrl) : null;
    if (!ref) return null;
    if (ref.channelId) return { channelId: ref.channelId, label: 'cette chaîne' };
    // La page de la chaîne est déjà ouverte : on y lit l'identifiant (adresse canonique, métadonnées, lien « Vidéos »).
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        [
          document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
          document.querySelector('meta[itemprop="identifier"]')?.getAttribute('content'),
          document.querySelector('meta[itemprop="channelId"]')?.getAttribute('content'),
          document.querySelector('a[href^="/channel/UC"]')?.getAttribute('href'),
        ].join(' '),
    });
    const fromPage = String(injection?.result ?? '').match(/UC[\w-]{22}/)?.[0];
    const channelId = fromPage ?? channelIdFromHtml(await (await page(`https://www.youtube.com/${ref.handle}`)).text());
    return channelId ? { channelId, label: ref.handle ?? 'cette chaîne' } : null;
  }

  async function analyzeOne(tabId: number, videoId: string, page: FetchFn): Promise<VideoInput | { skip: string }> {
    const cached = await getCachedVideo(videoId);
    // Pas de transcription audio par Gemini ici : elle coûterait une requête du quota par vidéo.
    const video = cached ?? (await fetchVideo(videoId, page, 'fr').catch((e: Error & { code?: string }) => (e.code === 'no_captions' ? null : Promise.reject(e))));
    if (!video) return { skip: 'pas de sous-titres' };
    if (!cached) await saveVideo(video);
    if (video.durationS < MIN_DURATION_S) return { skip: 'vidéo trop courte' };
    return video;
  }

  async function run(channelId: string, label: string): Promise<void> {
    if (running.has(channelId)) return;
    const { tabId } = ctx.current();
    const page = makePageFetch(tabId);
    const state = { done: 0, total: sample, detail: '', cancelled: false };
    running.set(channelId, state);
    runningId = channelId;
    error = null;
    void ctx.rerender();
    try {
      const config = await loadConfig();
      const categories = await grantedCategories();
      const report = await analyzeChannel(channelId, sample, {
        fetchFeed: async (id) => parseFeed(await (await page(feedUrl(id))).text()),
        cachedReport: (videoId) => getCachedReport(videoId),
        analyze: async (entry) => {
          const video = await analyzeOne(tabId, entry.videoId, page);
          if ('skip' in video) return video;
          // Un seul passage de vérification : la note de chaîne moyenne plusieurs vidéos, et chaque requête compte dans le quota.
          const r = await analyzeVideo(video, config, () => {}, fetch, categories, { passes: 1 });
          await saveReport(r);
          void saveToKb(video, ['report'], false).catch(() => undefined);
          return r;
        },
        onProgress: (done, total, detail) => {
          Object.assign(state, { done, total, detail });
          void ctx.rerender();
        },
        isCancelled: () => state.cancelled,
      });
      if (!report.name) report.name = label;
      const previous = await getChannel(channelId);
      await saveChannel(report);
      const saved = await backupChannel(report, false).catch(() => 'denied' as const);
      detailId = channelId;
      ctx.toast(
        typeof saved === 'object'
          ? `📺 ${report.summary.label} — enregistré dans ${saved.path}`
          : `📺 ${report.summary.label}${previous ? ' (mis à jour)' : ''} — dossier de la base non accessible : analyse gardée dans l'extension`,
      );
    } catch (e) {
      error = (e as Error).message;
    } finally {
      running.delete(channelId);
      runningId = null;
      await ctx.rerender();
    }
  }

  async function renderTab(stale: () => boolean): Promise<void> {
    const channels = await listChannels();
    if (stale()) return;
    if (detailId) {
      const detail = channels.find((c) => c.channelId === detailId);
      if (detail) return renderChannelDetail(ctx.content, detail, ctx.current().videoId);
      detailId = null;
    }
    // La cible (chaîne de la vidéo ouverte) est résolue sans requête quand la vidéo est en cache.
    const { videoId, channelUrl } = ctx.current();
    let target: { label: string; known: boolean } | null = null;
    const cached = videoId ? await getCachedVideo(videoId) : null;
    if (cached) target = { label: cached.author, known: channels.some((c) => c.channelId === cached.channelId || channelKey(c.name) === channelKey(cached.author)) };
    else if (videoId || channelUrl) target = { label: videoId ? 'la chaîne de cette vidéo' : 'cette chaîne', known: false };
    if (stale()) return;
    const state = runningId ? running.get(runningId) : undefined;
    renderChannels(ctx.content, { target, sample, running: state ?? null, error, channels, kbConfigured: true });
    const select = document.getElementById('channel-sample') as HTMLSelectElement | null;
    select?.addEventListener('change', () => (sample = Number(select.value)));
  }

  /** Renvoie vrai si l'action appartient aux chaînes. */
  async function handle(el: HTMLElement): Promise<boolean> {
    const action = el.dataset.action ?? '';
    if (!action.startsWith('channel-')) return false;
    const id = el.dataset.id ?? '';
    switch (action) {
      case 'channel-analyze': {
        const select = document.getElementById('channel-sample') as HTMLSelectElement | null;
        if (select && SAMPLE_CHOICES.includes(Number(select.value))) sample = Number(select.value);
        try {
          const target = await resolveTarget();
          if (!target) ctx.toast('Chaîne introuvable : ouvre une vidéo ou la page de la chaîne.');
          else void run(target.channelId, target.label);
        } catch (e) {
          ctx.toast(`⚠️ ${(e as Error).message}`);
        }
        break;
      }
      case 'channel-refresh':
        void run(id, '');
        break;
      case 'channel-cancel':
        if (runningId) running.get(runningId)!.cancelled = true;
        break;
      case 'channel-open':
        detailId = id;
        await ctx.rerender();
        break;
      case 'channel-back':
        detailId = null;
        await ctx.rerender();
        break;
      case 'channel-delete': {
        const channel = await getChannel(id);
        if (channel && confirm(`Retirer l’analyse de « ${channel.name} » de l’extension ?\n(Le dossier de la base de connaissances est conservé.)`)) {
          await deleteChannel(id);
          await ctx.rerender();
        }
        break;
      }
      case 'channel-export': {
        const channel = await getChannel(id);
        if (!channel) break;
        const saved = await backupChannel(channel, true).catch(() => 'denied' as const);
        if (typeof saved === 'object') ctx.toast(`📺 Enregistré dans ${saved.path}`);
        else download(`chaine-${channel.name.replace(/[^\w-]+/g, '-')}.md`, channelToMarkdown(channel));
        break;
      }
    }
    return true;
  }

  return { renderTab, handle };
}

export type { ChannelReport };
