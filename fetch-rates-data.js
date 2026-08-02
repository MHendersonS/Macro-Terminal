// fetch-rates-data.js
//
// Va chercher les taux directeurs réels (ou leur meilleur proxy public gratuit)
// auprès de la FRED (Réserve fédérale de Saint-Louis, qui republie aussi des
// séries d'autres banques centrales et de l'OCDE), et écrit data/rates.json.
//
// Aucune clé API nécessaire : on utilise le point d'accès public de
// téléchargement CSV de la FRED (celui derrière le bouton "Download" du site),
// qui ne demande pas d'inscription.
//
// Sources par pays :
// - US : taux cible de la Fed (borne haute)                  — DFEDTARU
// - EU / FR / DE : taux de la facilité de dépôt de la BCE     — ECBDFR (zone euro commune)
// - GB : taux directeur de la Banque d'Angleterre             — BOERUKM
// - JP : taux directeur de la Banque du Japon                 — IRSTCB01JPM156N
// - AU, NZ, CH : PAS de série "taux directeur" officielle trouvée en accès
//   libre → on utilise le taux interbancaire au jour le jour (proxy standard,
//   très proche du taux directeur réel, republié par l'OCDE via la FRED).

import fs from 'fs';
import path from 'path';

const SERIES = {
  US: { id: 'DFEDTARU', label: 'Fed — taux cible (borne haute)', proxy: false },
  EU: { id: 'ECBDFR', label: 'BCE — taux de la facilité de dépôt', proxy: false },
  FR: { id: 'ECBDFR', label: 'BCE — taux de la facilité de dépôt (zone euro)', proxy: false },
  DE: { id: 'ECBDFR', label: 'BCE — taux de la facilité de dépôt (zone euro)', proxy: false },
  GB: { id: 'BOERUKM', label: 'Banque d\'Angleterre — Bank Rate', proxy: false },
  JP: { id: 'IRSTCB01JPM156N', label: 'Banque du Japon — taux directeur', proxy: false },
  AU: { id: 'IRSTCI01AUQ156N', label: 'Taux interbancaire au jour le jour (proxy, OCDE)', proxy: true },
  NZ: { id: 'IRSTCI01NZM156N', label: 'Taux interbancaire au jour le jour (proxy, OCDE)', proxy: true },
  CH: { id: 'IRSTCI01CHM156N', label: 'Taux interbancaire au jour le jour (proxy, OCDE)', proxy: true },
};

function buildUrl(seriesId) {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
}

async function fetchWithRetry(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (res.ok) return await res.text();
      console.warn(`  Tentative ${attempt}/${tries} échouée : ${res.status} ${res.statusText}`);
    } catch (err) {
      console.warn(`  Tentative ${attempt}/${tries} échouée (réseau) : ${err.message}`);
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  return null;
}

// Parseur CSV respectant les guillemets (même logique que les 3 autres scripts)
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
      } else { cur += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { cells.push(cur.trim()); cur = ''; }
    else { cur += c; }
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

// Cache pour ne pas re-télécharger deux fois la même série (FR/DE partagent ECBDFR avec EU)
const seriesCache = {};

async function getSeries(seriesId) {
  if (seriesCache[seriesId]) return seriesCache[seriesId];
  const url = buildUrl(seriesId);
  console.log(`Taux directeur — série ${seriesId}...`);
  const csvText = await fetchWithRetry(url);
  if (!csvText) {
    console.warn(`  ⚠️  Abandon pour la série ${seriesId} après plusieurs tentatives.`);
    seriesCache[seriesId] = null;
    return null;
  }
  const rows = parseCsv(csvText);
  const valueCol = Object.keys(rows[0] || {}).find((k) => k !== 'DATE' && k !== 'observation_date') || seriesId;
  const dateCol = Object.keys(rows[0] || {}).find((k) => k === 'DATE' || k === 'observation_date') || 'DATE';
  const points = rows
    .map((row) => ({ period: row[dateCol], value: parseFloat(row[valueCol]) }))
    .filter((d) => d.period && !Number.isNaN(d.value))
    .sort((a, b) => a.period.localeCompare(b.period));
  console.log(`  OK — ${points.length} points reçus.`);
  seriesCache[seriesId] = points;
  await new Promise((r) => setTimeout(r, 800));
  return points;
}

async function main() {
  const byCountry = {};
  const failed = [];
  const sourcesUsed = {};

  for (const [appCode, info] of Object.entries(SERIES)) {
    const points = await getSeries(info.id);
    if (!points) { failed.push(appCode); continue; }
    byCountry[appCode] = points.slice(-10); // les 10 derniers points connus, comme les autres indicateurs
    sourcesUsed[appCode] = { series: info.id, label: info.label, isProxy: info.proxy };
  }

  if (Object.keys(byCountry).length === 0) {
    throw new Error('Aucun pays récupéré — la FRED est probablement indisponible pour le moment.');
  }

  const output = {
    indicator: 'policy_rate',
    unit: '%',
    source: 'FRED (Fed de Saint-Louis) — voir "sourcesUsed" pour le détail par pays',
    fetchedAt: new Date().toISOString(),
    failed,
    sourcesUsed,
    series: byCountry,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'rates.json'), JSON.stringify(output, null, 2));

  console.log(`\nOK — data/rates.json écrit avec ${Object.keys(byCountry).length}/${Object.keys(SERIES).length} pays.`);
  if (failed.length) console.log('Pays manquants ce coup-ci :', failed.join(', '));
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
