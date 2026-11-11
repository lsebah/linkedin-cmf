// Tests d'acceptation du moteur de règles (brief, section 5) et garde-fous sur les textes figés.
// Lancer : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const T = require('../src/texts.js');
const X = require('../src/exclusions.js');
const R = require('../src/rules.js');

const LUNDI = '2026-11-16';
const SAMEDI = '2026-11-14';

let n = 0;
const urn = () => 'ACoAAA' + String(++n).padStart(6, '0') + 'BxYzTestUrnFictif' + String(n).padStart(4, '0');
const moi = (date, version, salut = 'Paul', famille = 'dist') =>
  ({ de: 'moi', date, texte: T.rendre(version, { famille, salut, merci: false }) });
const libre = (date, texte) => ({ de: 'moi', date, texte });
const recu = (date, texte) => ({ de: 'contact', date, texte });
const fil = (u, messages) => ({ urn: u, lu: true, messages });
const cgp = (extra = {}) => Object.assign({ urn: urn(), nom: 'Paul Durand', famille: 'dist', categorie: 'cgp', org: 'Cabinet ' + n, statut: 'connecte', source: 'connexion' }, extra);
const planDe = (e) => R.construirePlan(Object.assign({ date: LUNDI, sendlog: [], suivi: [], collect: {} }, e));
const actionsDe = (p, u) => p.plan.filter((a) => a.urn === u);

test('1. samedi : seuls les anniversaires sortent', () => {
  const rel = cgp(), neuf = cgp({ connecteLe: '2026-11-12' }), anniv = cgp({ nom: 'Julie Martin' });
  const p = planDe({
    date: SAMEDI, suivi: [rel, neuf, anniv],
    collect: {
      birthdays: [{ urn: anniv.urn, nom: anniv.nom, date: SAMEDI }],
      threads: [fil(rel.urn, [moi('2026-11-02', 'A1')]), fil(neuf.urn, []), fil(anniv.urn, [])]
    }
  });
  assert.equal(p.weekend, true);
  assert.deepEqual(p.plan.map((a) => a.type), ['anniversaire']);
  assert.equal(p.plan[0].texte, 'Happy Birthday 🍾🍾🍾🍾');
});

test('2. A envoyé il y a 8 jours, sans réponse : B, version suivante dans la rotation', () => {
  const c = cgp(), autre = cgp({ envois: [{ date: '2026-11-13T09:00:00Z', type: 'B', version: 'B1' }] });
  const p = planDe({
    suivi: [c, autre],
    collect: { threads: [fil(c.urn, [moi('2026-11-08', 'A1')]), fil(autre.urn, [moi('2026-11-01', 'A2'), moi('2026-11-13', 'B1')])] }
  });
  const a = actionsDe(p, c.urn);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'relance1');
  assert.equal(a[0].compteur, 'rel');
  assert.equal(a[0].version, 'B2'); // B1 vient de partir : version suivante
  assert.ok(a[0].texte.startsWith('Bonjour Paul,\nJe reviens vers vous avec une proposition concrète'));
  assert.equal(actionsDe(p, autre.urn).length, 0); // B du 13/11 : E pas encore due
});

test('2 bis. A envoyé il y a 7 jours : rien (plus de 7 jours exigés)', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [moi('2026-11-09', 'A1')])] } });
  assert.equal(p.plan.length, 0);
});

test('3. A + B, B il y a 15 jours : E, jamais B', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [moi('2026-10-20', 'A1'), moi('2026-11-01', 'B1')])] } });
  const a = actionsDe(p, c.urn);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'relance2');
  assert.match(a[0].version, /^E[12]$/);
  assert.ok(a[0].texte.includes('Dernier message de ma part'));
});

test('4. A + B + E : aucun envoi, Closed-lost dormant', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [moi('2026-09-01', 'A1'), moi('2026-09-10', 'B1'), moi('2026-09-30', 'E1')])] } });
  assert.equal(p.plan.length, 0);
  assert.equal(p.clotures.length, 1);
  assert.equal(p.clotures[0].urn, c.urn);
  assert.equal(p.clotures[0].statut, 'Closed-lost');
});

test('5. dernier message de Laurent il y a 13 mois, sans réponse : B (cycle remis à zéro)', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [libre('2025-10-10', 'Bonjour Paul, je me permets de vous contacter au sujet de nos solutions.')])] } });
  const a = actionsDe(p, c.urn);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'relance1');
  assert.match(a[0].version, /^B[123]$/);
  assert.match(a[0].motif, /cycle remis à zéro/);
});

