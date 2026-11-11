#!/usr/bin/env node
// Produit les fichiers compacts de dist/ (à coller dans javascript_tool quand la page ne peut pas charger le dépôt).
// Nécessite esbuild : npx --yes esbuild (réseau au premier lancement).
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const cibles = {
  'collect.min.js': ['collect.js'],
  'moteur.min.js': ['texts.js', 'exclusions.js', 'rules.js', 'page.js']
};
for (const [sortie, fichiers] of Object.entries(cibles)) {
  const entree = fichiers.map(src).join('\n;\n');
  const min = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'esbuild@0.24.0', '--minify', '--charset=ascii', '--loader=js'],
    { input: entree, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 26 });
  fs.writeFileSync(path.join(__dirname, 'dist', sortie), '/* linkedin-cmf v9 : ' + fichiers.join(' + ') + ' */\n' + min);
  console.log(sortie, Buffer.byteLength(min), 'octets');
}
