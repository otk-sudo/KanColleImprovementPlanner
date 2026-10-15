import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Shell';
import { baseOf, useCommandId, useStore, type CommandBase, type RunResult } from '../../app/store';
import { handleCorrectResult, handleRecordResult, handleSaveDraft, recordOrderFor } from '../../application/commands';
import { projectInventory } from '../../domain/inventory/projection';
import type { ScopeKey } from '../../domain/inventory/types';
import { compareDate, formatMonthDayWeek, formatJstMonthDayTime, isValidDate, parseDate, type DateJst } from '../../domain/jst';
import { transitionOptions, transitionTo, transitionFrom, type Transition } from '../../domain/master';
import type { Attempt, Delta, RecipeSnapshot, ResultEvent } from '../../domain/model';
import { fixedHistoryOnlyScopes, inferInputSources, scopesOfDeltas, wouldGoNegative } from '../../domain/results/results';
import { newId, type AppData } from '../../infrastructure/repository';
import { costKeyPlain, recordedTransitionLabel, transitionLabel } from '../../ui/format';
import { DateBox } from '../../ui/SelectBox';
import { allocationFrom, plannedForAttempt, snapshotForDraft, consumedDeltas, consumptionRows, correctionEffect, deltasFromForm, parseCount, savedValues, valuesFromDeltas, type RecordForm } from './recordModel';
import './record.css';

// 改修結果の記録（S13）・実施済み確認待ち（S28）・過去実績の scope 確認（S34）。design/10・12、ui-design-v1 第4巡・第12巡。

function formKey(attemptId: string) {
  return `record:${attemptId}`;
}

function useAttemptContext(attemptId: string) {
  const { data, plan, master } = useStore();
  const attempt = data.attempts.find((a) => a.attemptId === attemptId);
  const placement = plan?.placements.find((p) => p.attemptId === attemptId) ?? null;
  const event = attempt?.resultEventId ? (data.resultEvents.find((e) => e.eventId === attempt.resultEventId) ?? null) : null;
  const options = attempt ? transitionOptions(master, attempt.transition) : [];
  const entry = placement?.entryIndex ?? event?.recipeSnapshot?.entryIndex ?? options[0]?.entryIndex ?? null;
  const cost = options.find((o) => o.entryIndex === entry)?.cost ?? options[0]?.cost ?? null;
  const mode = attempt?.mode ?? 'normal';
  const openDraft = data.drafts.find((d) => d.attemptId === attemptId && d.status === 'open') ?? null;
  const planned = plannedForAttempt({ eventPlanned: event?.recipeSnapshot?.plannedCost ?? null, draftPlanned: openDraft?.recipeSnapshot?.plannedCost ?? null, cost: placement?.cost ?? cost, mode });
  return { attempt, placement, event, planned, mode, entry };
}

/** 消費の入力行。記録・確認待ち・過去実績の各画面で同じ行（★ごとの割り当て）を使う */
function useConsumptionRows(ctx: ReturnType<typeof useAttemptContext>, extra: Delta[]) {
  const { master, projection } = useStore();
  const placement = ctx.placement;
  return useMemo(() => consumptionRows(master, ctx.planned, projection, extra, allocationFrom(placement?.consumption)), [master, ctx.planned, projection, extra, placement]);
}

/** 下書きが確保した消費のうち、消費の行にするもの（成功と報告した改修対象の確保は除く） */
function draftConsumptions(data: AppData, draftId: string | null, transition: Transition | undefined): Delta[] {
  const d = draftId ? data.drafts.find((x) => x.draftId === draftId) : undefined;
  return d && transition ? consumedDeltas(d.knownConsumptions, transition, d.reportedOutcome) : NO_DELTAS;
}

const NO_DELTAS: Delta[] = [];

function recipeSnapshotFor(master: ReturnType<typeof useStore>['master'], attempt: Attempt, ctx: ReturnType<typeof useAttemptContext>): RecipeSnapshot {
  const to = transitionTo(attempt.transition);
  const from = transitionFrom(attempt.transition);
  const helper = ctx.placement?.helperShipId ?? attempt.helperShipId ?? null;
  return {
    masterVersion: master.version,
    transition: attempt.transition,
    fromName: master.equipmentName(from.equipmentId),
    toName: master.equipmentName(to.equipmentId),
    mode: ctx.mode,
    entryIndex: ctx.entry,
    plannedCost: ctx.planned,
    helperShipId: helper,
    helperShipName: helper !== null ? master.shipName(helper) : null,
  };
}

function initialForm(attempt: Attempt, today: DateJst, mode: RecordForm['mode'], event: ResultEvent | null, eventValues: { values: Record<string, string>; stars: Record<string, number> } | null, draftValues: { values: Record<string, string>; stars: Record<string, number> } | null, draftId: string | null, commandBase: CommandBase): RecordForm {
  const base: RecordForm = {
    base: commandBase,
    attemptId: attempt.attemptId,
    mode,
    eventId: event?.eventId ?? null,
    draftId,
    outcome: null,
    occurredDate: attempt.scheduledDate && compareDate(attempt.scheduledDate, today) <= 0 ? attempt.scheduledDate : today,
    missedAfterImport: false,
    values: {},
    stars: {},
    scopeAnswers: {},
    reason: '',
  };
  // 訂正は、記録したときの「履歴だけ」の扱いを初期値にする（変えなければ所持数への反映は変わらない）
  if (event && eventValues) return { ...base, outcome: event.outcome, occurredDate: event.occurredDateJst, values: eventValues.values, stars: eventValues.stars, scopeAnswers: Object.fromEntries(event.historyOnlyScopes.map((sc) => [sc, 'historyOnly'])) };
  if (draftValues) return { ...base, ...draftValues };
  return base;
}