test('5 bis. après remise à zéro, B de plus de 14 jours : E', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [libre('2025-06-10', 'Bonjour Paul, ...'), moi('2026-10-30', 'B2')])] } });
  assert.equal(actionsDe(p, c.urn)[0].type, 'relance2');
});

test('6. refus il y a 2 ans : aucun envoi', () => {
  const c = cgp({ refus: { date: '2024-11-01', motif: 'pas intéressé' }, statut: 'refus' });
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [libre('2024-10-20', 'Bonjour Paul, ...'), recu('2024-11-01', 'Non merci.')])] } });
  assert.equal(p.plan.length, 0);
  assert.ok(p.ecartes.some((e) => e.urn === c.urn && e.motif === 'refus'));
});

test('7. le contact a écrit en dernier il y a 5 jours : à traiter, aucun envoi', () => {
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [moi('2026-11-02', 'A1'), recu('2026-11-11', 'Bonjour, pouvez-vous m\'en dire plus ?')])] } });
  assert.equal(p.plan.length, 0);
  assert.ok(p.aTraiter.some((e) => e.urn === c.urn));
});

test('7 bis. échange : Laurent a écrit en dernier, message ancien sans réponse : relance ; récent : attente', () => {
  const a = cgp(), b = cgp(), q = cgp({ statutFolk: 'Qualified' }), m = cgp();
  const echange = (dernier) => [moi('2026-09-01', 'A1'), recu('2026-09-03', 'Bonjour, envoyez-moi le Weekly.'), libre(dernier, 'Bonjour Paul, voici le Weekly.')];
  const p = planDe({ suivi: [a, b, q, Object.assign({}, m, { fil: [{ de: 'moi', date: '2026-09-01', version: 'A1' }, { de: 'contact', date: '2026-09-03' }, { de: 'moi', date: '2026-09-20', etape: '?' }] })],
    collect: { threads: [fil(a.urn, echange('2026-10-20')), fil(b.urn, echange('2026-11-12')), fil(q.urn, echange('2026-10-20'))] } });
  assert.equal(actionsDe(p, a.urn)[0].type, 'relance1');
  assert.match(actionsDe(p, a.urn)[0].motif, /échange resté sans réponse depuis le 2026-10-20/);
  assert.equal(actionsDe(p, b.urn).length, 0); // 4 jours : trop récent
  assert.equal(actionsDe(p, q.urn).length, 0); // Qualified dans Folk : jamais de relance automatique
  assert.ok(p.ecartes.some((e) => e.urn === q.urn));
  assert.equal(actionsDe(p, m.urn).length, 0); // fil seulement mémorisé : à relire d'abord
  assert.deepEqual(p.filsALire, [m.urn]);
});

test('8. anniversaire et relance due le même jour : anniversaire seul, relance reportée', () => {
  const c = cgp();
  const p = planDe({
    suivi: [c],
    collect: { birthdays: [{ urn: c.urn, nom: c.nom, date: LUNDI }], threads: [fil(c.urn, [moi('2026-11-02', 'A1')])] }
  });
  const a = actionsDe(p, c.urn);
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'anniversaire');
  assert.ok(p.reportes.some((e) => e.urn === c.urn));
});

test('9. Happy Birthday déjà envoyé cette année : rien', () => {
  const c = { urn: urn(), nom: 'Paul Durand' }; // simple relation, hors prospection
  const p = planDe({
    collect: { birthdays: [{ urn: c.urn, nom: c.nom, date: '2026-11-15' }], threads: [fil(c.urn, [libre('2026-11-15', 'Happy Birthday 🍾🍾🍾🍾')])] }
  });
  assert.equal(p.plan.length, 0);
});

test('9 bis. anniversaire : échange en cours (contact en dernier, moins de 3 mois) : signalé, pas d\'envoi', () => {
  const c = cgp();
  const p = planDe({
    suivi: [c],
    collect: { birthdays: [{ urn: c.urn, nom: c.nom, date: LUNDI }], threads: [fil(c.urn, [moi('2026-09-01', 'A1'), recu('2026-10-01', 'Merci, je reviens vers vous.')])] }
  });
  assert.equal(p.plan.length, 0);
  assert.ok(p.aTraiter.some((e) => e.urn === c.urn && /anniversaire/.test(e.motif)));
});

