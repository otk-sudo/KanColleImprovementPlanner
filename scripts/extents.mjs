// 指定領域で背景色と異なる画素の外接矩形を、参照と実装の両方で求める（位置合わせ用のローカル計測）。
// 使い方：node scripts/extents.mjs <variant> <Sxx> <x> <y> <w> <h> [...さらに領域]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [variant, id, ...nums] = process.argv.slice(2);
const ref = PNG.sync.read(await readFile(path.join(ROOT, 'docs', 'ui-reference', 'screens', `${id}.png`)));
const act = PNG.sync.read(await readFile(path.join(ROOT, 'work', 'screens', variant, `${id}.png`)));

function extent(img, x, y, w, h) {
  const at = (px, py) => {
    const i = (py * img.width + px) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const bg = at(x, y);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) {
      const c = at(px, py);
      if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 60) {
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
    }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

for (let i = 0; i + 3 < nums.length; i += 4) {
  const [x, y, w, h] = nums.slice(i, i + 4).map(Number);
  const r = extent(ref, x, y, w, h);
  const a = extent(act, x, y, w, h);
  const d = r && a ? `dx=${a.x - r.x} dy=${a.y - r.y} dw=${a.w - r.w} dh=${a.h - r.h}` : '';
  console.log(`${id} [${x},${y},${w},${h}] ref=${JSON.stringify(r)} app=${JSON.stringify(a)} ${d}`);
}
