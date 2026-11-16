// Résume out/compare/*.json : par moteur et par vidéo, score des faits (vérification sur preuves communes), affirmations, procédés, scores du discours, durées.
import { readFileSync, readdirSync } from 'node:fs';
const ids = ['Iun1QLA43xE', 'y0opgc1WoS4', 'Flrj38PSz8w', 'bvQ3deqSPnQ', 'qjk6DYHZyuc'];
const names = { Iun1QLA43xE: 'Science', y0opgc1WoS4: 'Kurzgesagt', Flrj38PSz8w: 'TerrePlate', bvQ3deqSPnQ: 'Formation', qjk6DYHZyuc: 'Crypto' };
const V = { vrai: 1, plutot_vrai: 0.8, exagere: 0.5, trompeur: 0.25, faux: 0 };
const P = { urgence: 10, rarete: 10, generalisation: 8, temoignage_inverifiable: 8, promesse_resultat: 15, autorite_douteuse: 8, conflit_interet: 15, certitude_abusive: 10, autre: 5 };
const engines = [...new Set(readdirSync('out/compare').filter((f) => f.endsWith('.json')).map((f) => f.split('.' + f.split('.').at(-2) + '.json')[0]))];
const facts = (claims, verdicts) => {
  const by = new Map(verdicts.map((v) => [v.claimId, v]));
  let w = 0, t = 0, n = 0;
  for (const c of claims) { if (c.type === 'opinion') continue; const v = by.get(c.id); if (!v || v.verdict === 'inverifiable') continue; n++; const sev = v.verdict === 'faux' || v.verdict === 'trompeur' ? 2 : 1; const k = c.importance * sev * Math.min(1, Math.max(0.1, v.confidence)); w += k * V[v.verdict]; t += k; }
  return n < 2 ? null : Math.round((100 * w) / t);
};
const discourse = (rh) => { const m = new Map(); for (const r of rh) m.set(r.technique, (m.get(r.technique) ?? 0) + 1); let tot = 0; for (const [k, n] of m) { const p = P[k] ?? 5; tot += Math.min(2 * p, p + ((n - 1) * p) / 2); } return Math.round(Math.max(0, 100 - tot)); };
console.log('moteur'.padEnd(26), ids.map((i) => names[i].padEnd(22)).join(''));
for (const e of engines) {
  const cells = ids.map((id) => {
    let d; try { d = JSON.parse(readFileSync(`out/compare/${e}.${id}.json`, 'utf8')); } catch { return '—'.padEnd(22); }
    const base = JSON.parse(readFileSync(`out/calib-v1/${id}.1.json`, 'utf8'));
    const f = d.verify ? facts(base.claims, d.verify) : null;
    const disc = d.extract ? discourse(d.extract.rhetoric) : null;
    const t = (d.verifyMs ? Math.round(d.verifyMs / 1000) : '?') + '/' + (d.extractMs ? Math.round(d.extractMs / 1000) : '?') + 's';
    return `F${f ?? '—'} D${disc ?? '—'} ${d.extract ? d.extract.claims.length : '—'}aff ${t}`.padEnd(22);
  });
  console.log(e.padEnd(26), cells.join(''));
}
console.log('\nF = score des faits (vérification sur preuves communes) · D = score du discours (extraction) · aff = affirmations extraites · temps vérification/extraction');