test('10. plafond des 8 premiers messages atteint : les suivants sont reportés', () => {
  const cs = Array.from({ length: 10 }, (_, i) => cgp({ nom: 'Paul Durand', connecteLe: '2026-10-' + String(10 + i) }));
  const p = planDe({ suivi: cs, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  assert.equal(p.plan.filter((a) => a.type === 'premier').length, 8);
  assert.equal(p.reportes.filter((r) => r.motif === 'plafond atteint').length, 2);
});

test('10 bis. budget glissant de 40 premiers messages sur 7 jours', () => {
  const cs = Array.from({ length: 5 }, () => cgp());
  const sendlog = [{ id: '2026-11-10', msg: 8 }, { id: '2026-11-11', msg: 8 }, { id: '2026-11-12', msg: 8 }, { id: '2026-11-13', msg: 8 }, { id: '2026-11-09', msg: 8 }, { id: '2026-11-15', msg: 0 }, { id: '2026-11-16', msg: 0 }];
  // Fenêtre du 10 au 16 : 32 envoyés (le 09/11 est sorti de la fenêtre) ; restent 8, dont 5 candidats.
  let p = planDe({ suivi: cs, sendlog, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  assert.equal(p.plan.length, 5);
  sendlog.push({ id: '2026-11-14', msg: 6 });
  p = planDe({ suivi: cs, sendlog, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  assert.equal(p.plan.length, 2); // 38 sur 40
});

test('11. deux contacts avec le même URN : erreur, aucun envoi', () => {
  const u = urn();
  const a = cgp({ urn: u, nom: 'Paul Durand', slug: 'paul-durand' }), b = cgp({ urn: u, nom: 'Anne Leroy', slug: 'anne-leroy' });
  const p = planDe({ suivi: [a, b], collect: { threads: [fil(u, [])], birthdays: [{ urn: u, nom: 'Paul Durand', date: LUNDI }] } });
  assert.equal(p.plan.length, 0);
  assert.equal(p.erreurs.length, 1);
  assert.equal(p.erreurs[0].urn, u);
});

test('11 bis. URN parasite de Laurent et URN partagé entre sources : erreur', () => {
  const parasite = 'ACoAAABb3LgBabcdefghijklmnopqrstuv';
  const u = urn();
  const p = planDe({
    collect: {
      connections: [{ urn: parasite, slug: 'jean-test', nom: 'Jean Test', headline: 'CGP' }, { urn: u, slug: 'a-b', nom: 'Alice Bon', headline: 'CGP' }],
      birthdays: [{ urn: u, slug: 'c-d', nom: 'Carl Dus', date: LUNDI }],
      threads: [fil(parasite, []), fil(u, [])]
    }
  });
  assert.equal(p.plan.length, 0);
  assert.equal(p.erreurs.length, 2);
});

test('12. institutionnel « Christine Dupont » : « Bonjour Madame Dupont, » ; nom abrégé « Paul D. » : « Bonjour Paul, »', () => {
  const a = cgp({ nom: 'Christine Dupont', famille: 'inst', categorie: 'mutuelle', org: 'Mutuelle A', connecteLe: '2026-11-10' });
  const b = cgp({ nom: 'Paul D.', famille: 'inst', categorie: 'fondation', org: 'Fondation B', connecteLe: '2026-11-11' });
  const p = planDe({ suivi: [a, b], collect: { threads: [fil(a.urn, []), fil(b.urn, [])] } });
  assert.ok(actionsDe(p, a.urn)[0].texte.startsWith('Bonjour Madame Dupont,\nMerci pour votre connexion.'));
  assert.ok(actionsDe(p, b.urn)[0].texte.startsWith('Bonjour Paul,\n'));
  assert.match(actionsDe(p, a.urn)[0].version, /^AI[123]$/);
});

test('12 bis. civilité incertaine (Dominique) : à traiter ; civilité fixée dans suivi : envoi', () => {
  const a = cgp({ nom: 'Dominique Morel', famille: 'inst', org: 'Mutuelle C' });
  const b = cgp({ nom: 'Dominique Morel', famille: 'inst', org: 'Mutuelle D', civilite: 'Monsieur' });
  const p = planDe({ suivi: [a, b], collect: { threads: [fil(a.urn, []), fil(b.urn, [])] } });
  assert.equal(actionsDe(p, a.urn).length, 0);
  assert.ok(p.aTraiter.some((e) => e.urn === a.urn && e.motif === 'civilité incertaine'));
  assert.ok(actionsDe(p, b.urn)[0].texte.startsWith('Bonjour Monsieur Morel,'));
});

test('13. connexion de 10 jours, distributeur : A commence par « Merci pour la connexion. »', () => {
  const a = cgp({ connecteLe: '2026-11-06' }), b = cgp({ connecteLe: '2026-10-20' });
  const p = planDe({ suivi: [a, b], collect: { threads: [fil(a.urn, []), fil(b.urn, [])] } });
  assert.ok(actionsDe(p, a.urn)[0].texte.split('\n')[1].startsWith('Merci pour la connexion. '));
  assert.ok(!actionsDe(p, b.urn)[0].texte.includes('Merci pour la connexion.'));
});

test('14. profil « ancien CGP », « retraité » ou « honoraire » : écarté', () => {
  const cs = ['Ancien CGP', 'Retraité, ex-banquier privé', 'Président honoraire, gestion de patrimoine'].map((h) => cgp({ poste: h }));
  const p = planDe({ suivi: cs, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  assert.equal(p.plan.length, 0);
  assert.equal(p.ecartes.filter((e) => e.motif === 'retraité').length, 3);
});

test('15. société présente 3 fois ou plus dans le lot : écartée (réseau)', () => {
  const cs = ['Anne Petit', 'Luc Roux', 'Marc Blanc'].map((nom) => cgp({ nom, org: 'Alpha Patrimoine SAS' }));
  const seul = cgp({ nom: 'Jean Noir', org: 'Beta Conseil' });
  const p = planDe({ suivi: cs.concat(seul), collect: { threads: cs.concat(seul).map((c) => fil(c.urn, [])) } });
  assert.deepEqual(p.plan.map((a) => a.urn), [seul.urn]);
  assert.equal(p.ecartes.filter((e) => /^réseau/.test(e.motif)).length, 3);
});

test('15 bis. libellés génériques (« Indépendant », « CGP », « MUT ») : jamais comptés comme réseau', () => {
  const cs = ['Anne Petit', 'Luc Roux', 'Marc Blanc', 'Jean Noir'].map((nom) => cgp({ nom, org: 'Indépendant' }));
  const p = planDe({ suivi: cs, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  assert.equal(p.plan.length, 4);
  assert.equal(X.cleSociete('CGP'), '');
  assert.equal(X.cleSociete('MUT'), '');
  assert.equal(X.cleSociete('Alpha Patrimoine SAS'), 'alpha');
});

test('schémas : le plan produit respecte les champs obligatoires de plan.schema.json', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'plan.schema.json'), 'utf8'));
  const c = cgp();
  const p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [])] } });
  for (const k of schema.required) assert.ok(k in p, k);
  for (const k of schema.properties.plan.items.required) assert.ok(k in p.plan[0], k);
  for (const f of ['suivi', 'collect']) JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', f + '.schema.json'), 'utf8'));
});

// ---------- Garde-fous complémentaires ----------

test('textes figés : empreinte SHA-256 de chaque texte', () => {
  const attendu = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'empreintes.json'), 'utf8'));
  const calcule = {};
  for (const v of Object.keys(T.TEXTES)) calcule[v] = crypto.createHash('sha256').update(T.TEXTES[v], 'utf8').digest('hex');
  assert.deepEqual(calcule, attendu);
  assert.equal(Object.keys(T.TEXTES).length, 14);
});

