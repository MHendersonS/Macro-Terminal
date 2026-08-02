// fetch-gdp-data.js
//
// Va chercher la croissance du PIB (trimestrielle, glissement annuel) réelle
// auprès de l'API gratuite de l'OCDE, pour les pays de l'app, et écrit
// data/gdp.json. Même principe que fetch-macro-data.js (inflation).

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
  EU: 'EU', // confirmé valide dans ce jeu de données (zone euro / UE agrégée)
};

const OECD_CODES = Object.keys(COUNTRY_MAP);

// Dataset OCDE : PIB trimestriel réel par composantes de la dépense (Table 0102),
// on filtre sur B1GQ = PIB total, transformation GY = glissement annuel.
const DATASET = 'OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD,1.1';
const KEY = `Q.Y.${OECD_CODES.join('+')}.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102`;
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
    indicator: 'gdp_growth_yoy',
    unit: '%',
    source: 'OCDE — DF_QNA_EXPENDITURE_GROWTH_OECD (PIB, glissement annuel)',
    fetchedAt: new Date().toISOString(),
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gdp.json'), JSON.stringify(output, null, 2));
  console.log('OK — data/gdp.json écrit avec', Object.keys(byCountry).length, 'pays.');
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
