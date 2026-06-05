import fs from 'fs';

const css = fs.readFileSync('src/App.css', 'utf8');
const prefixes = [
  '.store-page',
  '.store-filter',
  '.store-main',
  '.store-grid',
  '.store-sentinel',
  '.store-error',
  '.store-empty',
  '.store-end',
  '.store-section',
];

const rules = [];
for (const prefix of prefixes) {
  const re = new RegExp(`\\${prefix}[^{]*\\{[^}]*\\}`, 'g');
  let m;
  while ((m = re.exec(css))) rules.push(m[0]);
}

const media = css.match(/@media\(max-width:900px\)\{[^}]+\}/g) ?? [];

const fixed = rules.map((r) => {
  if (r.startsWith('.store-filter{width:280px')) {
    return r.replace('min-height:calc(100vh - 60px)', 'min-height:0');
  }
  return r;
});

const out = ['/* Store page + filter sidebar */', '', ...fixed, '', ...media, ''].join('\n');
fs.writeFileSync('src/styles/store-filter.css', out);
console.log('wrote', fixed.length, 'rules', media.length, 'media blocks');
