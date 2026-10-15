import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleDeleteGoal, handleReorderGoals, handleSaveGoal, handleSetPreferredHelper } from '../../application/commands';
import { equipmentStars } from '../../domain/inventory/projection';
import { WEEKDAY_LABELS } from '../../domain/jst';
import { enumerateRoutes, parseRouteKey, transitionOptions, type MasterIndex } from '../../domain/master';
import type { Goal, MaterialRouteChoice } from '../../domain/model';
import type { PlanResult, PlanStep, UnplacedReason } from '../../domain/planning/types';
import { UNPLACED_REASON_LABELS } from '../../domain/planning/types';
import { newId } from '../../infrastructure/repository';
import { EquipmentImage, IMAGES_ENABLED } from '../../ui/GameImage';
import { SelectBox } from '../../ui/SelectBox';
import { costKeyPlain, costSummaryTight, transitionLabel } from '../../ui/format';
import { stageName } from '../inventory/inventoryModel';
import { goalPlanOf, goalStatus, goalTarget, goalTitle, isGoalDone, routeOptions } from './goalModel';
import './goals.css';

// 改修目標（S03 一覧・S04 追加と計算プレビュー・S19 工程と改修条件・S14 配置できない予定）。design/09・17。

export function GoalsPage() {
  const { data, plan, master, run, busy } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'active';
  const goals = [...data.goals].sort((a, b) => a.priority - b.priority);
  const done = goals.filter((g) => isGoalDone(goalPlanOf(plan, g.goalId)));
  const active = goals.filter((g) => !isGoalDone(goalPlanOf(plan, g.goalId)));
  const shown = tab === 'done' ? done : tab === 'all' ? goals : active;
  const move = async (goalId: string, dir: -1 | 1) => {
    const ids = goals.map((g) => g.goalId);
    const i = ids.indexOf(goalId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await run('ReorderGoals', handleReorderGoals, { goalIds: ids });
  };
  return (
    <Page
      nav="goals"
      title="改修目標"
      sub="欲しい装備と個数から、必要な工程を組み立てます。"
      actions={
        <Link className="btn btn-primary goals-add" to="/goals/new">
          ＋ 目標を追加
        </Link>
      }
    >
      <div className="goals-tabs" role="tablist" aria-label="目標の絞り込み">
        {[
          ['active', `進行中 ${active.length}`],
          ['done', `達成済み ${done.length}`],
          ['all', 'すべて'],
        ].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn ${tab === key ? 'btn-primary' : ''}`} style={{ width: 138 }} onClick={() => setParams({ tab: key! })}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <section className="card goals-empty">
          <p>{goals.length === 0 ? 'まだ目標がありません。「＋ 目標を追加」から、欲しい装備・改修値・残す個数を登録します。' : 'この区分の目標はありません。'}</p>
        </section>
      ) : (
        <ol className="goals-list">
          {shown.map((g) => {
            const gp = goalPlanOf(plan, g.goalId);
            const st = goalStatus(gp);
            const completed = gp?.completed ?? 0;
            const pct = Math.min(100, (completed / g.count) * 100);
            return (
              <li key={g.goalId} className="card goal-card">
                <span className="goal-no">{String(g.priority).padStart(2, '0')}</span>
                <EquipmentImage equipmentId={g.equipmentId} name={master.equipmentName(g.equipmentId)} size={58} />
                <div className="goal-main">
                  <p className="goal-name">{master.equipmentName(g.equipmentId)}</p>
                  <p className="goal-target">{goalTarget(g)}</p>
                </div>
                <div className="goal-progress">
                  <p className="goal-progress-text">
                    {completed} / {g.count}個 達成
                  </p>
                  <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={g.count} aria-valuenow={completed} aria-label={`${goalTitle(master, g)} の達成数`}>
                    <span style={{ width: `${Math.max(pct, 1.5)}%` }} />
                  </div>
                </div>
                <div className={`goal-status text-${st.tone}`}>
                  <p>{st.text}</p>
                  {st.date ? <p className="goal-date text-sub">{st.date}</p> : null}
                </div>
                <div className="goal-priority">
                  <span>優先順位 {g.priority}</span>
                  <button type="button" className="link-button goal-move" disabled={busy || g.priority === 1} onClick={() => void move(g.goalId, -1)} aria-label={`${goalTitle(master, g)} の優先順位を上げる`}>
                    ↑ 上へ
                  </button>
                  <button type="button" className="link-button goal-move" disabled={busy || g.priority === goals.length} onClick={() => void move(g.goalId, 1)} aria-label={`${goalTitle(master, g)} の優先順位を下げる`}>
                    ↓ 下へ
                  </button>
                </div>
                <Link className="btn goal-edit" to={`/goals/${g.goalId}/edit`}>
                  詳細・編集
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <p className="goals-image-note">{IMAGES_ENABLED ? '画像は設定された配信元から表示しています。' : '画像は配布条件の確認待ちのため表示していません。名称と状態で判定できます。'}</p>
    </Page>
  );
}

function guaranteeValue(g: Pick<Goal, 'guarantee'>): string {
  if (g.guarantee.mode === 'never') return 'never';
  if (g.guarantee.mode === 'always') return 'always';
  return `from${g.guarantee.fromStar}`;
}

function EquipmentPicker({ master, value, onChange }: { master: MasterIndex; value: number | null; onChange: (id: number) => void }) {
  const { projection } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return master.file.equipment.filter((e) => e.name.includes(q) || String(e.id) === q).slice(0, 40);
  }, [query, master]);
  return (
    <div className="eq-picker">
      <div className="eq-picker-box">
        <span className="eq-picker-selected">{value ? master.equipmentName(value) : '未選択'}</span>
        <label className="visually-hidden" htmlFor="eq-picker-input">
          装備名で検索
        </label>
        <input
          id="eq-picker-input"
          className="eq-picker-input"
          placeholder="検索…"
          value={query}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="eq-picker-list"
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="eq-picker-list" id="eq-picker-list" role="listbox" aria-label="装備の候補">
          {results.map((e) => {
            const owned = [...equipmentStars(projection, e.id).values()].reduce((a, b) => a + b, 0);
            return (
              <li key={e.id} role="option" aria-selected={value === e.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(e.id);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <span>{e.name}</span>
                  <span className="text-sub">
                    {e.typeName} ・ {projection.equipment.known ? (owned > 0 ? `所持${owned}` : '未所持') : '所持不明'} ・ {master.hasRecipe(e.id) ? '改修データあり' : '改修データ未収録'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function GoalFormPage() {
  const { goalId } = useParams();
  const { data, master, projection, service, run, busy } = useStore();
  const navigate = useNavigate();
  const editing = goalId ? data.goals.find((g) => g.goalId === goalId) : undefined;
  const [form, setForm] = useState<Goal>(
    () =>
      editing ?? {
        goalId: newId('goal'),
        equipmentId: 0,
        targetStar: 6,
        count: 1,
        matchMode: 'atLeast',
        priority: data.goals.length + 1,
        createdAt: new Date().toISOString(),
        routeKey: null,
        guarantee: { mode: 'never', fromStar: null },
        updateGuarantee: false,
        materialRoutes: {},
        achievedAt: null,
      },
  );
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const commandId = useCommandId(form);
  const selected = form.equipmentId > 0;
  const routes = selected ? enumerateRoutes(master, form.equipmentId) : [];
  const preview = useMemo(() => {
    if (!selected) return null;
    const goals = [...data.goals.filter((g) => g.goalId !== form.goalId), form];
    try {
      return service.computePlan({ ...data, goals });
    } catch {
      return null;
    }
  }, [selected, data, form, service]);
  const gp = preview?.goals.find((g) => g.goalId === form.goalId);
  const steps = preview?.steps.filter((s) => s.goalId === form.goalId) ?? [];
  const helperBlock = steps.flatMap((s) => s.blockers).find((b) => b !== 'PREDECESSOR_BLOCKED');
  const stars = selected ? [...equipmentStars(projection, form.equipmentId).entries()].sort((a, b) => b[0] - a[0]) : [];
  const sameEquip = data.goals.filter((g) => g.equipmentId === form.equipmentId && g.goalId !== form.goalId);
  const dup = sameEquip.find((g) => g.targetStar === form.targetStar && g.matchMode === form.matchMode);
  const total = sameEquip.reduce((n, g) => n + g.count, 0) + form.count;
  const set = (patch: Partial<Goal>) => setForm((f) => ({ ...f, ...patch }));
  const routeHasConversion = (form.routeKey ? parseRouteKey(form.routeKey).length : 1) > 1;

  /** 保存して移動する。編集中で変更がなければ保存せずに移動する */
  const save = async (to = '/goals') => {
    if (!selected) return setMessage('装備を選んでください。');
    if (editing && JSON.stringify(editing) === JSON.stringify(form) && to !== '/goals') return navigate(to);
    const r = await run('SaveGoal', handleSaveGoal, { goal: form, isNew: !editing }, { commandId });
    if (!r.ok) {
      // 別のタブなどの変更と競合したら、フォームを最新の目標に読み直してから確認してもらう
      const latest = r.outcome.status === 'CONFLICT' || r.outcome.status === 'EPOCH_MISMATCH' ? r.latest.goals.find((g) => g.goalId === form.goalId) : undefined;
      if (latest) setForm(latest);
      return setMessage(r.message);
    }
    navigate(to);
  };
  const remove = async () => {
    if (!editing) return;
    const r = await run('DeleteGoal', handleDeleteGoal, { goalId: editing.goalId, now: new Date().toISOString() });
    if (!r.ok) return setMessage(r.message);
    navigate('/goals');
  };
  const shortages = gp?.shortages ?? [];
  const priorities = Array.from({ length: (editing ? data.goals.length : data.goals.length + 1) }, (_, i) => i + 1);
  // 編集中の目標が別のタブなどで削除されたら、新しい目標として保存し直さない
  if (goalId && !editing) {
    return (
      <Page nav="goals" title="目標を編集">
        <section className="card">
          <p>この目標は見つかりません。別のタブなどで削除された可能性があります。</p>
          <Link className="btn btn-primary" to="/goals">
            目標一覧へ
          </Link>
        </section>
      </Page>
    );
  }

  return (
    <Page nav="goals" title={editing ? '目標を編集' : '目標を追加'} sub="目標の条件を決めてから、必要数と予定への影響を確認します。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <div className="goal-form-grid">
        <section className="card goal-form-card" aria-labelledby="goal-cond-title">
          <h2 className="card-title" id="goal-cond-title">
            目標の条件
          </h2>
          <label className="field-label goal-field-first" htmlFor="eq-picker-input">
            装備を検索（未所持の装備も選べます）
          </label>
          <EquipmentPicker master={master} value={selected ? form.equipmentId : null} onChange={(id) => set({ equipmentId: id, routeKey: null })} />
          <div className="goal-form-row">
            <div>
              <label className="field-label" htmlFor="target-star">
                目標改修値
              </label>
              <SelectBox id="target-star" width={180} value={String(form.targetStar)} options={Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: `★${i}` }))} onChange={(v) => set({ targetStar: Number(v) })} />
            </div>
            <div>
              <span className="field-label" id="count-label">
                完成品として残す個数
              </span>
              <div className="stepper goal-count" role="group" aria-labelledby="count-label">
                <button type="button" aria-label="1個減らす" disabled={form.count <= 1} onClick={() => set({ count: Math.max(1, form.count - 1) })}>
                  −
                </button>
                <output aria-live="polite">{form.count}</output>
                <button type="button" aria-label="1個増やす" onClick={() => set({ count: form.count + 1 })}>
                  ＋
                </button>
              </div>
            </div>
          </div>
          <fieldset className="goal-match">
            <legend className="field-label">達成の判定</legend>
            <label className={`btn goal-radio ${form.matchMode === 'atLeast' ? 'btn-primary' : ''}`}>
              <input type="radio" name="match" checked={form.matchMode === 'atLeast'} onChange={() => set({ matchMode: 'atLeast' })} />
              {form.matchMode === 'atLeast' ? '●' : '○'} 指定した★以上
            </label>
            <label className={`btn goal-radio ${form.matchMode === 'exact' ? 'btn-primary' : ''}`}>
              <input type="radio" name="match" checked={form.matchMode === 'exact'} onChange={() => set({ matchMode: 'exact' })} />
              {form.matchMode === 'exact' ? '●' : '○'} 指定した★と一致
            </label>
          </fieldset>
          <label className="field-label goal-field goal-field-guarantee" htmlFor="guarantee">
            確実化する段階
          </label>
          <SelectBox
            id="guarantee"
            width={300}
            value={guaranteeValue(form)}
            options={[
              { value: 'never', label: '確実化しない（通常改修）' },
              { value: 'always', label: 'すべての改修で確実化' },
              ...Array.from({ length: 10 }, (_, i) => ({ value: `from${i + 1}`, label: `★${i + 1}への改修から` })),
            ]}
            onChange={(v) => set({ guarantee: v === 'never' ? { mode: 'never', fromStar: null } : v === 'always' ? { mode: 'always', fromStar: null } : { mode: 'fromTargetStar', fromStar: Number(v.slice(4)) } })}
          />
          {routes.length > 1 ? (
            <>
              <label className="field-label goal-field" htmlFor="route">
                更新経路
              </label>
              <SelectBox
                id="route"
                width={520}
                value={form.routeKey ?? ''}
                options={routeOptions(master, form.equipmentId)}
                onChange={(v) => set({ routeKey: v || null })}
              />
              {routeHasConversion ? (
                <label className="goal-check">
                  <input type="checkbox" checked={form.updateGuarantee} onChange={(e) => set({ updateGuarantee: e.target.checked })} /> 更新（装備の変化）も確実化する
                </label>
              ) : null}
            </>
          ) : null}
          <label className="field-label goal-field goal-field-priority" htmlFor="priority">
            優先順位
          </label>
          <SelectBox id="priority" width={300} value={String(form.priority)} options={priorities.map((p) => ({ value: String(p), label: `${p}${p === 1 ? '（最優先）' : p === priorities.length ? '（最後）' : ''}` }))} onChange={(v) => set({ priority: Number(v) })} />
          <p className="goal-form-note text-sub">
            同じ装備の目標も追加できます。個数は合算します。
            <br />
            この装備の合計目標：{total}個。同じ1個を二重に数えません。
          </p>
          {dup ? (
            <p className="goal-form-note text-warn">
              同じ条件（{goalTarget(dup)}）の目標があります。新しく追加すると合計{dup.count + form.count}個を残します。既存の個数を変える場合は<Link to={`/goals/${dup.goalId}/edit`}>既存の目標を編集</Link>してください。
            </p>
          ) : null}
        </section>
        <section className="card goal-preview-card" aria-labelledby="goal-preview-title" aria-live="polite">
          <h2 className="card-title" id="goal-preview-title">
            計算プレビュー
          </h2>
          {!selected ? (
            <p className="goal-preview-empty text-sub">装備を選ぶと、現在の所持・残り工程・不足を表示します。</p>
          ) : (
            <>
              <p className="goal-preview-label">現在の所持</p>
              <p className="goal-preview-stars">{!projection.equipment.known ? '所持データ未取得' : stars.length === 0 ? '所持なし' : stars.map(([s, n]) => `★${s} × ${n}個`).join(' / ')}</p>
              <p className="goal-preview-steps">{gp?.status === 'achieved' ? '所持で達成' : `残り ${gp?.remainingSteps ?? 0}工程`}</p>
              <p className="goal-preview-helper text-sub">
                {gp && gp.missingUnits > 0 ? `未所持の改修対象 ${gp.missingUnits}個（${UNPLACED_REASON_LABELS[gp.reasons[0] ?? 'TARGET_MISSING']}）` : helperBlock ? `担当艦  ! ${UNPLACED_REASON_LABELS[helperBlock]}` : '担当艦  ✓ 所持条件を満たす'}
                <br />
                通常成功時の計算・確実化設定を反映
              </p>
              {shortages.length > 0 ? (
                <div className="banner banner-warn goal-preview-warn">
                  {shortages.slice(0, 3).map((s) => (
                    <p key={s.key}>{s.amount === null ? `? ${costKeyPlain(master, s.key)}の所持数が不明` : `! ${costKeyPlain(master, s.key).replace('改修資材', 'ネジ').replace('開発資材', '釘')}が${s.amount}個不足`}</p>
                  ))}
                  <p>不足があっても予定へ仮配置します。</p>
                </div>
              ) : (
                <div className="banner banner-ok goal-preview-warn">
                  <p>{gp?.status === 'achieved' ? '✓ 現在の所持で目標を満たしています。' : '✓ 現在の所持数で必要数を満たしています（優先順位順に割当後）。'}</p>
                </div>
              )}
              <p className="goal-preview-links">
                <button type="button" className="link-button" disabled={busy} onClick={() => void save(`/materials?goal=${form.goalId}`)} aria-label={editing ? '素材内訳を確認' : '目標を保存して素材内訳を確認'}>
                  素材内訳を確認 →
                </button>
                <br />
                <button type="button" className="link-button" disabled={busy} onClick={() => void save(`/goals/${form.goalId}/steps`)} aria-label={editing ? '更新経路・素材の製作工程を確認' : '目標を保存して更新経路・素材の製作工程を確認'}>
                  更新経路・素材の製作工程 →
                </button>
              </p>
            </>
          )}
          <div className="goal-preview-actions">
            <Link className="btn" to="/goals" style={{ width: 160 }}>
              キャンセル
            </Link>
            <button type="button" className="btn btn-primary" style={{ width: 216 }} disabled={busy || !selected} onClick={() => void save()}>
              目標を保存
            </button>
          </div>
          {editing ? (
            <div className="goal-delete">
              {confirmDelete ? (
                <>
                  <span className="text-warn">この目標を削除します。実績・履歴は残ります。</span>
                  <button type="button" className="btn" onClick={() => void remove()} disabled={busy}>
                    削除する
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    やめる
                  </button>
                </>
              ) : (
                <button type="button" className="link-button text-error" onClick={() => setConfirmDelete(true)}>
                  この目標を削除
                </button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </Page>
  );
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function daysLabel(days: number[]): string {
  if (days.length === 7) return '毎日';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAY_LABELS[d]).join('・');
}

function stepUnitLabel(s: PlanStep): string {
  return s.role === 'craft' ? `素材製作${s.chainId.split('-').pop() ?? ''}` : `対象${Number(s.chainId.split('#t')[1] ?? 0) + 1}`;
}

export function GoalStepsPage() {
  const { goalId = '' } = useParams();
  const { data, plan, master, projection, run, busy } = useStore();
  const navigate = useNavigate();
  const goals = [...data.goals].sort((a, b) => a.priority - b.priority);
  const goal = goals.find((g) => g.goalId === goalId) ?? goals[0];
  const [showRoutes, setShowRoutes] = useState(false);
  const [pickHelper, setPickHelper] = useState<string | null>(null);
  if (!goal) {
    return (
      <Page nav="materials" title="工程と改修条件" top={195} sub="目標に必要な工程・担当艦・曜日・出典を確認します。">
        <section className="card">
          <p>目標がありません。</p>
          <Link className="btn btn-primary" to="/goals/new">
            目標を追加
          </Link>
        </section>
      </Page>
    );
  }
  const gp = goalPlanOf(plan, goal.goalId);
  const steps = plan?.steps.filter((s) => s.goalId === goal.goalId) ?? [];
  const placements = new Map((plan?.placements ?? []).map((p) => [p.stepKey, p]));
  const targets = new Set(steps.filter((s) => s.role === 'target').map((s) => s.chainId));
  const totals = (gp?.need ?? []).filter((n) => !['resource:1', 'resource:2', 'resource:3', 'resource:4'].includes(n.key));
  const recipe = master.recipes.get(goal.equipmentId) ?? [];
  const helperIds = [...new Set(recipe.flatMap((e) => e.helpers.flatMap((h) => h.shipIds)))];
  const ownedHelper = helperIds.find((id) => (projection.ships.owned.get(id) ?? 0) > 0);
  const mainHelper = ownedHelper ?? helperIds[0];
  const mainDays = mainHelper !== undefined ? [...new Set(recipe.flatMap((e) => e.helpers.filter((h) => h.shipIds.includes(mainHelper)).flatMap((h) => h.days)))] : [];
  const src = master.file.sources.find((s) => s.id === 'eo_equipment_upgrades');
  const shortMaterials = (plan?.totals ?? []).filter((t) => t.key.startsWith('equipment:') && (t.shortage ?? 0) > 0 && (gp?.need ?? []).some((n) => n.key === t.key));
  const completed = gp?.completed ?? 0;

  const setMaterialRoute = async (equipmentId: number, choice: MaterialRouteChoice) => {
    await run('SaveGoal', handleSaveGoal, { goal: { ...goal, materialRoutes: { ...goal.materialRoutes, [String(equipmentId)]: choice } }, isNew: false });
  };
  const setHelper = async (stepKey: string, shipId: number | null) => {
    await run('SetPreferredHelper', handleSetPreferredHelper, { stepKey, shipId });
    setPickHelper(null);
  };

  return (
    <Page nav="materials" title="工程と改修条件" top={195} sub="目標に必要な工程・担当艦・曜日・出典を確認します。">
      <div className="steps-head">
        <label className="visually-hidden" htmlFor="steps-goal">
          目標を選ぶ
        </label>
        <SelectBox id="steps-goal" primary width={360} value={goal.goalId} options={goals.map((g) => ({ value: g.goalId, label: goalTitle(master, g) }))} onChange={(v) => navigate(`/goals/${v}/steps`)} />
      </div>
      <div className="steps-grid">
        <section className="card steps-card" aria-labelledby="steps-title">
          <h2 className="card-title" id="steps-title">
            {gp?.status === 'achieved' ? '所持で達成済み' : `残り${goal.count - completed}個の改修工程`}
          </h2>
          {steps.length === 0 ? (
            <p className="steps-empty text-sub">{gp?.status === 'achieved' ? '残っている工程はありません。' : gp?.reasons.length ? `工程を作れません：${gp.reasons.map((r) => UNPLACED_REASON_LABELS[r]).join('・')}` : '工程はありません。'}</p>
          ) : (
            <ol className="steps-list">
              {steps.map((s, i) => {
                const p = placements.get(s.stepKey);
                return (
                  <li key={s.stepKey} className="steps-item">
                    <p className="steps-item-title">
                      {CIRCLED[i] ?? `(${i + 1})`} {master.equipmentName(s.transition.equipmentId)}（{stepUnitLabel(s)}）{'  '}
                      {s.transition.kind === 'improve' ? `★${s.transition.fromStar} → ★${s.transition.toStar}` : `★10 → ${master.equipmentName(s.transition.toEquipmentId)} ★${s.transition.toStar}`}
                    </p>
                    <p className="steps-item-cost">
                      {costSummaryTight(master, p?.cost ?? s.defaultCost, s.mode)} ／ {s.mode === 'guaranteed' ? '確実化あり' : '通常改修'}
                      {s.costVaries ? '（担当艦により費用が異なる）' : ''}
                    </p>
                    <p className="steps-item-meta text-sub">
                      {p?.date ? `予定 ${p.date.slice(5).replace('-', '/')}` : p?.reasons.length ? `未配置：${UNPLACED_REASON_LABELS[p.reasons[0]!]}` : ''}
                      {' ・ '}
                      <button type="button" className="link-button steps-helper-link" aria-expanded={pickHelper === s.stepKey} onClick={() => setPickHelper(pickHelper === s.stepKey ? null : s.stepKey)}>
                        担当艦：{p?.helperShipId ? master.shipName(p.helperShipId) : s.helperNote?.preferredShipId ? `${master.shipName(s.helperNote.preferredShipId)}（希望）` : '自動で選ぶ'} ▾
                      </button>
                    </p>
                    {pickHelper === s.stepKey ? <HelperChooser step={s} onPick={(id) => void setHelper(s.stepKey, id)} busy={busy} /> : null}
                  </li>
                );
              })}
            </ol>
          )}
          {totals.length > 0 ? <p className="steps-total">合計：{totals.map((t) => `${costKeyPlain(master, t.key).replace('改修資材', 'ネジ').replace('開発資材', '釘')}${t.key.startsWith('resource') ? '' : ' '}${t.amount}`).join('・')}</p> : null}
          <p className="steps-protect text-sub">{completed > 0 ? `既存の完成品${completed}個は保護し、素材に割り当てません。` : targets.size > 0 ? `改修対象${targets.size}個は素材に割り当てません。` : '完成品はまだありません。'}</p>
        </section>
        <section className="card steps-cond" aria-labelledby="cond-title">
          <h2 className="card-title" id="cond-title">
            曜日と担当艦
          </h2>
          {mainHelper === undefined ? (
            <p className="steps-days text-warn">条件未確認</p>
          ) : (
            <>
              <p className="steps-days">{daysLabel(mainDays)}</p>
              <p className="steps-helper">
                {master.shipName(mainHelper)} {ownedHelper !== undefined ? '✓ 所持' : projection.ships.known ? '! 未所持' : '? 所持不明'}
              </p>
            </>
          )}
          <p className="steps-check text-sub">改造段階まで条件を確認{helperIds.length > 1 ? `（ほか${helperIds.length - 1}隻の候補）` : ''}</p>
          <p className="steps-src">
            出典：
            {src ? (
              <a href={`${src.repository}/blob/${src.commit}/${src.path}`} target="_blank" rel="noreferrer">
                74式EN 改修データ（{src.commit.slice(0, 7)}）
              </a>
            ) : (
              '未設定'
            )}
          </p>
          <p className="steps-src">確認日：{src?.checkedAt ?? '未設定'}</p>
          <p className="steps-src-note text-sub">{recipe.length === 0 ? 'この装備は改修データに未収録です（不可とは断定しません）。' : '実機での全条件確認は未了です。'}</p>
        </section>
      </div>
      <section className="card steps-material" aria-labelledby="material-title">
        <h2 className="card-title" id="material-title">
          素材装備が不足するとき
        </h2>
        <p className="steps-material-text">{shortMaterials.length > 0 ? `${shortMaterials.map((t) => `${costKeyPlain(master, t.key)} 不足${t.shortage}個`).join('・')}を入手するか、素材装備の製造工程を計画に含めます。` : '不足する素材装備はありません。不足したときは、入手するか、素材装備の製造工程を計画に含められます。'}</p>
        <div className="steps-material-actions">
          <button type="button" className="btn" style={{ width: 250 }} onClick={() => setShowRoutes((v) => !v)} aria-expanded={showRoutes}>
            素材の製造経路を選ぶ
          </button>
          <span className="text-sub">候補・追加コスト・完了日の変化を確認して採用</span>
        </div>
        {showRoutes ? <MaterialRoutes goal={goal} plan={plan} onChoose={(id, c) => void setMaterialRoute(id, c)} busy={busy} /> : null}
      </section>
    </Page>
  );
}

function HelperChooser({ step, onPick, busy }: { step: PlanStep; onPick: (id: number | null) => void; busy: boolean }) {
  const { master, projection } = useStore();
  const options = transitionOptions(master, step.transition);
  const groups = options.flatMap((o) => o.helpers);
  const ids = [...new Set(groups.flatMap((g) => g.shipIds))].sort((a, b) => a - b);
  if (ids.length === 0) return <p className="steps-helper-panel text-warn">担当艦の条件が改修データに未収録です。</p>;
  return (
    <ul className="steps-helper-panel" aria-label="担当艦の候補">
      <li>
        <button type="button" className="link-button" disabled={busy} onClick={() => onPick(null)}>
          自動で選ぶ（艦娘ID順）
        </button>
      </li>
      {ids.map((id) => {
        const days = [...new Set(groups.filter((g) => g.shipIds.includes(id)).flatMap((g) => g.days))];
        const owned = projection.ships.owned.get(id) ?? 0;
        const family = master.shipFamily(id).filter((x) => (projection.ships.owned.get(x) ?? 0) > 0 && x !== id);
        return (
          <li key={id}>
            <button type="button" className="link-button" disabled={busy || owned === 0} onClick={() => onPick(id)}>
              {master.shipName(id)}
            </button>{' '}
            <span className="text-sub">
              {daysLabel(days)} ・ {!projection.ships.known ? '所持不明' : owned > 0 ? `所持${owned}` : family.length > 0 ? `改造段階が違う（${family.map((f) => stageName(master, f)).join('・')}を所持）` : '未所持'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MaterialRoutes({ goal, plan, onChoose, busy }: { goal: Goal; plan: PlanResult | null; onChoose: (equipmentId: number, c: MaterialRouteChoice) => void; busy: boolean }) {
  const { master } = useStore();
  const gp = plan?.goals.find((g) => g.goalId === goal.goalId);
  const materials = (gp?.need ?? []).filter((n) => n.key.startsWith('equipment:')).map((n) => Number(n.key.split(':')[1]));
  if (materials.length === 0) return <p className="steps-routes text-sub">この目標の工程は素材装備を消費しません。</p>;
  return (
    <div className="steps-routes">
      {materials.map((id) => {
        const routes = enumerateRoutes(master, id).filter((r) => r.equipmentIds.length > 1);
        const choice = goal.materialRoutes[String(id)];
        return (
          <fieldset key={id} className="steps-route">
            <legend>{master.equipmentName(id)}</legend>
            <label>
              <input type="radio" name={`mr-${id}`} checked={!choice || choice.kind === 'external'} disabled={busy} onChange={() => onChoose(id, { kind: 'external' })} /> 別途入手する（不足として表示。開発・ドロップを確定入手とはしません）
            </label>
            {routes.length === 0 ? <p className="text-sub">更新で作る経路は改修データにありません。</p> : null}
            {routes.map((r) => (
              <label key={r.key}>
                <input type="radio" name={`mr-${id}`} checked={choice?.kind === 'craft' && choice.routeKey === r.key} disabled={busy} onChange={() => onChoose(id, { kind: 'craft', routeKey: r.key })} /> 製作する：{r.equipmentIds.map((x) => master.equipmentName(x)).join(' → ')}
              </label>
            ))}
          </fieldset>
        );
      })}
      <p className="text-sub">製作を選ぶと、不足数だけ製作工程を追加し、親の工程の前に配置します。追加コストと完了日の変化は工程一覧とカレンダーに反映されます。</p>
    </div>
  );
}

interface UnplacedGroup {
  key: string;
  goalId: string;
  reason: UnplacedReason;
  stepKeys: string[];
  title: string;
  step: PlanStep | null;
}

function chipText(r: UnplacedReason): string {
  switch (r) {
    case 'HELPER_MISSING':
      return '担当艦を所持していない';
    case 'REMODEL_MISMATCH':
      return '担当艦の改造段階が足りない';
    case 'RECIPE_UNKNOWN':
      return '改修条件を確認中';
    default:
      return UNPLACED_REASON_LABELS[r];
  }
}

export function UnplacedPage() {
  const { plan, master, data, projection } = useStore();
  const stepByKey = new Map((plan?.steps ?? []).map((s) => [s.stepKey, s]));
  const groups: UnplacedGroup[] = [];
  for (const p of plan?.unplaced ?? []) {
    const reason = p.reasons[0];
    if (!reason) continue;
    const key = `${p.goalId}|${reason}`;
    const existing = groups.find((g) => g.key === key);
    const step = stepByKey.get(p.stepKey) ?? null;
    if (existing) existing.stepKeys.push(p.stepKey);
    else {
      const g = data.goals.find((x) => x.goalId === p.goalId);
      const title = step ? transitionLabel(master, step.transition) : g ? `${goalTitle(master, g)}` : '目標';
      groups.push({ key, goalId: p.goalId, reason, stepKeys: [p.stepKey], title, step });
    }
  }
  return (
    <Page nav="calendar" title="配置できない予定" top={198} sub="資材不足の仮予定とは分けて、予定を組めない理由を表示します。">
      {groups.length === 0 ? (
        <section className="card unplaced-card">
          <p>配置できない予定はありません。資材不足の予定は仮配置としてカレンダーに表示しています。</p>
        </section>
      ) : (
        groups.map((g) => <UnplacedCard key={g.key} group={g} />)
      )}
      <Link className="btn unplaced-back" to="/calendar" style={{ width: 220 }}>
        カレンダーに戻る
      </Link>
    </Page>
  );

  function UnplacedCard({ group }: { group: UnplacedGroup }) {
    const note = group.step?.helperNote;
    const goal = data.goals.find((x) => x.goalId === group.goalId);
    let detail: string;
    let hint: string;
    let primary: { label: string; to: string } = { label: '改修条件を見る', to: `/goals/${group.goalId}/steps` };
    let secondary: { label: string; to: string } = { label: '目標を編集', to: `/goals/${group.goalId}/edit` };
    switch (group.reason) {
      case 'HELPER_MISSING':
      case 'REMODEL_MISMATCH': {
        const required = (note?.requiredShipIds ?? []).map((id) => master.shipName(id)).join('・');
        const owned = (note?.ownedFamilyShipIds ?? []).map((id) => master.shipName(id)).join('・');
        detail = `必要な担当艦：${required} ／ 所持状態：${owned ? `${owned}を所持` : '未所持'}`;
        hint = '所持データを更新するか、条件を満たす担当艦を用意すると予定を再計算できます。';
        primary = { label: '艦娘データを確認', to: '/inventory/ships' };
        secondary = { label: '改修条件を見る', to: `/goals/${group.goalId}/steps` };
        break;
      }
      case 'HELPER_UNKNOWN':
        detail = '艦娘の所持データが未取得のため、担当艦の条件を判定できません。未所持とは区別しています。';
        hint = '母港のレスポンスを取り込むと、改造段階まで判定して予定を組みます。';
        primary = { label: '艦娘データを取り込む', to: '/import' };
        secondary = { label: '改修条件を見る', to: `/goals/${group.goalId}/steps` };
        break;
      case 'RECIPE_UNKNOWN':
        detail = '曜日・担当艦の条件が未確定です。「改修不可」とは区別しています。';
        hint = '条件の出典・確認日を表示し、情報がそろうまで自動配置を保留します。';
        break;
      case 'TARGET_MISSING':
        detail = `${goal ? master.equipmentName(goal.equipmentId) : '改修対象'}を所持していません（不足 ${group.stepKeys.length}個）。入手後に所持データを更新すると工程を計算します。`;
        hint = projection.equipment.known ? '開発・ドロップの入手を予定として扱うことはしません。' : '装備の所持データが未取得です。';
        primary = { label: '所持データを更新', to: '/import' };
        break;
      case 'ROUTE_REQUIRED':
        detail = '未所持分を、上流の装備から更新して作る経路があります。経路を選ぶと工程を計算します。';
        hint = '経路を選ばずに安い経路を自動で選ぶことはしません。';
        primary = { label: '更新経路を選ぶ', to: `/goals/${group.goalId}/edit` };
        break;
      case 'NO_AVAILABLE_DAY':
        detail = '担当艦が改修できる曜日と、設定で改修できる曜日が重なりません。';
        hint = '曜日ごとの上限や休みを見直すと再計算します。';
        primary = { label: '予定の設定を開く', to: '/settings' };
        break;
      case 'SEARCH_LIMIT':
        detail = `${data.settings.searchDays}日先まで空き枠がありません。改修不可ではありません。`;
        hint = '曜日ごとの上限を増やすか、探索期間を延ばすと配置できる場合があります。';
        primary = { label: '予定の設定を開く', to: '/settings' };
        break;
      case 'PREFERRED_HELPER_UNAVAILABLE':
        detail = '希望した担当艦がこの工程の条件に合わないか、所持していません。別の艦へ自動で切り替えません。';
        hint = '担当艦を選び直すか、「自動で選ぶ」に戻してください。';
        primary = { label: '担当艦を選び直す', to: `/goals/${group.goalId}/steps` };
        break;
      case 'PROTECTION_REVIEW':
        detail = '保護設定の確認待ちの装備があるため、改修対象に割り当てていません。';
        hint = '保護設定を確認すると再計算します。';
        primary = { label: '保護設定を確認', to: '/inventory/equipment' };
        break;
      case 'RESULT_PENDING':
        detail = '前の工程の結果（消費）が確認待ちのため、自動で再挑戦・後続を配置しません。';
        hint = '確認待ちの記録を再開して確定してください。';
        primary = { label: '確認待ちを再開', to: '/history?tab=drafts' };
        break;
      case 'CYCLE':
        detail = '素材を作る経路の途中で、同じ素材が再び必要になります。';
        hint = '素材の製作経路を見直してください。';
        primary = { label: '素材の製作経路を見直す', to: `/goals/${group.goalId}/steps` };
        break;
      default:
        detail = UNPLACED_REASON_LABELS[group.reason];
        hint = '前の工程の状態を確認してください。';
    }
    return (
      <section className="card unplaced-card" aria-label={group.title}>
        <h2 className="card-title">
          {group.title}
          {group.stepKeys.length > 1 && group.reason !== 'TARGET_MISSING' ? <span className="text-sub unplaced-more">ほか {group.stepKeys.length - 1}工程</span> : null}
        </h2>
        <span className="unplaced-chip">{chipText(group.reason)}</span>
        <p className="unplaced-detail">{detail}</p>
        <p className="unplaced-hint text-sub">{hint}</p>
        <div className="btn-row unplaced-actions">
          <Link className="btn btn-primary" to={primary.to} style={{ width: 200 }}>
            {primary.label}
          </Link>
          <Link className="btn" to={secondary.to} style={{ width: 180 }}>
            {secondary.label}
          </Link>
        </div>
      </section>
    );
  }
}