export function RecordPage({ mode }: { mode: 'record' | 'correct' | 'resume' }) {
  const params = useParams();
  const { data, master, today, projection, formCache, run, busy, rolloverAndReport } = useStore();
  const navigate = useNavigate();
  const event = mode === 'correct' ? (data.resultEvents.find((e) => e.eventId === params.eventId) ?? null) : null;
  const draft = mode === 'resume' ? (data.drafts.find((d) => d.draftId === params.draftId) ?? null) : null;
  const attemptId = mode === 'correct' ? (event?.attemptId ?? '') : mode === 'resume' ? (draft?.attemptId ?? '') : (params.attemptId ?? '');
  const ctx = useAttemptContext(attemptId);
  const { attempt } = ctx;
  const cached = formCache.get(formKey(attemptId)) as RecordForm | undefined;
  // 訂正では改修対象そのものの★変化を消費の行にしない。確定済みの記録は消費0の行も 0 として復元する
  const extra = useMemo(() => (event && attempt ? consumedDeltas(event.deltas, attempt.transition, event.outcome) : draft && attempt ? consumedDeltas(draft.knownConsumptions, attempt.transition, draft.reportedOutcome) : NO_DELTAS), [event, draft, attempt]);
  const rows = useConsumptionRows(ctx, extra);
  const [form, setForm] = useState<RecordForm | null>(() => {
    if (!attempt) return null;
    if (cached && cached.mode === mode) return cached;
    const dv = draft ? valuesFromDeltas(draft.knownConsumptions, attempt.transition, draft.reportedOutcome) : null;
    const ev = event ? savedValues(event.deltas, attempt.transition, event.outcome, rows) : null;
    const f = initialForm(attempt, today, mode, event, ev, dv, draft?.draftId ?? null, baseOf(data));
    if (draft) return { ...f, outcome: draft.reportedOutcome, occurredDate: draft.occurredDateJst, scopeAnswers: draft.scopeAnswers };
    return f;
  });
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<{ text: string; details?: ResultEvent[] } | null>(null);
  const commandId = useCommandId(form);
  const [eventId] = useState(() => newId('ev'));
  if (!attempt || !form) {
    return (
      <Page nav="calendar" title="改修結果を記録">
        <section className="card">
          <p>記録する予定が見つかりません。</p>
          <Link className="btn btn-primary" to="/calendar">
            カレンダーへ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const update = (patch: Partial<RecordForm>) => {
    setChecked(false);
    setMessage(null);
    setForm((f) => {
      const next = { ...f!, ...patch };
      formCache.set(formKey(attemptId), next);
      return next;
    });
  };
  /** 競合を知らせた後は、表示している最新の内容を前提に確定し直せるようにする */
  const rebase = (r: RunResult<unknown>) => {
    if (r.outcome.status !== 'CONFLICT' && r.outcome.status !== 'EPOCH_MISMATCH') return;
    // 訂正は、別のタブなどで同じ記録が変わっていたら、その最新の内容でフォームを作り直して確認してもらう
    const latestEvent = mode === 'correct' && event ? r.latest.resultEvents.find((x) => x.eventId === event.eventId) : undefined;
    if (latestEvent && attempt) {
      const latestRows = consumptionRows(master, ctx.planned, projection, consumedDeltas(latestEvent.deltas, attempt.transition, latestEvent.outcome), allocationFrom(ctx.placement?.consumption));
      const next = initialForm(attempt, today, 'correct', latestEvent, savedValues(latestEvent.deltas, attempt.transition, latestEvent.outcome, latestRows), null, null, r.latestBase);
      formCache.set(formKey(attemptId), next);
      setForm(next);
      setChecked(false);
      return;
    }
    setForm((f) => {
      const next = { ...f!, base: r.latestBase };
      formCache.set(formKey(attemptId), next);
      return next;
    });
  };
  const choose = (outcome: RecordForm['outcome']) => {
    if (outcome === 'skip' && mode === 'record') {
      navigate(`/attempts/${encodeURIComponent(attempt.attemptId)}/skip`);
      return;
    }
    const prefill: Record<string, string> = {};
    if (outcome === 'success' && mode !== 'correct') for (const r of rows) prefill[r.key] = String(r.planned);
    // 失敗では成功時の費用を写さない（design/10）。訂正時は保存済みの値を保持する
    update({ outcome, values: outcome === 'success' && mode !== 'correct' ? { ...prefill, ...(form.outcome === 'success' ? form.values : {}) } : outcome === 'failure' && form.outcome !== 'failure' && mode !== 'correct' ? {} : form.values });
  };
  const result = deltasFromForm(form, rows, attempt.transition);
  const missing = rows.filter((r) => parseCount(form.values[r.key]) === null);
  const isPast = compareDate(form.occurredDate, today) < 0;
  const needsScope = mode !== 'correct' && (isPast || form.missedAfterImport || !!attempt.lifecycle.match(/superseded/));
  const historyOnly = (Object.entries(form.scopeAnswers) as [ScopeKey, string][]).filter(([, v]) => v === 'historyOnly').map(([k]) => k);
  const applied = result.deltas.filter((d) => !historyOnly.includes(d.scope));
  // 下書きを確定するときは、その下書き自身の確保分を除いて判定する（操作層と同じ）
  const projForCheck = form.draftId ? projectInventory(data.baselines, data.resultEvents, data.drafts.filter((d) => d.draftId !== form.draftId)) : projection;
  // 過去日・記録漏れは種類ごとの扱い（反映／履歴のみ）を決めてから判定する（S34）
  const negative = form.outcome && form.outcome !== 'voided' && mode !== 'correct' && !needsScope ? wouldGoNegative(projForCheck, applied) : [];
  // 確認待ち（対象消失など）の予定は、取り込み前の記録漏れとして装備を履歴だけに記録する場合だけ確定できる（S34 で回答）
  const reviewBlocked = mode !== 'correct' && attempt.executionGate === 'reviewRequired' && !needsScope && form.outcome !== 'skip';
  const ready = form.outcome !== null && missing.length === 0 && result.invalid.length === 0 && negative.length === 0 && attempt.executionGate !== 'predecessorPending' && !reviewBlocked;

  const submit = async () => {
    if (!form.outcome) return;
    if (!checked) {
      setChecked(true);
      return;
    }
    if (mode === 'correct' && event) {
      const r = await run('CorrectResult', handleCorrectResult, { eventId: event.eventId, newOutcome: form.outcome, newDeltas: result.deltas, occurredDateJst: form.occurredDate, historyOnlyScopes: historyOnly, reason: form.reason, today, now: new Date().toISOString(), recipeSnapshot: event.recipeSnapshot ?? recipeSnapshotFor(master, attempt, ctx) }, { commandId, base: form.base });
      if (!r.ok) {
        rebase(r);
        const deps = (r.errors[0]?.details as { dependents?: { eventId: string }[] } | undefined)?.dependents ?? [];
        return setMessage({ text: r.message ?? '保存できませんでした。', details: data.resultEvents.filter((e) => deps.some((d) => d.eventId === e.eventId)) });
      }
      formCache.delete(formKey(attemptId));
      // 過去日の予定が未実施・スキップに戻った場合は、すぐ翌日処理の対象として再評価する
      // 保存できなければ、移動先の画面に再試行できる警告を残す
      if ((form.outcome === 'voided' || form.outcome === 'skip') && compareDate(attempt.scheduledDate ?? form.occurredDate, today) < 0) await rolloverAndReport();
      navigate('/history');
      return;
    }
    if (needsScope) {
      formCache.set(formKey(attemptId), form);
      navigate(`/attempts/${encodeURIComponent(attempt.attemptId)}/past`);
      return;
    }
    const r = await run(
      'RecordResult',
      handleRecordResult,
      {
        attemptId: attempt.attemptId,
        outcome: form.outcome as 'success' | 'failure',
        occurredDateJst: form.occurredDate,
        today,
        deltas: result.deltas,
        historyOnlyScopes: [],
        requireScopeAnswers: false,
        answeredScopes: [],
        eventId,
        recipeSnapshot: snapshotForDraft(data.drafts, form.draftId, () => recipeSnapshotFor(master, attempt, ctx)),
        inputSourceEventIds: inferInputSources(data.resultEvents, attempt, result.deltas, { date: form.occurredDate, order: recordOrderFor(data, attempt, form.occurredDate) }),
        fromDraftId: form.draftId,
        now: new Date().toISOString(),
      },
      { commandId, base: form.base },
    );
    if (!r.ok) {
      rebase(r);
      if (r.errors[0]?.code === 'SUCCESSOR_HAS_RESULT') {
        navigate(`/history/rollover/${encodeURIComponent(attempt.attemptId)}`);
        return;
      }
      return setMessage({ text: r.message ?? '保存できませんでした。' });
    }
    formCache.delete(formKey(attemptId));
    navigate(`/calendar?date=${form.occurredDate}`);
  };

  const toDraft = () => {
    formCache.set(formKey(attemptId), form);
    navigate(`/attempts/${encodeURIComponent(attempt.attemptId)}/draft`);
  };

  const title = mode === 'correct' ? '記録を修正' : '改修結果を記録';
  const outcomes: { key: RecordForm['outcome']; label: string }[] = [
    { key: 'success', label: '成功' },
    { key: 'failure', label: '失敗' },
    { key: 'skip', label: 'スキップ' },
  ];
  if (mode === 'correct') outcomes.push({ key: 'voided', label: '実施していなかった' });
  const from = transitionFrom(attempt.transition);
  const to = transitionTo(attempt.transition);
  const ownedFrom = projection.equipment.counts.get(`${from.equipmentId}:${from.star}`) ?? 0;
  const ownedTo = projection.equipment.counts.get(`${to.equipmentId}:${to.star}`) ?? 0;
  // 訂正は旧増減を戻した正味の変化。取り込み済みの基準に含まれる記録は現在数を変えない（P47/P50）
  const oldDeltas = mode === 'correct' && event && event.status === 'active' ? event.deltas.filter((d) => !event.historyOnlyScopes.includes(d.scope)) : [];
  const newDeltas = form.outcome === 'voided' ? [] : result.deltas;
  const fixedScopes = mode === 'correct' && event ? fixedHistoryOnlyScopes(event, scopesOfDeltas([...event.deltas, ...newDeltas]), data.baselines) : [];
  // 訂正では、取り込みの境界で固定されていない種類の「履歴だけ」を、どちら向きにも変えられる
  const editableHistoryOnly = mode === 'correct' && event ? [...scopesOfDeltas([...event.deltas, ...newDeltas])].filter((sc) => !fixedScopes.includes(sc)).sort((a, b) => scopeOrder(a) - scopeOrder(b) || a.localeCompare(b)) : [];
  const effect = correctionEffect({ newDeltas, oldDeltas, fixedScopes }, from.equipmentId, from.star, to.equipmentId, to.star);
  return (
    <Page nav={mode === 'correct' ? 'history' : 'calendar'} top={196} title={title} sub={mode === 'correct' ? '保存済みの結果を訂正します。訂正前の内容は履歴に残ります。' : '実際にゲームで行った結果を記録します。'}>
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          <p className="rec-msg">{message.text}</p>
          {message.details && message.details.length > 0 ? (
            <ul>
              {message.details.map((d) => (
                <li key={d.eventId}>
                  {d.occurredDateJst} {d.recipeSnapshot ? recordedTransitionLabel(master, d.recipeSnapshot.transition, d.recipeSnapshot) : d.stepKey}（{d.outcome === 'success' ? '成功' : d.outcome === 'failure' ? '失敗' : 'スキップ'}）{' '}
                  <Link to={`/history/events/${encodeURIComponent(d.eventId)}/correct`}>この記録を修正</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="rec-grid">
        <section className="card rec-form" aria-labelledby="rec-title">
          <h2 className="card-title" id="rec-title">
            {formatMonthDayWeek(form.occurredDate)} • {transitionLabel(master, attempt.transition)}
          </h2>
          <p className="rec-label" id="outcome-label">
            結果
          </p>
          <div className="rec-outcomes" role="radiogroup" aria-labelledby="outcome-label">
            {outcomes.map((o, i) => (
              <button key={o.key} type="button" role="radio" aria-checked={form.outcome === o.key} className={`btn rec-outcome ${form.outcome === o.key ? 'btn-primary' : ''}`} style={{ width: i === 2 ? 245 : 205 }} onClick={() => choose(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
          <h3 className="rec-sub">使用した資材・装備</h3>
          <div className="rec-rows">
            {rows.map((r) => (
              <div key={r.key} className={`rec-row${r.primary ? '' : ' is-minor'}`}>
                <label className="rec-row-label" htmlFor={`v-${r.key}`}>
                  {r.label}
                  {r.kind === 'equipment' ? (
                    <select aria-label={`${r.label}の改修値`} className="rec-star" value={form.stars[r.key] ?? r.star} onChange={(e) => update({ stars: { ...form.stars, [r.key]: Number(e.target.value) } })}>
                      {r.stars.map((s) => (
                        <option key={s} value={s}>
                          ★{s}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </label>
                <input
                  id={`v-${r.key}`}
                  className="input rec-input"
                  inputMode="numeric"
                  placeholder="未入力"
                  value={form.values[r.key] ?? ''}
                  aria-invalid={Number.isNaN(parseCount(form.values[r.key]) ?? 0) ? true : undefined}
                  onChange={(e) => update({ values: { ...form.values, [r.key]: e.target.value } })}
                />
              </div>
            ))}
          </div>
          {mode === 'correct' ? (
            <>
              <label className="field-label rec-reason-label" htmlFor="rec-reason">
                訂正の理由（任意）
              </label>
              <input id="rec-reason" className="input" value={form.reason} onChange={(e) => update({ reason: e.target.value })} placeholder="例：失敗を成功と取り違えた" />
              {editableHistoryOnly.length > 0 ? (
                // チェックした種類は所持数に反映しない（記録したときの扱いを初期値にする）
                <fieldset className="rec-history-only">
                  <legend className="field-label">所持数に反映しない種類（履歴だけ）</legend>
                  {editableHistoryOnly.map((sc) => (
                    <label key={sc} className="goal-check">
                      <input type="checkbox" checked={form.scopeAnswers[sc] === 'historyOnly'} onChange={(e) => update({ scopeAnswers: { ...form.scopeAnswers, [sc]: e.target.checked ? 'historyOnly' : 'apply' } })} />{' '}
                      {sc === 'equipment' ? '装備' : costKeyPlain(master, sc)}を履歴だけに記録
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}
          <div className="banner banner-warn rec-warn">
            <p className="rec-warn-main">実際に行った結果と消費数を確認します。</p>
            <p className="rec-warn-sub">消費が不明なら「実施済み・確認待ち」で保存できます。</p>
            {attempt.executionGate === 'predecessorPending' ? <p className="rec-warn-sub">前の工程の結果が確定していないため、この工程の結果はまだ確定できません。</p> : null}
            {reviewBlocked ? <p className="rec-warn-sub">この予定は所持データとの確認待ちです。取り込み前に実施した記録漏れなら下のチェックを付け、装備を履歴のみとして記録してください。</p> : null}
            {negative.length > 0 ? <p className="rec-warn-sub">記録すると所持数が負になる項目があります（{negative.map((s) => costKeyPlain(master, s)).join('・')}）。所持データが最新か確認してください。</p> : null}
            {result.invalid.length > 0 ? <p className="rec-warn-sub">数量は0〜999,999の整数で入力してください（{result.invalid.join('・')}）。</p> : null}
          </div>
          <div className="rec-date-row">
            <label htmlFor="rec-date">実施日</label>
            <span className="rec-date">
              <DateBox id="rec-date" width={170} value={form.occurredDate} max={today} onChange={(v) => isValidDate(v) && update({ occurredDate: v })} />
            </span>
            {mode !== 'correct' ? (
              <label className="rec-missed">
                <input type="checkbox" checked={form.missedAfterImport} onChange={(e) => update({ missedAfterImport: e.target.checked })} /> 最新の所持データを取り込む前に実施した記録漏れ
              </label>
            ) : null}
          </div>
          <div className="rec-actions">
            <Link className="btn" to={mode === 'correct' ? '/history' : `/calendar/day/${attempt.scheduledDate ?? today}`} style={{ width: 150 }}>
              キャンセル
            </Link>
            {mode !== 'correct' && form.outcome !== 'skip' ? (
              <button type="button" className="btn" style={{ width: 260 }} disabled={attempt.executionGate === 'predecessorPending' || (attempt.executionGate === 'reviewRequired' && form.scopeAnswers.equipment !== 'historyOnly') || result.invalid.length > 0} onClick={() => (form.outcome === null ? setMessage({ text: '先に結果（成功・失敗）を選んでください。消費が分からない項目は未入力のままで構いません。' }) : toDraft())}>
                実施済み・確認待ち
              </button>
            ) : (
              <span style={{ width: 260 }} />
            )}
            <button type="button" className={`btn ${ready ? 'btn-primary' : ''}`} style={{ width: 220 }} disabled={!ready || busy} onClick={() => void submit()}>
              {checked ? (mode === 'correct' ? 'この内容で訂正' : needsScope ? '種類ごとの反映を確認' : 'この内容で記録') : '内容を確認'}
            </button>
          </div>
        </section>
        <section className="card rec-effect" aria-labelledby="effect-title" aria-live="polite">
          <h2 className="card-title" id="effect-title">
            記録による変更
          </h2>
          {form.outcome === null ? (
            <>
              <p className="rec-effect-lead text-ok">結果を選んでください</p>
              <p className="rec-effect-h">選択後に変更内容を表示</p>
              <p className="rec-effect-p">まだ在庫・進捗は変更しません</p>
            </>
          ) : (
            <>
              <p className="rec-effect-lead text-ok">{form.outcome === 'success' ? '成功：改修値が進みます' : form.outcome === 'failure' ? '失敗：改修値は据え置き' : form.outcome === 'voided' ? '記録を取り消します' : 'スキップ：消費なし'}</p>
              {effect.kind === 'historyOnly' ? (
                <p className="rec-effect-h">
                  現在の所持数は変わりません（最新の取り込みに含まれる記録のため、履歴だけ訂正します）。
                  <br />
                  当時の所持数は記録がないため検証できません。
                </p>
              ) : effect.kind === 'change' ? (
                <p className="rec-effect-h">
                  {master.equipmentName(from.equipmentId)} ★{from.star}：{ownedFrom} → {ownedFrom + effect.from}
                  <br />
                  {master.equipmentName(to.equipmentId)} ★{to.star}：{ownedTo} → {ownedTo + effect.to}
                </p>
              ) : (
                <p className="rec-effect-h">{form.outcome === 'failure' ? '★は変わりません' : '所持数・★は変わりません'}</p>
              )}
              <p className="rec-effect-p">{missing.length > 0 ? `未入力：${missing.map((r) => r.label).join('・')}` : checked ? '保存すると在庫と予定に反映します。' : '「内容を確認」で反映内容を確定します。'}</p>
            </>
          )}
          <p className="rec-effect-h rec-gap">失敗の場合</p>
          <p className="rec-effect-p text-sub">改修値は据え置き。実際の消費を確認。</p>
          <p className="rec-effect-h rec-gap rec-gap2">スキップの場合</p>
          <p className="rec-effect-p text-sub">資材の消費なし。翌日にリスケ判定。</p>
          <p className="rec-effect-foot text-sub">保存後は「実績・繰り越し」から修正できます。</p>
        </section>
      </div>
    </Page>
  );
}

function outcomeText(o: string): string {
  return o === 'success' ? '成功' : o === 'failure' ? '失敗' : o;
}

export function DraftConfirmPage() {
  const { attemptId = '' } = useParams();
  const { data, master, today, formCache, run, busy } = useStore();
  const navigate = useNavigate();
  const ctx = useAttemptContext(attemptId);
  const form = formCache.get(formKey(attemptId)) as RecordForm | undefined;
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draftId] = useState(() => form?.draftId ?? newId('draft'));
  const commandId = useCommandId(attemptId, checked);
  const rows = useConsumptionRows(ctx, useMemo(() => draftConsumptions(data, form?.draftId ?? null, ctx.attempt?.transition), [data, form?.draftId, ctx.attempt?.transition]));
  if (!ctx.attempt || !form || (form.outcome !== 'success' && form.outcome !== 'failure')) {
    return (
      <Page nav="history" title="実施済み・消費確認待ち" top={196}>
        <section className="card">
          <p>確認待ちとして保存する入力がありません。結果を選んでから進んでください。</p>
          <Link className="btn btn-primary" to={`/attempts/${encodeURIComponent(attemptId)}/record`}>
            入力へ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const attempt = ctx.attempt;
  const r = deltasFromForm(form, rows, attempt.transition);
  const save = async () => {
    const res = await run(
      'SaveDraftResult',
      handleSaveDraft,
      { draftId, attemptId, occurredDateJst: form.occurredDate, today, reportedOutcome: form.outcome as 'success' | 'failure', knownConsumptions: r.known, unknownScopes: r.unknownScopes, scopeAnswers: form.scopeAnswers, confirmedPerformed: checked, recipeSnapshot: snapshotForDraft(data.drafts, form.draftId, () => recipeSnapshotFor(master, attempt, ctx)), now: new Date().toISOString() },
      { commandId, base: form.base },
    );
    if (!res.ok) {
      if (res.outcome.status === 'CONFLICT' || res.outcome.status === 'EPOCH_MISMATCH') {
        // 同じ確認待ちが別のタブなどで保存されていたら、その最新の内容に読み直し、実施済みの確認をやり直してもらう
        const latestDraft = res.latest.drafts.find((d) => d.attemptId === attemptId && d.status === 'open');
        const dv = latestDraft ? valuesFromDeltas(latestDraft.knownConsumptions, attempt.transition, latestDraft.reportedOutcome) : null;
        formCache.set(
          formKey(attemptId),
          latestDraft && dv
            ? { ...form, base: res.latestBase, draftId: latestDraft.draftId, outcome: latestDraft.reportedOutcome, occurredDate: latestDraft.occurredDateJst, values: dv.values, stars: dv.stars, scopeAnswers: latestDraft.scopeAnswers }
            : { ...form, base: res.latestBase },
        );
        setChecked(false);
      }
      return setMessage(res.message);
    }
    formCache.delete(formKey(attemptId));
    navigate('/history?tab=drafts');
  };
  const { month, day } = parseDate(form.occurredDate);
  const existing = data.drafts.find((d) => d.attemptId === attemptId && d.status === 'open');
  return (
    <Page nav="history" title="実施済み・消費確認待ち" top={196} sub="実施した事実を残し、消費が分かるまで在庫と後続の確定を保留します。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : r.invalid.length > 0 ? (
        // 不正な数量の行は、既知の消費にも不明な消費にも入らないため、直すまで保存しない
        <div className="banner banner-warn page-alert" role="alert">
          数量は0〜999,999の整数で入力してください（{r.invalid.join('・')}）。入力へ戻って直すまで保存できません。
        </div>
      ) : null}
      <section className="card draft-card" aria-labelledby="draft-title">
        <h2 className="card-title" id="draft-title">
          {transitionLabel(master, attempt.transition)} ／ {month}月{day}日
        </h2>
        <p className="draft-outcome">実施した結果：{outcomeText(form.outcome)}　／　実施回数：1回として計上</p>
        <p className="draft-values">
          {rows
            .filter((x) => x.primary)
            .map((x) => {
              const v = parseCount(form.values[x.key]);
              const label = x.kind === 'equipment' && rows.filter((y) => y.kind === 'equipment' && y.id === x.id).length > 1 ? `${x.label}★${form.stars[x.key] ?? x.star}` : x.label;
              return `${label}：${v === null || Number.isNaN(v) ? '確認待ち' : `${v}個`}`;
            })
            .join('　　')}
        </p>
        <label className={`draft-check ${checked ? 'text-ok' : ''}`}>
          <input type="checkbox" className="visually-hidden" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span className="draft-check-mark" aria-hidden="true">
            {checked ? '✓' : '□'}
          </span>
          ゲームで実施済みです（入力途中のメモとは異なります）
        </label>
      </section>
      <section className="card draft-card2" aria-labelledby="draft-rule-title">
        <h2 className="card-title" id="draft-rule-title">
          確認待ちの間の扱い
        </h2>
        <p className="draft-line">★と実在庫は確定変更しません。消費候補を保留し、充足を断定しません。</p>
        <p className="draft-line">この工程の自動再挑戦と、出力を使う後続工程は確認待ちになります。</p>
        <p className="draft-line">後から所持JSONを更新した場合は、その最新在庫から二重に差し引きません。</p>
        <p className="draft-line text-sub">「実績・繰り越し」から再開できます。未実施だった場合は理由を付けて訂正します。</p>
      </section>
      <div className="draft-actions">
        <Link className="btn" to={`/attempts/${encodeURIComponent(attemptId)}/record`} style={{ width: 170 }}>
          入力へ戻る
        </Link>
        {existing ? (
          <Link className="btn" to={`/history/drafts/${encodeURIComponent(existing.draftId)}/cancel`} style={{ width: 300 }}>
            未実施だった場合の訂正
          </Link>
        ) : (
          <Link
            className="btn"
            to={`/calendar/day/${attempt.scheduledDate ?? today}`}
            style={{ width: 300 }}
            onClick={() => formCache.delete(formKey(attemptId))}
          >
            未実施だった場合の訂正
          </Link>
        )}
        <button type="button" className={`btn ${checked && r.invalid.length === 0 ? 'btn-primary' : ''}`} style={{ width: 320 }} disabled={!checked || busy || r.invalid.length > 0} onClick={() => void save()}>
          実施済み・確認待ちで保存
        </button>
      </div>
    </Page>
  );
}

function scopeLastImport(data: AppData, scope: ScopeKey): string | null {
  return data.baselines.find((b) => b.scope === scope)?.importedAt ?? null;
}

const SCOPE_ORDER: string[] = ['equipment', 'resource:8', 'resource:7', 'resource:5', 'resource:6', 'resource:1', 'resource:2', 'resource:3', 'resource:4'];
const scopeOrder = (s: ScopeKey) => {
  const i = SCOPE_ORDER.indexOf(s);
  return i >= 0 ? i : SCOPE_ORDER.length;
};

export function PastRecordPage() {
  const { attemptId = '' } = useParams();
  const { data, master, today, projection, formCache, run, busy } = useStore();
  const navigate = useNavigate();
  const ctx = useAttemptContext(attemptId);
  const cached = formCache.get(formKey(attemptId)) as RecordForm | undefined;
  const [answers, setAnswers] = useState<Partial<Record<ScopeKey, 'apply' | 'historyOnly'>>>(cached?.scopeAnswers ?? {});
  const [message, setMessage] = useState<string | null>(null);
  const [eventId] = useState(() => newId('ev'));
  const commandId = useCommandId(attemptId, answers);
  const rows = useConsumptionRows(ctx, useMemo(() => draftConsumptions(data, cached?.draftId ?? null, ctx.attempt?.transition), [data, cached?.draftId, ctx.attempt?.transition]));
  if (!ctx.attempt || !cached || (cached.outcome !== 'success' && cached.outcome !== 'failure')) {
    return (
      <Page nav="history" title="過去の実績と所持数への反映" top={196}>
        <section className="card">
          <p>確認する入力がありません。</p>
          <Link className="btn btn-primary" to="/history">
            実績・繰り越しへ
          </Link>
        </section>
      </Page>
    );
  }
  const attempt = ctx.attempt;
  const form = cached;
  const result = deltasFromForm(form, rows, attempt.transition);
  // 表示順は装備 → ネジ → 釘 → その他資材 → アイテム（他画面の資材の並びと同じ）
  // 確認待ちの予定は、装備の消費がなくても装備の扱い（履歴だけ）を確認する
  const scopes = [...new Set<ScopeKey>([...scopesOfDeltas(result.deltas), ...(attempt.executionGate === 'reviewRequired' ? (['equipment'] as ScopeKey[]) : [])])].sort((a, b) => scopeOrder(a) - scopeOrder(b) || a.localeCompare(b));
  const fixed = fixedHistoryOnlyScopes({ originalSequence: data.meta.nextSequence, fromDraftId: form.draftId }, scopes, data.baselines);
  const unanswered = scopes.filter((s) => !fixed.includes(s) && !answers[s]);
  // 確認待ちの予定は、装備を履歴だけに記録する場合だけ確定できる（操作層の REVIEW_REQUIRED と同じ条件）
  const reviewBlocked = attempt.executionGate === 'reviewRequired' && scopes.includes('equipment') && !fixed.includes('equipment') && answers.equipment === 'apply';
  // 所持数に反映する種類だけで、既知の所持数が負にならないか確かめる（下書きの確定では自身の確保分を除く）
  const projForCheck = form.draftId ? projectInventory(data.baselines, data.resultEvents, data.drafts.filter((d) => d.draftId !== form.draftId)) : projection;
  const negative = unanswered.length === 0 ? wouldGoNegative(projForCheck, result.deltas.filter((d) => answers[d.scope] === 'apply' && !fixed.includes(d.scope))) : [];
  const confirmable = unanswered.length === 0 && !reviewBlocked && negative.length === 0;
  const valueAfter = (s: ScopeKey): string => {
    if (answers[s] !== 'apply') {
      if (answers[s] !== 'historyOnly' && !fixed.includes(s)) return '回答後に表示';
      if (s === 'equipment') return '変更なし';
      const id = Number(s.split(':')[1]);
      const cur = s.startsWith('resource:') ? projection.resources.get(id)?.value : projection.items.get(id)?.value;
      return cur === undefined ? '変更なし' : `${cur} → ${cur}（変更なし）`;
    }
    if (s === 'equipment') {
      return result.deltas
        .filter((d) => d.scope === 'equipment')
        .map((d) => {
          const eq = d as { equipmentId: number; star: number; amount: number };
          const cur = projection.equipment.counts.get(`${eq.equipmentId}:${eq.star}`) ?? 0;
          return `${eq.equipmentId === attempt.transition.equipmentId ? '' : `${master.equipmentName(eq.equipmentId)} `}★${eq.star}：${cur} → ${cur + eq.amount}`;
        })
        .join('\n');
    }
    const id = Number(s.split(':')[1]);
    const cur = s.startsWith('resource:') ? projection.resources.get(id)?.value : projection.items.get(id)?.value;
    const amount = result.deltas.filter((d) => d.scope === s).reduce((n, d) => n + d.amount, 0);
    return cur === undefined ? '不明（未取得）' : `${cur} → ${cur + amount}`;
  };
  const scopeName = (s: ScopeKey) => (s === 'equipment' ? '装備' : costKeyPlain(master, s));
  const confirm = async () => {
    const historyOnly = scopes.filter((s) => answers[s] === 'historyOnly');
    const r = await run(
      'RecordResult',
      handleRecordResult,
      {
        attemptId,
        outcome: form.outcome as 'success' | 'failure',
        occurredDateJst: form.occurredDate,
        today,
        deltas: result.deltas,
        historyOnlyScopes: historyOnly,
        requireScopeAnswers: true,
        answeredScopes: scopes.filter((s) => answers[s]),
        eventId,
        recipeSnapshot: snapshotForDraft(data.drafts, form.draftId, () => recipeSnapshotFor(master, attempt, ctx)),
        inputSourceEventIds: inferInputSources(data.resultEvents, attempt, result.deltas, { date: form.occurredDate, order: recordOrderFor(data, attempt, form.occurredDate) }),
        fromDraftId: form.draftId,
        now: new Date().toISOString(),
      },
      { commandId, base: form.base },
    );
    if (!r.ok) {
      if (r.outcome.status === 'CONFLICT' || r.outcome.status === 'EPOCH_MISMATCH') formCache.set(formKey(attemptId), { ...form, base: r.latestBase, scopeAnswers: answers });
      if (r.errors[0]?.code === 'SUCCESSOR_HAS_RESULT') return navigate(`/history/rollover/${encodeURIComponent(attemptId)}`);
      return setMessage(r.message);
    }
    formCache.delete(formKey(attemptId));
    navigate('/history');
  };
  const toDraft = () => {
    formCache.set(formKey(attemptId), { ...form, scopeAnswers: answers });
    navigate(`/attempts/${encodeURIComponent(attemptId)}/draft`);
  };
  const { month, day } = parseDate(form.occurredDate);
  return (
    <Page nav="history" title="過去の実績と所持数への反映" top={196} sub={`${month}月${day}日に実施した記録を追記します。種類ごとに、現在の所持数へ反映するか確認してください。`}>
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <section className="card past-card" aria-labelledby="past-title">
        <h2 className="card-title" id="past-title">
          {transitionLabel(master, attempt.transition)} ／ {outcomeText(form.outcome ?? '')}
        </h2>
        <div className="past-head text-sub" aria-hidden="true">
          <span>種類 / 最後に取り込んだ日時</span>
          <span>今回の実績の扱い</span>
          <span>現在数の変化</span>
        </div>
        {scopes.map((s) => {
          const last = scopeLastImport(data, s);
          const isFixed = fixed.includes(s);
          return (
            <fieldset key={s} className="past-row">
              <legend className="past-scope">
                {scopeName(s)} ／ {last ? formatJstMonthDayTime(last) : '未取得'}
              </legend>
              <div className="past-answer">
                {isFixed ? (
                  <span className="text-ok">● 履歴だけに記録（取り込み済みのため固定）</span>
                ) : (
                  // 参照どおり選んだ扱いだけを1行で表示し、押すと2択（所持数に反映／履歴だけに記録）を開く。
                  // 初期値は未選択で、取込日時から自動選択しない
                  <span className="past-choice">
                    <select className="past-choice-native" aria-label={`${scopeName(s)}の今回の実績の扱い`} value={answers[s] ?? ''} onChange={(e) => setAnswers({ ...answers, [s]: e.target.value as 'apply' | 'historyOnly' })}>
                      <option value="" disabled>
                        未選択
                      </option>
                      <option value="apply">所持数に反映</option>
                      <option value="historyOnly">履歴だけに記録</option>
                    </select>
                    <span className={`past-choice-face ${answers[s] ? 'text-ok' : 'text-warn is-unanswered'}`} aria-hidden="true">
                      {answers[s] === 'apply' ? '● 所持数に反映' : answers[s] === 'historyOnly' ? '● 履歴だけに記録' : '未選択：反映 / 履歴のみ'}
                    </span>
                  </span>
                )}
              </div>
              <div className={`past-change ${answers[s] || isFixed ? '' : 'text-sub'}`}>{valueAfter(s)}</div>
            </fieldset>
          );
        })}
        {unanswered.length > 0 ? (
          <div className="banner banner-warn past-warn" role="alert">
            <p className="past-warn-main">{unanswered.map(scopeName).join('・')}の扱いを選んでください。未回答のまま実績を確定できません。</p>
            <p className="past-warn-sub">分からない場合は「実施済み・確認待ち」で残せます。</p>
          </div>
        ) : reviewBlocked ? (
          <div className="banner banner-warn past-warn" role="alert">
            <p className="past-warn-main">この予定は所持データとの確認待ちのため、装備は「履歴だけに記録」を選んでください。</p>
            <p className="past-warn-sub">取り込み後に実施した場合は、所持データを取り込み直してから計画を確認してください。</p>
          </div>
        ) : negative.length > 0 ? (
          <div className="banner banner-warn past-warn" role="alert">
            <p className="past-warn-main">所持数に反映すると負になる種類があります（{negative.map(scopeName).join('・')}）。</p>
            <p className="past-warn-sub">取り込んだ所持データに今回の実績が含まれている場合は「履歴だけに記録」を選んでください。</p>
          </div>
        ) : null}
        <p className="past-note text-sub">取込日時は参考情報です。今回の実績が取り込み内容に含まれるかで判断します。</p>
      </section>
      <p className="past-foot">「履歴だけ」の種類は現在数を変えません。選んだJSONの所持数を最新として扱います。</p>
      <div className="past-actions">
        <Link className="btn" to={`/attempts/${encodeURIComponent(attemptId)}/record`} style={{ width: 200 }}>
          入力へ戻る
        </Link>
        <button type="button" className="btn" style={{ width: 300 }} disabled={attempt.executionGate === 'predecessorPending' || (attempt.executionGate === 'reviewRequired' && answers.equipment !== 'historyOnly')} onClick={toDraft}>
          実施済み・確認待ちへ
        </button>
        <span className="spacer" />
        <button type="button" className={`btn ${confirmable ? 'btn-primary' : ''}`} style={{ width: 300 }} disabled={!confirmable || busy} onClick={() => void confirm()}>
          {unanswered.length > 0 ? '未回答のため確定不可' : reviewBlocked ? '確認待ちのため確定不可' : negative.length > 0 ? '所持数を確認してください' : 'この内容で確定'}
        </button>
      </div>
    </Page>
  );
}
