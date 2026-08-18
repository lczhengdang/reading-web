/* Fetch real articles from The Guardian Open Platform (test key) into data/articles-raw/ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'data', 'articles-raw');

const KEY = 'test';
const SECTIONS = {
  science: { topic: '科学', difficulty: 4 },
  technology: { topic: '科技', difficulty: 4 },
  environment: { topic: '环境', difficulty: 4 },
  business: { topic: '经济', difficulty: 4 },
  education: { topic: '教育', difficulty: 3 },
  society: { topic: '社会', difficulty: 3 },
  books: { topic: '文化', difficulty: 3 },
  film: { topic: '文化', difficulty: 3 },
  politics: { topic: '政治', difficulty: 4 },
  'global-development': { topic: '社会', difficulty: 3 },
  media: { topic: '科技', difficulty: 3 },
  music: { topic: '文化', difficulty: 3 }
};
const PER_SECTION = 20;
const MAX_PAGES = 4;

fs.mkdirSync(outDir, { recursive: true });

const existing = new Set();
fs.readdirSync(path.join(root, 'data', 'articles'))
  .filter(f => f.endsWith('.json'))
  .forEach(f => existing.add(JSON.parse(fs.readFileSync(path.join(root, 'data', 'articles', f), 'utf8')).id));
fs.readdirSync(outDir)
  .filter(f => f.endsWith('.json'))
  .forEach(f => existing.add(JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')).id));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…').replace(/&#8217;/g, "'").replace(/&#8211;/g, '–')
    .replace(/&#8216;/g, '‘').replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
    .replace(/&#039;/g, "'");
}

const JUNK = /newsletter|sign up|sign-up|subscribe|subscribe|email address|Follow .* on|available for everyone|help us keep|if you would like to|explore more on these topics|you can also book|download the app|follow us on|get in touch|click here|please support|become a supporter|guardian pick/i;

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function slugifyId(apiId) {
  const last = String(apiId).split('/').pop() || String(apiId);
  return last.replace(/[^a-z0-9-]/gi, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

(async () => {
  let total = 0;
  for (const sec of Object.keys(SECTIONS)) {
    const meta = SECTIONS[sec];
    let page = 1;
    let got = 0;
    while (got < PER_SECTION && page <= MAX_PAGES) {
      const url = `https://content.guardianapis.com/search?section=${sec}&type=article&page=${page}&page-size=50&show-fields=body&order-by=newest&api-key=${KEY}`;
      console.log('GET', sec, 'page', page);
      const data = await getJSON(url);
      const results = (data.response && data.response.results) || [];
      if (!results.length) break;
      for (const art of results) {
        if (got >= PER_SECTION) break;
        const bodyHtml = art.fields && art.fields.body ? art.fields.body : '';
        const plain = stripTags(bodyHtml);
        const wc = (plain.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
        if (wc < 300) continue;
        const paras = [];
        const pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
        let pm;
        while ((pm = pRe.exec(bodyHtml)) !== null) {
          const t = stripTags(pm[1]);
          if (t.length > 30 && !JUNK.test(t)) paras.push(t);
        }
        if (paras.length > 8) paras.length = 8;
        if (paras.length < 5) continue;
        const year = (art.webPublicationDate || '').slice(0, 4) || '2026';
        const slug = slugifyId(art.id);
        const id = `gua-${year}-${slug}`;
        if (existing.has(id)) continue;
        existing.add(id);
        const obj = {
          id,
          title: stripTags(art.webTitle),
          source: 'The Guardian',
          sourceZh: '《卫报》',
          topic: meta.topic,
          difficulty: meta.difficulty,
          year: parseInt(year, 10),
          wordCount: wc,
          paragraphs: paras.map(en => ({ en }))
        };
        fs.writeFileSync(path.join(outDir, id + '.json'), JSON.stringify(obj, null, 2), 'utf8');
        got++;
        total++;
      }
      page++;
      await sleep(1300);
    }
    console.log(`  ${sec}: collected ${got}`);
  }
  console.log('TOTAL raw articles:', total);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