test('textes : aucun jeton restant, aucune promesse, pas de « finance structurée », pas de tiret cadratin', () => {
  for (const v of Object.keys(T.TEXTES)) {
    for (const famille of ['dist', 'inst']) {
      const t = T.rendre(v, { famille, salut: famille === 'inst' ? 'Madame Dupont' : 'Paul', merci: true });
      assert.ok(!/[\[\]]|Madame X|Monsieur X/.test(t), v);
      assert.ok(!/finance structurée/i.test(t), v);
      assert.ok(!/—/.test(t), v);
      assert.ok(!/\d+\s?%|rendement|garanti|performance/i.test(t), v);
    }
  }
  assert.ok(T.rendre('E2', { famille: 'inst', salut: 'Madame Dupont' }).includes('pour votre organisation'));
  assert.ok(T.rendre('E2', { famille: 'dist', salut: 'Paul' }).includes('pour vos clients'));
});

test('textes : identification d\'un texte figé dans un fil', () => {
  for (const v of Object.keys(T.TEXTES)) {
    const t = T.rendre(v, { famille: 'dist', salut: 'Paul', merci: true });
    assert.equal(T.identifier(t).version, v);
  }
  assert.equal(T.identifier('Bonjour, merci pour votre message.'), null);
});

test('rotation : version suivante, jamais deux consécutives identiques, jamais deux fois la même pour un contact', () => {
  assert.equal(T.versionSuivante('A', null, []).version, 'A1');
  assert.equal(T.versionSuivante('A', 'A3', []).version, 'A1');
  assert.equal(T.versionSuivante('B', 'B1', ['B2']).version, 'B3');
  assert.deepEqual(T.versionSuivante('E', 'E1', ['E2']), { version: null, motif: 'rotation' });
  assert.deepEqual(T.versionSuivante('E', 'E1', ['E1', 'E2']), { version: null, motif: 'epuise' });
  const cs = Array.from({ length: 6 }, () => cgp());
  const p = planDe({ suivi: cs, collect: { threads: cs.map((c) => fil(c.urn, [])) } });
  const versions = p.plan.map((a) => a.version);
  assert.deepEqual(versions, ['A1', 'A2', 'A3', 'A1', 'A2', 'A3']);
});

