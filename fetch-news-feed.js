// fetch-news-feed.js
//
// Va chercher de vraies actualités auprès de flux RSS publics et gratuits,
// et écrit data/news-feed.json. Contrairement aux autres scripts (OCDE, FRED),
// ici pas de format CSV : les flux RSS sont du XML, on extrait donc les
// <item> à la main avec des expressions régulières (pas besoin de librairie
// externe pour un besoin aussi simple).
//
// Sources actuelles (à étendre pays par pays par la suite) :
// - BCE (communiqués officiels)         → tag "bank", pays "EU"
// - CoinDesk (actualité crypto)          → tag "marche", pays "GLOBAL"
//
// Aucune clé API nécessaire — ce sont des flux RSS publics standards.

import fs from 'fs';
import path from 'path';

const FEEDS = [
  { url: 'https://www.ecb.europa.eu/rss/press.xml', country: 'EU', flag: '🇪🇺', tag: 'bank', tagLabel: 'Banque centrale', source: 'Banque centrale européenne', limit: 5 },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss', country: 'GLOBAL', flag: '🌍', tag: 'marche', tagLabel: 'Marché', source: 'CoinDesk', limit: 5 },
];

async function fetchWithRetry(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
      if (res.ok) return await res.text();
      console.warn(`  Tentative ${attempt}/${tries} échouée : ${res.status} ${res.statusText}`);
    } catch (err) {
      console.warn(`  Tentative ${attempt}/${tries} échouée (réseau) : ${err.message}`);
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  return null;
}

// Extraction simple des <item>...</item> d'un flux RSS, sans dépendance externe.
function parseRss(xml, limit) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks.slice(0, limit)) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(block, 'description');
    if (!title) continue;
    items.push({
      title: cleanText(title),
      link: link ? cleanText(link) : null,
      pubDate: pubDate ? new Date(pubDate).toISOString() : null,
      summary: description ? truncate(cleanText(description), 220) : '',
    });
  }
  return items;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '') // retire les balises HTML éventuelles dans la description
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;/g, '\u2019').replace(/&#8216;/g, '\u2018')
    .replace(/&#8211;/g, '\u2013').replace(/&#8212;/g, '\u2014')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

async function main() {
  const allItems = [];
  const failed = [];

  for (const feed of FEEDS) {
    console.log(`News — ${feed.source}...`);
    const xml = await fetchWithRetry(feed.url);
    if (!xml) {
      console.warn(`  ⚠️  Abandon pour ${feed.source} après plusieurs tentatives.`);
      failed.push(feed.source);
      continue;
    }
    const items = parseRss(xml, feed.limit);
    console.log(`  OK — ${items.length} actus reçues.`);
    items.forEach((it) => {
      allItems.push({
        country: feed.country,
        flag: feed.flag,
        tag: feed.tag,
        tagLabel: feed.tagLabel,
        title: it.title,
        summary: it.summary,
        source: feed.source,
        link: it.link,
        publishedAt: it.pubDate,
      });
    });
    await new Promise((r) => setTimeout(r, 800));
  }

  // Tri du plus récent au plus ancien (les items sans date connue passent en dernier)
  allItems.sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const output = {
    source: 'Flux RSS publics (BCE, CoinDesk — à étendre)',
    fetchedAt: new Date().toISOString(),
    failed,
    items: allItems,
  };

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'news-feed.json'), JSON.stringify(output, null, 2));

  console.log(`\nOK — data/news-feed.json écrit avec ${allItems.length} actus.`);
  if (failed.length) console.log('Sources manquantes ce coup-ci :', failed.join(', '));
}

main().catch((err) => {
  console.error('Échec du script :', err.message);
  process.exit(1);
});
