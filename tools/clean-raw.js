/* Clean raw Guardian articles: strip junk paragraphs, drop too-short articles */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const d = path.join(root, 'data', 'articles-raw');

const JUNK2 = /^related:/i;
const JUNK3 = /explore more on these topics|sign up to|newsletter|available for everyone|funded by readers|if you would like to comment|download the free (app|newspaper)|follow us on|photograph:|main image|guardian picks|you can also (book|sign)|^topics$|sign in to continue|reuse this content|^the independent/i;

let removed = 0, deleted = 0;
fs.readdirSync(d).filter(f => f.endsWith('.json')).forEach(f => {
  const p = path.join(d, f);
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = a.paragraphs.length;
  a.paragraphs = a.paragraphs
    .filter(x => x.en && !JUNK2.test(x.en) && !JUNK3.test(x.en) && x.en.length > 40)
    .slice(0, 8);
  removed += before - a.paragraphs.length;
  if (a.paragraphs.length < 5) { fs.unlinkSync(p); deleted++; }
  else fs.writeFileSync(p, JSON.stringify(a, null, 2), 'utf8');
});
const left = fs.readdirSync(d).filter(f => f.endsWith('.json')).length;
console.log('removed paras:', removed, '| deleted short:', deleted, '| remaining:', left);
