/*
 * texts.js : textes figés v8 (seuls textes autorisés à l'envoi), salutations, rotation.
 * Module pur (ni DOM ni réseau). Navigateur : globalThis.CMF.texts ; Node : require().
 * Les chaînes de TEXTES sont la copie caractère pour caractère du prompt v8, à une retouche près
 * (consigne de Laurent, 2026-11-11) : « finance structurée » n'est plus employé ; AI1, AI2 et BI1 parlent de
 * « solutions d'investissement » et de « produits structurés ».
 * test/rules.test.js vérifie leur empreinte SHA-256 : toute retouche casse le test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.CMF = root.CMF || {}; root.CMF.texts = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '9.0.0';

  var TEXTES = {
    A1: [
      'Bonjour [Prénom],',
      "[Merci pour la connexion. ]Chez CMF, je mets en concurrence, de façon anonyme, plus d'une vingtaine d'émetteurs de produits structurés (Phoenix, Athena, capital protégé, CLN...) pour obtenir les conditions les plus compétitives sur le cahier des charges de chaque client.",
      'Deux choses que je peux vous proposer, sans engagement :',
      '- le Weekly, une courte note de marché hebdomadaire réservée aux professionnels, sur votre adresse professionnelle si cela vous intéresse ;',
      "- un regard extérieur sur un produit en portefeuille ou à l'étude : décodage du payoff et comparaison avec ce que le marché cote aujourd'hui.",
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    A2: [
      'Bonjour [Prénom],',
      "[Merci pour la connexion. ]J'accompagne des CGP, des family offices et des banques privées sur les produits structurés : à partir du cahier des charges de vos clients, je consulte en parallèle plus d'une vingtaine d'émetteurs, sans dévoiler l'identité de votre cabinet, et je vous restitue les conditions les plus compétitives obtenues.",
      'Si le sujet vous parle, je vous envoie volontiers le Weekly, ma note de marché hebdomadaire réservée aux professionnels, ou je relis avec vous une structure en portefeuille.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    A3: [
      'Bonjour [Prénom],',
      "[Merci pour la connexion. ]Quand vous mettez en place un Phoenix ou un Athena pour un client, combien d'émetteurs consultez-vous ? Chez CMF, j'en mets plus d'une vingtaine en concurrence, de façon anonyme, pour obtenir les conditions les plus compétitives sur un cahier des charges donné.",
      'Je peux vous le montrer sur un cas concret, ou simplement vous envoyer le Weekly, ma note de marché hebdomadaire réservée aux professionnels.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    AI1: [
      'Bonjour Madame X / Monsieur X,',
      'Merci pour votre connexion. Je suis Laurent Sebah, Capital Management France, solutions d\'investissement et produits structurés. Je serais heureux d\'échanger avec vous, en visio ou lors d\'une rencontre à Paris, sur la gestion de la trésorerie de votre organisation. Quelles seraient vos disponibilités dans les prochaines semaines ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    AI2: [
      'Bonjour Madame X / Monsieur X,',
      "Merci pour votre connexion. Chez Capital Management France, j'accompagne des mutuelles, des fondations et des trésoreries d'entreprise sur les solutions d'investissement et les produits structurés : à partir de votre cahier des charges (horizon, niveau de protection du capital, contraintes réglementaires et comptables), je mets en concurrence, de façon anonyme, plus d'une vingtaine d'émetteurs.",
      'Seriez-vous disponible pour un premier échange de 20 minutes, en visio ou à Paris ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    AI3: [
      'Bonjour Madame X / Monsieur X,',
      "Merci pour votre connexion. Après 30 ans de marchés actions et crédit, j'accompagne aujourd'hui des investisseurs institutionnels chez Capital Management France sur les produits structurés et le placement de la trésorerie, avec une mise en concurrence anonyme de plus d'une vingtaine d'émetteurs.",
      'Je serais heureux de vous présenter mon approche lors d\'un échange en visio ou à Paris. Quelles seraient vos disponibilités ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    B1: [
      'Bonjour [Prénom],',
      "Je me permets de revenir vers vous. Chez CMF, je vous donne accès, en mise en concurrence anonyme de plus d'une vingtaine d'émetteurs, aux conditions les plus compétitives du marché sur les produits structurés, construits sur le cahier des charges de vos clients.",
      "Si vous avez 20 minutes cette semaine ou la suivante, je vous propose un échange en visio : vous me donnez un cas en cours, je vous montre ce que le marché cote aujourd'hui. Je vous envoie aussi volontiers le Weekly, ma note de marché hebdomadaire réservée aux professionnels.",
      'Dites-moi quel créneau vous arrange.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    B2: [
      'Bonjour [Prénom],',
      "Je reviens vers vous avec une proposition concrète : confiez-moi le cahier des charges d'un de vos clients (sous-jacent, horizon, niveau de protection), je consulte en parallèle plus d'une vingtaine d'émetteurs sans dévoiler votre identité et je vous restitue les conditions les plus compétitives obtenues, sans engagement.",
      'Un échange de 20 minutes en visio suffit pour lancer un premier cas. Quel créneau vous conviendrait cette semaine ou la suivante ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    B3: [
      'Bonjour [Prénom],',
      "Je me permets de vous relancer. Sur un même payoff, les conditions varient sensiblement d'un émetteur à l'autre. Chez CMF, je mets ces émetteurs en concurrence, de façon anonyme, à partir du cahier des charges de vos clients, pour obtenir la solution la plus compétitive du moment.",
      'Je vous propose 20 minutes en visio pour vous le montrer sur un cas réel, et je vous adresse volontiers le Weekly, ma note de marché hebdomadaire réservée aux professionnels.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    BI1: [
      'Bonjour Madame X / Monsieur X,',
      "Je me permets de revenir vers vous. Chez Capital Management France, j'accompagne des mutuelles, des fondations, des associations et des trésoreries d'entreprise : à partir de votre cahier des charges, je mets en concurrence, de façon anonyme, plus d'une vingtaine d'émetteurs pour vous donner accès aux conditions les plus compétitives sur les solutions d'investissement et les produits structurés.",
      'Seriez-vous disponible pour un échange de 20 minutes, en visio ou à Paris, cette semaine ou la suivante ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    BI2: [
      'Bonjour Madame X / Monsieur X,',
      "Je reviens vers vous avec une proposition simple : un échange de 20 minutes sur vos contraintes de placement (horizon, protection du capital, cadre réglementaire et comptable), puis, si vous le souhaitez, une mise en concurrence anonyme de plus d'une vingtaine d'émetteurs sur votre cahier des charges, sans engagement.",
      'Quel créneau vous conviendrait ?',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    E1: [
      'Bonjour [Prénom],',
      'Dernier message de ma part, pour ne pas encombrer votre messagerie. Si les produits structurés ne sont pas un sujet pour vous en ce moment, aucun souci. Si un jour vous souhaitez un second avis sur une structure en portefeuille, ou une comparaison des cotations entre émetteurs sur un même payoff, je reste joignable ici.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    E2: [
      'Bonjour [Prénom],',
      'Dernier message de ma part. Le jour où vous aurez un cahier des charges à mettre en concurrence pour vos clients, ou une structure en portefeuille à faire relire, je reste disponible ici, en toute discrétion.',
      'Bien cordialement,',
      'Laurent'
    ].join('\n'),
    C: 'Happy Birthday 🍾🍾🍾🍾'
  };

  // Séries et ordre de rotation.
  var SERIES = {
    A: ['A1', 'A2', 'A3'],
    AI: ['AI1', 'AI2', 'AI3'],
    B: ['B1', 'B2', 'B3'],
    BI: ['BI1', 'BI2'],
    E: ['E1', 'E2'],
    C: ['C']
  };

  // Étape du cycle portée par chaque série : A (prise de contact), B (relance 1), E (relance 2), C (anniversaire).
  var ETAPE = { A: 'A', AI: 'A', B: 'B', BI: 'B', E: 'E', C: 'C' };

  var MERCI = 'Merci pour la connexion. ';

  function serieDe(version) {
    var m = /^([A-Z]+?)(\d*)$/.exec(String(version || ''));
    return m && SERIES[m[1]] ? m[1] : null;
  }

  // Série à utiliser pour une étape et une famille.
  function seriePour(etape, famille) {
    if (etape === 'C') return 'C';
    if (etape === 'E') return 'E';
    if (etape === 'A') return famille === 'inst' ? 'AI' : 'A';
    if (etape === 'B') return famille === 'inst' ? 'BI' : 'B';
    return null;
  }

  /*
   * Rend le texte d'une version.
   * opts : { famille: 'dist'|'inst', salut: 'Paul' | 'Madame Dupont', merci: booléen }
   * Lève une erreur si un jeton reste non remplacé (jamais d'envoi d'un gabarit brut).
   */
  function rendre(version, opts) {
    opts = opts || {};
    var t = TEXTES[version];
    if (!t) throw new Error('version inconnue : ' + version);
    if (version === 'C') return t;
    var salut = String(opts.salut || '').trim();
    if (!salut) throw new Error('salutation vide pour ' + version);
    t = t.replace('[Prénom]', salut).replace('Madame X / Monsieur X', salut);
    t = t.replace('[Merci pour la connexion. ]', opts.merci && opts.famille !== 'inst' ? MERCI : '');
    if (version === 'E2' && opts.famille === 'inst') t = t.replace('pour vos clients', 'pour votre organisation');
    if (/\[|\]|Madame X|Monsieur X/.test(t)) throw new Error('jeton non remplacé dans ' + version);
    return t;
  }

  function compact(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // Signature d'une version : début de la 2e ligne, sans l'insert facultatif.
  var SIGNATURES = (function () {
    var out = [];
    Object.keys(TEXTES).forEach(function (v) {
      if (v === 'C') return;
      var l2 = TEXTES[v].split('\n')[1].replace('[Merci pour la connexion. ]', '');
      out.push({ version: v, sig: compact(l2).slice(0, 60) });
    });
    return out;
  })();

  /*
   * Reconnaît un texte figé dans un message lu dans un fil.
   * Renvoie { version, serie, etape } ou null (message libre ou texte d'une ancienne version).
   */
  function identifier(texte) {
    var c = compact(texte);
    if (!c) return null;
    if (/^happy birthday/i.test(c)) return { version: 'C', serie: 'C', etape: 'C' };
    for (var i = 0; i < SIGNATURES.length; i++) {
      if (c.indexOf(SIGNATURES[i].sig) !== -1) {
        var s = serieDe(SIGNATURES[i].version);
        return { version: SIGNATURES[i].version, serie: s, etape: ETAPE[s] };
      }
    }
    return null;
  }

  /*
   * Rotation : version suivante de la série après `derniere`, en écartant celles déjà reçues par le contact
   * et la dernière version envoyée (jamais deux envois consécutifs identiques).
   * Renvoie { version } ou { version: null, motif: 'epuise' | 'rotation' }.
   */
  function versionSuivante(serie, derniere, dejaRecues) {
    var liste = SERIES[serie];
    if (!liste) throw new Error('série inconnue : ' + serie);
    dejaRecues = dejaRecues || [];
    if (liste.length === 1) return { version: liste[0] };
    var i0 = liste.indexOf(derniere); // -1 si aucune : on commence à la version 1
    for (var k = 1; k <= liste.length; k++) {
      var v = liste[(i0 + k + liste.length) % liste.length];
      if (v === derniere) continue;
      if (dejaRecues.indexOf(v) !== -1) continue;
      return { version: v };
    }
    var toutes = liste.every(function (v) { return dejaRecues.indexOf(v) !== -1; });
    return { version: null, motif: toutes ? 'epuise' : 'rotation' };
  }

  // ---------- Noms, prénoms, civilité ----------

  function sansAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function cle(s) { return sansAccents(s).toLowerCase().replace(/[^a-z-]/g, ''); }

  function capitaliser(mot) {
    // « DUPONT » -> « Dupont », « JEAN-PIERRE » -> « Jean-Pierre », « de LA TOUR » géré mot à mot.
    if (!mot) return mot;
    if (mot !== mot.toUpperCase() || mot.length <= 1) return mot;
    return mot.toLowerCase().replace(/(^|[-' ])([a-zà-ÿ])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  /*
   * Découpe un nom complet LinkedIn.
   * Renvoie { prenom, nomFamille, abrege } ; abrege = nom de famille réduit à une initiale (« Paul D. »).
   */
  function decouperNom(nomComplet) {
    var s = String(nomComplet || '')
      .replace(/\([^)]*\)/g, ' ')          // « (Elle) », « (CFA) »
      .replace(/[,|•·–—].*$/, ' ')        // titres après une virgule ou un séparateur
      .replace(/[^\p{L}\p{M}.' -]/gu, ' ') // emojis, chiffres
      .replace(/\s+/g, ' ').trim();
    if (!s) return { prenom: '', nomFamille: '', abrege: true };
    var mots = s.split(' ');
    // « DUPONT Christine » : nom en capitales placé avant le prénom.
    if (mots.length >= 2 && mots[0].length > 1 && mots[0] === mots[0].toUpperCase() &&
        mots[mots.length - 1] !== mots[mots.length - 1].toUpperCase()) {
      mots.push(mots.shift());
    }
    var prenom = capitaliser(mots[0]);
    var reste = mots.slice(1);
    var nomFamille = reste.map(capitaliser).join(' ');
    var abrege = reste.length === 0 || /^\p{L}\.?$/u.test(reste[reste.length - 1]) || /^\p{L}\.?$/u.test(mots[0]);
    return { prenom: prenom, nomFamille: nomFamille, abrege: abrege };
  }

  var PRENOMS_F = ('adele adeline agathe agnes aida alexandra alexia alice alicia aline alix-f amandine amelie anais anastasia andree ' +
    'angelique anna anne annabelle annick annie anouk antoinette ariane arlette astrid audrey aude aurelie aurore axelle barbara beatrice ' +
    'benedicte berenice bernadette blandine brigitte carine carla carole caroline cassandra catherine cecile celia celine chantal charlene ' +
    'charlotte chloe christelle christiane christine claire clara clarisse claudia claudine clemence clementine clotilde colette coline ' +
    'constance coralie corinne cynthia daniele danielle daphne deborah delphine denise diane dorothee edith eleonore eliane elisa elisabeth ' +
    'elise elodie eloise elsa emeline emilie emma emmanuelle estelle esther eugenie eva eve evelyne fabienne fanny fatima florence ' +
    'floriane francine francoise frederique gabrielle gaelle genevieve geraldine germaine ghislaine gisele gwenaelle gwendoline helene ' +
    'heloise henriette hortense huguette ines ingrid irene isabelle jacqueline jade jeanne jeannine jennifer jessica joelle johanna josephine ' +
    'josette josiane judith julia julie juliette justine karine katia laetitia lara laura laure laurence laurie lea leila lena leonie liliane ' +
    'lina linda lisa lise louise lucie lucile lucille ludivine lydia lydie madeleine maeva magali manon marcelle margaux margot marguerite ' +
    'maria marianne marie marielle marina marine marion marjorie marlene marthe martine maryse mathilde maud melanie melissa michele ' +
    'micheline michelle mireille monique muriel murielle myriam nadege nadia nadine natacha nathalie nelly nicole nina noemie odette odile ' +
    'olivia ophelie oriane pascale patricia paule paulette pauline peggy perrine priscilla rachel raphaelle raymonde rebecca regine renee ' +
    'rita romane rosalie rose roseline sabine sabrina salome sandra sandrine sarah severine simone solange solene sonia sophie stephanie ' +
    'suzanne sylvaine sylviane sylvie tatiana therese tiphaine valentine valerie vanessa veronique victoire victoria violaine violette ' +
    'virginie viviane yolande yvette yvonne zoe').split(' ');

  var PRENOMS_M = ('adrien alain alban albert alexandre alexis alfred anatole andre anthony antoine antonin armand arnaud arthur aurelien ' +
    'axel aymeric baptiste bastien benjamin benoit bernard bertrand boris brice bruno cedric charles christian christophe clement come ' +
    'corentin cyril cyrille damien daniel david denis didier dimitri edgar edmond edouard emile emmanuel eric erwan etienne eudes fabien ' +
    'fabrice felix ferdinand florent florian francis franck francois frank frederic gabriel gael gaetan gaspard gauthier gautier geoffrey ' +
    'geoffroy georges gerald gerard ghislain gilbert gilles gregoire gregory guillaume gustave guy henri herve hubert hugo hugues ivan ' +
    'jacques jean jeremie jeremy jerome joachim joel jonathan jordan joseph jules julien justin kevin lambert laurent leo leon leonard ' +
    'lionel loic louis luc lucas lucien ludovic marc marcel marin marius martin mathias mathieu matthias matthieu maurice maxence maxime ' +
    'maximilien michael michel mickael nathan nicolas noel norbert octave olivier pascal patrice patrick paul philippe pierre pierrick ' +
    'quentin raoul raphael raymond regis remi remy renaud rene richard robert robin rodolphe roger roland romain romuald samuel sebastien ' +
    'serge simon stanislas stephan stephane sylvain theo theodore theophile thibaud thibault thibaut thierry thomas timothee tristan ulysse ' +
    'valentin valery victor vincent vivien william xavier yann yannick yoann yvan yves yvon').split(' ');

  // Prénoms mixtes ou épicènes : jamais de civilité déduite.
  var PRENOMS_MIXTES = ('alix camille claude dominique sacha charlie morgan lou andrea eden yael kim alex sam leslie gwenn mael lois ange ' +
    'celeste jackie jo dany noa swann stephane-f yannick-f loup sasha louison candide maxence-f marie-f').split(' ');

  var SET_F = {}, SET_M = {}, SET_X = {};
  PRENOMS_F.forEach(function (p) { SET_F[p] = 1; });
  PRENOMS_M.forEach(function (p) { SET_M[p] = 1; });
  PRENOMS_MIXTES.forEach(function (p) { SET_X[p] = 1; });

  /*
   * Civilité déduite du prénom : 'Madame', 'Monsieur' ou null (mixte ou inconnu : à traiter par Laurent).
   * Prénom composé : le premier élément décide (Jean-Marie : Monsieur ; Marie-Pierre : Madame).
   */
  function civilite(prenom) {
    var k = cle(prenom);
    if (!k) return null;
    var premier = k.split('-')[0];
    if (SET_X[k] || SET_X[premier]) return null;
    var f = SET_F[k] || SET_F[premier], m = SET_M[k] || SET_M[premier];
    if (f && !m) return 'Madame';
    if (m && !f) return 'Monsieur';
    return null;
  }

  /*
   * Salutation d'un contact.
   * contact : { nom, prenom?, nomFamille?, civilite?, famille }
   * Renvoie { salut } ou { salut: null, motif }.
   */
  function salutation(contact) {
    var d = decouperNom(contact.nom || [contact.prenom, contact.nomFamille].filter(Boolean).join(' '));
    var prenom = contact.prenom ? capitaliser(String(contact.prenom).trim()) : d.prenom;
    var nomFamille = contact.nomFamille ? capitaliser(String(contact.nomFamille).trim()) : d.nomFamille;
    var abrege = contact.nomFamille ? /^\p{L}\.?$/u.test(nomFamille) : d.abrege;
    if (!prenom || /^\p{L}\.?$/u.test(prenom)) return { salut: null, motif: 'prénom illisible' };
    if (contact.famille !== 'inst') return { salut: prenom };
    if (abrege) return { salut: prenom };
    var civ = contact.civilite === 'Madame' || contact.civilite === 'Monsieur' ? contact.civilite : civilite(prenom);
    if (!civ) return { salut: null, motif: 'civilité incertaine' };
    return { salut: civ + ' ' + nomFamille };
  }

  return {
    VERSION: VERSION, TEXTES: TEXTES, SERIES: SERIES, ETAPE: ETAPE, MERCI: MERCI,
    serieDe: serieDe, seriePour: seriePour, rendre: rendre, identifier: identifier,
    versionSuivante: versionSuivante, decouperNom: decouperNom, civilite: civilite, salutation: salutation,
    sansAccents: sansAccents, capitaliser: capitaliser
  };
});
