#!/usr/bin/env node
/*
 * appliquer_resolution.js : verse dans « suivi » les fiches Folk dont l'URN vient d'être résolu par collect.js (étape profiles).
 * Aucun appel réseau.
 *
 *   node migration/appliquer_resolution.js --lot lot.json --resultats resultats.txt --suivi dossier_suivi --date 2026-11-11
 *
 * --lot       : fiches à résoudre, dans l'ordre où leurs slugs ont été passés à l'étape profiles.
 * --resultats : une ligne par fiche, même ordre : URN|distance|c (connecté) ou a (invitation en attente) ou r (retirée).
 * --suivi     : dossier des documents suivi (un fichier <URN>.json par contact) ; il est mis à jour sur place.
 * Sortie : { crees: [URN], modifies: [URN], resolus: [folkId] }.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const lot = JSON.parse(fs.readFileSync(a.lot, 'utf8'));
const lignes = fs.readFileSync(a.resultats, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
if (lignes.length !== lot.length) throw new Error(`lot (${lot.length}) et résultats (${lignes.length}) de tailles différentes`);

const crees = [], modifies = [], resolus = [], vus = {};
lot.forEach((f, i) => {
  const [urn, distance, etat] = lignes[i];
  if (!/^ACoA[\w-]{20,}$/.test(urn)) throw new Error('URN invalide ligne ' + (i + 1));
  if (vus[urn]) throw new Error('URN en double ligne ' + (i + 1));
  vus[urn] = true;
  // Garde-fou : un identifiant de membre ACwAA... et son URN ACoAA... partagent les mêmes caractères 5 à 12.
  if (/^AC[ow]AA/.test(f.slug) && f.slug.slice(4, 12) !== urn.slice(4, 12)) throw new Error('ordre incohérent ligne ' + (i + 1));
  const fichier = path.join(a.suivi, urn + '.json');
  const existe = fs.existsSync(fichier);
  const doc = existe ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : { urn, fil: [], envois: [] };
  const avant = JSON.stringify(doc);
  Object.assign(doc, {
    slug: doc.slug || (/^AC[ow]AA/.test(f.slug) ? null : f.slug), nom: f.nom || doc.nom || null, folkId: f.folkId,
    poste: doc.poste || f.poste || null, famille: doc.famille || f.famille || null, categorie: doc.categorie || f.categorie || null,
    source: doc.source && doc.source !== 'sendlog' ? doc.source : 'connexion',
    statut: ['refus', 'couvert', 'dormant', 'ecarte'].includes(doc.statut) ? doc.statut : etat === 'c' ? 'connecte' : etat === 'a' ? 'invite' : null,
    distance: Number(distance) || null, statutFolk: f.statutFolk || null, dernierContactFolk: f.dernierContactFolk || null,
    maj: a.date + 'T00:00:00Z'
  });
  if (!('org' in doc)) doc.org = null;
  if (JSON.stringify(doc) !== avant) {
    fs.writeFileSync(fichier, JSON.stringify(doc));
    (existe ? modifies : crees).push(urn);
  }
  resolus.push(f.folkId);
});
console.log(JSON.stringify({ crees, modifies, resolus }));
