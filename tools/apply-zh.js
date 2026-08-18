/* Merge zh translations (data/zh-add/batch-*.json) into raw articles -> data/articles/ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const rawDir = path.join(root, 'data', 'articles-raw');
const zhDir = path.join(root, 'data', 'zh-add');
const outDir = path.join(root, 'data', 'articles');

fs.mkdirSync(outDir, { recursive: true });

const zh = {};
fs.readdirSync(zhDir).filter(f => f.endsWith('.json')).sort().forEach(f => {
  Object.assign(zh, JSON.parse(fs.readFileSync(path.join(zhDir, f), 'utf8')));
});
console.log('zh batches:', Object.keys(zh).length);

const rawFiles = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));
let done = 0, mismatched = [], missing = [];

rawFiles.forEach(f => {
  const a = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
  const tr = zh[a.id];
  if (!tr) { missing.push(a.id); return; }
  if (!Array.isArray(tr) || tr.length !== a.paragraphs.length) {
    mismatched.push(a.id + ' (zh ' + (tr ? tr.length : '?') + ' vs en ' + a.paragraphs.length + ')');
    return;
  }
  a.paragraphs.forEach((p, i) => { p.zh = String(tr[i]).trim(); });
  fs.writeFileSync(path.join(outDir, a.id + '.json'), JSON.stringify(a, null, 2), 'utf8');
  done++;
});

if (missing.length) console.log('MISSING zh:', missing.length, missing);
if (mismatched.length) console.log('MISMATCH:', mismatched.length, mismatched);
console.log('merged:', done, '/', rawFiles.length);
