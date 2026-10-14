// 共通マスター生成スクリプト（開発時・ビルド時に実行）
//
// - 出典は commit SHA と SHA-256 で固定する。内容が一致しなければ生成を中止する。
// - 出典データの配布条件は未確認のため、生成物（public/master/）は Git に含めない。
// - 利用者のブラウザから出典サイトへアクセスしない。生成済み JSON をビルドに同梱する。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'master-sources');
const OUT_DIR = path.join(ROOT, 'public', 'master');
const SCHEMA_VERSION = 1;

/** 固定した出典。更新時は commit・SHA-256・確認日を同時に変更し、PRで差分をレビューする。 */
export const SOURCES = [
  {
    id: 'api_start2',
    title: 'Tibowl/api_start2 start2.json（ゲームの共通マスター）',
    repository: 'https://github.com/Tibowl/api_start2',
    commit: '23637be57ac23a7b4281f193b836fa568ead8ee4',
    path: 'start2.json',
    sha256: '71E7FECB9475DF36063D9313BFDC552A906AE2F29EE97D5FB57FCDFAC559771F',
    checkedAt: '2026-10-14',
    license: '未確認（リポジトリにライセンス表記なし）',
  },
  {
    id: 'eo_equipment_upgrades',
    title: 'ElectronicObserverEN/Data EquipmentUpgrades.json（改修レシピ）',
    repository: 'https://github.com/ElectronicObserverEN/Data',
    commit: 'f9a1326f423308da27a94cab6df1f5688e351e4a',
    path: 'Data/EquipmentUpgrades.json',
    sha256: '9D6148C704DE1BE169DC316A5C61EE8EA900AB367ADEC33F473FEE34D028AB7C',
    checkedAt: '2026-10-14',
    license: '未確認（リポジトリにライセンス表記なし）',
  },
];

/** api_get_member/material の資材ID（data-research.md・74式EN MaterialData.cs で確認）。表示名は画面仕様に合わせる。 */
const RESOURCES = [
  { id: 1, name: '燃料', shortName: '燃料' },
  { id: 2, name: '弾薬', shortName: '弾薬' },
  { id: 3, name: '鋼材', shortName: '鋼材' },
  { id: 4, name: 'ボーキサイト', shortName: 'ボーキ' },
  { id: 5, name: '高速建造材（バーナー）', shortName: 'バーナー' },
  { id: 6, name: '高速修復材（バケツ）', shortName: 'バケツ' },
  { id: 7, name: '開発資材（釘）', shortName: '釘' },
  { id: 8, name: '改修資材（ネジ）', shortName: 'ネジ' },
];

const PLAYER_ID_LIMIT = 1500; // これ以上は深海棲艦側の装備・艦（プレイヤー用マスターから除外）

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function loadSource(source) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${source.id}-${source.commit}.json`);
  let buffer;
  if (existsSync(cacheFile)) {
    buffer = await readFile(cacheFile);
  } else {
    const url = `https://raw.githubusercontent.com/${source.repository.replace('https://github.com/', '')}/${source.commit}/${source.path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`出典の取得に失敗しました: ${source.id} HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  const actual = sha256Hex(buffer);
  if (actual !== source.sha256) {
    throw new Error(`出典のSHA-256が一致しません: ${source.id} expected=${source.sha256} actual=${actual}`);
  }
  if (!existsSync(cacheFile)) await writeFile(cacheFile, buffer);
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function assertInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`不正な数値: ${label}=${value}`);
  return value;
}

function stageCost(detail, label) {
  return {
    devmats: assertInt(detail.devmats, `${label}.devmats`),
    devmatsGuaranteed: assertInt(detail.devmats_sli, `${label}.devmats_sli`),
    screws: assertInt(detail.screws, `${label}.screws`),
    screwsGuaranteed: assertInt(detail.screws_sli, `${label}.screws_sli`),
    equipment: (detail.equips ?? []).map((e) => ({ equipmentId: assertInt(e.id, `${label}.equips.id`), count: assertInt(e.eq_count, `${label}.equips.count`) })),
    useItems: (detail.consumable ?? []).map((c) => ({ useItemId: assertInt(c.id, `${label}.consumable.id`), count: assertInt(c.eq_count, `${label}.consumable.count`) })),
  };
}

function buildShips(mstShips) {
  const players = mstShips.filter((s) => s.api_id < PLAYER_ID_LIMIT);
  const ids = new Set(players.map((s) => s.api_id));
  const parent = new Map(players.map((s) => [s.api_id, s.api_id]));
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const s of players) {
    const after = Number(s.api_aftershipid);
    if (after > 0 && ids.has(after)) union(s.api_id, after);
  }
  return players
    .map((s) => ({
      id: s.api_id,
      name: s.api_name,
      yomi: s.api_yomi ?? '',
      shipTypeId: s.api_stype,
      afterShipId: Number(s.api_aftershipid) > 0 ? Number(s.api_aftershipid) : null,
      afterLevel: typeof s.api_afterlv === 'number' && s.api_afterlv > 0 ? s.api_afterlv : null,
      familyId: find(s.api_id),
      sortNo: s.api_sortno ?? null,
    }))
    .sort((a, b) => a.id - b.id);
}

