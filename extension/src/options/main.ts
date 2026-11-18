import { geminiKeys } from '../../../core/gemini';
import { testKeys } from '../../../core/healthcheck';
import { GEMINI_TTS_MODELS, GEMINI_VOICES, geminiSpeak } from '../../../core/tts-gemini';
import { type Config, DEFAULT_MODELS } from '../../../core/types';
import { PIPER_VOICES, TTS_ENGINES, type TtsEngine } from '../../../core/voices';
import { getKbRoot, kbAccess, setKbRoot } from '../shared/kb';
import { loadConfig, saveConfig } from '../shared/storage';
import { PiperClient } from '../shared/tts/piper';

const KEY_FIELDS = ['openrouterKey', 'serperKey', 'jinaKey', 'factcheckKey', 'scraperapiKey', 'geminiKey', 'geminiKey2', 'openaiKey', 'anthropicKey'] as const;
type KeyField = (typeof KEY_FIELDS)[number];
const ENV_NAMES: Record<string, KeyField> = {
  OPENROUTER_API_KEY: 'openrouterKey',
  SERPER_API_KEY: 'serperKey',
  JINA_API_KEY: 'jinaKey',
  GOOGLE_FACTCHECK_API_KEY: 'factcheckKey',
  SCRAPERAPI_KEY: 'scraperapiKey',
  GEMINI_API_KEY: 'geminiKey',
  GEMINI_API_KEY_2: 'geminiKey2',
};

const form = document.querySelector('form')!;
const status = document.getElementById('status')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;

const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
const fillSelect = (name: string, options: [string, string][]) => {
  select(name).innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
};

fillSelect('ttsEngine', Object.entries(TTS_ENGINES));
fillSelect('geminiVoice', GEMINI_VOICES.map((v) => [v, v]));
fillSelect('geminiTtsModel', GEMINI_TTS_MODELS.map((m) => [m, m.replace(/^gemini-/, '')]));
fillSelect('piperVoice', PIPER_VOICES.fr.map((v) => [v.id, v.label]));
function fillBrowserVoices() {
  const voices = speechSynthesis.getVoices();
  const current = select('browserVoice').value;
  fillSelect('browserVoice', [['', 'Voix par défaut'], ...voices.map((v): [string, string] => [v.name, `${v.name} (${v.lang})`])]);
  select('browserVoice').value = current;
}
speechSynthesis.onvoiceschanged = fillBrowserVoices;
fillBrowserVoices();

const duck = field('duckVolume') as HTMLInputElement;
const showDuck = () => (document.getElementById('duckValue')!.textContent = `${duck.value} %`);
duck.addEventListener('input', showDuck);
// N'affiche que les réglages du moteur choisi.
const showEngine = () => {
  for (const el of document.querySelectorAll<HTMLElement>('[data-engine]')) el.hidden = el.dataset.engine !== select('ttsEngine').value;
};
select('ttsEngine').addEventListener('change', showEngine);

/** Champs du formulaire uniquement : fusionné avec la config existante (langue cible, etc.) à l'enregistrement. */
function readForm(): Config {
  const models = field('models').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const config: Config = {
    analysisProviderOrder: ({ 'gemini-first': ['gemini', 'openrouter', 'openai', 'anthropic'], 'openrouter-first': ['openrouter', 'gemini', 'openai', 'anthropic'], 'openai-first': ['openai', 'gemini', 'openrouter', 'anthropic'], 'anthropic-first': ['anthropic', 'gemini', 'openrouter', 'openai'] } as const)[select('analysisOrder').value as 'gemini-first' | 'openrouter-first' | 'openai-first' | 'anthropic-first'],
    openaiKey: field('openaiKey').value.trim() || undefined,
    anthropicKey: field('anthropicKey').value.trim() || undefined,
    openaiModel: field('openaiModel').value.trim() || undefined,
    anthropicModel: field('anthropicModel').value.trim() || undefined,
    searchProviderOrder: (['serper', 'jina', 'scraperapi'] as const).filter((id) => (field(`enable-${id}`) as HTMLInputElement).checked),
    recentSearchMode: select('recentSearchMode').value as 'parallel' | 'fallback',
    openrouterKey: field('openrouterKey').value.trim(),
    models: models.length ? models : DEFAULT_MODELS,
    geminiModels: field('geminiModels').value.split('\n').map((s) => s.trim()).filter(Boolean),
    autoSave: (field('autoSave') as HTMLInputElement).checked,
    ttsEngine: select('ttsEngine').value as TtsEngine,
    geminiVoice: select('geminiVoice').value,
    geminiTtsModel: select('geminiTtsModel').value,
    piperVoice: select('piperVoice').value,
    browserVoice: select('browserVoice').value || undefined,
    duckVolume: Number(duck.value) / 100,
    dubWait: (field('dubWait') as HTMLInputElement).checked,
    dubMultiVoice: (field('dubMultiVoice') as HTMLInputElement).checked,
    userProfile: field('userProfile').value.trim() || undefined,
  };
  // Une clé effacée doit le rester après fusion : on écrit explicitement `undefined`.
  for (const name of ['serperKey', 'jinaKey', 'factcheckKey', 'scraperapiKey', 'geminiKey', 'geminiKey2'] as const) config[name] = field(name).value.trim() || undefined;
  return config;
}

