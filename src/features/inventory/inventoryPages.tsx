import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleSetProtection } from '../../application/commands';
import { protectionChangePreview } from '../../domain/import/apply';
import { formatJstDateTime, formatJstMonthDayTime } from '../../domain/jst';
import type { MaterialTotal } from '../../domain/planning/types';
import { EquipmentImage, IMAGES_ENABLED, ShipImage } from '../../ui/GameImage';
import { equipLabel } from '../../ui/format';
import { equipmentRows, helperRows, requiredLabel, stageName } from './inventoryModel';
import './inventory.css';

// 所持データ（S06 装備・S16 艦娘・S17 資材とアイテム・S33 保護設定・S22 画像付き詳細）。

function InventoryTabs({ active, wide }: { active: 'equipment' | 'ships' | 'items'; wide: boolean }) {
  const w = wide ? [190, 190, 190] : [160, 160, 180];
  return (
    <div className={`inv-tabs${wide ? '' : ' is-narrow'}`} role="tablist" aria-label="所持データの種類">
      <Link role="tab" aria-selected={active === 'equipment'} className={`btn ${active === 'equipment' ? 'btn-primary' : ''}`} to="/inventory/equipment" style={{ width: w[0] }}>
        装備
      </Link>
      <Link role="tab" aria-selected={active === 'ships'} className={`btn ${active === 'ships' ? 'btn-primary' : ''}`} to="/inventory/ships" style={{ width: w[1] }}>
        艦娘
      </Link>
      <Link role="tab" aria-selected={active === 'items'} className={`btn ${active === 'items' ? 'btn-primary' : ''}`} to="/inventory/items" style={{ width: w[2] }}>
        資材・アイテム
      </Link>
      <span className="spacer" />
      <Link className="btn btn-primary" to="/import" style={{ width: wide ? 188 : 225 }}>
        データを更新
      </Link>
    </div>
  );
}

function importedText(iso: string | null): string {
  return iso ? `${formatJstMonthDayTime(iso).replace(/^(\d+)月(\d+)日 /, (_, mo: string, d: string) => `${mo.padStart(2, '0')}/${d.padStart(2, '0')} `)} 取り込み` : '未取得';
}

