import { Link, useSearchParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useStore } from '../../app/store';
import { formatJstMonthDayTime } from '../../domain/jst';
import type { CostKey, MaterialTotal } from '../../domain/planning/types';
import { costKeyLabel } from '../../ui/format';
import { SelectBox } from '../../ui/SelectBox';
import { goalTitle } from '../goals/goalModel';
import './materials.css';

// 必要素材（S05）。工程費用は各工程1回だけ合計し、共有在庫と一度だけ比較する（design/09「二重計上しない集計」）。

interface Row {
  key: CostKey;
  need: number;
  available: number | null;
  shortage: number | null;
  planned: number;
}

function judge(r: Row): { text: string; tone: string } {
  if (r.available === null) return { text: '? 未取得', tone: 'text-warn' };
  if ((r.shortage ?? 0) > 0) return { text: '! 不足', tone: 'text-warn' };
  return { text: '✓ 充足', tone: 'text-ok' };
}

const BASIC = ['resource:1', 'resource:2', 'resource:3', 'resource:4'];

export function MaterialsPage() {
  const { plan, data, master, projection } = useStore();
  const [params, setParams] = useSearchParams();
  const goalId = params.get('goal') ?? '';
  const onlyShort = params.get('view') === 'short';
  const goals = [...data.goals].sort((a, b) => a.priority - b.priority);
  const totals: MaterialTotal[] = plan?.totals ?? [];
  let rows: Row[];
  if (goalId) {
    const gp = plan?.goals.find((g) => g.goalId === goalId);
    const byKey = new Map(totals.map((t) => [t.key, t]));
    rows = (gp?.need ?? []).map((n) => {
      const s = gp?.shortages.find((x) => x.key === n.key);
      const t = byKey.get(n.key);
      return { key: n.key, need: n.amount, available: t?.available ?? null, shortage: s ? s.amount : t?.available === null ? null : 0, planned: t?.planned ?? 0 };
    });
  } else {
    rows = totals.map((t) => ({ key: t.key, need: t.need, available: t.available, shortage: t.shortage, planned: t.planned }));
  }
  rows.sort((a, b) => Number(BASIC.includes(a.key)) - Number(BASIC.includes(b.key)));
  const shown = onlyShort ? rows.filter((r) => r.shortage === null || r.shortage > 0) : rows;
  const screws = rows.find((r) => r.key === 'resource:8');
  const times = [projection.equipment.importedAt, ...[...projection.resources.values()].map((v) => v.importedAt)].filter((x): x is string => !!x).sort();
  const basis = times.at(-1);
  const goalForSteps = goalId || goals[0]?.goalId;
  return (
    <Page nav="materials" title="必要素材" sub="全目標の残り工程に必要なものを、在庫と比較します。">
      <div className="mat-toolbar">
        <label className="visually-hidden" htmlFor="mat-goal">
          対象の目標
        </label>
        <SelectBox
          id="mat-goal"
          width={200}
          value={goalId}
          options={[{ value: '', label: '全目標' }, ...goals.map((g) => ({ value: g.goalId, label: goalTitle(master, g) }))]}
          onChange={(v) => setParams(v ? { goal: v, view: onlyShort ? 'short' : 'all' } : { view: onlyShort ? 'short' : 'all' })}
        />
        <button type="button" className="btn btn-primary mat-toggle" aria-pressed={!onlyShort} onClick={() => setParams({ ...(goalId ? { goal: goalId } : {}), view: onlyShort ? 'all' : 'short' })}>
          {onlyShort ? '不足のみ表示中' : '全件を表示中'}
        </button>
        <p className="mat-basis text-muted">計算基準：{basis ? `${formatJstMonthDayTime(basis).replace(/^(\d+)月(\d+)日/, (_, m: string, d: string) => `${m}/${d}`)} の在庫` : '所持データ未取得'}</p>
      </div>
      <div className="mat-stats">
        <section className="card mat-stat" aria-label="必要なネジ">
          <p className="mat-stat-label">必要なネジ</p>
          <p className="mat-stat-value">{screws ? `${screws.need}個` : '0個'}</p>
        </section>
        <section className="card mat-stat" aria-label="使用可能">
          <p className="mat-stat-label">使用可能</p>
          <p className="mat-stat-value">{screws?.available === null ? '不明' : `${screws?.available ?? projection.resources.get(8)?.value ?? 0}個`}</p>
        </section>
        <section className="card mat-stat" aria-label="不足">
          <p className="mat-stat-label">不足</p>
          <p className={`mat-stat-value ${screws && screws.shortage !== 0 ? 'text-warn' : ''}`}>{screws ? (screws.shortage === null ? '不明' : `${screws.shortage}個`) : '0個'}</p>
        </section>
      </div>
      <section className="card mat-table-card" aria-label="必要なものの一覧">
        {!plan ? (
          <p className="text-sub">計画を計算できません（マスターの確認待ち、または計算待ち）。</p>
        ) : shown.length === 0 ? (
          <p className="text-sub">{rows.length === 0 ? '残りの工程で必要なものはありません。' : '不足している項目はありません。'}</p>
        ) : (
          <div className="table-scroll">
            <table className="mat-table">
              <thead>
                <tr>
                  <th scope="col">アイテム</th>
                  <th scope="col">必要</th>
                  <th scope="col">使用可能</th>
                  <th scope="col">不足</th>
                  <th scope="col">判定</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const j = judge(r);
                  return (
                    <tr key={r.key}>
                      <th scope="row">
                        {costKeyLabel(master, r.key)}
                        {r.planned > 0 ? <span className="mat-planned text-sub">（製作予定 {r.planned}）</span> : null}
                      </th>
                      <td>{r.need}</td>
                      <td>{r.available === null ? '不明' : r.available}</td>
                      <td>{r.shortage === null ? '—' : r.shortage}</td>
                      <td className={j.tone}>{j.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mat-note text-muted">使用可能数は保護・他計画の割当を除外。この計画用の割当は含めます。{goalId ? '目標別の不足は優先順位で割り当てた後の値です。' : ''}</p>
      <p className="mat-note2 text-muted">通常改修は全成功時の必要数。失敗した場合は実績に応じて再計算します。</p>
      {goalForSteps ? (
        <Link className="btn mat-steps" to={`/goals/${goalForSteps}/steps`}>
          工程別の内訳を見る
        </Link>
      ) : (
        <span className="btn mat-steps" aria-disabled="true">
          工程別の内訳を見る
        </span>
      )}
    </Page>
  );
}
