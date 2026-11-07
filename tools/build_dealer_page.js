// Builds docs/index.html, the dealers' stock page, as ONE self-contained file: the logos from
// dealer-page/img and the pump photos from dealer-page/img/pumps are embedded, so uploading
// index.html on its own (e.g. to Netlify) is enough.
// Edit dealer-page/index.src.html, then run:  node tools/build_dealer_page.js
// (New pump photos: python tools/build_pump_photos.py "<catalogue>.pdf" first.)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'dealer-page', 'index.src.html'), 'utf8');
let logos = 0;
let html = src.replace(/src="img\/([a-z0-9-]+\.png)"/g, (m, name) => {
  const data = fs.readFileSync(path.join(root, 'dealer-page', 'img', name)).toString('base64');
  logos++;
  return `src="data:image/png;base64,${data}"`;
});

const photoDir = path.join(root, 'dealer-page', 'img', 'pumps');
const photos = {};
if (fs.existsSync(photoDir)) {
  fs.readdirSync(photoDir).filter(f => f.endsWith('.webp')).sort().forEach(f => {
    photos[f.replace(/\.webp$/, '')] = 'data:image/webp;base64,' + fs.readFileSync(path.join(photoDir, f)).toString('base64');
  });
}
if (!html.includes('/*PUMP_PHOTOS*/{}')) throw new Error('PUMP_PHOTOS placeholder not found in the page source');
html = html.replace('/*PUMP_PHOTOS*/{}', () => JSON.stringify(photos));

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'index.html'), html);
console.log(`docs/index.html written: ${(html.length / 1024).toFixed(0)} KB, ${logos} logo(s), ${Object.keys(photos).length} pump photo(s) embedded`);
