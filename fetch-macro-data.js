// fetch-macro-data.js
//
// Va chercher l'inflation (CPI, glissement annuel) réelle auprès de l'API
// gratuite de l'OCDE, pour les pays de l'app, et écrit un fichier JSON propre
// que le site pourra lire directement (data/inflation.json).
//
// Version robuste : interroge un pays à la fois (requêtes plus légères pour
// le serveur de l'OCDE), réessaie en cas d'échec, et continue même si un pays
// échoue plutôt que de tout arrêter.
//
// Aucune clé API nécessaire — l'OCDE est en accès libre.

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

const DATASET = 'DSD_PRICES@DF_PRICES_N_CP01';

function buildUrl(iso3) {
  const key = `${iso3}.M.N.CPI.PA.CP01.N.GY`;
  return `https://sdmx.oecd.org/public/rest/data/${DATASET}/${key}/all?startPeriod=2024-01&format=csvfilewithlabels`;
}

async function fetchWithRetry(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.sdmx.data+csv; charset=utf-8',
          'User-Agent': 'macro-terminal-data-fetcher/1.0',
        },
      });
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
    console.log(`Inflation — ${appCode} (${iso3})...`);
    const csvText = await fetchWithRetry(url);

    if (!csvText) {
      console.warn(`  ⚠️  Abandon pour ${appCode} après plusieurs tentatives — ce pays sera absent du fichier cette fois-ci.`);
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
    // petite pause entre deux pays pour ne pas bombarder le serveur de l'OCDE
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (Object.keys(byCountry).length === 0) {
    throw new Error('Aucun pays récupéré — l\'OCDE est probablement indisponible pour le moment. Le workflow réessaiera au prochain passage automatique.');
  }

  const output = {
    indicator: 'inflation_cpi_yoy',
    unit: '%',
    source: 'OCDE — DSD_PRICES@DF_PRICES_N_CP01 (CPI, glissement annuel)',
    fetchedAt: new Date().toISOString(),
    failed, // pays absents ce coup-ci, s'il y en a
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'inflation.json'), JSON.stringify(output, null, 2));

  console.log(`\nOK — data/inflation.json écrit avec ${Object.keys(byCountry).length}/${Object.keys(COUNTRY_MAP).length} pays.`);
  if (failed.length) console.log('Pays manquants ce coup-ci :', failed.join(', '));
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
