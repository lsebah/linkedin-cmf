#!/usr/bin/env node
/*
 * plan.js : prépare le lot du jour hors navigateur (Node). Aucun appel réseau, aucun envoi.
 *
 *   node src/plan.js --date 2026-11-12 --suivi suivi.json --collect collect.json --sendlog sendlog.json \
 *        [--config config.json] [--sortie plan.json] [--html lot.html] [--etat preparation|execution|termine|blocage|limite]
 *        [--envoyes envoyes.json] [--folk folk.json] [--historique historique.json]
 *
 * Entrées : fichiers JSON (tableaux de documents, ou objets indexés par identifiant).
 * Sorties : le plan (schemas/plan.schema.json) sur la sortie standard ou dans --sortie ; la page dans --html.
 * Code de retour : 0 si le plan est produit, 2 si des erreurs bloquantes (URN) sont présentes, 1 en cas d'échec.
 */
'use strict';
const fs = require('node:fs');
const R = require('./rules.js');
const P = require('./page.js');

function arguments_(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('argument inattendu : ' + argv[i]);
    o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}
const lire = (f, defaut) => (f ? JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) : defaut);

function main() {
  const a = arguments_(process.argv.slice(2));
  if (a.aide || a.help || !a.date) {
    console.error('usage : node src/plan.js --date AAAA-MM-JJ --suivi f.json --collect f.json --sendlog f.json [--config f.json] [--sortie f.json] [--html f.html]');
    process.exit(a.date ? 0 : 1);
  }
  const plan = R.construirePlan({
    date: a.date, suivi: lire(a.suivi, []), collect: lire(a.collect, {}), sendlog: lire(a.sendlog, []), config: lire(a.config, {})
  });
  const json = JSON.stringify(plan, null, 2) + '\n';
  if (a.sortie) fs.writeFileSync(a.sortie, json); else process.stdout.write(json);
  if (a.html) {
    // --envoyes [{urn, heure, resultat}], --folk {creees, modifiees, interactions, echecs, signalements}, --historique [{date, resume}]
    fs.writeFileSync(a.html, P.rendre(plan, { etat: typeof a.etat === 'string' ? a.etat : undefined,
      envoyes: lire(a.envoyes, []), folk: lire(a.folk, null), historique: lire(a.historique, []) }));
  }
  const c = plan.compteurs;
  console.error(`Lot du ${plan.date} : ${c.bday} anniversaires, ${c.rel} relances, ${c.msg} premiers messages, ${c.bkl} backlog, ${c.inv} invitations ; ` +
    `${plan.aTraiter.length} à traiter, ${plan.reportes.length} reportés, ${plan.ecartes.length} écartés, ${plan.filsALire.length} fils à lire, ${plan.erreurs.length} erreurs.`);
  process.exit(plan.erreurs.length ? 2 : 0);
}

try { main(); } catch (e) { console.error('échec : ' + e.message); process.exit(1); }
