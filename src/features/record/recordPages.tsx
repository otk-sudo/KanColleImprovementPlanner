import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleCorrectResult, handleRecordResult, handleSaveDraft } from '../../application/commands';
import { inferInputSources } from '../../application/service';
import type { ScopeKey } from '../../domain/inventory/types';
import { compareDate, formatMonthDayWeek, formatJstMonthDayTime, isValidDate, parseDate, type DateJst } from '../../domain/jst';
import { transitionOptions, transitionTo, transitionFrom } from '../../domain/master';
import type { Attempt, RecipeSnapshot, ResultEvent } from '../../domain/model';
import { fixedHistoryOnlyScopes, scopesOfDeltas, wouldGoNegative } from '../../domain/results/results';
import { newId, type AppData } from '../../infrastructure/repository';
import { costKeyPlain, recordedTransitionLabel, transitionLabel } from '../../ui/format';
import { DateBox } from '../../ui/SelectBox';
import { consumptionRows, correctionEffect, deltasFromForm, parseCount, plannedFrom, valuesFromDeltas, type RecordForm } from './recordModel';
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
  const planned = event?.recipeSnapshot?.plannedCost ?? plannedFrom(placement?.cost ?? cost, mode);
  return { attempt, placement, event, planned, mode, entry };
}

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

