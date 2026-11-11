/*
 * page.js : rend la page « Lot du jour » (fragment HTML sans doctype ni html/head/body, sobre, sans bouton d'envoi).
 * Module pur. Navigateur : globalThis.CMF.page ; Node : require().
 * Jamais d'email ni de téléphone : les extraits sont masqués avant affichage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.CMF = root.CMF || {}; root.CMF.page = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function masquer(s) {
    return String(s || '')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[coordonnées masquées]')
      .replace(/(?:\+|00)?\d(?:[\s.\-]?\d){8,13}/g, '[coordonnées masquées]');
  }
  var LIBELLE = { anniversaire: 'Anniversaire', relance1: 'Relance 1', relance2: 'Relance 2', premier: 'Premier message', backlog: 'Backlog Folk', invitation: 'Invitation sans note' };
  var ETATS = { preparation: 'Lot préparé, en attente du « go »', execution: 'Envoi en cours', termine: 'Lot terminé', limite: 'Limite LinkedIn',
    injoignable: 'PC injoignable', blocage: "Blocage d'autorisation", weekend: 'Week-end : anniversaires seulement' };

  function lienFil(urn) { return 'https://www.linkedin.com/messaging/compose/?recipient=' + encodeURIComponent(urn); }
  function lienProfil(slug) { return 'https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/'; }
  function nomLie(x) {
    var n = esc(x.nom || x.slug || x.urn || '?');
    return x.slug ? '<a href="' + lienProfil(x.slug) + '" target="_blank" rel="noopener">' + n + '</a>' : n;
  }
  function tableau(entetes, lignes, vide) {
    if (!lignes.length) return '<p class="vide">' + esc(vide) + '</p>';
    return '<div class="defile"><table><thead><tr>' + entetes.map(function (e) { return '<th>' + esc(e) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + lignes.map(function (l) { return '<tr>' + l.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  /*
   * plan   : sortie de rules.construirePlan
   * opts   : { etat, envoyes: [{ urn, heure, resultat }], folk: { creees, modifiees, interactions, echecs }, historique: [{ date, resume }] }
   */
  function rendre(plan, opts) {
    opts = opts || {};
    var B = plan.budgets || {}, c = plan.compteurs || {};
    var envoyes = {};
    (opts.envoyes || []).forEach(function (e) { envoyes[e.urn] = e; });
    var etat = opts.etat || (plan.weekend ? 'weekend' : 'preparation');
    function jauge(nom, b) {
      if (!b) return '';
      var fait = b.semaine || 0, max = b.plafondSemaine || 1;
      return '<div class="jauge"><span class="k">' + esc(nom) + '</span><span class="v">' + fait + '/' + max + '</span>' +
        '<span class="barre"><i style="width:' + Math.min(100, Math.round(100 * fait / max)) + '%"></i></span>' +
        '<span class="s">reste aujourd\'hui : ' + (b.reste || 0) + '</span></div>';
    }
    var h = [];
    h.push('<title>Prospection LinkedIn CMF</title>');
    h.push('<style>' + CSS + '</style>');
    h.push('<main>');
    h.push('<header><p class="sur">Prospection LinkedIn CMF · moteur v' + esc(plan.version || '') + '</p><h1>Lot du ' + esc(plan.date) + '</h1>' +
      '<p class="etat etat-' + esc(etat) + '">' + esc(ETATS[etat] || etat) + '</p>' +
      '<div class="jauges">' + jauge('Invitations (7 jours)', B.inv) + jauge('Premiers messages (7 jours)', B.msg) + jauge('Backlog (7 jours)', B.bkl) + '</div>' +
      '<p class="resume">Lot : ' + (c.bday || 0) + ' anniversaires, ' + (c.rel || 0) + ' relances (sans plafond), ' + (c.msg || 0) + ' premiers messages, ' +
      (c.bkl || 0) + ' backlog, ' + (c.inv || 0) + ' invitations.' + (B.inv && B.inv.limite ? ' Invitations arrêtées jusqu\'à lundi (limite LinkedIn).' : '') + '</p></header>');

    if ((plan.erreurs || []).length) {
      h.push('<section class="alerte"><h2>Erreurs bloquantes</h2>' + tableau(['URN', 'Contacts', 'Motif'], plan.erreurs.map(function (e) {
        return [esc(e.urn), esc((e.noms || []).join(', ')), esc(e.motif)];
      }), '') + '</section>');
    }

    h.push('<section><h2>Réponses à traiter par Laurent</h2>' + tableau(['Contact', 'Organisation', 'Date', 'Motif', 'Extrait'], (plan.aTraiter || []).map(function (a) {
      var fil = a.urn ? ' <a class="fil" href="' + lienFil(a.urn) + '" target="_blank" rel="noopener">fil</a>' : '';
      return [nomLie(a) + fil, esc(a.org || ''), esc((a.date || '').slice(0, 10)), esc(a.motif), esc(masquer(a.extrait).slice(0, 160).replace(/[\uD800-\uDBFF]$/, '').replace(/^[\uDC00-\uDFFF]/, ''))];
    }), 'Aucune réponse en attente.') + '</section>');

    h.push('<section><h2>Lot du jour</h2><p class="note">Rien ne part avant le « go » de Laurent. Chaque envoi est fait un par un dans LinkedIn, après contrôle du fil.</p>' +
      tableau(['#', 'Contact', 'Organisation', 'Type', 'Version', 'Motif', 'Fil', 'Envoi'], (plan.plan || []).map(function (a) {
        var e = envoyes[a.urn];
        return [String(a.ordre), nomLie(a), esc(a.org || ''), esc(LIBELLE[a.type] || a.type), esc(a.version || ''), esc(a.motif || ''),
          a.type === 'invitation' ? '' : (a.filLu ? 'lu' : 'à lire'), e ? esc((e.heure || '') + ' ' + (e.resultat || 'envoyé')) : 'en attente'];
      }), 'Aucun envoi prévu aujourd\'hui.'));
    var textes = (plan.plan || []).filter(function (a) { return a.texte && a.type !== 'anniversaire'; });
    if (textes.length) {
      h.push('<details><summary>Textes prévus (' + textes.length + ')</summary>' + textes.map(function (a) {
        return '<article><h3>' + a.ordre + '. ' + esc(a.nom || '') + ' · ' + esc(a.version || '') + '</h3><pre>' + esc(a.texte) + '</pre></article>';
      }).join('') + '</details>');
    }
    h.push('</section>');

    h.push('<section><h2>Reportés</h2>' + tableau(['Contact', 'Organisation', 'Prévu', 'Motif'], (plan.reportes || []).map(function (r) {
      return [nomLie(r), esc(r.org || ''), esc(LIBELLE[r.prevu] || r.prevu || ''), esc(r.motif)];
    }), 'Aucun report.') + '</section>');

    h.push('<section><h2>Écartés</h2>' + tableau(['Contact', 'Organisation', 'Motif'], (plan.ecartes || []).map(function (r) {
      return [nomLie(r), esc(r.org || ''), esc(r.motif)];
    }), 'Aucun contact écarté.') + '</section>');

    if ((plan.clotures || []).length) {
      h.push('<section><h2>Clôtures (Closed-lost dormant)</h2>' + tableau(['Contact', 'Organisation', 'Motif'], plan.clotures.map(function (r) {
        return [nomLie(r), esc(r.org || ''), esc(r.motif)];
      }), '') + '</section>');
    }

    var f = opts.folk;
    h.push('<section><h2>Folk</h2>' + (f ? '<p>' + (f.creees || 0) + ' fiches créées, ' + (f.modifiees || 0) + ' fiches modifiées, ' + (f.interactions || 0) +
      ' interactions créées, ' + (f.echecs || 0) + ' échecs.</p>' + ((f.signalements || []).length ? '<ul>' + f.signalements.map(function (s) { return '<li>' + esc(masquer(s)) + '</li>'; }).join('') + '</ul>' : '')
      : '<p class="vide">Écritures Folk en lot après les envois.</p>') + '</section>');

    if ((opts.historique || []).length) {
      h.push('<section><h2>Historique (7 jours)</h2>' + opts.historique.slice(0, 7).map(function (j) {
        return '<details><summary>' + esc(j.date) + '</summary><p>' + esc(masquer(j.resume)) + '</p></details>';
      }).join('') + '</section>');
    }
    h.push('</main>');
    return h.join('\n');
  }

  var CSS = [
    ':root{--fond:#f7f6f2;--carte:#ffffff;--encre:#1c2530;--doux:#5d6875;--trait:#dcd8cf;--accent:#0b4f6c;--alerte:#a4321f;--ok:#2f6b3c;--jauge:#e7e3da}',
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fond:#12171d;--carte:#1a212a;--encre:#e8e6e1;--doux:#9aa5b1;--trait:#2c3642;--accent:#7cc0dc;--alerte:#f08a75;--ok:#8fd19e;--jauge:#28313c}}',
    ':root[data-theme="dark"]{--fond:#12171d;--carte:#1a212a;--encre:#e8e6e1;--doux:#9aa5b1;--trait:#2c3642;--accent:#7cc0dc;--alerte:#f08a75;--ok:#8fd19e;--jauge:#28313c}',
    'body{margin:0;background:var(--fond);color:var(--encre);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
    'main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}',
    'h1{font-size:28px;margin:2px 0 8px;letter-spacing:-.01em}h2{font-size:17px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 4px}',
    '.sur{margin:0;color:var(--doux);font-size:13px;text-transform:uppercase;letter-spacing:.06em}',
    '.etat{display:inline-block;margin:0 0 14px;padding:3px 10px;border:1px solid var(--trait);border-radius:999px;font-size:13px;color:var(--accent)}',
    '.etat-limite,.etat-blocage,.etat-injoignable{color:var(--alerte);border-color:var(--alerte)}.etat-termine{color:var(--ok)}',
    '.jauges{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:10px}',
    '.jauge{background:var(--carte);border:1px solid var(--trait);border-radius:8px;padding:10px 12px;display:grid;grid-template-columns:1fr auto;gap:4px 8px}',
    '.jauge .k{color:var(--doux);font-size:13px}.jauge .v{font-variant-numeric:tabular-nums;font-weight:600}',
    '.jauge .barre{grid-column:1/-1;height:6px;background:var(--jauge);border-radius:3px;overflow:hidden}.jauge .barre i{display:block;height:100%;background:var(--accent)}',
    '.jauge .s{grid-column:1/-1;color:var(--doux);font-size:12px}',
    '.resume,.note{color:var(--doux);margin:6px 0 0}',
    'section{background:var(--carte);border:1px solid var(--trait);border-radius:8px;padding:16px;margin-top:16px}',
    'section.alerte{border-color:var(--alerte)}section.alerte h2{color:var(--alerte)}',
    '.defile{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}',
    'th{text-align:left;color:var(--doux);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:6px 10px 6px 0;border-bottom:1px solid var(--trait);white-space:nowrap}',
    'td{padding:7px 10px 7px 0;border-bottom:1px solid var(--trait);vertical-align:top}tr:last-child td{border-bottom:0}',
    'a{color:var(--accent)}a.fil{font-size:12px;margin-left:6px}.vide{color:var(--doux);margin:0}',
    'details{margin-top:12px}summary{cursor:pointer;color:var(--accent)}',
    'pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Consolas,monospace;background:var(--fond);border:1px solid var(--trait);border-radius:6px;padding:10px;margin:0}'
  ].join('');

  return { rendre: rendre, masquer: masquer };
});
