// Tests des fonctions d'analyse de collect.js sur des fixtures anonymisées (aucune donnée réelle).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/collect.js');
const R = require('../src/rules.js');

const fx = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const MOI = 'ACoAAABb3LgBFictifUrnDeLaurent0000000000';
const AUJ = '2026-11-16'; // lundi

test('collect.js sous Node : fonctions pures seulement, aucun accès navigateur', () => {
  assert.equal(typeof C.parseTopCard, 'function');
  assert.equal(C.run, undefined);
});

test('dates françaises des fils et des cartes', () => {
  assert.equal(C.parseDateFr('25 AOÛT 2025', AUJ), '2025-08-25'); // format réel des séparateurs de fil
  assert.equal(C.parseDateFr('19 JUIL.', AUJ), '2026-07-19');
  assert.equal(C.parseDateFr('11 SEPT.', AUJ), '2026-09-11');
  assert.equal(C.parseDateFr("Aujourd'hui", AUJ), '2026-11-16');
  assert.equal(C.parseDateFr('Hier', AUJ), '2026-11-15');
  assert.equal(C.parseDateFr('vendredi', AUJ), '2026-11-13');
  assert.equal(C.parseDateFr('lundi', AUJ), '2026-11-09'); // jamais le jour même
  assert.equal(C.parseDateFr('9 nov.', AUJ), '2026-11-09');
  assert.equal(C.parseDateFr('3 déc.', AUJ), '2025-12-03'); // pas dans le futur
  assert.equal(C.parseDateFr('12 oct. 2025', AUJ), '2025-10-12');
  assert.equal(C.parseDateFr('1er août 2024', AUJ), '2024-08-01');
  assert.equal(C.parseDateFr('Nov 9', AUJ), '2026-11-09');
  assert.equal(C.parseDateFr('Oct 12, 2025', AUJ), '2025-10-12');
  assert.equal(C.parseDateFr('', AUJ), null);
});

test('connexions : URN pris dans la réponse, slug, nom, headline, date', () => {
  const c = C.parseConnections(fx('connections.json'));
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], {
    urn: 'ACoAAA111111FictifUrnAlpha00000000000000', slug: 'alice-fictive-0001', nom: 'Alice Fictive',
    headline: 'Conseillère en gestion de patrimoine indépendante', connecteLe: '2026-11-10T08:00:00.000Z'
  });
  assert.equal(c[1].slug, 'bruno-exemple-0002');
});

test('bandeau de profil : URN propre au contact, jamais le parasite', () => {
  const t = C.parseTopCard(fx('topcard_attente.json'), 'carole-modele-0003', 'ACoAAABb3LgB');
  assert.equal(t.urn, 'ACoAAA333333FictifUrnGamma00000000000000'); // pas celui de Laurent, pourtant présent dans la réponse
  assert.equal(t.invitation, 'SENT');
  assert.equal(t.etat, 'attente');
  assert.equal(t.connecte, false);
  assert.equal(t.distance, 2);
  const k = C.parseTopCard(fx('topcard_connecte.json'), 'denis-specimen-0004', 'ACoAAABb3LgB');
  assert.equal(k.etat, 'connecte');
  assert.equal(k.distance, 1);
  assert.equal(k.retraite, true); // « Ancien directeur financier »
  const p = C.parseTopCard({ included: [{ entityUrn: 'urn:li:fsd_profile:ACoAAABb3LgBFictifUrnDeLaurent0000000000', publicIdentifier: 'x-y', firstName: 'X', lastName: 'Y' }] }, 'x-y', 'ACoAAABb3LgB');
  assert.equal(p.urn, null);
  assert.match(p.alertes[0], /parasite/);
  const r = C.parseTopCard({ included: [] }, 'inconnu', 'ACoAAABb3LgB');
  assert.equal(r.urn, null);
  assert.equal(r.etat, 'retire');
});

test('conversations : dernier message, auteur, groupes ignorés', () => {
  const k = C.parseConversations(fx('conversations.json'), MOI);
  assert.equal(k.length, 2);
  assert.equal(k[0].urn, 'ACoAAA111111FictifUrnAlpha00000000000000');
  assert.equal(k[0].dernierDe, 'contact');
  assert.equal(k[0].extrait, 'Bonjour, pouvez-vous m\'en dire plus ?');
  assert.equal(k[1].dernierDe, 'moi');
});

test('messages d\'un fil (API) : ordre chronologique, auteur', () => {
  const m = C.parseMessages(fx('messages.json'), MOI);
  assert.deepEqual(m.map((x) => x.de), ['moi', 'moi', 'contact']);
  assert.equal(m[0].date, '2026-10-20T08:30:00.000Z');
});

test('fil lu dans le DOM : dates des séparateurs, auteur hérité du groupe', () => {
  const m = C.parseThreadDom(fx('thread_dom.json'), AUJ, 'Laurent Sebah');
  assert.deepEqual(m.map((x) => x.de), ['moi', 'moi', 'contact']);
  assert.deepEqual(m.map((x) => x.date), ['2025-10-12T09:15', '2026-11-06T10:02', '2026-11-13T18:40']);
});

