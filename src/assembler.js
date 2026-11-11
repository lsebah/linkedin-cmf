#!/usr/bin/env node
/*
 * assembler.js : transforme l'export brut de la page LinkedIn (CMF.collect.sortir) en collect.json pour plan.js,
 * et verse dans « suivi » les fiches de la file « aresoudre » qui viennent d'être vérifiées. Aucun appel réseau.
 *
 *   node src/assembler.js --brut export.json --suivi dossier_suivi --date 2026-11-12 --sortie collect.json
 *        [--aresoudre file.json --aresoudre-sortie file_apres.json --nouveaux dossier_nouveaux]
 *        [--marques marques.json]
 *
 * --brut : { conversations, birthdays, annivProfils, connections, watch, jobChanges, profils, threads }
 *          chaque valeur est le résultat d'un appel CMF.collect.run (objet { ok, data, ... }) ou directement ses données ;
 *          threads et profils peuvent être des tableaux de résultats cumulés.
 * --marques : { "<slug ou URN>": { source: "sourcing"|"backlog", famille, categorie, folkId, org } } pour les profils
 *          que la routine a retenus (sourcing, backlog) ; les autres profils servent seulement à l'état.
 * Sortie standard : résumé chiffré.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { lire } = require('./lire.js');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const donnees = (x) => (x && typeof x === 'object' && !Array.isArray(x) && 'data' in x ? x.data : x) || [];
const aplatir = (x) => (Array.isArray(x) ? x : [x]).flatMap((r) => { const d = donnees(r); return Array.isArray(d) ? d : [d]; }).filter(Boolean);
const cle = (s) => { try { return decodeURIComponent(String(s || '')).toLowerCase(); } catch (e) { return String(s || '').toLowerCase(); } };

function assembler({ brut, suivi, file, marques, date }) {
  const parSlug = {};
  suivi.forEach((d) => { if (d.slug) parSlug[cle(d.slug)] = d; });
  const profils = aplatir(brut.profils || []).concat(aplatir(brut.annivProfils || []));
  const profilParSlug = {};
  profils.forEach((p) => { if (p.slug) profilParSlug[cle(p.slug)] = p; });

  const conv = donnees(brut.conversations) || {};
  const collect = {
    date,
    replies: (conv.replies || []).filter((r) => r.urn),
    birthdays: aplatir(brut.birthdays || []).map((b) => {
      const p = profilParSlug[cle(b.slug)], s = parSlug[cle(b.slug)];
      return { slug: b.slug, nom: b.nom, date: b.date, urn: b.urn || (p && p.urn) || (s && s.urn) || null };
    }),
    jobChanges: aplatir(brut.jobChanges || []).map((j) => ({ slug: j.slug, nom: j.nom, texte: j.texte })),
    connections: aplatir(brut.connections || []),
    watch: aplatir(brut.watch || []),
    threads: aplatir(brut.threads || []).filter((t) => t.urn),
    profiles: []
  };
  const sansUrn = collect.birthdays.filter((b) => !b.urn).map((b) => b.slug);
  collect.birthdays = collect.birthdays.filter((b) => b.urn);

  // Profils retenus par la routine (sourcing, backlog) : marqués pour le moteur.
  profils.forEach((p) => {
    const m = (marques || {})[p.slug] || (marques || {})[cle(p.slug)] || (marques || {})[p.urn];
    if (m && p.urn) collect.profiles.push(Object.assign({}, p, m));
  });

  // File « aresoudre » : fiches vérifiées aujourd'hui -> nouveaux documents suivi.
  const nouveaux = [], resolus = [];
  const parUrnProfil = {};
  profils.forEach((p) => { if (p.urn) parUrnProfil[p.urn] = p; });
  const dejaUrn = new Set(suivi.map((d) => d.urn));
  Object.entries((file && file.items) || {}).forEach(([id, f]) => {
    const p = (f.urn && parUrnProfil[f.urn]) || profilParSlug[cle(f.slug)];
    if (!p || !p.urn || p.etat === 'inconnu') return;
    resolus.push(id);
    if (dejaUrn.has(p.urn)) return;
    dejaUrn.add(p.urn);
    nouveaux.push({
      urn: p.urn, slug: p.slug && !/^AC[ow]AA/.test(p.slug) ? p.slug : null, nom: f.nom || p.nom || null, org: null, poste: f.poste || p.headline || null,
      folkId: f.folkId || null, famille: f.famille || null, categorie: f.categorie || null, source: f.source || 'connexion',
      statut: p.etat === 'connecte' ? 'connecte' : p.etat === 'attente' ? 'invite' : null, distance: p.distance || null,
      statutFolk: f.statutFolk || null, dernierContactFolk: f.dernierContactFolk || null, fil: [], envois: [], maj: date + 'T00:00:00Z'
    });
  });
  return { collect, nouveaux, resolus, sansUrn };
}

if (require.main === module) {
  try {
    if (!a.brut || !a.date || !a.sortie) throw new Error('usage : --brut export.json --suivi dossier --date AAAA-MM-JJ --sortie collect.json');
    const file = a.aresoudre ? lire(a.aresoudre) : null;
    const res = assembler({ brut: lire(a.brut), suivi: lire(a.suivi, []), file, marques: lire(a.marques, {}), date: a.date });
    fs.writeFileSync(a.sortie, JSON.stringify(res.collect, null, 1));
    if (a.nouveaux) {
      fs.mkdirSync(a.nouveaux, { recursive: true });
      res.nouveaux.forEach((d) => fs.writeFileSync(path.join(a.nouveaux, d.urn + '.json'), JSON.stringify(d)));
    }
    if (file && a['aresoudre-sortie']) {
      res.resolus.forEach((id) => { delete file.items[id]; });
      file.maj = a.date;
      fs.writeFileSync(a['aresoudre-sortie'], JSON.stringify(file));
    }
    const c = res.collect;
    console.log(JSON.stringify({ reponses: c.replies.length, anniversaires: c.birthdays.length, anniversairesSansUrn: res.sansUrn,
      connexions: c.connections.length, watch: c.watch.length, fils: c.threads.length, filsNonLus: c.threads.filter((t) => t.lu === false).length,
      profilsMarques: c.profiles.length, nouveauxSuivi: res.nouveaux.map((d) => d.urn), fileResolus: res.resolus.length }, null, 1));
  } catch (e) { console.error('échec : ' + e.message); process.exit(1); }
}

module.exports = { assembler };
