#!/usr/bin/env node
/*
 * build_suivi.js : construit la collection db « suivi » à partir de sendlog, watch et Folk. Aucun appel réseau.
 *
 *   node migration/build_suivi.js --sendlog dossier|fichier --watch dossier|fichier --folk fichier.json \
 *        [--sortie suivi.json] [--a-resoudre a_resoudre.json]
 *
 * --sendlog, --watch : dossier de documents JSON (un fichier par document, nom = identifiant) ou fichier JSON unique.
 * --folk : personnes Folk des groupes CGP France, Weekly, The List (réponses d'API brutes ou liste).
 *
 * Ce que le script sait faire, et ses limites :
 * - La clé de « suivi » est l'URN LinkedIn. Seuls les contacts dont l'URN est connu y entrent :
 *   invitations acceptées de watch (champ urn) et noms suivis d'un URN dans les notes de sendlog.
 * - Les fiches Folk n'ont qu'un slug LinkedIn : elles sortent dans --a-resoudre, à résoudre par collect.js
 *   (étape profiles, 60 par run), puis à verser dans suivi avec la source « backlog » ou « connexion ».
 * - Les fils ne sont pas connus ici : `fil` reste vide. Le moteur exige un fil lu avant tout premier message,
 *   donc le premier run v9 lit le fil de chaque candidat et fixe l'état réel (A, B, E, dates).
 * - Les invitations en attente restent dans la collection watch (leur identifiant n'est pas l'URN du profil).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const X = require('../src/exclusions.js');

const GROUPES = {
  the_list: 'grp_9ab5b27f-2161-4dfb-a00e-ada0888efb29', weekly: 'grp_a2fc0f5f-96c5-4e25-bc86-d47f2881c581',
  linkedin: 'grp_15301c3d-745b-4261-9836-14dbdb243009', cgp_france: 'grp_96f7ad3a-0a8a-4fcf-af02-a7ee534d85cd'
};
const LAURENT = 'usr_97d36c92-4487-4b45-8a90-3982aec9e0ea';
const CATEGORIE = { 'CGP + MFO': 'cgp', 'Family Office + HNW': 'family_office', 'CGP + MFO, Family Office + HNW': 'family_office', 'Banque Privée': 'banque_privee',
  'Mutuelle': 'mutuelle', 'Institutionnel': 'prevoyance', 'Corporate': 'corporate', 'Asso / Diocese / Federation': 'association' };
const INST = { mutuelle: 1, prevoyance: 1, corporate: 1, association: 1, fondation: 1 };

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) o[argv[i].replace(/^--/, '')] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return o;
}
function lireDocs(chemin) {
  if (!chemin) return [];
  if (fs.statSync(chemin).isDirectory()) {
    return fs.readdirSync(chemin).filter((f) => f.endsWith('.json')).sort().map((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(chemin, f), 'utf8'));
      return Object.assign({ id: f.replace(/\.json$/, '') }, j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j);
    });
  }
  const j = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  return Array.isArray(j) ? j : Object.keys(j).map((k) => Object.assign({ id: k }, j[k]));
}
function personnesFolk(chemin) {
  if (!chemin) return [];
  const out = {};
  (function visiter(o) {
    if (Array.isArray(o)) o.forEach(visiter);
    else if (o && typeof o === 'object') {
      if (typeof o.id === 'string' && o.id.startsWith('per_')) out[o.id] = o; else Object.values(o).forEach(visiter);
    }
  })(JSON.parse(fs.readFileSync(chemin, 'utf8')));
  return Object.values(out);
}

/* Noms suivis d'un URN dans les notes libres de sendlog : « Durand ACoAAB... », « Paul Durand ACoAAA... ». */
function urnsDesNotes(doc) {
  const out = [];
  const re = /((?:\p{Lu}[\p{L}'’-]+)(?: \p{Lu}[\p{L}'’-]+){0,2})(?: \([^)]{0,80}\))? (ACoA[\w-]{20,})/gu;
  Object.keys(doc).filter((k) => /^notes/i.test(k) && typeof doc[k] === 'string').forEach((k) => {
    let m;
    while ((m = re.exec(doc[k]))) out.push({ nom: m[1], urn: m[2], vuLe: doc.id });
  });
  return out;
}

function etatFolk(p, aujourdhui) {
  const cfv = p.customFieldValues || {};
  const cgp = cfv[GROUPES.cgp_france] || {}, tl = cfv[GROUPES.the_list] || {}, wk = cfv[GROUPES.weekly] || {};
  const ids = (p.groups || []).map((g) => g.id);
  const estCgp = ids.includes(GROUPES.cgp_france) && !ids.includes(GROUPES.the_list);
  const categorie = estCgp ? 'cgp' : CATEGORIE[tl['Client Type']] || (X.classer({ poste: p.jobTitle }) || {}).categorie || null;
  const famille = categorie ? (INST[categorie] ? 'inst' : 'dist') : null;
  const meta = (p.interactionMetadata || {}).workspace || {};
  const dernier = meta.lastInteractedAt || null;
  const vieux = !dernier || new Date(dernier) < new Date(new Date(aujourdhui).getTime() - 366 * 86400000);
  const desc = p.description || '';
  let statut = null, motif = null;
  const couvreurs = (cgp['Déjà Couvert'] || []).filter((c) => c !== 'Laurent');
  if (/^REFUS\b/.test(desc) || cgp.Potentiel === 'Refus') { statut = 'refus'; motif = 'refus noté dans Folk'; }
  else if (couvreurs.length) { statut = 'couvert'; motif = 'couvert par ' + couvreurs.join(', '); }
  else if (/^ÉCARTÉ\b/.test(desc)) { statut = 'ecarte'; motif = desc.split('\n')[0]; }
  else if (wk.Status === 'Closed-lost' && !vieux) { statut = 'dormant'; motif = 'Closed-lost de moins de 12 mois'; }
  const collegue = p.createdBy && p.createdBy.id !== LAURENT && (meta.approximateCount || 0) > 0 &&
    !(meta.lastInteractedBy || []).some((u) => u.id === LAURENT);
  return { categorie, famille, statut, motif, dernier, interactions: meta.approximateCount || 0,
    source: (meta.approximateCount || 0) === 0 || vieux ? 'backlog' : 'connexion', statutFolk: wk.Status || null, collegue };
}

