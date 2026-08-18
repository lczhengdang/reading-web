const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dictPath = path.join(root, 'data', 'dictionary.json');
const fixDir = path.join(root, 'data', 'dict-fix');

const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
const patch = {};
fs.readdirSync(fixDir).filter(f => f.endsWith('.json')).sort().forEach(f => {
  Object.assign(patch, JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8')));
});
console.log('patch entries:', Object.keys(patch).length);

const keySet = new Set(dict.words.map(w => w.word));
const unknown = Object.keys(patch).filter(k => !keySet.has(k));
if (unknown.length) { console.error('UNKNOWN patch keys:', unknown.join(',')); process.exit(1); }

let fixed = 0; const stillBad = [];
dict.words.forEach(e => {
  if (/\?/.test(e.definition)) {
    const p = patch[e.word];
    if (p) { e.definition = p; fixed++; } else stillBad.push(e.word);
  }
});
if (stillBad.length) { console.error('STILL CORRUPTED (no patch):', stillBad.length, stillBad.join(',')); process.exit(1); }
if (/\?/.test(JSON.stringify(dict.words))) { console.error('remaining ? chars somewhere'); process.exit(1); }

fs.writeFileSync(dictPath, JSON.stringify(dict), 'utf8');
console.log('fixed entries:', fixed, '| total words:', dict.words.length);
