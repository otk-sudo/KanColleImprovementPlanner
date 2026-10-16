// 共通マスターの網羅性検証（開発時に実行。生成物・出典を配布しない）
//
// 使い方：npm run master:build のあと npm run master:crosscheck [-- --wiki <保存したHTMLのパス>]
// - 出典（.cache/master-sources の固定版）と生成物（public/master）を突き合わせ、全装備・全改修データが
//   取り込まれているか、参照先（装備・艦娘・更新先）が存在するかを確認する。不一致があれば終了コード 1。
// - --wiki を指定すると、改修可能な装備IDの一覧を独立した資料（手元に保存した攻略Wikiの改修表）と比べる。
//   Wiki の内容は表示上の照合用であり、生成物には使わない。差分は情報として出力する（終了コードには含めない）。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SOURCES } from './build-master.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PLAYER_ID_LIMIT = 1500;

async function json(file) {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

function sourceFile(id) {
  const s = SOURCES.find((x) => x.id === id);
  return path.join(ROOT, '.cache', 'master-sources', `${s.id}-${s.commit}.json`);
}

async function main() {
  const wikiArg = process.argv.indexOf('--wiki');
  const wikiPath = wikiArg >= 0 ? process.argv[wikiArg + 1] : null;
  const manifestFile = path.join(ROOT, 'public', 'master', 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error('public/master がありません。先に npm run master:build を実行してください。');
  const manifest = await json(manifestFile);
  const master = await json(path.join(ROOT, 'public', 'master', manifest.file));
  for (const id of ['api_start2', 'eo_equipment_upgrades']) {
    if (!existsSync(sourceFile(id))) throw new Error(`出典のキャッシュ（${id}）がありません。npm run master:build を実行してください。`);
  }
  const raw2 = await json(sourceFile('api_start2'));
  const start2 = raw2.api_data ?? raw2;
  const eo = await json(sourceFile('eo_equipment_upgrades'));
  const problems = [];
  const report = (ok, label, detail = '') => {
    console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? `：${detail}` : ''}`);
    if (!ok) problems.push(label);
  };

  // 1. 装備・艦娘・アイテム：出典のプレイヤー用マスターを全件含む
  const slotIds = start2.api_mst_slotitem.filter((x) => x.api_id < PLAYER_ID_LIMIT).map((x) => x.api_id);
  const shipIds = start2.api_mst_ship.filter((x) => x.api_id < PLAYER_ID_LIMIT).map((x) => x.api_id);
  const itemIds = start2.api_mst_useitem.map((x) => x.api_id);
  const mEq = new Set(master.equipment.map((x) => x.id));
  const mShip = new Set(master.ships.map((x) => x.id));
  const mItem = new Set(master.useItems.map((x) => x.id));
  const missEq = slotIds.filter((id) => !mEq.has(id));
  const missShip = shipIds.filter((id) => !mShip.has(id));
  const missItem = itemIds.filter((id) => !mItem.has(id));
  report(missEq.length === 0, `装備 ${mEq.size}件（出典 ${slotIds.length}件）`, missEq.length ? `未収録 ${missEq.slice(0, 10).join(',')}` : '');
  report(missShip.length === 0, `艦娘 ${mShip.size}件（出典 ${shipIds.length}件）`, missShip.length ? `未収録 ${missShip.slice(0, 10).join(',')}` : '');
  report(missItem.length === 0, `アイテム ${mItem.size}件（出典 ${itemIds.length}件）`, missItem.length ? `未収録 ${missItem.slice(0, 10).join(',')}` : '');

  // 2. 改修レシピ：出典で改修データがある装備をすべて含み、エントリ数も一致する
  const eoImprovable = eo.filter((e) => Array.isArray(e.improvement) && e.improvement.length > 0);
  const mRecipe = new Map(master.recipes.map((r) => [r.equipmentId, r]));
  const missRecipe = eoImprovable.filter((e) => !mRecipe.has(e.eq_id)).map((e) => e.eq_id);
  const extraRecipe = master.recipes.filter((r) => !eoImprovable.some((e) => e.eq_id === r.equipmentId)).map((r) => r.equipmentId);
  report(missRecipe.length === 0 && extraRecipe.length === 0, `改修できる装備 ${mRecipe.size}件（出典 ${eoImprovable.length}件）`, [missRecipe.length ? `未収録 ${missRecipe.join(',')}` : '', extraRecipe.length ? `出典にない ${extraRecipe.join(',')}` : ''].filter(Boolean).join(' / '));
  const entryMismatch = eoImprovable.filter((e) => (mRecipe.get(e.eq_id)?.entries.length ?? -1) !== e.improvement.length).map((e) => e.eq_id);
  const totalEntries = master.recipes.reduce((n, r) => n + r.entries.length, 0);
  report(entryMismatch.length === 0, `改修エントリ ${totalEntries}件`, entryMismatch.length ? `件数が違う装備 ${entryMismatch.join(',')}` : '');

  // 3. 参照先：担当艦・更新先・素材装備・アイテムがマスターに存在する
  const badRefs = [];
  for (const r of master.recipes) {
    for (const e of r.entries) {
      for (const h of e.helpers) for (const s of h.shipIds) if (!mShip.has(s)) badRefs.push(`装備${r.equipmentId}の担当艦${s}`);
      if (e.convert && !mEq.has(e.convert.toEquipmentId)) badRefs.push(`装備${r.equipmentId}の更新先${e.convert.toEquipmentId}`);
      for (const st of [e.cost.p1, e.cost.p2, e.cost.conv].filter(Boolean)) {
        for (const q of st.equipment) if (!mEq.has(q.equipmentId)) badRefs.push(`装備${r.equipmentId}の素材${q.equipmentId}`);
        for (const u of st.useItems) if (!mItem.has(u.useItemId)) badRefs.push(`装備${r.equipmentId}のアイテム${u.useItemId}`);
      }
    }
  }
  report(badRefs.length === 0, '参照先（担当艦・更新先・素材・アイテム）', badRefs.slice(0, 10).join(' / '));
  const noHelper = master.recipes.filter((r) => r.entries.some((e) => e.helpers.length === 0)).map((r) => r.equipmentId);
  console.log(`情報 担当艦・曜日が出典にないエントリを持つ装備：${noHelper.length}件（${noHelper.join(',')}）→ 画面では「条件未確認」と表示し、改修不可とは扱わない`);

  // 4. 独立資料との照合（任意）
  if (wikiPath) {
    const html = await readFile(wikiPath, 'utf8');
    const wikiIds = new Set([...html.matchAll(/name ?="id(\d+)"/g)].map((m) => Number(m[1])));
    const onlyEo = [...mRecipe.keys()].filter((id) => !wikiIds.has(id));
    const onlyWiki = [...wikiIds].filter((id) => !mRecipe.has(id));
    console.log(`情報 攻略Wikiの改修表：${wikiIds.size}件。マスターのみ ${onlyEo.length}件（${onlyEo.join(',')}）、Wikiのみ ${onlyWiki.length}件（${onlyWiki.join(',')}）`);
  }

  console.log(problems.length === 0 ? '\n網羅性の検証：不一致なし' : `\n網羅性の検証：不一致 ${problems.length}件`);
  if (problems.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
