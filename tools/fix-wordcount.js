const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const artDir = path.join(root, 'data', 'articles');
let changed = 0;
fs.readdirSync(artDir).filter(f => f.endsWith('.json')).forEach(f => {
  const p = path.join(artDir, f);
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  const total = a.paragraphs.reduce((s, pr) => s + (pr.en.match(/[A-Za-z']+/g) || []).length, 0);
  if (total !== a.wordCount) { console.log(`${f}: ${a.wordCount} -> ${total}`); a.wordCount = total; fs.writeFileSync(p, JSON.stringify(a, null, 2), 'utf8'); changed++; }
});
console.log('adjusted:', changed);
