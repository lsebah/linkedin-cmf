/*
 * collect.js : collecte en LECTURE SEULE, exécutée dans un onglet linkedin.com déjà connecté (javascript_tool).
 * Aucune écriture, aucun envoi, aucune acceptation d'invitation : uniquement des requêtes GET et de la lecture de DOM.
 * Aucun cookie ni jeton n'est renvoyé ni journalisé (le jeton CSRF est lu à l'exécution et reste dans la page).
 *
 * Usage (un appel par étape, chaque appel dure moins de 45 s) :
 *   await CMF.collect.run('diagnostic')
 *   await CMF.collect.run('connections', { depuis: '2026-11-10' })
 *   await CMF.collect.run('conversations', { depuis: '2026-11-10T09:10Z' })     // réponses reçues
 *   await CMF.collect.run('birthdays')            // onglet sur /mynetwork/catch-up/birthdays/ ou lecture par cadre caché
 *   await CMF.collect.run('jobChanges')
 *   await CMF.collect.run('watch', { liste: [{ id, slug, nom, org }] })
 *   await CMF.collect.run('profiles', { slugs: [...] })
 *   await CMF.collect.run('threads', { urns: [...] })
 *   await CMF.collect.run('recherche', { requetes: ['prénom nom organisation'] })
 * Chaque appel renvoie { ok, etape, data, reste, duree, alertes, arret }. `reste` = éléments non traités faute de temps :
 * rappeler la même étape avec `reste`. `arret` = vérification, limite ou déconnexion détectée : tout arrêter, notifier.
 *
 * Les fonctions d'analyse (parse*) sont pures et testées sous Node (test/collect.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else { root.CMF = root.CMF || {}; root.CMF.collect = factory(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (win) {
  'use strict';

  var VERSION = '9.0.0';

  var CFG = {
    pauseMin: 1200, pauseMax: 2500,   // ms entre deux requêtes
    budgetMs: 38000,                  // durée maximale d'un appel (limite de l'outil : 45 s)
    maxProfils: 60, maxRecherches: 20, maxPagesConnexions: 3,
    urnLaurent: 'ACoAAABb3LgB',       // préfixe de l'URN de Laurent (parasite sur les profils)
    connexionsDeco: 'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16',
    // Versions candidates de la décoration du bandeau de profil : la première qui répond est mémorisée.
    topCardDecos: [20, 19, 18, 21, 22, 16, 17, 23, 24].map(function (n) { return 'com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-' + n; }),
    attenteCadre: 16000               // ms d'attente du rendu d'un fil dans le cadre caché
  };

  var etat = { moi: null, deco: null, convs: {}, gabarits: null, recherches: 0, profils: 0 };

  // ---------- Fonctions pures ----------

  function compact(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function sansAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function urnProfil(s) { var m = /(ACoA[\w-]{10,})/.exec(String(s || '')); return m ? m[1] : null; }
  function texteDe(x) { return x == null ? '' : typeof x === 'string' ? x : (x.text != null ? String(x.text) : ''); }
  function parcourir(o, f, prof) {
    prof = prof || 0;
    if (!o || typeof o !== 'object' || prof > 14) return;
    if (f(o) === false) return;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) parcourir(o[i], f, prof + 1); }
    else { for (var k in o) parcourir(o[k], f, prof + 1); }
  }

  function decoder(s) { try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); } }
  /* Slug d'un document watch : champ slug, sinon identifiant du document (« b_C3_A9reng_C3_A8re-x » = « b%C3%A9reng%C3%A8re-x »). */
  function slugDeWatch(w) {
    if (w.slug) return w.slug;
    var id = String(w.id || '');
    if (!id) return null;
    return /^AC[ow]AA/.test(id) ? id : id.replace(/_([0-9A-F]{2})/g, '%$1');
  }

  var RETRAITE_RE = /(^|[^a-z])(retraite(e|s|es)?|retired|ancien(ne|s|nes)?|ex-[a-z]|honoraire(s)?)($|[^a-z])/;
  function estRetraite(t) { return RETRAITE_RE.test(sansAccents(t).toLowerCase()); }

  var MOIS = { janv: 1, janvier: 1, jan: 1, fevr: 2, fev: 2, fevrier: 2, feb: 2, mars: 3, mar: 3, avr: 4, avril: 4, apr: 4, mai: 5, may: 5,
    juin: 6, jun: 6, juil: 7, juillet: 7, jul: 7, aout: 8, aug: 8, sept: 9, sep: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11,
    dec: 12, decembre: 12 };
  var JOURS = { dimanche: 0, dim: 0, sunday: 0, lundi: 1, lun: 1, monday: 1, mardi: 2, mar: 2, tuesday: 2, mercredi: 3, mer: 3, wednesday: 3,
    jeudi: 4, jeu: 4, thursday: 4, vendredi: 5, ven: 5, friday: 5, samedi: 6, sam: 6, saturday: 6 };
  function iso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function plusJours(j, n) { var p = j.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000).toISOString().slice(0, 10); }

  /*
   * Date d'un séparateur de fil ou d'une carte (« Aujourd'hui », « Hier », « lundi », « 9 nov. », « 12 oct. 2025 »).
   * Renvoie AAAA-MM-JJ ou null. Sans année : la date la plus récente qui ne soit pas dans le futur.
   */
  function parseDateFr(texte, aujourdhui) {
    var t = sansAccents(compact(texte)).toLowerCase().replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!t) return null;
    if (/aujourd|today/.test(t)) return aujourdhui;
    if (/\bhier\b|yesterday/.test(t)) return plusJours(aujourdhui, -1);
    var m = /(\d{1,2})(?:er)? ([a-z]+)(?: (\d{4}))?/.exec(t) || null, jour, mois, an;
    if (m && MOIS[m[2]]) { jour = +m[1]; mois = MOIS[m[2]]; an = m[3] ? +m[3] : null; }
    else {
      m = /([a-z]+) (\d{1,2})(?: (\d{4}))?/.exec(t);
      if (m && MOIS[m[1]]) { jour = +m[2]; mois = MOIS[m[1]]; an = m[3] ? +m[3] : null; }
    }
    if (jour) {
      if (!an) { an = +aujourdhui.slice(0, 4); if (iso(an, mois, jour) > aujourdhui) an--; }
      return iso(an, mois, jour);
    }
    var mot = t.split(' ')[0];
    if (JOURS[mot] !== undefined) {
      var p = aujourdhui.split('-'), w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
      var recul = (w - JOURS[mot] + 7) % 7 || 7;
      return plusJours(aujourdhui, -recul);
    }
    m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
    if (m) return iso(+m[3], +m[2], +m[1]);
    return null;
  }

  /* Connexions (réponse normalisée ou non de /relationships/dash/connections). */
  function parseConnections(json) {
    var profils = {}, liens = [];
    parcourir(json, function (o) {
      if (Array.isArray(o)) return;
      var e = o.entityUrn || '';
      if (typeof e === 'string' && /fsd_profile:ACoA/.test(e) && (o.firstName || o.lastName || o.publicIdentifier)) {
        profils[urnProfil(e)] = o;
      }
      if (o.createdAt && (o.connectedMember || o['*connectedMember'] || o.connectedMemberResolutionResult)) {
        var cible = o.connectedMemberResolutionResult ? o.connectedMemberResolutionResult.entityUrn : (o.connectedMember || o['*connectedMember']);
        liens.push({ urn: urnProfil(cible), date: o.createdAt });
      }
    });
    var vus = {}, out = [];
    liens.forEach(function (l) {
      if (!l.urn || vus[l.urn]) return;
      vus[l.urn] = 1;
      var p = profils[l.urn] || {};
      out.push({
        urn: l.urn, slug: p.publicIdentifier || null,
        nom: compact([texteDe(p.firstName), texteDe(p.lastName)].join(' ')) || null,
        headline: compact(texteDe(p.headline)) || null,
        connecteLe: new Date(l.date).toISOString()
      });
    });
    return out;
  }

  /*
   * Bandeau de profil (WebTopCardCore) : URN propre au contact, nom, headline, distance, état d'invitation.
   * L'URN est toujours pris sur l'objet dont publicIdentifier === slug, jamais ailleurs.
   */
  function parseTopCard(json, slug, urnLaurent) {
    var brut = typeof json === 'string' ? json : JSON.stringify(json || {});
    var obj = typeof json === 'string' ? null : json;
    var profil = null, alertes = [];
    var parId = /^AC[ow]AA[\w-]{10,}$/.test(String(slug)); // identifiant de membre à la place du slug public
    var voulu = decoder(slug).toLowerCase();
    if (obj) {
      // Élément principal de la réponse : celui que la requête a résolu.
      var d = obj.data && typeof obj.data === 'object' ? obj.data : obj;
      var el = d['*elements'] || d.elements;
      var principal = Array.isArray(el) && el.length ? urnProfil(typeof el[0] === 'string' ? el[0] : el[0].entityUrn) : null;
      parcourir(obj, function (o) {
        if (Array.isArray(o) || !/fsd_profile:ACoA/.test(String(o.entityUrn || '')) || !(o.firstName || o.publicIdentifier)) return;
        var memeSlug = o.publicIdentifier && decoder(o.publicIdentifier).toLowerCase() === voulu;
        if (parId ? urnProfil(o.entityUrn) === principal : memeSlug) { profil = o; return false; }
      });
      if (profil && principal && urnProfil(profil.entityUrn) !== principal) alertes.push('URN du slug différent de celui de la réponse pour ' + slug);
    }
    var urn = profil ? urnProfil(profil.entityUrn) : null;
    if (!urn) alertes.push('URN introuvable pour ' + slug);
    if (urn && urnLaurent && urn.indexOf(urnLaurent) === 0) { alertes.push('URN parasite (Laurent) écarté pour ' + slug); urn = null; }
    var dist = /DISTANCE_(\d)/.exec(brut);
    var distance = dist ? +dist[1] : (/OUT_OF_NETWORK/.test(brut) ? 3 : null);
    var envoyee = /"invitationType"\s*:\s*"SENT"/.test(brut);
    var recue = /"invitationType"\s*:\s*"RECEIVED"/.test(brut);
    var enCours = /"\*invitation"\s*:\s*"urn/.test(brut);
    var connecte = distance === 1 || /"\*?connection"\s*:\s*"urn:li:fsd_connection/.test(brut);
    var headline = profil ? compact(texteDe(profil.headline)) : '';
    return {
      slug: profil && profil.publicIdentifier ? profil.publicIdentifier : (parId ? null : slug), urn: urn,
      nom: profil ? compact([texteDe(profil.firstName), texteDe(profil.lastName)].join(' ')) : null,
      headline: headline || null, poste: headline || null, org: null,
      distance: connecte ? 1 : distance,
      connecte: connecte,
      invitation: envoyee ? 'SENT' : recue ? 'RECEIVED' : enCours ? 'PENDING' : null,
      invitable: !connecte && !envoyee && !enCours && distance !== null && !/OUT_OF_NETWORK/.test(brut),
      retraite: estRetraite(headline),
      etat: connecte ? 'connecte' : (envoyee || enCours) ? 'attente' : 'retire',
      alertes: alertes
    };
  }

  /* Conversations (GraphQL messengerConversations) : participant, dernier message, date. */
  function parseConversations(json, moi) {
    var out = [];
    parcourir(json, function (o) {
      if (Array.isArray(o) || !Array.isArray(o.conversationParticipants) || !/msg_conversation/.test(String(o.entityUrn || ''))) return;
      var autres = o.conversationParticipants.map(function (p) {
        var u = urnProfil(p.hostIdentityUrn || JSON.stringify(p));
        var m = (p.participantType && p.participantType.member) || {};
        return { urn: u, nom: compact([texteDe(m.firstName), texteDe(m.lastName)].join(' ')) || null,
          slug: m.profileUrl ? (/\/in\/([^/?#]+)/.exec(m.profileUrl) || [])[1] || null : null, headline: compact(texteDe(m.headline)) || null };
      }).filter(function (p) { return p.urn && p.urn !== moi; });
      if (autres.length !== 1) return false; // conversations de groupe ignorées
      var dernier = null;
      var ms = o.messages && (o.messages.elements || o.messages);
      if (Array.isArray(ms) && ms.length) {
        var m0 = ms[ms.length - 1];
        ms.forEach(function (x) { if ((x.deliveredAt || 0) > (m0.deliveredAt || 0)) m0 = x; });
        dernier = messageDe(m0, moi);
      }
      out.push({
        urn: autres[0].urn, nom: autres[0].nom, slug: autres[0].slug, headline: autres[0].headline,
        conversation: o.entityUrn,
        date: o.lastActivityAt ? new Date(o.lastActivityAt).toISOString() : (dernier ? dernier.date : null),
        dernierDe: dernier ? dernier.de : null,
        extrait: dernier ? dernier.texte.slice(0, 200) : '',
        nonLu: (o.unreadCount || 0) > 0
      });
      return false;
    });
    return out;
  }
  function messageDe(m, moi) {
    var exp = urnProfil((m.sender && (m.sender.hostIdentityUrn || JSON.stringify(m.sender))) || (m.actor && JSON.stringify(m.actor)) || '');
    return { de: exp && exp === moi ? 'moi' : 'contact', date: m.deliveredAt ? new Date(m.deliveredAt).toISOString() : null,
      texte: compact(texteDe(m.body)).length ? String(texteDe(m.body)) : '' };
  }

  /* Messages d'un fil (GraphQL messengerMessages), du plus ancien au plus récent. */
  function parseMessages(json, moi) {
    var out = [], vus = {};
    parcourir(json, function (o) {
      if (Array.isArray(o) || !o.deliveredAt || !o.body || typeof o.deliveredAt !== 'number') return;
      var cle = o.entityUrn || (o.deliveredAt + '|' + texteDe(o.body).slice(0, 30));
      if (vus[cle]) return false;
      vus[cle] = 1;
      out.push(messageDe(o, moi));
      return false;
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  /*
   * Fil lu dans le DOM. `lignes` = éléments dans l'ordre du document :
   *   { type: 'date', texte } pour .msg-s-message-list__time-heading
   *   { type: 'msg', auteur, heure, texte, autre } pour .msg-s-event-listitem (autre = message du contact)
   */
  function parseThreadDom(lignes, aujourdhui, nomMoi) {
    var jour = null, auteur = null, out = [];
    var moiN = sansAccents(compact(nomMoi)).toLowerCase();
    (lignes || []).forEach(function (l) {
      if (l.type === 'date') { jour = parseDateFr(l.texte, aujourdhui) || jour; return; }
      if (l.auteur) auteur = compact(l.auteur);
      var estMoi = l.autre === true ? false : l.autre === false ? true : (moiN && sansAccents(auteur || '').toLowerCase() === moiN);
      var h = /(\d{1,2})[:h](\d{2})/.exec(l.heure || '');
      out.push({ de: estMoi ? 'moi' : 'contact', date: jour ? jour + (h ? 'T' + String(h[1]).padStart(2, '0') + ':' + h[2] : '') : null,
        texte: String(l.texte || '').trim() });
    });
    return out;
  }

  /* Cartes d'une page catch-up (anniversaires, changements de poste) : { texte, slug, nom, urn } */
  function parseCartes(cartes, aujourdhui, urnLaurent) {
    var vus = {}, out = [];
    (cartes || []).forEach(function (c) {
      if (!c.slug || vus[c.slug]) return;
      vus[c.slug] = 1;
      var urn = c.urn && !(urnLaurent && c.urn.indexOf(urnLaurent) === 0) ? c.urn : null;
      var t = compact(c.texte);
      var d = parseDateFr((/(aujourd'hui|today|hier|yesterday|\d{1,2}(?:er)? [a-zéûA-Z]{3,9}\.?|[A-Z][a-z]{2,8} \d{1,2})/i.exec(t) || [])[1] || '', aujourdhui);
      out.push({ slug: c.slug, nom: compact(c.nom) || null, urn: urn, date: d, texte: t.slice(0, 200) });
    });
    return out;
  }

  /* Slugs d'une page de résultats de recherche (HTML brut). */
  function parseRecherche(html) {
    var re = /linkedin\.com\/in\/([A-Za-z0-9%_-]+)|"\/in\/([A-Za-z0-9%_-]+)/g, m, vus = {}, out = [];
    while ((m = re.exec(html))) { var s = m[1] || m[2]; if (!vus[s]) { vus[s] = 1; out.push(s); } }
    return out;
  }

  /* Gabarits d'URL GraphQL de messagerie relevés dans les requêtes déjà faites par la page. */
  function parseGabarits(urls) {
    var g = { conversations: null, messages: null };
    (urls || []).forEach(function (u) {
      var m = /voyagerMessagingGraphQL\/graphql\?queryId=(messenger(Conversations|Messages)\.[0-9a-f]+)/.exec(u);
      if (!m) return;
      if (m[2] === 'Conversations' && !/lastUpdatedBefore|recipients|query:/.test(u)) g.conversations = u;
      if (m[2] === 'Conversations' && !g.conversations) g.conversations = u;
      if (m[2] === 'Messages' && /conversationUrn/.test(u) && !/deliveredAt|countBefore|prevCursor/.test(u)) g.messages = u;
    });
    return g;
  }
  function encoderUrn(u) { return encodeURIComponent(u).replace(/\(/g, '%28').replace(/\)/g, '%29'); }
  function urlMessages(gabarit, conversationUrn) {
    return gabarit.replace(/conversationUrn:[^,)]+/, 'conversationUrn:' + encoderUrn(conversationUrn));
  }

  var pur = {
    VERSION: VERSION, CFG: CFG, parseDateFr: parseDateFr, parseConnections: parseConnections, parseTopCard: parseTopCard,
    parseConversations: parseConversations, parseMessages: parseMessages, parseThreadDom: parseThreadDom, parseCartes: parseCartes,
    parseRecherche: parseRecherche, slugDeWatch: slugDeWatch, parseGabarits: parseGabarits, urlMessages: urlMessages, estRetraite: estRetraite
  };
  if (!win) return pur; // Node : fonctions pures seulement

  // ---------- Partie navigateur (lecture seule) ----------

  var doc = win.document;
  function Arret(motif) { this.arret = true; this.message = motif; }
  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pause() { return dormir(CFG.pauseMin + Math.random() * (CFG.pauseMax - CFG.pauseMin)); }
  function aujourdhui() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function csrf() {
    var m = /(?:^|;\s*)JSESSIONID=("?)([^";]+)\1/.exec(doc.cookie);
    if (!m) throw new Arret('session LinkedIn absente (déconnexion ?)');
    return m[2];
  }
  var dernierAppel = 0;
  async function get(url, accept) {
    var attente = dernierAppel + CFG.pauseMin - Date.now();
    if (attente > 0) await dormir(attente + Math.random() * (CFG.pauseMax - CFG.pauseMin));
    dernierAppel = Date.now();
    var r = await win.fetch(url, { method: 'GET', credentials: 'include',
      headers: accept === 'html' ? {} : { 'csrf-token': csrf(), 'x-restli-protocol-version': '2.0.0', accept: accept || 'application/vnd.linkedin.normalized+json+2.1' } });
    if (/\/(checkpoint|authwall|uas\/login|login)\b/.test(r.url)) throw new Arret('vérification ou connexion demandée par LinkedIn');
    if (r.status === 429 || r.status === 999) throw new Arret('limite LinkedIn (HTTP ' + r.status + ')');
    if (r.status === 401) throw new Arret('session expirée (HTTP 401)');
    return r;
  }
  async function getJson(url, accept) {
    var r = await get(url, accept);
    if (!r.ok) { var e = new Error('HTTP ' + r.status + ' sur ' + url.split('?')[0]); e.status = r.status; throw e; }
    return r.json();
  }

  async function moi() {
    if (etat.moi) return etat.moi;
    var j = await getJson('/voyager/api/me');
    var urn = null, nom = null;
    parcourir(j, function (o) {
      if (Array.isArray(o)) return;
      if (!urn && o.firstName && o.lastName && /ACoA/.test(String(o.entityUrn || o.dashEntityUrn || ''))) {
        urn = urnProfil(o.dashEntityUrn || o.entityUrn); nom = compact(texteDe(o.firstName) + ' ' + texteDe(o.lastName));
      }
    });
    if (!urn) urn = urnProfil(JSON.stringify(j));
    etat.moi = { urn: urn, nom: nom };
    return etat.moi;
  }

  function gabarits() {
    var urls = win.performance.getEntriesByType('resource').map(function (e) { return e.name; });
    var g = parseGabarits(urls);
    etat.gabarits = { conversations: g.conversations || (etat.gabarits && etat.gabarits.conversations) || null,
      messages: g.messages || (etat.gabarits && etat.gabarits.messages) || null };
    return etat.gabarits;
  }

  async function topCard(slug) {
    var decos = etat.deco ? [etat.deco] : CFG.topCardDecos, dernier = null;
    for (var i = 0; i < decos.length; i++) {
      try {
        var j = await getJson('/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + encodeURIComponent(slug) + '&decorationId=' + decos[i]);
        etat.deco = decos[i];
        return parseTopCard(j, slug, CFG.urnLaurent);
      } catch (e) {
        if (e.arret) throw e;
        dernier = e;
        if (e.status === 403 || e.status === 404) break; // profil inaccessible : inutile d'essayer d'autres versions
      }
    }
    return { slug: slug, urn: null, etat: 'inconnu', alertes: ['profil illisible : ' + (dernier ? dernier.message : 'erreur')] };
  }

  // Cadre caché de même origine : lit une page LinkedIn sans changer d'onglet. Lecture seule.
  async function cadre(url, pret) {
    var f = doc.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none';
    f.src = url;
    doc.body.appendChild(f);
    try {
      var debut = Date.now();
      while (Date.now() - debut < CFG.attenteCadre) {
        await dormir(500);
        var d = null;
        try { d = f.contentDocument; } catch (e) { throw new Error('cadre inaccessible'); }
        if (d && /\/(checkpoint|authwall|login)\b/.test(String(f.contentWindow.location.pathname))) throw new Arret('vérification ou connexion demandée par LinkedIn');
        if (d && d.body && pret(d)) { await dormir(1500); return await Promise.resolve(f.contentDocument); }
      }
      return null;
    } finally { /* le document est lu par l'appelant avant le retrait */ etat.cadre = f; }
  }
  function retirerCadre() { if (etat.cadre) { etat.cadre.remove(); etat.cadre = null; } }

  function lignesDuFil(d) {
    var out = [];
    d.querySelectorAll('.msg-s-message-list__time-heading, .msg-s-event-listitem').forEach(function (el) {
      if (el.classList.contains('msg-s-message-list__time-heading')) { out.push({ type: 'date', texte: el.innerText }); return; }
      var groupe = el.closest('.msg-s-message-list__event') || el.parentElement;
      var a = groupe && groupe.querySelector('.msg-s-message-group__name');
      var h = groupe && groupe.querySelector('.msg-s-message-group__timestamp');
      var corps = el.querySelector('.msg-s-event-listitem__body');
      out.push({ type: 'msg', auteur: a ? a.innerText : '', heure: h ? h.innerText : '',
        texte: corps ? corps.innerText : el.innerText, autre: el.classList.contains('msg-s-event-listitem--other') ? true : undefined });
    });
    return out;
  }
  function carteVue(d) {
    // Anti-faux négatif : la carte du destinataire est visible dans la zone de rédaction.
    return !!(d.querySelector('.msg-compose__pill, .msg-connections-typeahead__pill, [class*="recipient-pill"]') ||
      d.querySelector('button[aria-label^="Supprimer "], button[aria-label^="Remove "]') ||
      d.querySelector('.msg-compose__profile-link[href*="/in/"], .msg-thread a[href*="/in/"], .msg-title-bar a[href*="/in/"]'));
  }

  async function filParCadre(urn, m) {
    try {
      var d = await cadre('/messaging/compose/?recipient=' + encodeURIComponent(urn), function (x) {
        return x.querySelector('.msg-s-event-listitem') || carteVue(x);
      });
      if (!d) return { urn: urn, lu: false, source: 'dom', motif: 'fil non lu (page non rendue)' };
      var lignes = lignesDuFil(d), carte = carteVue(d);
      var messages = parseThreadDom(lignes, aujourdhui(), m.nom);
      if (!messages.length && !carte) return { urn: urn, lu: false, source: 'dom', motif: 'fil non lu (carte du contact absente)' };
      return { urn: urn, lu: true, source: 'dom', vide: messages.length === 0, carteVue: carte, messages: messages, tronque: messages.length >= 20 };
    } catch (e) {
      if (e.arret) throw e;
      return { urn: urn, lu: false, source: 'dom', motif: 'fil non lu (' + e.message + ')' };
    } finally { retirerCadre(); }
  }

  async function filParApi(urn, m) {
    var conv = etat.convs[urn], g = etat.gabarits || gabarits();
    if (!conv || !g.messages) return null;
    try {
      var j = await getJson(urlMessages(g.messages, conv), 'application/graphql');
      var messages = parseMessages(j, m.urn);
      if (!messages.length) return null; // conversation connue mais réponse vide : structure inattendue, repli sur le DOM
      return { urn: urn, lu: true, source: 'api', vide: false, messages: messages, tronque: messages.length >= 20 };
    } catch (e) { if (e.arret) throw e; return null; }
  }

  // ---------- Étapes ----------

  var ETAPES = {
    async diagnostic(p) {
      var out = { version: VERSION, page: win.location.pathname, alertes: [] };
      var m = await moi();
      out.moi = { urnTrouve: !!m.urn, urnAttendu: !!(m.urn && m.urn.indexOf(CFG.urnLaurent) === 0), nomTrouve: !!m.nom };
      var g = gabarits();
      out.messagerie = { gabaritConversations: !!g.conversations, gabaritMessages: !!g.messages };
      try {
        var j = await getJson('/voyager/api/relationships/dash/connections?decorationId=' + CFG.connexionsDeco + '&count=10&q=search&sortType=RECENTLY_ADDED&start=0');
        var c = parseConnections(j);
        out.connexions = { lues: c.length, avecSlug: c.filter(function (x) { return x.slug; }).length, avecHeadline: c.filter(function (x) { return x.headline; }).length };
        if (c[0] && c[0].slug) {
          var t = await topCard(c[0].slug);
          out.topCard = { deco: etat.deco, urnCoherent: t.urn === c[0].urn, distance: t.distance, etat: t.etat, alertes: t.alertes };
          if (p && p.fil !== false) {
            var f = await filParCadre(c[0].urn, m);
            out.filParCadre = { lu: f.lu, vide: f.vide, messages: f.messages ? f.messages.length : 0, carteVue: f.carteVue, motif: f.motif || null,
              dates: f.messages ? f.messages.filter(function (x) { return x.date; }).length : 0 };
          }
        }
      } catch (e) { if (e.arret) throw e; out.alertes.push(e.message); }
      if (g.conversations) {
        try {
          var k = parseConversations(await getJson(g.conversations, 'application/graphql'), m.urn);
          out.messagerie.conversations = k.length;
          out.messagerie.avecDernierMessage = k.filter(function (x) { return x.dernierDe; }).length;
        } catch (e2) { if (e2.arret) throw e2; out.alertes.push('conversations : ' + e2.message); }
      }
      return { data: out };
    },

    async connections(p) {
      p = p || {};
      var borne = p.depuis ? new Date(new Date(p.depuis).getTime() - 2 * 86400000).toISOString() : null;
      var out = [], fin = false;
      for (var page = 0; page < CFG.maxPagesConnexions && !fin; page++) {
        var j = await getJson('/voyager/api/relationships/dash/connections?decorationId=' + CFG.connexionsDeco + '&count=100&q=search&sortType=RECENTLY_ADDED&start=' + page * 100);
        var lot = parseConnections(j);
        if (!lot.length) break;
        lot.forEach(function (c) { if (borne && c.connecteLe < borne) fin = true; else out.push(c); });
        if (lot.length < 100) break;
      }
      var alertes = [];
      out = out.filter(function (c) { if (c.urn.indexOf(CFG.urnLaurent) === 0) { alertes.push('URN parasite écarté'); return false; } return true; });
      return { data: out, alertes: alertes };
    },

    async conversations(p) {
      p = p || {};
      var m = await moi(), g = gabarits();
      if (!g.conversations) {
        return { data: [], alertes: ['messagerie : gabarit GraphQL introuvable (ouvrir /messaging/ dans cet onglet puis relancer, ou lire la liste dans le DOM)'] };
      }
      var liste = parseConversations(await getJson(g.conversations, 'application/graphql'), m.urn);
      liste.forEach(function (c) { etat.convs[c.urn] = c.conversation; });
      var depuis = p.depuis ? new Date(p.depuis).toISOString() : null;
      var replies = liste.filter(function (c) { return c.dernierDe === 'contact' && (!depuis || (c.date && c.date > depuis)); })
        .map(function (c) { return { urn: c.urn, nom: c.nom, slug: c.slug, date: c.date, extrait: c.extrait }; });
      return { data: { replies: replies, conversations: liste.length } };
    },

    async birthdays() { return cartesCatchUp('/mynetwork/catch-up/birthdays/'); },
    async jobChanges() { return cartesCatchUp('/mynetwork/catch-up/job_changes/'); },

    async watch(p, limite) {
      var liste = (p && (p.reste || p.liste)) || [], out = [], alertes = [];
      while (liste.length && Date.now() < limite && etat.profils < CFG.maxProfils) {
        var w = liste.shift();
        var sl = slugDeWatch(w);
        if (!sl) { out.push({ id: w.id, nom: w.nom, etat: 'inconnu', alertes: ['slug absent : recherche nécessaire'] }); continue; }
        var t = await topCard(sl); etat.profils++;
        out.push(Object.assign({ id: w.id, org: w.org || w.c || null, src: w.src || null, since: w.since || null }, t, { nom: t.nom || w.nom || w.n || null }));
      }
      return { data: out, reste: liste, alertes: alertes };
    },

    async profiles(p, limite) {
      var slugs = (p && (p.reste || p.slugs)) || [], out = [];
      while (slugs.length && Date.now() < limite && etat.profils < CFG.maxProfils) { out.push(await topCard(slugs.shift())); etat.profils++; }
      return { data: out, reste: slugs, alertes: etat.profils >= CFG.maxProfils && slugs.length ? ['plafond de ' + CFG.maxProfils + ' profils atteint'] : [] };
    },

    async threads(p, limite) {
      var urns = (p && (p.reste || p.urns)) || [], out = [], m = await moi();
      while (urns.length && Date.now() < limite - CFG.attenteCadre) {
        var u = urns.shift();
        if (!/^ACoA[\w-]{10,}$/.test(u) || u.indexOf(CFG.urnLaurent) === 0) { out.push({ urn: u, lu: false, motif: 'URN invalide ou parasite' }); continue; }
        out.push((p.api !== false && await filParApi(u, m)) || await filParCadre(u, m));
      }
      return { data: out, reste: urns };
    },

    async recherche(p, limite) {
      var q = (p && (p.reste || p.requetes)) || [], out = [];
      while (q.length && Date.now() < limite && etat.recherches < CFG.maxRecherches) {
        var mots = q.shift(); etat.recherches++;
        var r = await get('/search/results/people/?keywords=' + encodeURIComponent(mots) + (p.reseau ? '&network=%5B%22F%22%5D' : ''), 'html');
        out.push({ requete: mots, slugs: parseRecherche(await r.text()).slice(0, 10) });
        await dormir(1300); // 2,5 s d'écart au total entre deux recherches
      }
      return { data: out, reste: q, alertes: etat.recherches >= CFG.maxRecherches && q.length ? ['plafond de ' + CFG.maxRecherches + ' recherches atteint'] : [] };
    }
  };

  async function cartesCatchUp(chemin) {
    var d = win.location.pathname.indexOf(chemin) === 0 ? doc : null, parCadre = false;
    try {
      if (!d) { parCadre = true; d = await cadre(chemin, function (x) { return x.querySelector('main a[href*="/in/"]'); }); }
      if (!d) return { data: [], alertes: ['page ' + chemin + ' non rendue : y naviguer puis relancer'] };
      var cartes = [];
      d.querySelectorAll('main a[href*="/in/"]').forEach(function (a) {
        var slug = (/\/in\/([^/?#]+)/.exec(a.getAttribute('href')) || [])[1];
        var carte = a.closest('li, [data-view-name], article, section > div') || a.parentElement;
        var lien = carte && carte.querySelector('a[href*="recipient=ACoA"], a[href*="recipients=ACoA"]');
        cartes.push({ slug: slug, nom: a.getAttribute('aria-label') || a.innerText, texte: carte ? carte.innerText : a.innerText,
          urn: lien ? urnProfil(lien.getAttribute('href')) : null });
      });
      var out = parseCartes(cartes, aujourdhui(), CFG.urnLaurent);
      return { data: out, alertes: out.some(function (c) { return !c.urn; }) ? ['URN absents des cartes : les résoudre par l\'étape profiles (slugs)'] : [] };
    } finally { if (parCadre) retirerCadre(); }
  }

  async function run(etape, params) {
    var debut = Date.now();
    if (!ETAPES[etape]) return { ok: false, etape: etape, erreur: 'étape inconnue' };
    if (!/(^|\.)linkedin\.com$/.test(win.location.hostname)) return { ok: false, etape: etape, erreur: 'à exécuter dans un onglet linkedin.com' };
    try {
      var r = await ETAPES[etape](params || {}, debut + ((params && params.budgetMs) || CFG.budgetMs));
      return { ok: true, etape: etape, data: r.data, reste: r.reste && r.reste.length ? r.reste : [], alertes: r.alertes || [], duree: Date.now() - debut };
    } catch (e) {
      retirerCadre();
      return { ok: false, etape: etape, arret: !!e.arret, erreur: e.message, duree: Date.now() - debut };
    }
  }

  return Object.assign({ run: run, etat: etat }, pur);
});