function construire({ sendlog, watch, folk, aujourdhui }) {
  const suivi = {}, rapport = { watchConnectes: 0, watchEnAttente: 0, urnsNotes: 0, folk: 0, folkSansLinkedin: 0, aResoudre: 0, rapproches: 0, conflits: [] };
  const maj = aujourdhui + 'T00:00:00Z';

  watch.forEach((w) => {
    if (w.state !== 'connected' || !/^ACoA/.test(w.urn || '')) { if (w.state === 'pending') rapport.watchEnAttente++; return; }
    rapport.watchConnectes++;
    suivi[w.urn] = { urn: w.urn, slug: w.slug || (/^AC[ow]AA/.test(w.id || '') ? null : decodeURIComponent(String(w.id || '').replace(/_([0-9A-F]{2})/g, '%$1')) || null), nom: w.n || null, org: w.c || null, famille: w.src === 'inst' ? 'inst' : 'dist',
      categorie: w.src === 'inst' ? null : 'cgp', source: 'watch', statut: 'connecte', inviteLe: w.since || null, connecteLe: w.acc || null,
      fil: [], envois: [], maj };
  });

  const parNomNote = {};
  sendlog.forEach((d) => urnsDesNotes(d).forEach((n) => {
    if (suivi[n.urn]) { if (!suivi[n.urn].vuLe || suivi[n.urn].vuLe < n.vuLe) suivi[n.urn].vuLe = n.vuLe; return; }
    if (parNomNote[X.norm(n.nom)] && parNomNote[X.norm(n.nom)] !== n.urn) rapport.conflits.push(n.nom + ' : deux URN dans les notes');
    parNomNote[X.norm(n.nom)] = n.urn;
    rapport.urnsNotes++;
    suivi[n.urn] = { urn: n.urn, slug: null, nom: n.nom, org: null, famille: null, categorie: null, source: 'sendlog', statut: 'connecte',
      vuLe: n.vuLe, fil: [], envois: [], maj };
  }));

  // Folk : rapprochement par slug, sinon par nom complet ou nom de famille unique ; le reste part en « à résoudre ».
  const parSlug = {}, parNom = {};
  Object.values(suivi).forEach((s) => {
    if (s.slug) parSlug[s.slug.toLowerCase()] = s;
    (parNom[X.norm(s.nom)] = parNom[X.norm(s.nom)] || []).push(s);
  });
  const aResoudre = [];
  folk.forEach((p) => {
    rapport.folk++;
    const slug = ((p.urls || []).map((u) => (/linkedin\.com\/in\/([^/?#\s]+)/i.exec(u) || [])[1]).filter(Boolean)[0] || '').toLowerCase() || null;
    const e = etatFolk(p, aujourdhui);
    const complet = X.norm(p.fullName || [p.firstName, p.lastName].join(' '));
    const cible = (slug && parSlug[slug]) || ((parNom[complet] || []).length === 1 && parNom[complet][0]) ||
      ((parNom[X.norm(p.lastName)] || []).length === 1 && folk.filter((q) => X.norm(q.lastName) === X.norm(p.lastName)).length === 1 && parNom[X.norm(p.lastName)][0]) || null;
    if (cible) {
      rapport.rapproches++;
      Object.assign(cible, { folkId: p.id, nom: p.fullName || cible.nom, slug: cible.slug || slug, org: cible.org || null, poste: p.jobTitle || null,
        famille: cible.famille || e.famille, categorie: cible.categorie || e.categorie, statutFolk: e.statutFolk, dernierContactFolk: e.dernier });
      if (e.statut) { cible.statut = e.statut; if (e.statut === 'refus') cible.refus = { date: null, motif: e.motif }; }
      return;
    }
    if (!slug) { rapport.folkSansLinkedin++; return; }
    rapport.aResoudre++;
    aResoudre.push({ slug, folkId: p.id, nom: p.fullName, poste: p.jobTitle || null, famille: e.famille, categorie: e.categorie, source: e.source,
      statut: e.statut, motif: e.motif, statutFolk: e.statutFolk, dernierContactFolk: e.dernier, interactions: e.interactions, collegue: e.collegue });
  });

  return { suivi: Object.values(suivi).sort((a, b) => (a.urn < b.urn ? -1 : 1)), aResoudre, rapport };
}

if (require.main === module) {
  const a = args(process.argv.slice(2));
  const res = construire({ sendlog: lireDocs(a.sendlog), watch: lireDocs(a.watch), folk: personnesFolk(a.folk),
    aujourdhui: typeof a.date === 'string' ? a.date : new Date().toISOString().slice(0, 10) });
  if (a.sortie) fs.writeFileSync(a.sortie, JSON.stringify(res.suivi, null, 2) + '\n');
  if (a['a-resoudre']) fs.writeFileSync(a['a-resoudre'], JSON.stringify(res.aResoudre, null, 2) + '\n');
  console.log(JSON.stringify(Object.assign({ suivi: res.suivi.length }, res.rapport), null, 2));
}

module.exports = { construire, urnsDesNotes, etatFolk };
