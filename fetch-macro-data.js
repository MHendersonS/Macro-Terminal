// fetch-macro-data.js
//
// Va chercher l'inflation (CPI, glissement annuel) réelle auprès de l'API
// gratuite de l'OCDE, pour les pays de l'app, et écrit un fichier JSON propre
// que le site pourra lire directement (data/inflation.json).
//
// Ce script est fait pour tourner via GitHub Actions (voir le fichier
// update-macro-data.yml fourni à côté), mais tu peux aussi le lancer à la main
// avec : node fetch-macro-data.js
//
// Aucune clé API nécessaire — l'OCDE est en accès libre.

import fs from 'fs';
import path from 'path';

// Code ISO3 OCDE -> code pays utilisé dans l'app (voir countries[] dans le prototype)
const COUNTRY_MAP = {
  FRA: 'FR',
  USA: 'US',
  DEU: 'DE',
  JPN: 'JP',
  GBR: 'GB',
  NZL: 'NZ',
  AUS: 'AU',
  CHE: 'CH',
  // EU / zone euro : à ajouter dans une prochaine passe (code REF_AREA à confirmer,
  // probablement EA20 ou EU27_2020 selon le jeu de données OCDE)
};

const OECD_CODES = Object.keys(COUNTRY_MAP); // ['FRA','USA','DEU',...]

// Dataset OCDE : Consumer Price Indices, CPI, glissement annuel (GY), tous postes (CP01)
const DATASET = 'DSD_PRICES@DF_PRICES_N_CP01';
const KEY = `${OECD_CODES.join('+')}.M.N.CPI.PA.CP01.N.GY`;
const URL = `https://sdmx.oecd.org/public/rest/data/${DATASET}/${KEY}/all?startPeriod=2024-01&format=csvfilewithlabels`;

async function main() {
  console.log('Requête OCDE :', URL);
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`Réponse OCDE en erreur : ${res.status} ${res.statusText}`);
  }
  const csvText = await res.text();

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error('Aucune ligne reçue — vérifier la requête (clé/dimensions).');
  }

  // On garde, pour chaque pays, la série triée par date, et on ne conserve
  // que les colonnes utiles au site (REF_AREA, obsTime, obsValue).
  const byCountry = {};
  for (const row of rows) {
    const iso3 = row.REF_AREA;
    const appCode = COUNTRY_MAP[iso3];
    if (!appCode) continue; // pays qu'on ne suit pas dans l'app

    if (!byCountry[appCode]) byCountry[appCode] = [];
    byCountry[appCode].push({
      period: row.TIME_PERIOD || row.obsTime,
      value: parseFloat(row.OBS_VALUE || row.obsValue),
    });
  }

  // Tri chronologique de chaque série
  for (const code of Object.keys(byCountry)) {
    byCountry[code].sort((a, b) => a.period.localeCompare(b.period));
  }

  const output = {
    indicator: 'inflation_cpi_yoy',
    unit: '%',
    source: 'OCDE — DSD_PRICES@DF_PRICES_N_CP01 (CPI, glissement annuel)',
    fetchedAt: new Date().toISOString(),
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'inflation.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('OK — data/inflation.json écrit avec', Object.keys(byCountry).length, 'pays.');
}

// Petit parseur CSV simple (le CSV de l'OCDE n'a pas de virgules dans les champs
// qui nous intéressent ici, donc pas besoin d'une librairie externe).
function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
