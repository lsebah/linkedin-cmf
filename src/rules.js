/*
 * rules.js : moteur de règles déterministe (prompt v8), sans DOM ni réseau.
 * Entrées : suivi (état par contact), collect (sortie du jour), sendlog (7 jours), date du jour.
 * Sortie : plan ordonné d'actions, plus ecartes, aTraiter, reportes, clotures, erreurs, filsALire.
 * Navigateur : globalThis.CMF.rules (charger texts.js et exclusions.js avant) ; Node : require().
 * Ce module ne fait AUCUN envoi : il prépare le lot que Laurent valide par son « go ».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./texts.js'), require('./exclusions.js'));
  else { root.CMF = root.CMF || {}; root.CMF.rules = factory(root.CMF.texts, root.CMF.exclusions); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T, X) {
  'use strict';

  var VERSION = '9.0.0';

  var DEFAUT = {
    plafonds: {
      inv: { jour: 12, semaine: 60, dist: 8, inst: 4 },
      msg: { jour: 8, semaine: 40 },
      bkl: { jour: 50, semaine: 200, rampe: [20, 35, 50] }
    },
    rampeDebut: null,            // AAAA-MM-JJ : 1er jour du backlog v9 (semaine 1 : 20, semaine 2 : 35, ensuite 50)
    delaiB: 7,                   // A seul de plus de 7 jours : B
    delaiE: 14,                  // B de plus de 14 jours : E
    moisReset: 12,               // dernier message de plus de 12 mois : cycle remis à zéro
    moisEchange: 3,              // anniversaire : échange en cours si le contact a écrit il y a moins de 3 mois
    joursMerci: 15,              // « Merci pour la connexion. » si connexion de moins de 15 jours
    joursAnniv: 7,               // anniversaires récents rattrapés
    seuilReseau: 3,              // société présente 3 fois ou plus dans le lot : écartée
    urnLaurent: 'ACoAAABb3LgB'   // préfixe de l'URN parasite (celui de Laurent)
  };

  // ---------- Dates ----------

  var fmtParis = null;
  function jourParis(d) {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    var local = /^(\d{4}-\d{2}-\d{2})T[\d:.]+$/.exec(d); // heure de Paris sans fuseau (fil lu dans le DOM)
    if (local) return local[1];
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    if (!fmtParis) fmtParis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmtParis.format(dt);
  }
  function utc(j) { var p = j.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffJours(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function plusJours(j, n) { return new Date(utc(j) + n * 86400000).toISOString().slice(0, 10); }
  function plusMois(j, n) {
    var p = j.split('-'), y = +p[0], m = +p[1] - 1 + n, d = +p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var fin = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, fin))).toISOString().slice(0, 10);
  }
  function jourSemaine(j) { return new Date(utc(j)).getUTCDay(); } // 0 = dimanche
  function lundiDe(j) { var w = jourSemaine(j); return plusJours(j, -((w + 6) % 7)); }

  // ---------- Utilitaires ----------

  function liste(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    return Object.keys(x).map(function (k) { var o = x[k]; if (o && typeof o === 'object' && !o.id) o = Object.assign({ id: k }, o); return o; });
  }
  function fusion(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in (b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') o[k] = fusion(a[k], b[k]);
      else if (b[k] !== undefined) o[k] = b[k];
    }
    return o;
  }
  function urnValide(u) { return typeof u === 'string' && /^ACoA[\w-]{10,}$/.test(u); }

  // ---------- Budgets ----------

  function budgets(sendlog, date, cfg) {
    var parJour = {};
    liste(sendlog).forEach(function (d) { var id = d.id || d.doc_id || d.date; if (id) parJour[id] = d; });
    var debut = plusJours(date, -6);
    function somme(champ) {
      var s = 0;
      Object.keys(parJour).forEach(function (j) { if (j >= debut && j <= date) s += Number(parJour[j][champ]) || 0; });
      return s;
    }
    var auj = parJour[date] || {};
    var lundi = lundiDe(date);
    var limite = Object.keys(parJour).some(function (j) { return j >= lundi && j <= date && parJour[j].lim === true; });
    var P = cfg.plafonds;
    var palier = 0;
    if (cfg.rampeDebut && date >= cfg.rampeDebut) palier = Math.min(P.bkl.rampe.length - 1, Math.floor(diffJours(cfg.rampeDebut, date) / 7));
    var bklJour = Math.min(P.bkl.jour, P.bkl.rampe[palier]);
    function reste(jourMax, semMax, champ) {
      var j = Number(auj[champ]) || 0, s = somme(champ);
      return { jour: j, semaine: s, plafondJour: jourMax, plafondSemaine: semMax, reste: Math.max(0, Math.min(jourMax - j, semMax - s)) };
    }
    return {
      inv: fusion(reste(P.inv.jour, P.inv.semaine, 'inv'), { limite: limite }),
      msg: reste(P.msg.jour, P.msg.semaine, 'msg'),
      bkl: reste(bklJour, P.bkl.semaine, 'bkl'),
      rel: { jour: Number(auj.rel) || 0 },
      bday: { jour: Number(auj.bday) || 0 }
    };
  }

  // ---------- Fil d'un contact ----------

  function etapeDe(m) {
    if (m.etape) return m.etape;
    if (m.version) { var s = T.serieDe(m.version); if (s) return T.ETAPE[s]; }
    if (m.type && /^[ABEC]$/.test(m.type)) return m.type;
    var id = T.identifier(m.texte);
    return id ? id.etape : '?';
  }
  function versionDe(m) {
    if (m.version) return m.version;
    var id = T.identifier(m.texte);
    return id ? id.version : null;
  }
  function normMessage(m) {
    var de = m.de === 'moi' || m.de === 'laurent' || m.moi === true ? 'moi' : 'contact';
    return { de: de, date: m.date, jour: jourParis(m.date), etape: de === 'moi' ? etapeDe(m) : null,
      version: de === 'moi' ? versionDe(m) : null, texte: m.texte || m.extrait || '' };
  }

  /*
   * Reconstitue le fil : la lecture du jour (collect.threads) fait foi ; sinon le dernier fil mémorisé dans suivi,
   * complété par les envois journalisés et les réponses reçues depuis.
   * Renvoie { messages, lu } ; lu = le fil a été lu aujourd'hui.
   */
  function filDe(c, thread, replies) {
    var msgs = [], lu = false;
    if (thread && thread.lu !== false && Array.isArray(thread.messages)) {
      msgs = thread.messages.map(normMessage); lu = true;
    } else {
      msgs = (c.fil || []).map(normMessage);
      (c.envois || []).forEach(function (e) {
        if (e.type === 'INV') return;
        var m = normMessage({ de: 'moi', date: e.date, version: e.version, type: e.type });
        var deja = msgs.some(function (x) { return x.de === 'moi' && x.jour === m.jour && (!x.version || !m.version || x.version === m.version); });
        if (!deja) msgs.push(m);
      });
      if (c.dernierRecu && c.dernierRecu.date) {
        var r = normMessage({ de: 'contact', date: c.dernierRecu.date, texte: c.dernierRecu.extrait });
        if (!msgs.some(function (x) { return x.de === 'contact' && x.jour === r.jour; })) msgs.push(r);
      }
    }
    (replies || []).forEach(function (rep) {
      var r = normMessage({ de: 'contact', date: rep.date, texte: rep.extrait });
      if (r.jour && !msgs.some(function (x) { return x.de === 'contact' && x.jour === r.jour; })) msgs.push(r);
    });
    msgs = msgs.filter(function (m) { return m.jour; });
    msgs.sort(function (a, b) { return a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0; });
    return { messages: msgs, lu: lu };
  }

  var TUTOIEMENT = /(^|[^\p{L}])(tu|toi|t'es|t'as|ton|ta|tes|te)($|[^\p{L}])/iu;
  function auTutoiement(messages) {
    return messages.some(function (m) {
      if (m.de === 'moi' && m.version) return false; // texte figé : vouvoiement
      return TUTOIEMENT.test(m.texte || '');
    });
  }

  /*
   * État du cycle de prospection d'un fil (anniversaires ignorés).
   * Renvoie { etat } parmi : vide, reponse, echange, attente, B, E, dormant, reset.
   */
  function analyserCycle(messages, date, cfg) {
    var msgs = messages.filter(function (m) { return !(m.de === 'moi' && m.etape === 'C'); });
    if (!msgs.length) return { etat: 'vide' };
    var dernier = msgs[msgs.length - 1];
    var age = diffJours(dernier.jour, date);
    var vieux = plusMois(dernier.jour, cfg.moisReset) < date;
    if (dernier.de === 'contact') {
      return vieux ? { etat: 'reset', dernier: dernier.jour } : { etat: 'reponse', dernier: dernier.jour, extrait: dernier.texte };
    }
    if (vieux) return { etat: 'reset', dernier: dernier.jour };
    // Série finale de messages de Laurent appartenant au cycle en cours (pas d'écart de plus de 12 mois).
    var serie = [], i = msgs.length - 1, cycleRemis = false, echange = false;
    while (i >= 0) {
      var m = msgs[i];
      if (m.de !== 'moi') { echange = true; break; }
      serie.unshift(m);
      if (i > 0 && plusMois(msgs[i - 1].jour, cfg.moisReset) < m.jour) { cycleRemis = true; break; }
      i--;
    }
    if (echange) return { etat: 'echange', dernier: dernier.jour };
    var aE = serie.some(function (m) { return m.etape === 'E'; });
    var aB = serie.some(function (m) { return m.etape === 'B'; });
    var niveau = aE ? 3 : Math.max(aB ? 2 : 0, serie.length + (cycleRemis ? 1 : 0));
    if (niveau >= 3) return { etat: 'dormant', dernier: dernier.jour };
    if (niveau === 2) return age > cfg.delaiE ? { etat: 'E', dernier: dernier.jour } : { etat: 'attente', dernier: dernier.jour, du: plusJours(dernier.jour, cfg.delaiE + 1) };
    return age > cfg.delaiB ? { etat: 'B', dernier: dernier.jour } : { etat: 'attente', dernier: dernier.jour, du: plusJours(dernier.jour, cfg.delaiB + 1) };
  }

  // ---------- Construction du plan ----------

  function construirePlan(entree) {
    entree = entree || {};
    var date = entree.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('date du jour attendue au format AAAA-MM-JJ');
    var cfg = fusion(DEFAUT, entree.config || {});
    var collect = entree.collect || {};
    var suivi = liste(entree.suivi);
    var jsem = jourSemaine(date);
    var weekend = jsem === 0 || jsem === 6;
    var B = budgets(entree.sendlog, date, cfg);

    var plan = [], ecartes = [], aTraiter = [], reportes = [], clotures = [], erreurs = [], filsALire = [];
    var bloques = {};

    // --- 1. Fusion des sources et contrôle des URN ---
    var contacts = {}, vus = {};
    function voir(urn, slug, nom, source) {
      if (!urn) return;
      (vus[urn] = vus[urn] || []).push({ slug: slug || '', nom: X.norm(nom), brut: nom || '', source: source });
    }
    function integrer(src, origine) {
      var urn = src.urn;
      if (!urnValide(urn)) return null;
      var c = contacts[urn] = contacts[urn] || { urn: urn };
      Object.keys(src).forEach(function (k) {
        if (src[k] !== undefined && src[k] !== null && src[k] !== '' && (c[k] === undefined || c[k] === null || c[k] === '')) c[k] = src[k];
      });
      if (origine) (c.origines = c.origines || []).push(origine);
      return c;
    }

    var parUrnSuivi = {};
    suivi.forEach(function (s) {
      var urn = s.urn || s.id;
      (parUrnSuivi[urn] = parUrnSuivi[urn] || []).push(s);
      voir(urn, s.slug, s.nom, 'suivi');
    });
    Object.keys(parUrnSuivi).forEach(function (urn) {
      if (parUrnSuivi[urn].length > 1) {
        bloques[urn] = true;
        erreurs.push({ urn: urn, noms: parUrnSuivi[urn].map(function (s) { return s.nom; }), motif: 'même URN pour plusieurs contacts (suivi)' });
      } else integrer(fusion({ urn: urn }, parUrnSuivi[urn][0]), 'suivi');
    });

    liste(collect.watch).forEach(function (w) {
      voir(w.urn, w.slug, w.nom || w.n, 'watch');
      if (w.etat === 'connecte' || w.state === 'connected') {
        var c = integrer({ urn: w.urn, slug: w.slug, nom: w.nom || w.n, org: w.org || w.c, connecteLe: w.acc || w.connecteLe,
          famille: w.famille || (w.src === 'inst' ? 'inst' : w.src ? 'dist' : undefined), headline: w.headline, poste: w.poste }, 'watch');
        if (c) { c.connecte = true; c.accepte = true; }
      }
    });
    liste(collect.connections).forEach(function (k) {
      voir(k.urn, k.slug, k.nom, 'connexion');
      var c = integrer({ urn: k.urn, slug: k.slug, nom: k.nom, headline: k.headline, org: k.org, connecteLe: k.connecteLe || k.date }, 'connexion');
      if (c) { c.connecte = true; if (!c.connecteLe && k.connecteLe) c.connecteLe = k.connecteLe; }
    });
    liste(collect.profiles).forEach(function (p) {
      voir(p.urn, p.slug, p.nom, 'profil');
      var c = integrer({ urn: p.urn, slug: p.slug, nom: p.nom, poste: p.poste, org: p.org, headline: p.headline, famille: p.famille,
        categorie: p.categorie, source: p.source }, 'profil');
      if (c) {
        // Le profil lu aujourd'hui prime sur l'état mémorisé.
        ['poste', 'org', 'distance', 'retraite', 'invitation', 'invitable'].forEach(function (k) { if (p[k] !== undefined && p[k] !== null) c[k] = p[k]; });
        if (p.distance === 1 || p.connecte === true) c.connecte = true;
      }
    });
    var anniversaires = liste(collect.birthdays);
    anniversaires.forEach(function (a) { voir(a.urn, a.slug, a.nom, 'anniversaire'); });

    Object.keys(vus).forEach(function (urn) {
      if (bloques[urn]) return;
      if (!urnValide(urn)) { bloques[urn] = true; erreurs.push({ urn: urn, noms: vus[urn].map(function (v) { return v.brut; }), motif: 'URN invalide' }); return; }
      if (urn.indexOf(cfg.urnLaurent) === 0) { bloques[urn] = true; erreurs.push({ urn: urn, noms: vus[urn].map(function (v) { return v.brut; }), motif: 'URN parasite (celui de Laurent)' }); return; }
      var slugs = {}, noms = {};
      vus[urn].forEach(function (v) { if (v.slug) slugs[v.slug] = 1; if (v.nom) noms[v.nom] = v.brut; });
      var conflit = Object.keys(slugs).length > 1 || (Object.keys(slugs).length <= 1 && Object.keys(noms).length > 1 &&
        !memePersonne(Object.keys(noms)));
      if (conflit) {
        bloques[urn] = true;
        erreurs.push({ urn: urn, noms: Object.keys(noms).map(function (n) { return noms[n]; }), motif: 'même URN pour plusieurs contacts' });
      }
    });
    function memePersonne(noms) {
      // Tolère « Paul Durand » et « Paul D. » ou un nom suivi d'un titre : même premier mot et même initiale de nom.
      var cles = noms.map(function (n) { var m = n.split(' '); return m[0] + '|' + (m[1] || '').charAt(0); });
      return cles.every(function (k) { return k === cles[0]; });
    }

    var threads = {};
    liste(collect.threads).forEach(function (t) { if (t.urn) threads[t.urn] = t; });
    var repliesParUrn = {};
    liste(collect.replies).forEach(function (r) { if (r.urn) (repliesParUrn[r.urn] = repliesParUrn[r.urn] || []).push(r); });

    // --- 2. Déjà servis aujourd'hui (reprise après interruption) ---
    var servi = {};
    Object.keys(contacts).forEach(function (urn) {
      (contacts[urn].envois || []).forEach(function (e) { if (jourParis(e.date) === date) servi[urn] = true; });
    });

    // --- Rotation : dernière version envoyée par série ---
    var rotation = {};
    (function () {
      var dern = {};
      Object.keys(contacts).forEach(function (urn) {
        (contacts[urn].envois || []).forEach(function (e) {
          var s = T.serieDe(e.version);
          if (!s || s === 'C') return;
          if (!dern[s] || String(e.date) > dern[s].date) dern[s] = { date: String(e.date), version: e.version };
        });
      });
      var rotLog = null;
      liste(entree.sendlog).slice().sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; })
        .forEach(function (d) { if (d.rot && typeof d.rot === 'object') rotLog = d.rot; });
      Object.keys(T.SERIES).forEach(function (s) {
        if (s === 'C') return;
        rotation[s] = dern[s] ? dern[s].version : (rotLog && rotLog[s]) || (entree.config && entree.config.rotation && entree.config.rotation[s]) || null;
      });
    })();

    function versionsRecues(c, fil) {
      var v = {};
      (c.envois || []).forEach(function (e) { if (e.version) v[e.version] = 1; });
      fil.messages.forEach(function (m) { if (m.de === 'moi' && m.version) v[m.version] = 1; });
      return Object.keys(v);
    }

    function famillede(c) {
      if (c.famille === 'dist' || c.famille === 'inst') return c.famille;
      var k = X.classer(c);
      if (k) { c.famille = k.famille; if (!c.categorie) c.categorie = k.categorie; return k.famille; }
      return null;
    }

    function base(c) { return { urn: c.urn, slug: c.slug || null, nom: c.nom || null, org: c.org || null }; }

    /*
     * Compose une action : salutation, version (rotation), texte. Renvoie l'action ou null (et range le contact).
     */
    function composer(c, etape, fil, type, compteur, motif) {
      var fam = famillede(c);
      if (!fam) { ecartes.push(fusion(base(c), { motif: 'hors périmètre (famille non déterminée)' })); return null; }
      var sal = T.salutation(c);
      if (!sal.salut) { aTraiter.push(fusion(base(c), { motif: sal.motif, prevu: type })); return null; }
      var serie = T.seriePour(etape, fam);
      var r = T.versionSuivante(serie, rotation[serie], versionsRecues(c, fil));
      if (!r.version) {
        if (r.motif === 'epuise') aTraiter.push(fusion(base(c), { motif: 'toutes les versions ' + serie + ' déjà reçues', prevu: type }));
        else reportes.push(fusion(base(c), { motif: 'rotation des versions', prevu: type }));
        return null;
      }
      var merci = etape === 'A' && fam === 'dist' && !!c.connecteLe && diffJours(jourParis(c.connecteLe), date) < cfg.joursMerci;
      var texte = T.rendre(r.version, { famille: fam, salut: sal.salut, merci: merci });
      rotation[serie] = r.version;
      return fusion(base(c), { type: type, compteur: compteur, famille: fam, categorie: c.categorie || null, version: r.version,
        texte: texte, motif: motif, filLu: fil.lu });
    }

    function ajouter(action) { servi[action.urn] = true; plan.push(action); }

    // --- 3. Réponses reçues (tous les jours) ---
    liste(collect.replies).forEach(function (r) {
      aTraiter.push({ urn: r.urn || null, slug: r.slug || null, nom: r.nom || null, org: r.org || null, motif: 'réponse reçue', date: r.date || null, extrait: r.extrait || '' });
    });

    // --- 4. Anniversaires (tous les jours) ---
    var annee = date.slice(0, 4);
    anniversaires.forEach(function (a) {
      var urn = a.urn;
      if (!urn || bloques[urn]) return;
      var c = contacts[urn] || { urn: urn, slug: a.slug, nom: a.nom };
      if (!c.nom) c.nom = a.nom;
      if (!c.slug) c.slug = a.slug;
      var jourAnniv = a.date ? jourParis(a.date) : date;
      if (jourAnniv > date || diffJours(jourAnniv, date) > cfg.joursAnniv) { ecartes.push(fusion(base(c), { motif: 'anniversaire de plus de ' + cfg.joursAnniv + ' jours' })); return; }
      if (servi[urn]) { ecartes.push(fusion(base(c), { motif: 'déjà servi aujourd\'hui' })); return; }
      var fil = filDe(c, threads[urn], repliesParUrn[urn]);
      var souhaits = fil.messages.filter(function (m) { return m.de === 'moi' && m.etape === 'C'; }).map(function (m) { return m.jour; });
      if (c.dernierAnniv) souhaits.push(jourParis(c.dernierAnniv));
      var deja = souhaits.some(function (j) { return j && (j.slice(0, 4) === annee || diffJours(j, date) < 30); });
      if (deja) { ecartes.push(fusion(base(c), { motif: 'anniversaire déjà souhaité cette année' })); return; }
      var hors = fil.messages.filter(function (m) { return !(m.de === 'moi' && m.etape === 'C'); });
      var dern = hors[hors.length - 1];
      if (dern && dern.de === 'contact' && plusMois(dern.jour, cfg.moisEchange) >= date) {
        aTraiter.push(fusion(base(c), { motif: 'anniversaire : échange en cours, le contact a écrit en dernier', date: dern.jour, extrait: dern.texte }));
        servi[urn] = true; // aucun autre envoi automatique aujourd'hui
        return;
      }
      ajouter(fusion(base(c), { type: 'anniversaire', compteur: 'bday', famille: c.famille || null, categorie: c.categorie || null,
        version: 'C', texte: T.rendre('C'), motif: jourAnniv === date ? 'anniversaire du jour' : 'anniversaire du ' + jourAnniv, filLu: fil.lu }));
      if (!fil.lu) filsALire.push(urn);
    });

    // --- 5. Samedi et dimanche : anniversaires seulement ---
    if (!weekend) {
      var urns = Object.keys(contacts).filter(function (u) { return !bloques[u]; }).sort();
      var relances = [], premiers = [], backlog = [], invitations = [];

      urns.forEach(function (urn) {
        var c = contacts[urn];
        var fil = filDe(c, threads[urn], repliesParUrn[urn]);
        var cycle = analyserCycle(fil.messages, date, cfg);
        var aInviter = !c.connecte && c.statut !== 'connecte' && c.distance !== 1 && cycle.etat === 'vide' &&
          (c.statut === 'a_inviter' || c.source === 'sourcing' || (c.source === 'backlog' && (c.distance === 2 || c.distance === 3)));

        // Exclusions définitives.
        if (c.refus || c.statut === 'refus') { ecartes.push(fusion(base(c), { motif: 'refus' })); return; }
        if (c.statut === 'couvert') { ecartes.push(fusion(base(c), { motif: 'couvert par un collègue' })); return; }
        if (c.statut === 'ecarte') return;

        if (cycle.etat === 'reponse') {
          if (!liste(collect.replies).some(function (r) { return r.urn === urn; })) {
            aTraiter.push(fusion(base(c), { motif: 'le contact a écrit en dernier', date: cycle.dernier, extrait: cycle.extrait || '' }));
          }
          return;
        }
        if (cycle.etat === 'echange') { ecartes.push(fusion(base(c), { motif: 'échange en cours, Laurent a écrit en dernier (' + cycle.dernier + ')' })); return; }
        if (cycle.etat === 'attente') return;
        if (cycle.etat === 'dormant') {
          if (c.statut !== 'dormant') clotures.push(fusion(base(c), { statut: 'Closed-lost', motif: 'dormant : prise de contact et 2 relances sans réponse', folkId: c.folkId || null }));
          return;
        }

        if (servi[urn]) {
          if (cycle.etat === 'B' || cycle.etat === 'E' || cycle.etat === 'reset') reportes.push(fusion(base(c), { motif: 'un envoi par jour (anniversaire ou envoi déjà fait)', prevu: cycle.etat }));
          return;
        }

        var excl = X.motifExclusion(c);
        if (excl) { if (cycle.etat !== 'vide' || c.connecte || c.statut === 'connecte' || c.distance === 1 || aInviter) ecartes.push(fusion(base(c), { motif: excl })); return; }

        if (cycle.etat === 'B' || cycle.etat === 'E' || cycle.etat === 'reset') {
          if (auTutoiement(fil.messages)) { aTraiter.push(fusion(base(c), { motif: 'fil au tutoiement : pas de texte figé', prevu: cycle.etat })); return; }
          var duBacklog = cycle.etat === 'reset' && c.source === 'backlog' && !(c.envois || []).some(function (e) { return e.type !== 'INV' && e.type !== 'C'; });
          var item = { c: c, fil: fil, cycle: cycle };
          if (duBacklog) backlog.push(fusion(item, { etape: 'B' }));
          else relances.push(item);
          return;
        }

        // Fil vide : premier contact ou invitation.
        if (cycle.etat === 'vide') {
          var connecte = c.connecte || c.statut === 'connecte' || c.distance === 1;
          if (connecte) {
            var o = c.origines || [];
            var sourceSuivi = c.source;
            if (sourceSuivi === 'backlog') backlog.push({ c: c, fil: fil, etape: 'A' });
            else if (c.accepte || sourceSuivi === 'watch' || sourceSuivi === 'sourcing') premiers.push({ c: c, fil: fil, rang: 0 });
            else if (o.indexOf('connexion') !== -1 || sourceSuivi === 'connexion') premiers.push({ c: c, fil: fil, rang: 1 });
          } else if (aInviter) invitations.push({ c: c, fil: fil });
        }
      });

      // Société présente 3 fois ou plus parmi les nouveaux prospects : réseau, écartée.
      (function () {
        var compte = {};
        var nouveaux = premiers.concat(backlog.filter(function (b) { return b.etape === 'A'; }), invitations);
        nouveaux.forEach(function (n) { var k = n.c.org ? X.cleSociete(n.c.org) : ''; if (k) compte[k] = (compte[k] || 0) + 1; });
        function garder(n) {
          var k = n.c.org ? X.cleSociete(n.c.org) : '';
          if (k && compte[k] >= cfg.seuilReseau) { ecartes.push(fusion(base(n.c), { motif: 'réseau : société présente ' + compte[k] + ' fois dans le lot' })); return false; }
          return true;
        }
        premiers = premiers.filter(garder);
        backlog = backlog.filter(function (b) { return b.etape !== 'A' || garder(b); });
        invitations = invitations.filter(garder);
      })();

      // 5a. Relances, sans plafond : les plus anciennes d'abord.
      relances.sort(function (a, b) { return a.cycle.dernier < b.cycle.dernier ? -1 : a.cycle.dernier > b.cycle.dernier ? 1 : a.c.urn < b.c.urn ? -1 : 1; });
      relances.forEach(function (r) {
        var e = r.cycle.etat === 'E' ? 'E' : 'B';
        var motif = r.cycle.etat === 'reset' ? 'cycle remis à zéro (dernier message du ' + r.cycle.dernier + ')'
          : e === 'B' ? 'prise de contact du ' + r.cycle.dernier + ' sans réponse' : 'relance 1 du ' + r.cycle.dernier + ' sans réponse';
        var a = composer(r.c, e, r.fil, e === 'E' ? 'relance2' : 'relance1', 'rel', motif);
        if (a) { ajouter(a); if (!r.fil.lu) filsALire.push(r.c.urn); }
      });

      // 5b. Premiers messages a et b : fil lu et vide exigé.
      function premierMessage(item, type, compteur, budget, motif) {
        var c = item.c;
        if (!famillede(c)) { ecartes.push(fusion(base(c), { motif: 'hors périmètre' })); return; }
        if (!item.fil.lu) { filsALire.push(c.urn); reportes.push(fusion(base(c), { motif: 'fil non lu', prevu: type })); return; }
        if (budget.reste <= 0) { reportes.push(fusion(base(c), { motif: 'plafond atteint', prevu: type })); return; }
        var a = composer(c, item.etape || 'A', item.fil, type, compteur, motif);
        if (a) { budget.reste--; ajouter(a); }
      }
      premiers.sort(function (a, b) {
        if (a.rang !== b.rang) return a.rang - b.rang;
        var da = String(a.c.connecteLe || ''), db = String(b.c.connecteLe || '');
        return da < db ? -1 : da > db ? 1 : a.c.urn < b.c.urn ? -1 : 1;
      });
      premiers.forEach(function (p) {
        premierMessage(p, 'premier', 'msg', B.msg, p.rang === 0 ? 'invitation acceptée' : 'nouvelle connexion');
      });

      // 5c. Backlog Folk.
      backlog.sort(function (a, b) { return a.c.urn < b.c.urn ? -1 : 1; });
      backlog.forEach(function (b) {
        if (b.etape === 'B') {
          if (B.bkl.reste <= 0) { reportes.push(fusion(base(b.c), { motif: 'plafond atteint', prevu: 'backlog' })); return; }
          var a = composer(b.c, 'B', b.fil, 'backlog', 'bkl', 'backlog : cycle remis à zéro (dernier message du ' + b.cycle.dernier + ')');
          if (a) { B.bkl.reste--; ajouter(a); if (!b.fil.lu) filsALire.push(b.c.urn); }
        } else premierMessage(b, 'backlog', 'bkl', B.bkl, 'backlog Folk, fil vide');
      });

      // 6. Invitations sans note : 8 distributeurs et 4 institutionnels au plus.
      (function () {
        var faits = { dist: 0, inst: 0 };
        Object.keys(contacts).forEach(function (u) {
          (contacts[u].envois || []).forEach(function (e) {
            if (e.type === 'INV' && jourParis(e.date) === date) { var f = contacts[u].famille; if (f) faits[f]++; }
          });
        });
        var P = cfg.plafonds.inv;
        var resteFam = { dist: Math.max(0, P.dist - faits.dist), inst: Math.max(0, P.inst - faits.inst) };
        var enAttente = {};
        liste(collect.watch).forEach(function (w) { if (w.urn && (w.etat === 'attente' || w.state === 'pending')) enAttente[w.urn] = true; });
        invitations.forEach(function (it) {
          var c = it.c;
          var fam = famillede(c);
          if (!fam) { ecartes.push(fusion(base(c), { motif: 'hors périmètre' })); return; }
          if (X.nomAbrege(c.nom)) { ecartes.push(fusion(base(c), { motif: 'nom abrégé' })); return; }
          if (c.invitation || c.statut === 'invite' || enAttente[c.urn]) { ecartes.push(fusion(base(c), { motif: 'déjà invité' })); return; }
          if (c.distance === 3 && c.invitable !== true) { ecartes.push(fusion(base(c), { motif: 'hors réseau, non invitable' })); return; }
          if (!c.slug) { ecartes.push(fusion(base(c), { motif: 'slug absent' })); return; }
          if (B.inv.limite) { reportes.push(fusion(base(c), { motif: 'limite LinkedIn : invitations arrêtées jusqu\'à lundi', prevu: 'invitation' })); return; }
          if (B.inv.reste <= 0 || resteFam[fam] <= 0) { reportes.push(fusion(base(c), { motif: 'plafond atteint', prevu: 'invitation' })); return; }
          B.inv.reste--; resteFam[fam]--;
          ajouter(fusion(base(c), { type: 'invitation', compteur: 'inv', famille: fam, categorie: c.categorie || null, version: null, texte: null,
            motif: 'invitation sans note (' + (fam === 'inst' ? 'institutionnel' : 'distributeur') + ')', filLu: false }));
        });
      })();
    }

    // Ordre final : anniversaires, relances, premiers messages, backlog, invitations.
    var ORDRE = { anniversaire: 0, relance1: 1, relance2: 1, premier: 2, backlog: 3, invitation: 4 };
    plan = plan.map(function (a, i) { return { a: a, i: i }; })
      .sort(function (x, y) { return (ORDRE[x.a.type] - ORDRE[y.a.type]) || (x.i - y.i); })
      .map(function (x, i) { x.a.ordre = i + 1; return x.a; });

    var compteurs = { inv: 0, msg: 0, bkl: 0, rel: 0, bday: 0 };
    plan.forEach(function (a) { compteurs[a.compteur]++; });

    // Garde-fou final : un envoi par personne et par jour.
    var double = {};
    plan.forEach(function (a) { double[a.urn] = (double[a.urn] || 0) + 1; });
    Object.keys(double).forEach(function (u) { if (double[u] > 1) throw new Error('plan incohérent : deux envois pour ' + u); });

    return {
      version: VERSION, date: date, weekend: weekend,
      budgets: B, compteurs: compteurs,
      plan: plan, ecartes: ecartes, aTraiter: aTraiter, reportes: reportes, clotures: clotures, erreurs: erreurs,
      filsALire: filsALire.filter(function (u, i, t) { return t.indexOf(u) === i; }),
      rotation: rotation
    };
  }

  return {
    VERSION: VERSION, DEFAUT: DEFAUT, construirePlan: construirePlan, analyserCycle: analyserCycle, filDe: filDe, budgets: budgets,
    jourParis: jourParis, diffJours: diffJours, plusJours: plusJours, plusMois: plusMois
  };
});