test('invitations : 8 distributeurs et 4 institutionnels au plus, arrêt si limite LinkedIn', () => {
  const dist = Array.from({ length: 10 }, (_, i) => ({ urn: urn(), slug: 'd-' + i, nom: 'Luc Martin', famille: 'dist', org: 'Cab D' + i, statut: 'a_inviter', source: 'sourcing', distance: 2 }));
  const inst = Array.from({ length: 6 }, (_, i) => ({ urn: urn(), slug: 'i-' + i, nom: 'Anne Roy', famille: 'inst', org: 'Mut I' + i, statut: 'a_inviter', source: 'sourcing', distance: 2 }));
  let p = planDe({ suivi: dist.concat(inst) });
  assert.equal(p.plan.filter((a) => a.type === 'invitation' && a.famille === 'dist').length, 8);
  assert.equal(p.plan.filter((a) => a.type === 'invitation' && a.famille === 'inst').length, 4);
  assert.ok(p.plan.every((a) => a.texte === null)); // sans note
  p = planDe({ suivi: dist.concat(inst), sendlog: [{ id: LUNDI, lim: true }] });
  assert.equal(p.plan.length, 0);
});

test('ordre du lot : anniversaires, relances, premiers messages, backlog, invitations', () => {
  const anniv = cgp(), rel = cgp(), prem = cgp(), bkl = cgp({ source: 'backlog' });
  const inv = { urn: urn(), slug: 'x-y', nom: 'Luc Martin', famille: 'dist', org: 'Cab Z', statut: 'a_inviter', source: 'sourcing', distance: 2 };
  const p = planDe({
    suivi: [inv, bkl, prem, rel, anniv], config: { rampeDebut: LUNDI },
    collect: { birthdays: [{ urn: anniv.urn, nom: anniv.nom, date: LUNDI }], threads: [fil(anniv.urn, []), fil(rel.urn, [moi('2026-11-02', 'A1')]), fil(prem.urn, []), fil(bkl.urn, [])] }
  });
  assert.deepEqual(p.plan.map((a) => a.type), ['anniversaire', 'relance1', 'premier', 'backlog', 'invitation']);
  assert.deepEqual(p.plan.map((a) => a.ordre), [1, 2, 3, 4, 5]);
  assert.deepEqual(p.compteurs, { inv: 1, msg: 1, bkl: 1, rel: 1, bday: 1 });
});

test('rampe du backlog : 20 par jour la 1re semaine, 35 la 2e, 50 ensuite', () => {
  const b = (date) => R.budgets([], date, Object.assign({}, R.DEFAUT, { rampeDebut: '2026-11-12' })).bkl.plafondJour;
  assert.equal(b('2026-11-12'), 20);
  assert.equal(b('2026-11-18'), 20);
  assert.equal(b('2026-11-19'), 35);
  assert.equal(b('2026-11-26'), 50);
  assert.equal(R.budgets([], '2026-11-12', R.DEFAUT).bkl.plafondJour, 20); // sans date de départ : palier prudent
});