export function EquipmentInventoryPage() {
  const { projection, plan, master, data } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const rows = useMemo(() => equipmentRows(projection, plan), [projection, plan]);
  const types = useMemo(() => [...new Set(rows.map((r) => master.equipment.get(r.equipmentId)?.typeName ?? '未登録'))].sort(), [rows, master]);
  const filtered = rows
    .filter((r) => (query ? master.equipmentName(r.equipmentId).includes(query) : true))
    .filter((r) => (type ? (master.equipment.get(r.equipmentId)?.typeName ?? '未登録') === type : true))
    .sort((a, b) => Number(b.reconciliationRequired) - Number(a.reconciliationRequired) || (master.equipment.get(a.equipmentId)?.sortNo ?? a.equipmentId) - (master.equipment.get(b.equipmentId)?.sortNo ?? b.equipmentId) || b.star - a.star);
  const issues = rows.filter((r) => r.reconciliationRequired);
  const helpers = helperRows(master, projection, data.goals, plan);
  const eqTime = projection.equipment.importedAt;
  const shipTime = projection.ships.importedAt;
  const resTimes = [...projection.resources.values()].map((v) => v.importedAt).sort();
  const itemTimes = [...projection.items.values()].map((v) => v.importedAt).sort();
  return (
    <Page nav="inventory" title="所持データ" sub="取り込んだ在庫と担当艦の状態を確認します。">
      <InventoryTabs active="equipment" wide />
      <section className="card inv-eq-card" aria-label="所持装備">
        {!projection.equipment.known ? (
          <div className="empty-state">
            装備の所持データは未取得です。
            <Link to="/import">取り込む</Link>
          </div>
        ) : (
          <>
            <div className="inv-filter">
              <label className="visually-hidden" htmlFor="eq-search">
                装備名で検索
              </label>
              <input id="eq-search" className="inv-search" placeholder="装備名で検索…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="visually-hidden" htmlFor="eq-type">
                分類
              </label>
              <select id="eq-type" className="inv-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">分類：すべて ▾</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    分類：{t}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-scroll">
              <table className="inv-eq-table">
                <thead>
                  <tr>
                    <th scope="col">装備・改修値</th>
                    <th scope="col">所持</th>
                    <th scope="col">目標用</th>
                    <th scope="col">保護</th>
                    <th scope="col">素材利用可</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">
                        <Link className="inv-eq-name" to={`/inventory/equipment/${r.equipmentId}`}>
                          {equipLabel(master, r.equipmentId, r.star)}
                        </Link>
                      </th>
                      <td>{r.owned}</td>
                      <td>{r.goalUse}</td>
                      <td>{r.reconciliationRequired ? '要確認' : r.protectionRequested}</td>
                      <td>
                        <span>{r.reconciliationRequired ? '保留' : r.materialAvailable}</span>
                        <button type="button" className="btn inv-protect-btn" aria-label={`${equipLabel(master, r.equipmentId, r.star)}の保護数を変更`} onClick={() => navigate(`/inventory/protection/${r.key}`)}>
                          保護数を変更
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 ? <p className="empty-state">条件に合う装備はありません。</p> : null}
            {issues.map((r) => (
              <p key={r.key} className="inv-warning text-warn">
                <Link to={`/inventory/protection/${r.key}`} className="text-warn">
                  ! {equipLabel(master, r.equipmentId, r.star)}：最新所持{r.owned}個に対し手動保護{r.protectionRequested}個。保護設定の確認が必要です。
                </Link>
              </p>
            ))}
          </>
        )}
      </section>
      <div className="inv-bottom">
        <section className="card inv-helper-card" aria-labelledby="helper-title">
          <h2 className="card-title" id="helper-title">
            担当艦の確認
          </h2>
          {helpers.length === 0 ? (
            <p className="inv-helper-list text-sub">目標を登録すると、改修に必要な担当艦の所持・改造段階を表示します。</p>
          ) : (
            <ul className="inv-helper-list">
              {[...helpers]
                .sort((a, b) => ['ok', 'remodel', 'missing', 'unknown'].indexOf(a.status) - ['ok', 'remodel', 'missing', 'unknown'].indexOf(b.status))
                .slice(0, 6)
                .map((h) => (
                  <li key={h.key}>
                    <span className="inv-helper-name">{master.shipName(h.status === 'ok' || h.status === 'remodel' ? h.displayShipId : h.requiredShipIds[h.requiredShipIds.length - 1]!)}</span>
                    <span>{h.status === 'ok' ? '✓ 条件適合' : h.status === 'remodel' ? '改造段階不足' : h.status === 'unknown' ? '所持状況不明' : '未所持'}</span>
                  </li>
                ))}
              {helpers.length > 6 ? (
                <li>
                  <Link to="/inventory/ships">ほか {helpers.length - 6} 隻を見る</Link>
                </li>
              ) : null}
            </ul>
          )}
        </section>
        <section className="card inv-import-card" aria-labelledby="import-status-title">
          <h2 className="card-title" id="import-status-title">
            取り込み状況
          </h2>
          <ul className="inv-import-list text-sub">
            {eqTime && eqTime === shipTime ? (
              <li>装備・艦娘：{importedText(eqTime)}</li>
            ) : (
              <>
                <li>装備：{eqTime ? importedText(eqTime) : <Link to="/import">未取得 → 取り込む</Link>}</li>
                <li>艦娘：{shipTime ? importedText(shipTime) : <Link to="/import">未取得 → 取り込む</Link>}</li>
              </>
            )}
            <li>資材：{resTimes.length > 0 ? importedText(resTimes[resTimes.length - 1]!) : <Link to="/import">未取得 → 取り込む</Link>}</li>
            <li>その他アイテム：{itemTimes.length > 0 ? importedText(itemTimes[itemTimes.length - 1]!) : <Link to="/import">未取得 → 取り込む</Link>}</li>
          </ul>
        </section>
      </div>
    </Page>
  );
}

