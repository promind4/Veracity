import { describe, expect, it } from 'vitest';
import type { ChatTurn } from '../core/chat';
import { chatToMarkdown, reportToMarkdown, slugify, transcriptToMarkdown, transcriptToText, translationToMarkdown } from '../core/export';
import type { Report, VideoInput } from '../core/types';

const video: VideoInput = {
  videoId: 'abc', title: 'Ma vidéo', author: 'Auteur', description: '', durationS: 40, language: 'fr',
  segments: [{ start: 0, text: 'Bonjour' }, { start: 10, text: 'à tous' }, { start: 35, text: 'Suite' }],
};

describe('exports de transcription', () => {
  it('texte brut par blocs de 30 s', () => {
    expect(transcriptToText(video)).toBe('Ma vidéo\nAuteur · https://www.youtube.com/watch?v=abc\n\n[0:00] Bonjour à tous\n[0:35] Suite\n');
  });
  it('markdown avec liens horodatés', () => {
    expect(transcriptToMarkdown(video)).toContain('**[0:35](https://www.youtube.com/watch?v=abc&t=35s)** Suite');
  });
});

describe('reportToMarkdown', () => {
  it('liste verdicts, sources et procédés', () => {
    const report: Report = {
      version: 1, videoId: 'abc', title: 'Ma vidéo', author: 'Auteur', createdAt: '2026-10-12T10:00:00Z', models: ['m'],
      summary: 'Résumé.',
      claims: [
        { id: 'C1', type: 'fait', claim: 'Shopify fondé en 2006', quote: 'en 2006', timestampS: 48, importance: 2, queries: [] },
        { id: 'C2', type: 'opinion', claim: 'Shopify est le meilleur', quote: '', timestampS: 50, importance: 1, queries: [] },
      ],
      verdicts: [{ claimId: 'C1', verdict: 'vrai', confidence: 0.9, explanation: 'Confirmé.', evidenceIds: ['E1'] }],
      evidence: [{ id: 'E1', claimId: 'C1', url: 'https://fr.wikipedia.org/wiki/Shopify', title: 'Shopify', snippet: '', source: 'serper' }],
      rhetoric: [{ timestampS: 100, technique: 'urgence', quote: 'ce soir', explanation: 'Délai artificiel.' }],
      scores: { facts: 90, discourse: 90, coverage: 1, label: 'Fiable' },
      warnings: [],
    };
    const md = reportToMarkdown(report);
    expect(md).toContain('# Veracity — Ma vidéo');
    expect(md).toContain('**Fiable** · Faits : 90 % · Discours : 90 % · Couverture : 100 %');
    expect(md).toContain('### [0:48] Vrai — Shopify fondé en 2006');
    expect(md).toContain('- [Shopify](https://fr.wikipedia.org/wiki/Shopify) (fr.wikipedia.org)');
    expect(md).toContain('- **[1:40] Urgence artificielle** — « ce soir » : Délai artificiel.');
    expect(md).toContain('## Opinions (non vérifiées)\n\n- [0:50] Shopify est le meilleur');
  });
});

describe('chatToMarkdown', () => {
  it('garde questions et réponses, sans les erreurs', () => {
    const turns: ChatTurn[] = [
      { role: 'user', content: 'Q1', at: '' },
      { role: 'assistant', content: 'R1', at: '' },
      { role: 'assistant', content: '⚠️ erreur', at: '', error: true },
    ];
    expect(chatToMarkdown(video, turns)).toBe('# Discussion — Ma vidéo\n\nhttps://www.youtube.com/watch?v=abc\n\n## Question\n\nQ1\n\n## Réponse\n\nR1\n');
  });
});

describe('slugify', () => {
  it('produit un nom de fichier sûr', () => {
    expect(slugify('Comment Se Lancer en Dropshipping en 2025 (Étape par Étape) !')).toBe('comment-se-lancer-en-dropshipping-en-2025-etape-par-etape');
    expect(slugify('???')).toBe('video');
  });
});

describe('translationToMarkdown', () => {
  it('regroupe les sous-titres traduits par blocs de 30 s avec liens horodatés', () => {
    const tr = {
      lang: 'fr', model: 'm', missing: 0, createdAt: '',
      cues: [
        { start: 0, end: 2, text: 'Bonjour.', orig: 'Hello.' },
        { start: 10, end: 12, text: 'Suite.', orig: 'Next.' },
        { start: 35, end: 38, text: 'Fin.', orig: 'End.' },
      ],
    };
    expect(translationToMarkdown(video, tr)).toBe(
      '# Ma vidéo — traduction (français)\n\n*Auteur* · https://www.youtube.com/watch?v=abc\n\n**[0:00](https://www.youtube.com/watch?v=abc&t=0s)** Bonjour. Suite.\n\n**[0:35](https://www.youtube.com/watch?v=abc&t=35s)** Fin.\n',
    );
  });
});
