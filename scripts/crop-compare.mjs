// 参照と実装の同じ領域を切り出して上下に並べ、拡大した確認用画像を作る（ローカル確認用）。
// 使い方：node scripts/crop-compare.mjs <variant> <Sxx> <x> <y> <w> <h> [scale]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [variant, id, xs, ys, ws, hs, ss] = process.argv.slice(2);
const [x, y, w, h, scale] = [xs, ys, ws, hs, ss ?? '2'].map(Number);

const ref = PNG.sync.read(await readFile(path.join(ROOT, 'docs', 'ui-reference', 'screens', `${id}.png`)));
const act = PNG.sync.read(await readFile(path.join(ROOT, 'work', 'screens', variant, `${id}.png`)));
const out = new PNG({ width: w * scale, height: (h * 2 + 4) * scale });
out.data.fill(255);
const put = (src, oy) => {
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const si = ((y + yy) * src.width + (x + xx)) * 4;
      for (let sy = 0; sy < scale; sy++)
        for (let sx = 0; sx < scale; sx++) {
          const di = ((oy + yy) * scale + sy) * out.width * 4 + (xx * scale + sx) * 4;
          out.data[di] = src.data[si];
          out.data[di + 1] = src.data[si + 1];
          out.data[di + 2] = src.data[si + 2];
          out.data[di + 3] = 255;
        }
    }
};
put(ref, 0);
put(act, h + 4);
await mkdir(path.join(ROOT, 'work', 'screens', 'crops'), { recursive: true });
const file = path.join(ROOT, 'work', 'screens', 'crops', `${id}-${x}-${y}.png`);
await writeFile(file, PNG.sync.write(out));
console.log(file);
