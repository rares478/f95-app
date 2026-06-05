import fs from 'fs';

let css = fs.readFileSync('src/App.css', 'utf8');
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

for (const prefix of prefixes) {
  const re = new RegExp(`\\${prefix}[^{]*\\{[^}]*\\}`, 'g');
  css = css.replace(re, '');
}

css = css.replace(
  /@media\(max-width:900px\)\{\.store-page\{flex-direction:column\}\.store-page:before\{display:none\}\.store-filter\{[^}]+\}\}/g,
  '',
);

fs.writeFileSync('src/App.css', css);
console.log('stripped store rules from App.css');