function initialForm(attempt: Attempt, today: DateJst, mode: RecordForm['mode'], event: ResultEvent | null, draftValues: { values: Record<string, string>; stars: Record<string, number> } | null, draftId: string | null): RecordForm {
  const base: RecordForm = {
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
  if (event) {
    const v = valuesFromDeltas(event.deltas, attempt.transition, event.outcome);
    return { ...base, outcome: event.outcome, occurredDate: event.occurredDateJst, values: v.values, stars: v.stars };
  }
  if (draftValues) return { ...base, ...draftValues };
  return base;
}

export function RecordPage({ mode }: { mode: 'record' | 'correct' | 'resume' }) {
  const params = useParams();
  const { data, master, today, projection, formCache, run, busy } = useStore();
  const navigate = useNavigate();
  const event = mode === 'correct' ? (data.resultEvents.find((e) => e.eventId === params.eventId) ?? null) : null;
  const draft = mode === 'resume' ? (data.drafts.find((d) => d.draftId === params.draftId) ?? null) : null;
  const attemptId = mode === 'correct' ? (event?.attemptId ?? '') : mode === 'resume' ? (draft?.attemptId ?? '') : (params.attemptId ?? '');
  const ctx = useAttemptContext(attemptId);
  const { attempt } = ctx;
  const cached = formCache.get(formKey(attemptId)) as RecordForm | undefined;
  const [form, setForm] = useState<RecordForm | null>(() => {
    if (!attempt) return null;
    if (cached && cached.mode === mode) return cached;
    const dv = draft ? valuesFromDeltas(draft.knownConsumptions, attempt.transition, 'failure') : null;
    const f = initialForm(attempt, today, mode, event, dv, draft?.draftId ?? null);
    if (draft) return { ...f, outcome: draft.reportedOutcome, occurredDate: draft.occurredDateJst, scopeAnswers: draft.scopeAnswers };
    return f;
  });
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<{ text: string; details?: ResultEvent[] } | null>(null);
  const rows = useMemo(() => consumptionRows(master, ctx.planned, projection, event?.deltas ?? draft?.knownConsumptions ?? []), [master, ctx.planned, projection, event, draft]);
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
  const negative = form.outcome && form.outcome !== 'voided' && mode !== 'correct' ? wouldGoNegative(projection, applied) : [];
  const ready = form.outcome !== null && missing.length === 0 && result.invalid.length === 0 && negative.length === 0 && attempt.executionGate !== 'predecessorPending';

  const submit = async () => {
    if (!form.outcome) return;
    if (!checked) {
      setChecked(true);
      return;
    }
    if (mode === 'correct' && event) {
      const r = await run('CorrectResult', handleCorrectResult, { eventId: event.eventId, newOutcome: form.outcome, newDeltas: result.deltas, occurredDateJst: form.occurredDate, historyOnlyScopes: [], reason: form.reason, today, now: new Date().toISOString() }, { commandId });
      if (!r.ok) {
        const deps = (r.errors[0]?.details as { dependents?: { eventId: string }[] } | undefined)?.dependents ?? [];
        return setMessage({ text: r.message ?? '保存できませんでした。', details: data.resultEvents.filter((e) => deps.some((d) => d.eventId === e.eventId)) });
      }
      formCache.delete(formKey(attemptId));
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
        recipeSnapshot: recipeSnapshotFor(master, attempt, ctx),
        inputSourceEventIds: inferInputSources(data.resultEvents, attempt, result.deltas),
        fromDraftId: form.draftId,
        now: new Date().toISOString(),
      },
      { commandId },
    );
    if (!r.ok) {
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
            </>
          ) : null}
          <div className="banner banner-warn rec-warn">
            <p className="rec-warn-main">実際に行った結果と消費数を確認します。</p>
            <p className="rec-warn-sub">消費が不明なら「実施済み・確認待ち」で保存できます。</p>
            {attempt.executionGate === 'predecessorPending' ? <p className="rec-warn-sub">前の工程の結果が確定していないため、この工程の結果はまだ確定できません。</p> : null}
            {negative.length > 0 ? <p className="rec-warn-sub">記録すると所持数が負になる項目があります（{negative.map((s) => costKeyPlain(master, s)).join('・')}）。所持データが最新か確認してください。</p> : null}
            {result.invalid.length > 0 ? <p className="rec-warn-sub">数量は0以上の整数で入力してください（{result.invalid.join('・')}）。</p> : null}
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
              <button type="button" className="btn" style={{ width: 260 }} onClick={() => (form.outcome === null ? setMessage({ text: '先に結果（成功・失敗）を選んでください。消費が分からない項目は未入力のままで構いません。' }) : toDraft())}>
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
  const { data, master, today, projection, formCache, run, busy } = useStore();
  const navigate = useNavigate();
  const ctx = useAttemptContext(attemptId);
  const form = formCache.get(formKey(attemptId)) as RecordForm | undefined;
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draftId] = useState(() => form?.draftId ?? newId('draft'));
  const commandId = useCommandId(attemptId, checked);
  const rows = useMemo(() => consumptionRows(master, ctx.planned, projection), [master, ctx.planned, projection]);
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
      { draftId, attemptId, occurredDateJst: form.occurredDate, today, reportedOutcome: form.outcome as 'success' | 'failure', knownConsumptions: r.known, unknownScopes: r.unknownScopes, scopeAnswers: form.scopeAnswers, confirmedPerformed: checked, recipeSnapshot: recipeSnapshotFor(master, attempt, ctx), now: new Date().toISOString() },
      { commandId },
    );
    if (!res.ok) return setMessage(res.message);
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
              return `${x.label}：${v === null || Number.isNaN(v) ? '確認待ち' : `${v}個`}`;
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
        <button type="button" className={`btn ${checked ? 'btn-primary' : ''}`} style={{ width: 320 }} disabled={!checked || busy} onClick={() => void save()}>
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
  const rows = useMemo(() => consumptionRows(master, ctx.planned, projection), [master, ctx.planned, projection]);
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
  const scopes = [...scopesOfDeltas(result.deltas)].sort((a, b) => scopeOrder(a) - scopeOrder(b) || a.localeCompare(b));
  const fixed = fixedHistoryOnlyScopes({ originalSequence: data.meta.nextSequence, fromDraftId: form.draftId }, scopes, data.baselines);
  const unanswered = scopes.filter((s) => !fixed.includes(s) && !answers[s]);
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
        recipeSnapshot: recipeSnapshotFor(master, attempt, ctx),
        inputSourceEventIds: inferInputSources(data.resultEvents, attempt, result.deltas),
        fromDraftId: form.draftId,
        now: new Date().toISOString(),
      },
      { commandId },
    );
    if (!r.ok) {
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
        ) : null}
        <p className="past-note text-sub">取込日時は参考情報です。今回の実績が取り込み内容に含まれるかで判断します。</p>
      </section>
      <p className="past-foot">「履歴だけ」の種類は現在数を変えません。選んだJSONの所持数を最新として扱います。</p>
      <div className="past-actions">
        <Link className="btn" to={`/attempts/${encodeURIComponent(attemptId)}/record`} style={{ width: 200 }}>
          入力へ戻る
        </Link>
        <button type="button" className="btn" style={{ width: 300 }} onClick={toDraft}>
          実施済み・確認待ちへ
        </button>
        <span className="spacer" />
        <button type="button" className={`btn ${unanswered.length === 0 ? 'btn-primary' : ''}`} style={{ width: 300 }} disabled={unanswered.length > 0 || busy} onClick={() => void confirm()}>
          {unanswered.length > 0 ? '未回答のため確定不可' : 'この内容で確定'}
        </button>
      </div>
    </Page>
  );
}
