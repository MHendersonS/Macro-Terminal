// fetch-unemployment-data.js
//
// Va chercher le taux de chômage mensuel réel auprès de l'API gratuite de
// l'OCDE, pour les pays de l'app, et écrit data/unemployment.json.
// Même principe que fetch-macro-data.js (inflation) et fetch-gdp-data.js (PIB).

import fs from 'fs';
import path from 'path';

const COUNTRY_MAP = {
  FRA: 'FR',
  USA: 'US',
  DEU: 'DE',
  JPN: 'JP',
  GBR: 'GB',
  NZL: 'NZ',
  AUS: 'AU',
  CHE: 'CH',
  // EU : pas confirmé disponible dans ce jeu de données précis, à vérifier séparément
};

const OECD_CODES = Object.keys(COUNTRY_MAP);

// Dataset OCDE : taux de chômage mensuel, population active 15 ans et plus,
// données CVS (corrigées des variations saisonnières).
const DATASET = 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0';
const KEY = `${OECD_CODES.join('+')}..PT_LF_SUB._Z.Y._T.Y_GE15..M`;
const URL = `https://sdmx.oecd.org/public/rest/data/${DATASET}/${KEY}/all?startPeriod=2023-01&format=csvfilewithlabels`;

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

  const byCountry = {};
  for (const row of rows) {
    const iso = row.REF_AREA;
    const appCode = COUNTRY_MAP[iso];
    if (!appCode) continue;
    if (!byCountry[appCode]) byCountry[appCode] = [];
    byCountry[appCode].push({
      period: row.TIME_PERIOD || row.obsTime,
      value: parseFloat(row.OBS_VALUE || row.obsValue),
    });
  }
  for (const code of Object.keys(byCountry)) {
    byCountry[code].sort((a, b) => a.period.localeCompare(b.period));
  }

  const output = {
    indicator: 'unemployment_rate',
    unit: '%',
    source: 'OCDE — DF_IALFS_UNE_M (taux de chômage mensuel, 15 ans et plus)',
    fetchedAt: new Date().toISOString(),
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'unemployment.json'), JSON.stringify(output, null, 2));
  console.log('OK — data/unemployment.json écrit avec', Object.keys(byCountry).length, 'pays.');
}

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
