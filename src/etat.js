#!/usr/bin/env node
/*
 * etat.js : met à jour l'état « suivi » hors navigateur (Node). Aucun appel réseau.
 *
 *   node src/etat.js fils   --suivi suivi.json --threads threads.json --quand 2026-11-12T07:35:00Z
 *       -> documents suivi à écrire après lecture des fils (fil mémorisé sans texte)
 *   node src/etat.js envoi  --suivi suivi.json --action action.json --quand 2026-11-12T08:31:00Z
 *       -> { suivi: document à écrire, folk: événement pour folk_sync.py (null pour un anniversaire) }
 *
 * --suivi : tableau de documents ou objet indexé par URN. --action : une action du plan (envoi CONFIRMÉ dans le fil).
 */
'use strict';
const fs = require('node:fs');
const R = require('./rules.js');

const a = {};
const argv = process.argv.slice(3);
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const index = (x) => {
  const o = {};
  (Array.isArray(x) ? x : Object.keys(x).map((k) => Object.assign({ urn: k }, x[k]))).forEach((d) => { o[d.urn || d.id] = d; });
  return o;
};

try {
  const commande = process.argv[2];
  if (!a.quand || !/Z$|[+-]\d\d:\d\d$/.test(a.quand)) throw new Error('--quand attendu : date-heure ISO avec fuseau (heure réelle, UTC)');
  const suivi = a.suivi ? index(lire(a.suivi)) : {};
  let sortie;
  if (commande === 'fils') {
    sortie = lire(a.threads).filter((t) => t.lu !== false).map((t) => R.memoriserFil(suivi[t.urn] || { urn: t.urn }, t, a.quand));
  } else if (commande === 'envoi') {
    const action = lire(a.action);
    const doc = suivi[action.urn] || null;
    sortie = { suivi: R.appliquerEnvoi(doc, action, a.quand), folk: R.evenementFolk(action, a.quand, doc || {}) };
  } else throw new Error('commande attendue : fils | envoi');
  process.stdout.write(JSON.stringify(sortie, null, 2) + '\n');
} catch (e) { console.error('échec : ' + e.message); process.exit(1); }