function buildMaster(start2, upgrades) {
  const data = start2.api_data ?? start2;
  const equipTypes = new Map(data.api_mst_slotitem_equiptype.map((t) => [t.api_id, t.api_name]));
  const equipment = data.api_mst_slotitem
    .filter((e) => e.api_id < PLAYER_ID_LIMIT)
    .map((e) => ({
      id: e.api_id,
      name: e.api_name,
      typeId: e.api_type[2],
      typeName: equipTypes.get(e.api_type[2]) ?? '',
      iconId: e.api_type[3],
      sortNo: e.api_sortno ?? null,
    }))
    .sort((a, b) => a.id - b.id);
  const ships = buildShips(data.api_mst_ship);
  const useItems = data.api_mst_useitem.map((u) => ({ id: u.api_id, name: u.api_name })).sort((a, b) => a.id - b.id);

  const equipmentIds = new Set(equipment.map((e) => e.id));
  const shipIds = new Set(ships.map((s) => s.id));
  const useItemIds = new Set(useItems.map((u) => u.id));
  const problems = [];

  const recipes = upgrades
    .map((u) => {
      const equipmentId = assertInt(u.eq_id, 'eq_id');
      if (!equipmentIds.has(equipmentId)) problems.push(`改修対象の装備IDがマスターにない: ${equipmentId}`);
      const entries = (u.improvement ?? []).map((imp, entryIndex) => {
        const label = `eq${equipmentId}#${entryIndex}`;
        const helpers = (imp.helpers ?? []).map((h) => ({
          shipIds: h.ship_ids.map((id) => {
            if (!shipIds.has(id)) problems.push(`${label}: 担当艦IDがマスターにない ${id}`);
            return assertInt(id, `${label}.ship_ids`);
          }),
          days: h.days.map((d) => {
            if (!Number.isInteger(d) || d < 0 || d > 6) problems.push(`${label}: 曜日値が不正 ${d}`);
            return d;
          }),
        }));
        const convert = imp.convert
          ? { toEquipmentId: assertInt(imp.convert.id_after, `${label}.id_after`), toStar: assertInt(imp.convert.lvl_after, `${label}.lvl_after`) }
          : null;
        if (convert && !equipmentIds.has(convert.toEquipmentId)) problems.push(`${label}: 更新先IDがマスターにない ${convert.toEquipmentId}`);
        if (convert && !imp.costs.conv) problems.push(`${label}: 更新先があるのに更新費用がない`);
        const cost = {
          fuel: assertInt(imp.costs.fuel, `${label}.fuel`),
          ammo: assertInt(imp.costs.ammo, `${label}.ammo`),
          steel: assertInt(imp.costs.steel, `${label}.steel`),
          bauxite: assertInt(imp.costs.baux, `${label}.baux`),
          p1: stageCost(imp.costs.p1, `${label}.p1`),
          p2: stageCost(imp.costs.p2, `${label}.p2`),
          // 更新先がないエントリの conv は使わない（出典データに6件存在。更新工程を推測しない）
          conv: convert && imp.costs.conv ? stageCost(imp.costs.conv, `${label}.conv`) : null,
          extra: (imp.costs.extra ?? []).map((x) => ({
            levels: x.levels.map((l) => assertInt(l, `${label}.extra.levels`)),
            equipment: (x.equips ?? []).map((e) => ({ equipmentId: assertInt(e.id, `${label}.extra.equips.id`), count: assertInt(e.eq_count, `${label}.extra.equips.count`) })),
            useItems: (x.consumable ?? []).map((c) => ({ useItemId: assertInt(c.id, `${label}.extra.consumable.id`), count: assertInt(c.eq_count, `${label}.extra.consumable.count`) })),
          })),
        };
        for (const stage of [cost.p1, cost.p2, cost.conv, ...cost.extra]) {
          if (!stage) continue;
          for (const e of stage.equipment) if (!equipmentIds.has(e.equipmentId)) problems.push(`${label}: 素材装備IDがマスターにない ${e.equipmentId}`);
          for (const c of stage.useItems) if (!useItemIds.has(c.useItemId)) problems.push(`${label}: アイテムIDがマスターにない ${c.useItemId}`);
        }
        return { entryIndex, helpers, convert, cost };
      });
      return { equipmentId, entries };
    })
    .filter((r) => r.entries.length > 0)
    .sort((a, b) => a.equipmentId - b.equipmentId);

  return { equipment, ships, useItems, recipes, problems };
}

async function main() {
  const [start2, upgrades] = await Promise.all(SOURCES.map(loadSource));
  const { equipment, ships, useItems, recipes, problems } = buildMaster(start2, upgrades);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    throw new Error(`マスターの参照整合に ${problems.length} 件の問題があります`);
  }
  const body = {
    schemaVersion: SCHEMA_VERSION,
    sources: SOURCES.map(({ sha256, ...s }) => ({ ...s, sha256 })),
    resources: RESOURCES,
    equipment,
    ships,
    useItems,
    recipes,
  };
  const contentHash = sha256Hex(Buffer.from(JSON.stringify(body)));
  const masterVersion = `m${SOURCES[0].checkedAt.replaceAll('-', '')}-${contentHash.slice(0, 10).toLowerCase()}`;
  const master = { masterVersion, ...body };
  const json = JSON.stringify(master);
  const fileName = `master-${masterVersion}.json`;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, fileName), json, 'utf8');
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    masterVersion,
    file: fileName,
    sha256: sha256Hex(Buffer.from(json)),
    counts: {
      equipment: equipment.length,
      ships: ships.length,
      useItems: useItems.length,
      recipes: recipes.length,
      recipeEntries: recipes.reduce((n, r) => n + r.entries.length, 0),
      entriesWithoutHelpers: recipes.reduce((n, r) => n + r.entries.filter((e) => e.helpers.length === 0).length, 0),
    },
    sources: SOURCES.map((s) => ({ id: s.id, commit: s.commit, sha256: s.sha256, checkedAt: s.checkedAt, license: s.license })),
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`マスターを生成しました: ${fileName}`);
  console.log(JSON.stringify(manifest.counts));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
