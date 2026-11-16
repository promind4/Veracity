import { describe, expect, it } from 'vitest';
import { esc, renderMarkdown } from '../extension/src/sidepanel/markdown';

describe('renderMarkdown', () => {
  it('échappe le HTML', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
  it('rend titres, listes, gras et code', () => {
    expect(renderMarkdown('## Plan\n- **un**\n- `deux`\n\n1. trois\n2) quatre')).toBe(
      '<h4>Plan</h4><ul><li><strong>un</strong></li><li><code>deux</code></li></ul><ol><li>trois</li><li>quatre</li></ol>',
    );
  });
  it('transforme les horodatages en boutons, y compris les plages', () => {
    expect(renderMarkdown('Voir [1:05] et (1:02:03) puis [2:00–2:30].')).toBe(
      '<p>Voir <button class="ts" data-t="65">▶ 1:05</button> et <button class="ts" data-t="3723">▶ 1:02:03</button> puis <button class="ts" data-t="120">▶ 2:00–2:30</button>.</p>',
    );
  });
  it('accepte les doubles crochets', () => {
    expect(renderMarkdown('Étape [[0:42]][[1:46]]')).toBe('<p>Étape <button class="ts" data-t="42">▶ 0:42</button><button class="ts" data-t="106">▶ 1:46</button></p>');
  });
  it('n’interprète pas une heure sans crochets', () => {
    expect(renderMarkdown('à 10:30 du matin')).toBe('<p>à 10:30 du matin</p>');
  });
});

describe('esc', () => {
  it('échappe les guillemets', () => {
    expect(esc(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});

describe('renderMarkdown : contenus riches produits par les modèles', () => {
  it('transforme un tableau en fiches lisibles dans un panneau étroit', () => {
    const md = '| # | Étape | Outils | Horodatage |\n|---|---|---|---|\n| 1 | **Centraliser** | Google Sheets<br>une ligne par article | [4:17] |\n| 2 | Résumer | — | |';
    expect(renderMarkdown(md)).toBe(
      '<div class="md-card"><div class="md-card-title">1. <strong>Centraliser</strong></div>' +
        '<div class="md-field"><span class="md-label">Outils :</span> Google Sheets<br>une ligne par article</div>' +
        '<div class="md-field"><span class="md-label">Horodatage :</span> <button class="ts" data-t="257">▶ 4:17</button></div></div>' +
        '<div class="md-card"><div class="md-card-title">2. Résumer</div></div>',
    );
  });
  it('utilise la première colonne comme titre sans colonne de numéro', () => {
    expect(renderMarkdown('| Outil | Rôle |\n|---|---|\n| Make | Orchestration |')).toBe(
      '<div class="md-card"><div class="md-card-title">Make</div><div class="md-field"><span class="md-label">Rôle :</span> Orchestration</div></div>',
    );
  });
  it('rend séparateurs, citations et retours à la ligne <br>', () => {
    expect(renderMarkdown('Avant<br/>après\n\n---\n> **Résultat** : linéaire\n> Limite')).toBe(
      '<p>Avant<br>après</p><hr><blockquote><p><strong>Résultat</strong> : linéaire</p><p>Limite</p></blockquote>',
    );
  });
  it('imbrique les sous-listes et rattache les lignes de continuation', () => {
    expect(renderMarkdown('1. Étape\n   - outil A\n   - outil B\n   détail\n2. Suite')).toBe(
      '<ol><li>Étape<ul><li>outil A</li><li>outil B<br>détail</li></ul></li><li>Suite</li></ol>',
    );
  });
  it('poursuit la numérotation après une ligne vide', () => {
    expect(renderMarkdown('1. Un\n\n2. Deux')).toBe('<ol><li>Un</li></ol><ol start="2"><li>Deux</li></ol>');
  });
  it('reconnaît les plages avec tiret insécable', () => {
    expect(renderMarkdown('[4:17‑4:28]')).toBe('<p><button class="ts" data-t="257">▶ 4:17–4:28</button></p>');
  });
});
