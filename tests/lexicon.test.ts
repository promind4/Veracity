import { describe, expect, it, vi } from 'vitest';
import {
  buildExtractPrompt,
  buildTutorSystemPrompt,
  canonicalDomain,
  dueTerms,
  extractTerms,
  filterTerms,
  type Lexicon,
  lexiconDomains,
  lexiconToMarkdown,
  mergeTerms,
  parseTerms,
  reviewTerm,
  setDomain,
  setStatus,
  termKey,
  tutorAnswer,
} from '../core/lexicon';
import type { VideoInput } from '../core/types';

const video: VideoInput = {
  videoId: 'abc12345678',
  title: 'Rust et domotique',
  author: 'Chaîne',
  description: '',
  durationS: 600,
  language: 'fr',
  segments: [{ start: 0, text: 'On parle de MQTT et de FFI en Rust.' }],
};
const item = (term: string, extra = {}) => ({ term, full: '', definition: `Définition de ${term}`, why: 'Cité dans la vidéo', example: '', domain: 'Domotique', related: [], t: 12, ...extra });
const NOW = '2026-10-13T10:00:00.000Z';

describe('termKey', () => {
  it('rapproche les variantes d’un même terme', () => {
    expect(termKey('MQTT')).toBe(termKey('le protocole MQTT'));
    expect(termKey('Zigbee')).toBe(termKey(' zigbee '));
    expect(termKey('Z-Wave')).toBe('zwave');
    expect(termKey('C++')).toBe('c++');
  });
});

