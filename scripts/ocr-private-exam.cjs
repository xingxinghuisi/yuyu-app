/* Offline OCR: only language models are downloaded separately; exam pages stay local. */
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(process.argv[2]);
  const models = path.resolve(process.argv[3]);
  const output = path.join(root, 'import', 'ocr');
  fs.mkdirSync(output, { recursive: true });
  const jobs = ['paper', 'answers'].flatMap(kind => fs.readdirSync(path.join(root, 'assets', kind))
    .filter(file => file.endsWith('.webp')).map(file => ({ kind, file })));
  let index = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    const worker = await createWorker(['jpn', 'chi_sim'], 1,
      { langPath: models, cachePath: models, cacheMethod: 'readOnly', gzip: true });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: '180' });
      while (index < jobs.length) {
        const { kind, file } = jobs[index++];
        const target = path.join(output, kind + '-' + file.replace('.webp', '.json'));
        if (fs.existsSync(target)) continue;
        const input = await sharp(path.join(root, 'assets', kind, file)).png().toBuffer();
        const { data } = await worker.recognize(input, {}, { text: true, blocks: true, tsv: true });
        fs.writeFileSync(target, JSON.stringify({ text: data.text, confidence: data.confidence,
          blocks: data.blocks, tsv: data.tsv }, null, 2));
        fs.writeFileSync(target.replace('.json', '.txt'), data.text);
        console.log(kind + '/' + file + ' OCR ' + data.confidence.toFixed(1));
      }
    } finally { await worker.terminate(); }
  }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
