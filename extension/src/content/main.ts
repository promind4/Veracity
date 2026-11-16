import { CHANNEL_INDEX_KEY, type ChannelIndex, type ChannelVerdict, channelKey } from '../../../core/channel';
import { buildScoreIndex, chipOf, SCORE_INDEX_KEY, type ScoreEntry, type ScoreIndex, type ScoreTone } from '../../../core/scoreIndex';
import { parseVideoId } from '../../../core/youtube';

const BUTTON_ID = 'veracity-check-button';
const CHIP_ATTR = 'data-veracity-chip';
const COLORS: Record<ScoreTone, string> = { ok: '#2b8a3e', warn: '#e67700', bad: '#c92a2a', na: '#868e96' };
// Les différentes générations de miniatures de YouTube (la page d'accueil, la recherche et les suggestions n'utilisent pas les mêmes).
const THUMBNAILS = 'ytd-thumbnail, yt-thumbnail-view-model, ytd-playlist-thumbnail';

let index: ScoreIndex = {};
let channelIndex: ChannelIndex = {};
const CHANNEL_COLORS: Record<ChannelVerdict, string> = { fiable: '#2b8a3e', orientee: '#e67700', mitigee: '#e67700', peu_fiable: '#c92a2a', commerciale: '#c92a2a', insuffisant: '#868e96' };
const CHANNEL_CHIP_ID = 'veracity-channel-chip';
const OWNER_LINKS = ['ytd-video-owner-renderer #channel-name a', '#owner #channel-name a', 'ytd-channel-name#channel-name a'];

async function loadIndex(): Promise<void> {
  const stored = await chrome.storage.local.get(SCORE_INDEX_KEY);
  if (stored[SCORE_INDEX_KEY]) {
    index = stored[SCORE_INDEX_KEY] as ScoreIndex;
    return;
  }
  // Première fois : on le construit à partir des rapports déjà enregistrés.
  index = buildScoreIndex(await chrome.storage.local.get(null));
  await chrome.storage.local.set({ [SCORE_INDEX_KEY]: index });
}

async function loadChannelIndex(): Promise<void> {
  channelIndex = ((await chrome.storage.local.get(CHANNEL_INDEX_KEY))[CHANNEL_INDEX_KEY] as ChannelIndex | undefined) ?? {};
}

/** Verdict de la chaîne (si elle a été analysée) juste sous le nom de l'auteur, sur la page de la vidéo. */
function injectChannelChip(): void {
  const existing = document.getElementById(CHANNEL_CHIP_ID);
  const name = OWNER_LINKS.map((s) => document.querySelector(s)?.textContent?.trim()).find(Boolean);
  const entry = name ? channelIndex[channelKey(name)] : undefined;
  if (!entry || !parseVideoId(location.href)) {
    existing?.remove();
    return;
  }
  const owner = document.querySelector('ytd-video-owner-renderer') ?? document.querySelector('#owner');
  if (!owner) return;
  const chip = existing ?? document.createElement('span');
  if (!existing) {
    chip.id = CHANNEL_CHIP_ID;
    Object.assign(chip.style, { display: 'inline-block', margin: '4px 0 0 12px', padding: '2px 8px', borderRadius: '10px', color: '#fff', font: '600 12px Roboto, Arial, sans-serif' });
    owner.appendChild(chip);
  }
  const text = `📺 ${entry.label}${entry.facts === null ? '' : ` · Faits ${entry.facts} %`} · Discours ${entry.discourse} %`;
  if (chip.textContent !== text) chip.textContent = text;
  chip.title = `Veracity — analyse de la chaîne sur ${entry.videos} vidéo(s)`;
  chip.style.background = CHANNEL_COLORS[entry.verdict];
}

function openPanel(): void {
  void chrome.runtime.sendMessage({ type: 'open-panel', videoId: parseVideoId(location.href) });
}