describe('parseTerms', () => {
  it('ignore les entrées invalides et les doublons, complète les champs manquants', () => {
    const out = parseTerms([{ term: 'MQTT', definition: 'Un protocole.', t: '1:05' }, { term: 'mqtt', definition: 'doublon' }, { term: '', definition: 'x' }, 'n’importe quoi', { term: 'FFI' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ term: 'MQTT', definition: 'Un protocole.', t: 65, domain: '', related: [], example: '' });
  });
  it('plafonne à 15 termes', () => {
    expect(parseTerms(Array.from({ length: 30 }, (_, i) => ({ term: `t${i}`, definition: 'd' })))).toHaveLength(15);
  });
});

describe('mergeTerms', () => {
  it('réutilise un nom développé dans le même domaine et conserve les acquis', () => {
    const first = setStatus(mergeTerms({}, [item('LLM', { full: 'Large language model', domain: 'Intelligence artificielle' })], video, NOW).lexicon, 'llm', 'known', NOW);
    const result = mergeTerms(first, [item('Large language model', { domain: 'IA' })], { videoId: 'other', title: 'Autre' }, NOW);
    expect(result.added).toBe(0);
    expect(result.lexicon.llm.status).toBe('known');
    expect(result.lexicon.llm.videos).toHaveLength(2);
    expect(Object.keys(result.lexicon)).toHaveLength(1);
  });
  it('crée les termes, avec la vidéo et le statut « new »', () => {
    const { lexicon, added } = mergeTerms({}, [item('MQTT')], video, NOW);
    expect(added).toBe(1);
    expect(lexicon[termKey('MQTT')]).toMatchObject({ status: 'new', domain: 'Domotique', videos: [{ videoId: video.videoId, t: 12 }] });
  });
  it('rattache une nouvelle vidéo à un terme existant sans toucher à sa définition ni à son statut', () => {
    const first = setStatus(mergeTerms({}, [item('MQTT')], video, NOW).lexicon, termKey('MQTT'), 'learning', NOW);
    const other = { videoId: 'zzz12345678', title: 'Autre' };
    const { lexicon, added, linked } = mergeTerms(first, [item('le protocole MQTT', { definition: 'Autre définition' })], other, NOW);
    expect(added).toBe(0);
    expect(linked).toBe(1);
    const t = lexicon[termKey('MQTT')];
    expect(t.definition).toBe('Définition de MQTT');
    expect(t.status).toBe('learning');
    expect(t.videos.map((v) => v.videoId)).toEqual([video.videoId, other.videoId]);
  });
  it('ne rattache pas deux fois la même vidéo', () => {
    const first = mergeTerms({}, [item('MQTT')], video, NOW).lexicon;
    const again = mergeTerms(first, [item('MQTT')], video, NOW);
    expect(again.linked).toBe(0);
    expect(again.lexicon[termKey('MQTT')].videos).toHaveLength(1);
  });
  it('accepte un ajout manuel sans vidéo', () => {
    const { lexicon } = mergeTerms({}, [item('Thread')], null, NOW);
    expect(lexicon[termKey('Thread')].videos).toEqual([]);
  });
  it('range un nouveau terme dans le domaine existant écrit autrement', () => {
    const first = mergeTerms({}, [item('GAN', { domain: 'Intelligence Artificielle' })], video, NOW).lexicon;
    const { lexicon } = mergeTerms(first, [item('Token', { domain: ' intelligence  artificielle ' })], video, NOW);
    expect(lexicon[termKey('Token')].domain).toBe('Intelligence Artificielle');
    expect(lexiconDomains(lexicon)).toEqual(['Intelligence Artificielle']);
  });
});

describe('domaines', () => {
  const base = mergeTerms({}, [item('GAN', { domain: 'Intelligence artificielle' }), item('STEM', { domain: 'Informatique' })], video, NOW).lexicon;
  it('canonicalDomain reprend l’écriture existante, sinon garde la saisie', () => {
    expect(canonicalDomain(base, 'INTELLIGENCE ARTIFICIELLE')).toBe('Intelligence artificielle');
    expect(canonicalDomain(base, 'Éducation')).toBe('Éducation');
    expect(canonicalDomain(base, '  ')).toBe('');
  });
  it('setDomain déplace un terme, et ignore un domaine vide', () => {
    const moved = setDomain(base, termKey('STEM'), 'Éducation', NOW);
    expect(moved[termKey('STEM')].domain).toBe('Éducation');
    expect(setDomain(base, termKey('STEM'), ' ', NOW)).toBe(base);
  });
});

describe('révision espacée', () => {
  const base = (): Lexicon => mergeTerms({}, [item('MQTT'), item('Zigbee')], video, NOW).lexicon;
  const days = (iso: string | undefined) => Math.round((Date.parse(iso ?? '') - Date.parse(NOW)) / 86_400_000);
  it('chaque bonne réponse monte d’une boîte et espace la révision suivante', () => {
    const id = termKey('MQTT');
    let l = reviewTerm(base(), id, true, NOW);
    expect(l[id]).toMatchObject({ box: 1, status: 'learning', reviews: 1 });
    expect(days(l[id].due)).toBe(1);
    l = reviewTerm(l, id, true, NOW);
    expect(days(l[id].due)).toBe(3);
    l = reviewTerm(l, id, true, NOW);
    expect(l[id]).toMatchObject({ box: 3, status: 'known' });
    expect(days(l[id].due)).toBe(7);
  });
  it('une erreur ramène à la boîte 0 et le terme revient dans quelques minutes', () => {
    const id = termKey('MQTT');
    let l = reviewTerm(reviewTerm(reviewTerm(base(), id, true, NOW), id, true, NOW), id, true, NOW);
    l = reviewTerm(l, id, false, NOW);
    expect(l[id]).toMatchObject({ box: 0, status: 'learning' });
    expect(Date.parse(l[id].due!) - Date.parse(NOW)).toBe(10 * 60_000);
  });
  it('la dernière boîte est plafonnée à 30 jours', () => {
    const id = termKey('MQTT');
    let l = base();
    for (let i = 0; i < 8; i++) l = reviewTerm(l, id, true, NOW);
    expect(l[id].box).toBe(5);
    expect(days(l[id].due)).toBe(30);
  });
  it('propose les termes jamais vus ou arrivés à échéance, jamais ceux qui ne sont pas dus', () => {
    let l = reviewTerm(base(), termKey('MQTT'), true, NOW); // MQTT dû dans 1 jour
    expect(dueTerms(l, NOW).map((t) => t.term)).toEqual(['Zigbee']);
    const tomorrow = '2026-10-14T10:00:01.000Z';
    expect(dueTerms(l, tomorrow).map((t) => t.term).sort()).toEqual(['MQTT', 'Zigbee']);
    l = setStatus(l, termKey('Zigbee'), 'known', NOW);
    expect(dueTerms(l, NOW)).toEqual([]);
    expect(dueTerms(l, '2026-11-20T00:00:00.000Z')).toHaveLength(2);
  });
  it('« je connais » reprogramme une vérification dans 30 jours, « à réapprendre » remet à zéro', () => {
    const id = termKey('MQTT');
    let l = setStatus(base(), id, 'known', NOW);
    expect(l[id]).toMatchObject({ status: 'known', box: 5 });
    expect(days(l[id].due)).toBe(30);
    l = setStatus(l, id, 'learning', NOW);
    expect(l[id]).toMatchObject({ status: 'learning', box: 0, due: NOW });
  });
});

describe('filterTerms', () => {
  const l = setStatus(mergeTerms({}, [item('MQTT'), item('Rust', { domain: 'Programmation', definition: 'Un langage système.' })], video, NOW).lexicon, termKey('Rust'), 'known', NOW);
  it('filtre par statut, domaine, vidéo et recherche sans accents', () => {
    expect(filterTerms(l, { status: 'todo' }).map((t) => t.term)).toEqual(['MQTT']);
    expect(filterTerms(l, { status: 'known' }).map((t) => t.term)).toEqual(['Rust']);
    expect(filterTerms(l, { domain: 'Programmation' }).map((t) => t.term)).toEqual(['Rust']);
    expect(filterTerms(l, { videoId: 'inconnue' })).toEqual([]);
    expect(filterTerms(l, { query: 'langage systeme' }).map((t) => t.term)).toEqual(['Rust']);
  });
});

describe('prompts', () => {
  const lexicon = setStatus(mergeTerms({}, [item('Rust')], video, NOW).lexicon, termKey('Rust'), 'known', NOW);
  it('l’extraction transmet le profil, la transcription et les termes déjà connus', () => {
    const prompt = buildExtractPrompt(video, lexicon, 'Débutant en code, à l’aise en commerce');
    expect(prompt).toContain('Débutant en code');
    expect(prompt).toContain('MQTT et de FFI');
    expect(prompt).toMatch(/N'inclus PAS ces termes[^\n]*Rust/);
  });
  it('sans profil, suppose un débutant', () => {
    expect(buildExtractPrompt(video, {}, '  ')).toContain('non renseigné');
  });
  it('le tuteur reçoit la fiche du terme et ce que l’utilisateur connaît', () => {
    const term = mergeTerms({}, [item('MQTT', { example: 'Un capteur publie sa température.' })], video, NOW).lexicon[termKey('MQTT')];
    const prompt = buildTutorSystemPrompt(term, lexicon, 'Débutant');
    expect(prompt).toContain('Définition : Définition de MQTT');
    expect(prompt).toContain('Rust et domotique');
    expect(prompt).toContain("(appuie-toi dessus) : Rust");
  });
});

describe('extractTerms', () => {
  const gemini = (text: string) => vi.fn(async (_url: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 }));
  it('passe par Gemini et filtre les entrées invalides', async () => {
    const fetchFn = gemini(JSON.stringify({ terms: [item('MQTT'), { term: 'sans définition' }] }));
    const out = await extractTerms(video, {}, undefined, { geminiKey: 'k', openrouterKey: '', models: [] }, fetchFn as unknown as typeof fetch);
    expect(out.terms.map((t) => t.term)).toEqual(['MQTT']);
    expect(String(fetchFn.mock.calls[0][0])).toContain('generativelanguage');
  });
  it('sans aucune clé, explique quoi faire', async () => {
    await expect(extractTerms(video, {}, undefined, { openrouterKey: '', models: [] })).rejects.toThrow(/clé/i);
  });
});

describe('lexiconToMarkdown', () => {
  it('range par domaine et lie chaque vidéo à l’instant du terme', () => {
    const l = mergeTerms({}, [item('MQTT', { full: 'Message Queuing Telemetry Transport', example: 'Un capteur publie.' })], video, NOW).lexicon;
    const md = lexiconToMarkdown(l, '2026-10-13');
    expect(md).toContain('type: "lexique"');
    expect(md).toContain('## Domotique (1)');
    expect(md).toContain('### MQTT — Message Queuing Telemetry Transport 📖');
    expect(md).toContain(`[Rust et domotique](https://www.youtube.com/watch?v=${video.videoId}&t=12s) à 0:12`);
  });
});

describe('tutorAnswer', () => {
  const messages = [
    { role: 'system' as const, content: 'Consignes' },
    { role: 'user' as const, content: 'C’est quoi MQTT ?' },
  ];
  it('répond par Gemini, d’un bloc, avec les consignes et la question', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Un protocole.' }] } }] }), { status: 200 }));
    const deltas: string[] = [];
    const out = await tutorAnswer(messages, { geminiKey: 'k', openrouterKey: '', models: [] }, (d) => deltas.push(d), fetchFn as unknown as typeof fetch);
    expect(out.text).toBe('Un protocole.');
    expect(deltas).toEqual(['Un protocole.']);
    const sent = JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).contents[0].parts[0].text as string;
    expect(sent).toContain('Consignes\n\nUtilisateur : C’est quoi MQTT ?\n\nAssistant :');
  });
  it('sans aucune clé, explique quoi faire', async () => {
    await expect(tutorAnswer(messages, { openrouterKey: '', models: [] }, () => {})).rejects.toThrow(/clé/i);
  });
});
