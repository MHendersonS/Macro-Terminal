// fetch-gdp-data.js
//
// Va chercher la croissance du PIB (trimestrielle, glissement annuel) réelle
// auprès de l'API gratuite de l'OCDE, pour les pays de l'app, et écrit
// data/gdp.json.
//
// Version robuste : un pays à la fois, avec réessais automatiques.

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
  EU: 'EU',
};

const DATASET = 'OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD,1.1';

function buildUrl(iso) {
  const key = `Q.Y.${iso}.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102`;
  return `https://sdmx.oecd.org/public/rest/data/${DATASET}/${key}/all?startPeriod=2023-01&format=csvfilewithlabels`;
}

async function fetchWithRetry(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      const body = await res.text().catch(() => '');
      console.warn(`  Tentative ${attempt}/${tries} échouée : ${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 200) : ''}`);
    } catch (err) {
      console.warn(`  Tentative ${attempt}/${tries} échouée (réseau) : ${err.message}`);
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  return null;
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

async function main() {
  const byCountry = {};
  const failed = [];

  for (const [iso, appCode] of Object.entries(COUNTRY_MAP)) {
    const url = buildUrl(iso);
    console.log(`PIB — ${appCode} (${iso})...`);
    const csvText = await fetchWithRetry(url);

    if (!csvText) {
      console.warn(`  ⚠️  Abandon pour ${appCode} après plusieurs tentatives.`);
      failed.push(appCode);
      continue;
    }

    const rows = parseCsv(csvText);
    byCountry[appCode] = rows
      .map((row) => ({
        period: row.TIME_PERIOD || row.obsTime,
        value: parseFloat(row.OBS_VALUE || row.obsValue),
      }))
      .filter((d) => d.period && !Number.isNaN(d.value))
      .sort((a, b) => a.period.localeCompare(b.period));

    console.log(`  OK — ${byCountry[appCode].length} points reçus.`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (Object.keys(byCountry).length === 0) {
    throw new Error('Aucun pays récupéré — l\'OCDE est probablement indisponible pour le moment.');
  }

  const output = {
    indicator: 'gdp_growth_yoy',
    unit: '%',
    source: 'OCDE — DF_QNA_EXPENDITURE_GROWTH_OECD (PIB, glissement annuel)',
    fetchedAt: new Date().toISOString(),
    failed,
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gdp.json'), JSON.stringify(output, null, 2));

  console.log(`\nOK — data/gdp.json écrit avec ${Object.keys(byCountry).length}/${Object.keys(COUNTRY_MAP).length} pays.`);
  if (failed.length) console.log('Pays manquants ce coup-ci :', failed.join(', '));
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