export function ShipInventoryPage() {
  const { projection, plan, master, data } = useStore();
  const rows = helperRows(master, projection, data.goals, plan);
  return (
    <Page nav="inventory" title="所持艦娘" top={195} sub="担当艦の所持だけでなく、改造段階が条件を満たすか確認します。">
      <InventoryTabs active="ships" wide={false} />
      <section className="card inv-ship-card" aria-labelledby="ship-title">
        <h2 className="card-title" id="ship-title">
          目標に関係する担当艦
        </h2>
        {rows.length === 0 ? (
          <p className="empty-state">目標を登録すると、改修に必要な担当艦を表示します。</p>
        ) : (
          <div className="table-scroll">
            <table className="inv-ship-table">
              <thead>
                <tr>
                  <th scope="col">艦娘</th>
                  <th scope="col">所持・改造段階</th>
                  <th scope="col">条件</th>
                  <th scope="col">対象</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const shown = r.status === 'ok' || r.status === 'remodel' ? r.displayShipId : r.requiredShipIds[r.requiredShipIds.length - 1]!;
                  return (
                    <tr key={r.key} className={r.status === 'missing' ? 'is-alt' : ''}>
                      <th scope="row">
                        <span className="inv-ship-cell">
                          <ShipImage shipId={shown} name={master.shipName(shown)} />
                          <span className="inv-ship-name">{master.shipName(shown)}</span>
                        </span>
                      </th>
                      <td>{r.ownedLabel}</td>
                      <td className={r.status === 'ok' ? 'text-ok' : 'text-warn'}>{requiredLabel(master, r)}</td>
                      <td>{r.targets.map((t) => master.equipmentName(t)).join('・')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card inv-ship-note" aria-labelledby="ship-none-title">
        <h2 className="card-title" id="ship-none-title">
          所持情報がない場合
        </h2>
        <p className="inv-ship-note-text">装備のみ取り込んだ場合、艦娘は「不明」です。未所持とは区別し、自動配置を保留します。</p>
        <p className="inv-ship-updated">最終更新：{projection.ships.importedAt ? `${formatJstDateTime(projection.ships.importedAt)} JST` : '未取得'}</p>
      </section>
      <p className="inv-image-note">{IMAGES_ENABLED ? '画像は設定された配信元から表示しています。' : '画像は配布条件の確認待ちのため表示していません。名称と状態で判定できます。'}</p>
    </Page>
  );
}

interface ItemRow {
  key: string;
  label: string;
  current: number | null;
  need: number;
  shortage: number | null;
  state: '不足' | '充足' | '使用予定なし' | '取得が必要' | '確認待ち';
}

export function ItemsInventoryPage() {
  const { projection, plan, master } = useStore();
  const totals = new Map<string, MaterialTotal>((plan?.totals ?? []).map((t) => [t.key, t]));
  const rows: ItemRow[] = [];
  const order = [8, 7, 5, 6, 1, 2, 3, 4];
  for (const id of order) {
    const key = `resource:${id}`;
    const t = totals.get(key);
    const v = projection.resources.get(id);
    // 未取得で計画にも使わない資材は行を出さない（情報がない行で一覧を埋めない）
    if (!v && !t) continue;
    rows.push(toRow(key, master.resourceName(id), v?.value ?? null, t));
  }
  const itemIds = new Set<number>([...projection.items.keys(), ...[...totals.keys()].filter((k) => k.startsWith('item:')).map((k) => Number(k.split(':')[1]))]);
  for (const id of [...itemIds].sort((a, b) => a - b)) rows.push(toRow(`item:${id}`, master.useItemName(id), projection.items.get(id)?.value ?? null, totals.get(`item:${id}`)));
  const updated = [...projection.resources.values(), ...projection.items.values()].map((v) => v.importedAt).sort().at(-1);
  return (
    <Page nav="inventory" title="資材・アイテム" top={195} sub="現在数・計画で使う数・不足数をまとめて確認できます。">
      <InventoryTabs active="items" wide={false} />
      <section className="card inv-items-card" aria-labelledby="items-title">
        <h2 className="card-title" id="items-title">
          所持数と計画全体の必要数
        </h2>
        <div className="table-scroll">
          <table className="inv-items-table">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">現在数</th>
                <th scope="col">必要数</th>
                <th scope="col">不足数</th>
                <th scope="col">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={i % 2 === 1 ? 'is-alt' : ''}>
                  <th scope="row">{r.label}</th>
                  <td>{r.current === null ? '不明' : r.current}</td>
                  <td>{r.need}</td>
                  <td>{r.shortage === null ? '—' : r.shortage}</td>
                  <td className={r.state === '充足' ? 'text-ok' : r.state === '使用予定なし' ? 'text-sub' : 'text-warn'}>{r.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="inv-items-foot text-sub">最終更新：{updated ? `${formatJstDateTime(updated)} JST` : '未取得'} ／ 不明な値を 0 として計算しません。</p>
      </section>
    </Page>
  );
}

function toRow(key: string, label: string, current: number | null, t: MaterialTotal | undefined): ItemRow {
  const need = t?.need ?? 0;
  const held = t?.held ?? 0;
  const shortage = current === null ? null : Math.max(0, need - (current - held));
  let state: ItemRow['state'];
  if (need === 0) state = '使用予定なし';
  else if (current === null || t?.available === null) state = '取得が必要';
  else if ((t?.shortage ?? shortage ?? 0) > 0) state = '不足';
  else state = '充足';
  if (held > 0 && state === '充足') state = '確認待ち';
  return { key, label, current, need, shortage: current === null ? null : (t?.shortage ?? shortage), state };
}

export function ProtectionPage() {
  const { bucket = '' } = useParams();
  const { projection, plan, master, run, busy } = useStore();
  const navigate = useNavigate();
  const [equipmentId, star] = bucket.split(':').map(Number) as [number, number];
  const usage = plan?.buckets.find((b) => b.equipmentId === equipmentId && b.star === star);
  const owned = Math.max(0, projection.equipment.counts.get(bucket) ?? 0);
  const goalUse = usage?.goalUse ?? 0;
  const requested = usage?.protectionRequested ?? 0;
  const reconciling = usage?.reconciliationRequired ?? false;
  const prev = useStore().data.protections.find((p) => p.bucket === bucket);
  const instances = (projection.equipment.instances ?? []).filter((i) => i.equipmentId === equipmentId && i.star === star);
  const useInstances = projection.equipment.granularity === 'instance' && instances.length > 0;
  const [selected, setSelected] = useState<number[]>(prev?.instanceIds?.filter((id) => instances.some((i) => i.instanceId === id)) ?? []);
  // 個体単位では、保護数は選んだ個体の数（取り込みで消えた個体は選択から外れる）
  const [count, setCount] = useState(() => (useInstances ? selected.length : Math.min(requested, owned)));
  const [message, setMessage] = useState<string | null>(null);
  const snapshotAtOpen = useMemo(() => projection.equipment.snapshotId, [bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = protectionChangePreview({ owned, goalUse, newManual: count });
  const commandId = useCommandId(bucket, count, selected);
  const name = equipLabel(master, equipmentId, star);
  const save = async () => {
    const r = await run(reconciling ? 'ResolveProtection' : 'SetProtection', handleSetProtection, {
      equipmentId,
      star,
      count,
      instanceIds: useInstances ? selected : null,
      reason: '手動保護',
      resolve: reconciling,
      snapshotId: snapshotAtOpen,
      now: new Date().toISOString(),
    }, { commandId });
    if (!r.ok) {
      // 別のタブなどの変更と競合したら、最新の保護設定に読み直してから確認してもらう（古い値で上書きしない）
      if (r.outcome.status === 'CONFLICT' || r.outcome.status === 'EPOCH_MISMATCH') {
        const latest = r.latest.protections.find((p) => p.bucket === bucket);
        const ids = latest?.instanceIds?.filter((id) => instances.some((i) => i.instanceId === id)) ?? [];
        setSelected(ids);
        setCount(useInstances ? ids.length : (latest?.count ?? 0));
      }
      return setMessage(r.message);
    }
    navigate('/inventory/equipment');
  };
  return (
    <Page nav="inventory" top={196} title={reconciling ? '保護設定を確認' : '保護数を変更'} sub={reconciling ? '最新JSONは反映済みです。保護設定の確認が終わるまで、この装備を素材に割り当てません。' : '素材として消費しない個数を指定します。完成品としては数えます。'}>
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <section className="card prot-card1" aria-labelledby="prot-title">
        <h2 className="card-title" id="prot-title">
          {name}
        </h2>
        <p className="prot-counts">{reconciling && prev?.previousOwned !== null && prev?.previousOwned !== undefined ? `旧所持 ${prev.previousOwned}個 → 最新所持 ${owned}個` : `最新所持 ${owned}個`}</p>
        <p className="prot-detail">
          手動保護の指定 {requested}個 ／ 現在の完成目標への割当 {goalUse}個
        </p>
        <p className="prot-hint text-sub">保護は重複分を足しません。目標の{goalUse}個を含め、所持{owned}個を守る設定へ変更できます。</p>
      </section>
      <section className="card prot-card2" aria-labelledby="prot-edit-title">
        <h2 className="card-title" id="prot-edit-title">
          最新所持に合わせた手動保護
        </h2>
        <div className="prot-edit-row">
          <div className="stepper prot-stepper" role="group" aria-label="手動保護の個数">
            <button type="button" aria-label="1個減らす" disabled={count <= 0 || useInstances} onClick={() => setCount((c) => Math.max(0, c - 1))}>
              −
            </button>
            <output aria-live="polite">{count} 個</output>
            <button type="button" aria-label="1個増やす" disabled={count >= owned || useInstances} onClick={() => setCount((c) => Math.min(owned, c + 1))}>
              ＋
            </button>
          </div>
          <span className="prot-range">有効範囲：0〜{owned}個</span>
        </div>
        {useInstances ? (
          <fieldset className="prot-instances">
            <legend>保護する個体を選ぶ（個体IDを推測して対応付けません）</legend>
            {instances.map((i) => (
              <label key={i.instanceId}>
                <input
                  type="checkbox"
                  checked={selected.includes(i.instanceId)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...selected, i.instanceId] : selected.filter((x) => x !== i.instanceId);
                    setSelected(next);
                    setCount(next.length);
                  }}
                />{' '}
                個体ID {i.instanceId}
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="prot-after">
          変更後：手動保護 {count}個{preview.overlapWithGoal > 0 ? `（目標の${preview.overlapWithGoal}個と重複）` : ''}／ 素材に使える数 {preview.materialAvailable}個
        </p>
        <p className="prot-note text-sub">目標による保護は、この操作では解除されません。目標の変更は「改修目標」へ。</p>
      </section>
      {reconciling ? <p className="prot-hold text-warn">今は保留：最新所持{owned}個は維持し、確認待ちを残します。{prev?.previousOwned ? `旧所持${prev.previousOwned}個には戻りません。` : ''}</p> : <p className="prot-hold" />}
      <div className="prot-actions">
        <button type="button" className="btn" style={{ width: 200 }} onClick={() => navigate('/inventory/equipment')}>
          {reconciling ? '今は保留' : '戻る'}
        </button>
        <button type="button" className="btn btn-primary" style={{ width: 330 }} disabled={busy || !preview.valid} onClick={() => void save()}>
          保護{count}個に変更
        </button>
      </div>
    </Page>
  );
}

export function EquipmentDetailPage() {
  const { equipmentId: idParam = '' } = useParams();
  const equipmentId = Number(idParam);
  const { projection, plan, master } = useStore();
  const name = master.equipmentName(equipmentId);
  const rows = equipmentRows(projection, plan).filter((r) => r.equipmentId === equipmentId);
  const owned = rows.reduce((n, r) => n + r.owned, 0);
  const goalUse = rows.reduce((n, r) => n + r.goalUse, 0);
  const material = rows.reduce((n, r) => n + r.materialAvailable, 0);
  const helperIds = [...new Set((master.recipes.get(equipmentId) ?? []).flatMap((e) => e.helpers.flatMap((h) => h.shipIds)))];
  const ownedHelper = helperIds.find((id) => (projection.ships.owned.get(id) ?? 0) > 0) ?? helperIds[0];
  return (
    <Page nav="inventory" title="画像付きの装備・担当艦表示" top={196} sub="画像と名称を併記し、似た装備や改造段階を見分けやすくします。">
      <section className="card detail-card" aria-labelledby="detail-eq-title">
        <h2 className="card-title" id="detail-eq-title">
          装備の表示
        </h2>
        <div className="detail-body">
          <EquipmentImage equipmentId={equipmentId} name={name} size={112} />
          <div>
            <p className="detail-name">{name}</p>
            <p className="detail-counts">
              所持 {owned} ／ 目標用 {goalUse} ／ 素材利用可 {material}
              {rows.length > 0 ? <span className="detail-stars text-sub">（{[...rows].sort((a, b) => a.star - b.star).map((r) => `★${r.star}×${r.owned}`).join('・')}）</span> : null}
            </p>
            <p className="detail-sub text-sub">一覧は小さな画像、詳細では大きな画像で確認。名前と★は常に表示。</p>
          </div>
        </div>
        <p className="detail-warn text-warn">{IMAGES_ENABLED ? '画像は設定された配信元から表示しています。配布条件は運用者が確認してください。' : '画像は配布条件の確認待ちのため表示していません（名称・★・数量で操作できます）。'}</p>
      </section>
      <section className="card detail-card2" aria-labelledby="detail-ship-title">
        <h2 className="card-title" id="detail-ship-title">
          担当艦の表示
        </h2>
        {ownedHelper ? (
          <div className="detail-ship">
            <ShipImage shipId={ownedHelper} name={master.shipName(ownedHelper)} width={113} height={77} />
            <div>
              <p className="detail-name">{master.shipName(ownedHelper)}</p>
              <p className="detail-ship-sub text-ok">
                {(projection.ships.owned.get(ownedHelper) ?? 0) > 0 ? `所持（改造段階：${stageName(master, ownedHelper)}）` : projection.ships.known ? '未所持' : '所持状況不明'}
                {helperIds.length > 1 ? ` ／ ほかの担当艦 ${helperIds.length - 1}隻` : ''}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sub">この装備の担当艦は改修データに未収録です（条件を確認中）。</p>
        )}
        <p className="detail-source text-sub">画像出典：{IMAGES_ENABLED ? '設定された配信元' : '未設定'}。公開配布の条件確認は別途必要です。</p>
        <p className="detail-source text-sub">画像なし・読込失敗でも名称・状態・操作を維持します。</p>
      </section>
      <p className="detail-apply">適用：目標選択・所持一覧・必要素材・カレンダー詳細・担当艦候補</p>
    </Page>
  );
}