/** Bouton de la page de la vidéo : « Vérifier », ou les scores si la vidéo a déjà été analysée. */
function injectButton(): void {
  const videoId = parseVideoId(location.href);
  const existing = document.getElementById(BUTTON_ID);
  if (!videoId) {
    existing?.remove();
    return;
  }
  const entry: ScoreEntry | undefined = index[videoId];
  let button = existing as HTMLButtonElement | null;
  if (!button) {
    const anchor = document.querySelector('ytd-watch-metadata #title') ?? document.querySelector('#above-the-fold');
    if (!anchor) return;
    button = document.createElement('button');
    button.id = BUTTON_ID;
    Object.assign(button.style, { margin: '8px 0', padding: '8px 14px', borderRadius: '18px', font: '500 14px Roboto, Arial, sans-serif', cursor: 'pointer' });
    button.addEventListener('click', openPanel);
    anchor.appendChild(button);
  }
  const chip = entry ? chipOf(entry) : null;
  const label = entry && chip ? `🔎 Veracity · ${chip.text} · Discours ${entry.discourse} %` : '🔎 Vérifier la véracité';
  if (button.textContent !== label) button.textContent = label;
  button.title = chip?.title ?? 'Analyser cette vidéo avec Veracity';
  const color = chip ? COLORS[chip.tone] : '#3b5bdb';
  Object.assign(button.style, { background: color, color: '#fff', border: 'none' });
}

function paintChip(host: HTMLElement, entry: ScoreEntry): void {
  const info = chipOf(entry);
  let chip = host.querySelector<HTMLElement>(`[${CHIP_ATTR}]`);
  if (!chip) {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    chip = document.createElement('span');
    chip.setAttribute(CHIP_ATTR, '');
    Object.assign(chip.style, {
      position: 'absolute',
      top: '6px',
      left: '6px',
      zIndex: '5',
      padding: '2px 7px',
      borderRadius: '10px',
      color: '#fff',
      font: '600 12px Roboto, Arial, sans-serif',
      lineHeight: '16px',
      pointerEvents: 'none',
      boxShadow: '0 1px 3px rgba(0,0,0,.4)',
    });
    host.appendChild(chip);
  }
  if (chip.textContent !== info.text) chip.textContent = info.text;
  chip.title = info.title;
  chip.style.background = COLORS[info.tone];
}

/** Pose, sur chaque miniature d'une vidéo déjà analysée, son score ; retire ceux dont le rapport a disparu. */
function paintThumbnails(): void {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/watch?v="]')) {
    const host = (a.querySelector(THUMBNAILS) ?? a.closest(THUMBNAILS) ?? (a.querySelector('img') ? a : null)) as HTMLElement | null;
    if (!host) continue;
    // Les liens cachés ou minuscules (avatars, menus) ne sont pas des miniatures.
    const box = host.getBoundingClientRect();
    if (box.width < 100 || box.height < 50) continue;
    const id = parseVideoId(a.href);
    const entry = id ? index[id] : undefined;
    if (entry) paintChip(host, entry);
    else host.querySelector(`[${CHIP_ATTR}]`)?.remove();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function refresh(): void {
  injectButton();
  injectChannelChip();
  paintThumbnails();
}
const scheduleRefresh = () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, 400);
};

void Promise.all([loadIndex(), loadChannelIndex()]).then(() => {
  refresh();
  // YouTube charge les miniatures au fil du défilement : on repasse après chaque ajout au document.
  new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', refresh);
  setInterval(injectButton, 2000);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SCORE_INDEX_KEY]) index = (changes[SCORE_INDEX_KEY].newValue as ScoreIndex | undefined) ?? {};
  if (changes[CHANNEL_INDEX_KEY]) channelIndex = (changes[CHANNEL_INDEX_KEY].newValue as ChannelIndex | undefined) ?? {};
  if (changes[SCORE_INDEX_KEY] || changes[CHANNEL_INDEX_KEY]) refresh();
});
