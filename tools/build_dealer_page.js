// Builds docs/index.html, the dealers' stock page, as ONE self-contained file: the logos from
// dealer-page/img are embedded, so uploading index.html on its own (e.g. to Netlify) is enough.
// Edit dealer-page/index.src.html, then run:  node tools/build_dealer_page.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'dealer-page', 'index.src.html'), 'utf8');
let embedded = 0;
const html = src.replace(/src="img\/([a-z0-9-]+\.png)"/g, (m, name) => {
  const data = fs.readFileSync(path.join(root, 'dealer-page', 'img', name)).toString('base64');
  embedded++;
  return `src="data:image/png;base64,${data}"`;
});
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'index.html'), html);
console.log(`docs/index.html written: ${(html.length / 1024).toFixed(0)} KB, ${embedded} logo(s) embedded`);
