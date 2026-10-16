// 画面設計（docs/ui-reference/screens/Sxx.png）と実装の撮影（work/screens/<variant>/Sxx.png）を比較する。
// 出力：work/screens/compare/<variant>/Sxx-diff.png（差分）・Sxx-side.png（左右並べ）・report.json
// 参照PNG・撮影画像はローカル資料であり Git 対象外。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const variant = process.argv[2] ?? 'app';
const only = process.argv.slice(3);
const REF = path.join(ROOT, 'docs', 'ui-reference', 'screens');
const ACT = path.join(ROOT, 'work', 'screens', variant);
const OUT = path.join(ROOT, 'work', 'screens', 'compare', variant);

function readPng(file) {
  return readFile(file).then((b) => PNG.sync.read(b));
}

/** 行ごとの差分画素数から、差が集中している帯（y範囲）を返す */
function bands(diffRows, height) {
  const out = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    const hot = diffRows[y] > 20;
    if (hot && start < 0) start = y;
    if ((!hot || y === height - 1) && start >= 0) {
      if (y - start > 3) out.push([start, y]);
      start = -1;
    }
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ids = only.length > 0 ? only : Array.from({ length: 34 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
  const report = [];
  for (const id of ids) {
    const refFile = path.join(REF, `${id}.png`);
    const actFile = path.join(ACT, `${id}.png`);
    if (!existsSync(refFile) || !existsSync(actFile)) {
      report.push({ id, status: 'MISSING' });
      continue;
    }
    const ref = await readPng(refFile);
    const act = await readPng(actFile);
    if (ref.width !== act.width || ref.height !== act.height) {
      report.push({ id, status: 'SIZE_MISMATCH', ref: [ref.width, ref.height], act: [act.width, act.height] });
      continue;
    }
    const { width, height } = ref;
    const diff = new PNG({ width, height });
    const n = pixelmatch(ref.data, act.data, diff.data, width, height, { threshold: 0.15, includeAA: false, alpha: 0.35 });
    const rows = new Array(height).fill(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (diff.data[(y * width + x) * 4] === 255 && diff.data[(y * width + x) * 4 + 1] === 0) rows[y]++;
    await writeFile(path.join(OUT, `${id}-diff.png`), PNG.sync.write(diff));
    const side = new PNG({ width: width * 2 + 8, height });
    side.data.fill(255);
    PNG.bitblt(ref, side, 0, 0, width, height, 0, 0);
    PNG.bitblt(act, side, 0, 0, width, height, width + 8, 0);
    await writeFile(path.join(OUT, `${id}-side.png`), PNG.sync.write(side));
    report.push({ id, status: 'OK', diffPixels: n, ratio: Number(((n / (width * height)) * 100).toFixed(2)), bands: bands(rows, height) });
  }
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  for (const r of report) console.log(`${r.id}\t${r.status}\t${r.ratio ?? ''}%\t${(r.bands ?? []).map((b) => b.join('-')).join(' ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
