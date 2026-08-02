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
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; macro-terminal-data-fetcher/1.0)',
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

// Vrai parseur CSV : gère les champs entre guillemets qui contiennent des
// virgules (ex: "Croissance, glissement annuel"), ce qu'un simple split(',')
// ne sait pas faire correctement.
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.trim().split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
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
    if (byCountry[appCode].length === 0) {
      console.warn(`  ⚠️  0 point exploitable. Longueur du texte reçu : ${csvText.length} caractères.`);
      console.warn('  Début du texte brut reçu :', JSON.stringify(csvText.slice(0, 400)));
      if (rows.length > 0) {
        console.warn('  Colonnes vues :', Object.keys(rows[0]).join(', '));
        console.warn('  Exemple de ligne :', JSON.stringify(rows[0]));
      } else {
        console.warn('  Aucune ligne de données parsée (0 lignes après l\'en-tête).');
      }
    }
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
