/*
 * exclusions.js : réseaux exclus, retraités, hors cible, classement par famille (prompt v8, section Exclusions).
 * Module pur. Navigateur : globalThis.CMF.exclusions ; Node : require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.CMF = root.CMF || {}; root.CMF.exclusions = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  }

  // Réseaux et groupements exclus (liste v8). Comparaison sur le nom normalisé, mot entier.
  var RESEAUX = [
    'Capfinances', 'UFF', 'Union Financière de France', 'Gan', 'Société Générale', 'BNP Paribas', 'Natixis', 'Allianz', 'AXA',
    'Crédit Agricole', 'LCL', 'Generali', 'Crédit Mutuel', 'Banque Populaire', 'SOFIAP', "Caisse d'Épargne", 'CIC', 'MMA',
    'Valority', 'Quintet', 'Louvre Banque Privée', 'L&A Finance', 'Laplace', 'Valofi', 'Predictis', 'Astoria', 'Inovéa',
    'Bienviyance', 'VIP Conseils', 'Le Conservateur', 'Cerfrance', 'Altius', 'Massalia', 'Climb', 'Prodemial', 'Stellium'
  ];
  var RESEAUX_RE = RESEAUX.map(function (r) {
    var n = norm(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]?');
    return { nom: r, re: new RegExp('(^|[^a-z0-9])' + n + '($|[^a-z0-9])') };
  });

  // Renvoie le nom du réseau exclu trouvé dans le texte (société ou headline), sinon null.
  function reseauExclu(texte) {
    var t = norm(texte);
    if (!t) return null;
    for (var i = 0; i < RESEAUX_RE.length; i++) if (RESEAUX_RE[i].re.test(t)) return RESEAUX_RE[i].nom;
    return null;
  }

  // Retraités : « retraité », « retired », « ancien », « ex- », « honoraire ».
  var RETRAITE_RE = /(^|[^a-z])(retraite(e|s|es)?|retired|ancien(ne|s|nes)?|ex-[a-z]|honoraire(s)?)($|[^a-z])/;
  function retraite(texte) { return RETRAITE_RE.test(norm(texte)); }

  // Hors cible : motif en clair, sinon null.
  var HORS_CIBLE = [
    { re: /(^|[^a-z])(stagiaire|alternante?|alternance|apprentie?|etudiante?|student|intern|internship)($|[^a-z])/, motif: 'stagiaire, alternant ou étudiant' },
    { re: /(en recherche d|a la recherche d|open to work|en transition professionnelle|sans emploi|en disponibilite)/, motif: 'sans poste actuel' },
    { re: /(expert[- ]comptable|cabinet comptable|commissaire aux comptes|expertise comptable)/, motif: 'comptable' },
    { re: /(courtier en (credit|pret)|courtage en (credit|pret)|courtier immobilier|credit immobilier)/, motif: 'courtier en crédit' },
    { re: /(agent immobilier|agence immobiliere|negociateur immobilier|mandataire immobilier|transaction immobiliere|promoteur immobilier)/, motif: 'immobilier pur' },
    { re: /(asset management|societe de gestion|gerant de portefeuille|portfolio manager|gestion d'actifs pour compte de tiers)/, motif: 'société de gestion' },
    { re: /(banque d'investissement|investment bank|corporate and investment|(^|[^a-z])cib($|[^a-z])|structureur|emetteur de produits structures)/, motif: "émetteur ou banque d'investissement" }
  ];
  function horsCible(texte) {
    var t = norm(texte);
    if (!t) return null;
    // Un family office reste dans la cible même s'il gère des actifs.
    var fo = /family office/.test(t);
    for (var i = 0; i < HORS_CIBLE.length; i++) {
      if (HORS_CIBLE[i].re.test(t)) {
        if (fo && HORS_CIBLE[i].motif === 'société de gestion') continue;
        return HORS_CIBLE[i].motif;
      }
    }
    return null;
  }

  // Classement par famille à partir du headline, du poste et de la société.
  var CLASSES = [
    { famille: 'dist', categorie: 'family_office', re: /(family office|multi[- ]family|single family)/ },
    { famille: 'dist', categorie: 'banque_privee', re: /(banque privee|banquier prive|banquiere privee|private bank|gestion de fortune|wealth manage)/ },
    { famille: 'dist', categorie: 'cgp', re: /(gestion de patrimoine|gestion privee|conseil(ler|lere)?s? (en )?patrimo|conseil patrimonial|(^|[^a-z])cgpi?($|[^a-z])|(^|[^a-z])cif($|[^a-z])|ingenieur(e)? patrimonial|ingenierie patrimoniale|conseil(ler|lere)? en investissements? financiers?|patrimoine)/ },
    { famille: 'inst', categorie: 'mutuelle', re: /(mutuelle|mutualiste|(^|[^a-z])mutualite)/ },
    { famille: 'inst', categorie: 'prevoyance', re: /(prevoyance|caisse de retraite|retraite complementaire)/ },
    { famille: 'inst', categorie: 'fondation', re: /(fondation|fonds de dotation)/ },
    { famille: 'inst', categorie: 'association', re: /(association|federation|(^|[^a-z])ong($|[^a-z]))/ },
    { famille: 'inst', categorie: 'corporate', re: /(tresori(er|ere)|tresorerie|treasur|directeur financier|directrice financiere|(^|[^a-z])daf($|[^a-z])|(^|[^a-z])cfo($|[^a-z])|chief financial|direct(eur|rice) des investissements|responsable des investissements|(^|[^a-z])alm($|[^a-z]))/ }
  ];
  /*
   * Renvoie { famille: 'dist'|'inst', categorie } ou null (hors périmètre).
   */
  function classer(profil) {
    var t = norm([profil.headline, profil.poste, profil.org].filter(Boolean).join(' | '));
    if (!t) return null;
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].re.test(t)) return { famille: CLASSES[i].famille, categorie: CLASSES[i].categorie };
    return null;
  }

  // Nom abrégé : « Paul D. », « P. Durand », prénom seul.
  function nomAbrege(nom) {
    var mots = String(nom || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (mots.length < 2) return true;
    return /^\p{L}\.?$/u.test(mots[0]) || /^\p{L}\.?$/u.test(mots[mots.length - 1]);
  }

  // Clé de société pour compter les doublons dans le lot (formes juridiques et ponctuation retirées).
  function cleSociete(org) {
    return norm(org).replace(/[.,()]/g, ' ')
      .replace(/(^| )(sas|sarl|sa|sasu|eurl|scp|selarl|groupe|group|cabinet|conseil|conseils|finance|gestion privee|patrimoine)(?= |$)/g, ' ')
      .replace(/\s+/g, ' ').trim() || norm(org);
  }

  /*
   * Motif d'exclusion d'un profil pour la prospection (hors anniversaires), sinon null.
   * profil : { nom, headline, poste, org, retraite }
   */
  function motifExclusion(profil) {
    var texte = [profil.headline, profil.poste].filter(Boolean).join(' | ');
    if (profil.retraite === true || retraite(texte)) return 'retraité';
    var hc = horsCible(texte);
    if (hc) return 'hors cible : ' + hc;
    var r = reseauExclu(profil.org) || reseauExclu(texte);
    if (r) return 'réseau exclu : ' + r;
    return null;
  }

  return {
    RESEAUX: RESEAUX, norm: norm, reseauExclu: reseauExclu, retraite: retraite, horsCible: horsCible,
    classer: classer, nomAbrege: nomAbrege, cleSociete: cleSociete, motifExclusion: motifExclusion
  };
});