test('fil lu dans le DOM puis moteur de règles : le contact a écrit en dernier, à traiter', () => {
  const u = 'ACoAAA111111FictifUrnAlpha00000000000000';
  const messages = C.parseThreadDom(fx('thread_dom.json'), AUJ, 'Laurent Sebah');
  const p = R.construirePlan({ date: AUJ, sendlog: [], suivi: [{ urn: u, nom: 'Alice Fictive', famille: 'dist', statut: 'connecte' }],
    collect: { threads: [{ urn: u, lu: true, messages }] } });
  assert.equal(p.plan.length, 0);
  assert.equal(p.aTraiter[0].date, '2026-11-13');
});

test('cartes catch-up : slug, date, URN parasite écarté', () => {
  const c = C.parseCartes([
    { slug: 'alice-fictive-0001', nom: 'Alice Fictive', texte: ['Alice Fictive', 'Fêtez l’anniversaire de Alice aujourd’hui', 'Alice, je vous souhaite un très joyeux anniversaire.'].join(String.fromCharCode(10)), urn: 'ACoAAA111111FictifUrnAlpha00000000000000' },
    { slug: 'bruno-exemple-0002', nom: 'Bruno Exemple', texte: "L'anniversaire de Bruno Exemple était le 14 nov.", urn: 'ACoAAABb3LgBFictifUrnDeLaurent0000000000' },
    { slug: 'alice-fictive-0001', nom: 'Alice Fictive', texte: 'doublon' }
  ], AUJ, 'ACoAAABb3LgB');
  assert.equal(c.length, 2);
  assert.equal(c[0].date, '2026-11-16');
  assert.equal(c[1].date, '2026-11-14');
  assert.equal(c[1].urn, null);
});

test('recherche : slugs extraits du HTML', () => {
  const html = '<a href="https://www.linkedin.com/in/alice-fictive-0001?miniProfileUrn=x">A</a> {"navigationUrl":"/in/bruno-exemple-0002"} linkedin.com/in/alice-fictive-0001';
  assert.deepEqual(C.parseRecherche(html), ['alice-fictive-0001', 'bruno-exemple-0002']);
});

test('gabarits GraphQL relevés dans les requêtes de la page, substitution de la conversation', () => {
  const g = C.parseGabarits([
    'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.aaaa1111&variables=(mailboxUrn:urn%3Ali%3Afsd_profile%3AME)',
    'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.bbbb2222&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AME%2C2-OLD%3D%3D%29)',
    'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.bbbb2222&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AME%2C2-AUTRE%3D%3D%29,syncToken:abc)',
    'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.aaaa1111&variables=(query:(predicateUnions:List((x:(category:INBOX)))),count:20,mailboxUrn:urn%3Ali%3Afsd_profile%3AME)',
    'https://www.linkedin.com/voyager/api/graphql?queryId=autre'
  ]);
  assert.match(g.conversations, /messengerConversations\.aaaa1111/);
  assert.ok(!/query:|syncToken/.test(g.conversations));
  assert.ok(!/syncToken/.test(g.messages));
  const u = C.urlMessages(g.messages, 'urn:li:msg_conversation:(urn:li:fsd_profile:ME,2-NEW==)');
  assert.ok(u.endsWith('variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AME%2C2-NEW%3D%3D%29)'));
});

test('collect.js : aucune écriture réseau, aucun secret dans le code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'collect.js'), 'utf8');
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(src));
  assert.equal((src.match(/method:\s*'GET'/g) || []).length, 1); // un seul point d'accès réseau
  assert.ok(!/\.click\(|\.submit\(|dispatchEvent|execCommand/.test(src)); // aucun clic ni saisie
  assert.ok(!/li_at|password|Bearer /i.test(src));
});

test('watch : slug tiré de l\'identifiant du document ; profil résolu par identifiant de membre', () => {
  assert.equal(C.slugDeWatch({ id: 'b_C3_A9reng_C3_A8re-x-92720611' }), 'b%C3%A9reng%C3%A8re-x-92720611');
  assert.equal(C.slugDeWatch({ id: 'ACwAAA2DoWUBFictif', slug: 'paul-x' }), 'paul-x');
  assert.equal(C.slugDeWatch({ id: 'ACwAAA2DoWUBFictif000000' }), 'ACwAAA2DoWUBFictif000000');
  const t = C.parseTopCard(fx('topcard_attente.json'), 'ACwAAA333333FictifIdMembre0000000000000', 'ACoAAABb3LgB');
  assert.equal(t.urn, 'ACoAAA333333FictifUrnGamma00000000000000'); // élément principal de la réponse
  assert.equal(t.slug, 'carole-modele-0003');
  const accent = C.parseTopCard({ included: [{ entityUrn: 'urn:li:fsd_profile:ACoAAA555555FictifUrnEpsilon000000000000', publicIdentifier: 'bérengère-x', firstName: 'B', lastName: 'X' }] }, 'b%C3%A9reng%C3%A8re-x', 'ACoAAABb3LgB');
  assert.equal(accent.urn, 'ACoAAA555555FictifUrnEpsilon000000000000');
});
