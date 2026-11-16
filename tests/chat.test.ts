import { describe, expect, it } from 'vitest';
import { buildChatMessages, type ChatTurn, MAX_HISTORY_TURNS, QUICK_PROMPTS } from '../core/chat';
import type { Report, VideoInput } from '../core/types';

const video: VideoInput = {
  videoId: 'abc', title: 'Ma vidéo', author: 'Auteur', description: 'Desc', durationS: 3700, language: 'fr',
  segments: [{ start: 0, text: 'Bonjour' }, { start: 65, text: 'Étape un' }],
};
const report = {
  scores: { facts: 40, discourse: 30, coverage: 1, label: 'Peu fiable' },
  claims: [{ id: 'C1', type: 'fait', claim: 'La TVA est supprimée', quote: '', timestampS: 65, importance: 3, queries: [] }],
  verdicts: [{ claimId: 'C1', verdict: 'faux', confidence: 0.9, explanation: 'Exonération supprimée', correction: 'La TVA est due', evidenceIds: [] }],
  rhetoric: [{ timestampS: 70, technique: 'urgence', quote: 'ce soir', explanation: '' }],
} as unknown as Report;
const turn = (role: ChatTurn['role'], content: string, error = false): ChatTurn => ({ role, content, at: '', error });

describe('buildChatMessages', () => {
  it('donne la transcription horodatée, les métadonnées et les règles', () => {
    const [system, user] = buildChatMessages(video, null, [], 'Résume');
    expect(system.role).toBe('system');
    expect(system.content).toContain('[0:00] Bonjour');
    expect(system.content).toContain('[1:05] Étape un');
    expect(system.content).toContain('Durée : 1:01:40');
    expect(system.content).toContain('(hors vidéo)');
    expect(system.content).toContain("Aucun rapport de vérification");
    expect(user).toEqual({ role: 'user', content: 'Résume' });
  });
  it('ajoute un condensé du rapport', () => {
    const [system] = buildChatMessages(video, report, [], 'q');
    expect(system.content).toContain('Verdict global : Peu fiable (faits 40 %, discours 30 %)');
    expect(system.content).toContain('[1:05] La TVA est supprimée → faux : Exonération supprimée (correction : La TVA est due)');
    expect(system.content).toContain('[1:10] Urgence artificielle : « ce soir »');
  });
  it('limite l’historique et retire les erreurs', () => {
    const history = Array.from({ length: 30 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `m${i}`));
    history.push(turn('assistant', '⚠️ quota', true));
    const messages = buildChatMessages(video, null, history, 'q');
    expect(messages).toHaveLength(1 + MAX_HISTORY_TURNS + 1);
    expect(messages.at(-2)?.content).toBe('m29');
  });
  it('propose des questions prêtes', () => {
    expect(QUICK_PROMPTS.map((p) => p.label)).toContain('Étapes / process');
  });
});
