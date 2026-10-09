const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
if (!process.argv[2]) throw new Error('Usage: node tests/package-art.cjs sources.json (map asset names to original PNG paths)');
const sources = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const out = path.join(__dirname, '../frontend/assets/anime');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  const tiles = [];
  for (const [name, file] of Object.entries(sources)) {
    const meta = await sharp(file).metadata();
    const stats = await sharp(file).stats();
    console.log(name, meta.width, meta.height, 'alpha:', meta.hasAlpha, 'opaque:', stats.isOpaque);
    const image = sharp(file);
    if (name !== 'sea') image.trim({ threshold: 1 });
    const source = await image.png().toBuffer();
    const width = name === 'sea' ? 1440 : name === 'traveler' ? 340 : 1120;
    await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 86, effort: 6 }).toFile(path.join(out, name + '.webp'));
    if (name !== 'traveler') await sharp(source).resize({ width: name === 'sea' ? 720 : 560 }).webp({ quality: 82, effort: 6 }).toFile(path.join(out, name + '-small.webp'));
    tiles.push({ input: await sharp(source).resize(300, 300, { fit: 'contain', background: '#183d62' }).png().toBuffer(), left: (tiles.length % 4) * 300, top: Math.floor(tiles.length / 4) * 300 });
  }
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#183d62' } }).composite(tiles).png().toFile(path.join(__dirname, '../data/art-contact-sheet.png'));
})();