test('premier message : fil non lu : reporté et demandé en lecture ; fil au tutoiement : à traiter', () => {
  const a = cgp(), b = cgp();
  const p = planDe({ suivi: [a, b], collect: { threads: [fil(b.urn, [libre('2026-10-01', 'Salut Paul, tu vas bien ?')])] } });
  assert.equal(p.plan.length, 0);
  assert.deepEqual(p.filsALire, [a.urn]);
  assert.ok(p.aTraiter.some((e) => e.urn === b.urn && /tutoiement/.test(e.motif)));
});

test('exclusions : réseaux, hors cible, classement', () => {
  assert.equal(X.reseauExclu('BNP Paribas Banque Privée'), 'BNP Paribas');
  assert.equal(X.reseauExclu('Organisation Patrimoine'), null); // « gan » n'est pas un mot entier ici
  assert.equal(X.reseauExclu('Gan Patrimoine'), 'Gan');
  assert.equal(X.horsCible('Étudiante en master gestion de patrimoine'), 'stagiaire, alternant ou étudiant');
  assert.deepEqual(X.classer({ headline: 'Conseiller en gestion de patrimoine indépendant' }), { famille: 'dist', categorie: 'cgp' });
  assert.deepEqual(X.classer({ headline: 'Directeur financier', org: 'Mutuelle du Sud' }), { famille: 'inst', categorie: 'mutuelle' });
  assert.equal(X.classer({ headline: 'Boulanger' }), null);
});

test('exécution : envoi confirmé mémorisé dans suivi, puis relance due au bon moment', () => {
  const c = cgp({ connecteLe: '2026-11-01' });
  let p = planDe({ suivi: [c], collect: { threads: [fil(c.urn, [])] } });
  const doc = R.appliquerEnvoi(c, p.plan[0], '2026-11-16T08:31:00Z');
  assert.equal(doc.envois.length, 1);
  assert.equal(doc.fil[0].version, p.plan[0].version);
  // Le même jour : déjà servi. Huit jours plus tard, sans relire le fil : relance 1.
  assert.equal(planDe({ suivi: [doc] }).plan.length, 0);
  p = planDe({ date: '2026-11-24', suivi: [doc] });
  assert.equal(p.plan[0].type, 'relance1');
  assert.equal(p.plan[0].filLu, false);
  assert.deepEqual(p.filsALire, [c.urn]);
  const ev = R.evenementFolk(p.plan[0], '2026-11-24T08:40:00Z');
  assert.equal(ev.type, 'relance1');
  assert.equal(ev.prenom, 'Paul');
  assert.equal(R.evenementFolk({ type: 'anniversaire' }, 'x'), null);
});

test('exécution : fil mémorisé sans texte, réponse reçue prise en compte au run suivant', () => {
  const c = cgp();
  const doc = R.memoriserFil(c, fil(c.urn, [moi('2026-11-02', 'A1'), recu('2026-11-12T10:00:00Z', 'Oui, volontiers.')]), '2026-11-16T07:30:00Z');
  assert.deepEqual(doc.fil[0], { de: 'moi', date: '2026-11-02', etape: 'A', version: 'A1' });
  assert.equal(doc.fil[1].texte, undefined);
  const p = planDe({ suivi: [doc] });
  assert.equal(p.plan.length, 0);
  assert.ok(p.aTraiter.some((e) => e.urn === c.urn));
});

test('migration : contact déjà travaillé dans Folk, fil jamais lu : lecture demandée pour un connecté, rien pour un simple invité', () => {
  const a = cgp({ dernierContactFolk: '2026-11-05T09:00:00Z', statutFolk: 'Lead' });
  const b = cgp({ dernierContactFolk: '2026-11-05T09:00:00Z', statut: 'invite', distance: 2 });
  const p = planDe({ suivi: [a, b] });
  assert.equal(p.plan.length, 0);
  assert.deepEqual(p.filsALire, [a.urn]);
});

test('fiche réduite au nom de famille : pas de faux doublon, nom complété', () => {
  const urn = 'ACoAAB1234567890abcdefghijklmnopqrstuvwxyz0';
  const p = R.construirePlan({ date: '2026-11-11', sendlog: [],
    suivi: [{ urn, slug: 'guido-chimienti', nom: 'Chimienti', statut: 'connecte', fil: [], envois: [] }],
    collect: { birthdays: [{ urn, slug: 'guido-chimienti', nom: 'Guido Chimienti', date: '2026-11-11' }] } });
  assert.equal(p.erreurs.length, 0);
  const tous = JSON.stringify(p);
  assert.ok(!/"nom":"Chimienti"/.test(tous) || /Guido Chimienti/.test(tous));
});
