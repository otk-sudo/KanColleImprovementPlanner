// 画面比較（ローカル専用）のため、参照PNGに含まれる画像部分を切り出して public/local-images/ に置く。
// 出力先は Git 対象外。ゲーム画像の公開配布条件は未確認のため、配布物・公開リポジトリには含めない。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'docs', 'ui-reference', 'screens');
const OUT = path.join(ROOT, 'public', 'local-images');

// [参照画面, 種類, ID, x, y, 幅, 高さ]（e2e/support/masters.ts の架空ID）
const CROPS = [
  ['S03', 'equipment', 1001, 330, 275, 58, 58],
  ['S03', 'equipment', 1003, 330, 449, 58, 58],
  ['S03', 'equipment', 1004, 330, 623, 58, 58],
  ['S16', 'ships', 2003, 282, 367, 65, 43],
  ['S16', 'ships', 2011, 282, 452, 65, 43],
  ['S16', 'ships', 2022, 282, 537, 65, 43],
];

async function crop(screen, x, y, w, h) {
  const png = PNG.sync.read(await readFile(path.join(SRC, `${screen}.png`)));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return PNG.sync.write(out);
}

async function main() {
  if (!existsSync(SRC)) throw new Error('参照PNG（docs/ui-reference/screens）がありません。このPCのローカル資料が必要です。');
  for (const [screen, kind, id, x, y, w, h] of CROPS) {
    await mkdir(path.join(OUT, kind), { recursive: true });
    await writeFile(path.join(OUT, kind, `${id}.png`), await crop(screen, x, y, w, h));
  }
  // S22 の大きな画像（同じIDを詳細表示で使うため別名で保存し、表示側で拡大に使う）
  console.log(`切り出し ${CROPS.length} 件 → public/local-images（Git対象外）`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