function fillForm(config: Config) {
  select('analysisOrder').value = `${config.analysisProviderOrder?.[0] ?? 'gemini'}-first`;
  field('openaiModel').value = config.openaiModel ?? '';
  field('anthropicModel').value = config.anthropicModel ?? '';
  select('recentSearchMode').value = config.recentSearchMode ?? 'parallel';
  for (const id of ['serper', 'jina', 'scraperapi'] as const) (field(`enable-${id}`) as HTMLInputElement).checked = (config.searchProviderOrder ?? ['serper', 'jina', 'scraperapi']).includes(id);
  for (const name of KEY_FIELDS) field(name).value = config[name] ?? '';
  field('models').value = config.models.join('\n');
  field('geminiModels').value = (config.geminiModels ?? []).join('\n');
  (field('autoSave') as HTMLInputElement).checked = config.autoSave !== false;
  select('ttsEngine').value = config.ttsEngine ?? 'gemini';
  select('geminiVoice').value = config.geminiVoice ?? 'Kore';
  select('geminiTtsModel').value = config.geminiTtsModel ?? GEMINI_TTS_MODELS[0];
  select('piperVoice').value = config.piperVoice ?? PIPER_VOICES.fr[0].id;
  select('browserVoice').value = config.browserVoice ?? '';
  duck.value = String(Math.round((config.duckVolume ?? 0.2) * 100));
  (field('dubWait') as HTMLInputElement).checked = config.dubWait !== false;
  (field('dubMultiVoice') as HTMLInputElement).checked = config.dubMultiVoice !== false;
  field('userProfile').value = config.userProfile ?? '';
  showDuck();
  showEngine();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveConfig({ ...(await loadConfig()), ...readForm() });
  status.textContent = 'Enregistré ✅';
});

const SAMPLE = "Bonjour ! Voici un exemple de doublage : la plupart des explications sur les agents IA sont soit trop techniques, soit trop basiques.";
const ttsStatus = document.getElementById('ttsStatus')!;
const piper = new PiperClient();
let sampleAudio: HTMLAudioElement | null = null;

document.getElementById('ttsSample')!.addEventListener('click', async () => {
  const c = readForm();
  sampleAudio?.pause();
  speechSynthesis.cancel();
  const t0 = performance.now();
  try {
    if (c.ttsEngine === 'browser') {
      const u = new SpeechSynthesisUtterance(SAMPLE);
      u.lang = 'fr-FR';
      const voice = speechSynthesis.getVoices().find((v) => v.name === c.browserVoice);
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
      ttsStatus.textContent = 'Lecture avec la voix du navigateur.';
      return;
    }
    ttsStatus.textContent = c.ttsEngine === 'gemini' ? 'Génération par Gemini…' : 'Génération par Piper…';
    const out =
      c.ttsEngine === 'gemini'
        ? await geminiSpeak(SAMPLE, {
            key: geminiKeys(c),
            voice: c.geminiVoice ?? 'Kore',
            lang: 'fr',
            models: [c.geminiTtsModel ?? GEMINI_TTS_MODELS[0]],
            attempts: 4,
          })
        : await piper.speak(SAMPLE, c.piperVoice ?? PIPER_VOICES.fr[0].id, (loaded, total) => {
            ttsStatus.textContent = `Téléchargement de la voix (une seule fois) : ${Math.round((100 * loaded) / (total || 1))} %`;
          });
    sampleAudio = new Audio(URL.createObjectURL(new Blob([out.wav], { type: 'audio/wav' })));
    void sampleAudio.play();
    ttsStatus.textContent = `Généré en ${((performance.now() - t0) / 1000).toFixed(1)} s pour ${out.durationS.toFixed(1)} s d'audio.`;
  } catch (e) {
    ttsStatus.textContent = `⚠️ ${(e as Error).message}`;
  }
});

document.getElementById('test')!.addEventListener('click', async () => {
  status.textContent = 'Test en cours…';
  const c = readForm();
  const results = await testKeys({ ...c,
    serperKey: c.searchProviderOrder?.includes('serper') ? c.serperKey : undefined,
    jinaKey: c.searchProviderOrder?.includes('jina') ? c.jinaKey : undefined,
    scraperapiKey: c.searchProviderOrder?.includes('scraperapi') ? c.scraperapiKey : undefined,
  });
  const list = document.getElementById('results')!;
  list.replaceChildren(
    ...Object.entries(results).map(([name, r]) => {
      const li = document.createElement('li');
      li.textContent = `${r.ok === null ? '➖' : r.ok ? '✅' : '❌'} ${name} : ${r.message}`;
      return li;
    }),
  );
  status.textContent = '';
});

const envFile = document.getElementById('envFile') as HTMLInputElement;
document.getElementById('import')!.addEventListener('click', () => envFile.click());
envFile.addEventListener('change', async () => {
  const file = envFile.files?.[0];
  if (!file) return;
  let imported = 0;
  for (const line of (await file.text()).split(/\r?\n/)) {
    const i = line.indexOf('=');
    const name = ENV_NAMES[line.slice(0, i).trim()];
    if (i > 0 && name) {
      field(name).value = line.slice(i + 1).trim();
      imported++;
    }
  }
  status.textContent = `${imported} clé(s) importée(s) : pense à enregistrer.`;
});

const kbStatus = document.getElementById('kbStatus')!;
async function showKbStatus() {
  const root = await getKbRoot();
  const access = await kbAccess(root);
  kbStatus.textContent = !root
    ? 'Aucun dossier choisi.'
    : access === 'granted'
      ? `📁 ${root.name} : accès autorisé ✅`
      : `📁 ${root.name} : accès à réautoriser (rechoisis le dossier ou autorise-le depuis le panneau).`;
}

document.getElementById('pickKb')!.addEventListener('click', async () => {
  try {
    const root = await window.showDirectoryPicker({ id: 'veracity-kb', mode: 'readwrite' });
    await setKbRoot(root);
    status.textContent = `Dossier « ${root.name} » enregistré.`;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') status.textContent = `Impossible d'utiliser ce dossier : ${(e as Error).message}`;
  }
  await showKbStatus();
});

void loadConfig().then(fillForm);
void showKbStatus();
