// fetch-unemployment-data.js
//
// Va chercher le taux de chômage mensuel réel auprès de l'API gratuite de
// l'OCDE, pour les pays de l'app, et écrit data/unemployment.json.
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
};

const DATASET = 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0';

function buildUrl(iso3) {
  const key = `${iso3}..PT_LF_SUB._Z.Y._T.Y_GE15..M`;
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

  for (const [iso3, appCode] of Object.entries(COUNTRY_MAP)) {
    const url = buildUrl(iso3);
    console.log(`Chômage — ${appCode} (${iso3})...`);
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
    indicator: 'unemployment_rate',
    unit: '%',
    source: 'OCDE — DF_IALFS_UNE_M (taux de chômage mensuel, 15 ans et plus)',
    fetchedAt: new Date().toISOString(),
    failed,
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'unemployment.json'), JSON.stringify(output, null, 2));

  console.log(`\nOK — data/unemployment.json écrit avec ${Object.keys(byCountry).length}/${Object.keys(COUNTRY_MAP).length} pays.`);
  if (failed.length) console.log('Pays manquants ce coup-ci :', failed.join(', '));
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
