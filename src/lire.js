/*
 * lire.js : lecture d'une entrée JSON pour les outils en ligne de commande.
 * Accepte un fichier JSON, ou un dossier de documents exportés par ArtifactData (out_dir) :
 * un fichier <identifiant>.json par document ; l'identifiant devient le champ id.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function lireJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); }

function lire(f, defaut) {
  if (!f) return defaut;
  if (fs.statSync(f).isDirectory()) {
    return fs.readdirSync(f).filter((n) => n.endsWith('.json')).sort().map((n) => {
      const j = lireJson(path.join(f, n));
      const d = j && j.data && typeof j.data === 'object' && !Array.isArray(j.data) && !j.urn ? j.data : j;
      return Object.assign({ id: n.replace(/\.json$/, '') }, d);
    });
  }
  return lireJson(f);
}

module.exports = { lire };
