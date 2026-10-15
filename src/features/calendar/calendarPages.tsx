import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleRecordResult, handleSkipDate, handleSameDayRetry } from '../../application/commands';
import { addDays, compareDate, formatMonthDayWeek, formatSlashDate, isValidDate, monthGrid, parseDate, weekStartMonday, type DateJst } from '../../domain/jst';
import type { Placement, PlanResult, UnplacedReason } from '../../domain/planning/types';
import { UNPLACED_REASON_LABELS } from '../../domain/planning/types';
import type { AppData } from '../../infrastructure/repository';
import { newId } from '../../infrastructure/repository';
import { costKeyLabel, costKeyPlain, costSummary, costSummaryTight, transitionLabel, transitionShort } from '../../ui/format';
import { WelcomeContent } from '../onboarding/WelcomePage';
import { buildDays, dayRequirements, emptyDay, entryCost, entryEquipmentName, entryHelperName, entryLabel, KIND_LABEL, latestAttemptOf, monthCellSummary, type DayEntry, type DayInfo } from './calendarModel';
import './calendar.css';

// カレンダー（S01 月・S02 週・S18 日付指定・S24 個別スキップ・S25 日全体スキップ・S30 前提待ち）。

function monthKey(date: DateJst): string {
  return date.slice(0, 7);
}

function shortageLine(master: ReturnType<typeof useStore>['master'], p: Placement | null): string | null {
  const s = p?.shortages.find((x) => x.deficit === null || x.deficit > 0);
  if (!s) return null;
  const name = costKeyPlain(master, s.key).replace('改修資材', 'ネジ').replace('開発資材', '釘');
  return s.deficit === null ? `${name}の所持数が不明です` : `${name}が${s.deficit}個不足しています`;
}

function unplacedSummary(plan: PlanResult | null): { total: number; parts: string[] } {
  const counts = new Map<UnplacedReason, number>();
  for (const p of plan?.unplaced ?? []) {
    const r = p.reasons[0];
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const short: Partial<Record<UnplacedReason, string>> = { HELPER_MISSING: '担当艦未所持', RECIPE_UNKNOWN: '条件未確認', REMODEL_MISMATCH: '改造段階不足', HELPER_UNKNOWN: '艦娘データ未取得', TARGET_MISSING: '対象未所持' };
  return { total: plan?.unplaced.length ?? 0, parts: [...counts.entries()].map(([r, n]) => `${short[r] ?? UNPLACED_REASON_LABELS[r]} ${n}件`) };
}

export function CalendarPage() {
  const { data, plan, today, projection } = useStore();
  const [params, setParams] = useSearchParams();
  const selected = isValidDate(params.get('date') ?? '') ? params.get('date')! : today;
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : monthKey(selected);
  const { year, month: mon } = parseDate(`${month}-01`);
  const grid = monthGrid(year, mon);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, '0')}`;
  const days = buildDays(data, plan, first, last, today);
  const detailDays = buildDays(data, plan, selected, selected, today);
  const unplaced = unplacedSummary(plan);
  const nav = (m: string, d?: string) => setParams(d ? { month: m, date: d } : { month: m, date: selected });
  const shiftMonth = (delta: number) => {
    const dt = new Date(Date.UTC(year, mon - 1 + delta, 1));
    nav(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  if (!projection.equipment.known && data.goals.length === 0 && data.attempts.length === 0) {
    return (
      <Page nav="calendar" title="はじめての改修計画" top={196} sub="データを取り込んで、目標を決めるところから始めましょう。">
        <WelcomeContent />
      </Page>
    );
  }

  return (
    <Page nav="calendar" title="カレンダー" sub="予定を確認して、今日の改修を記録しましょう。">
      <MasterReviewBanner />
      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-toolbar">
            <button type="button" className="btn cal-arrow" aria-label="前の月" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <h2 className="cal-month" aria-live="polite">
              {year}年 {mon}月
            </h2>
            <button type="button" className="btn cal-arrow" aria-label="次の月" onClick={() => shiftMonth(1)}>
              ›
            </button>
            <button type="button" className="btn cal-today" onClick={() => nav(monthKey(today), today)}>
              今日
            </button>
            <span className="spacer" />
            <span className="btn btn-primary cal-mode" aria-current="page">
              月
            </span>
            <Link className="btn cal-mode-week" to={`/calendar/week?start=${weekStartMonday(selected)}`}>
              週
            </Link>
            <Link className="btn cal-mode-day" to={`/calendar/day/${selected}`}>
              日付指定
            </Link>
          </div>
          <section className="card cal-month-card" aria-label={`${year}年${mon}月のカレンダー`}>
            <div className="cal-weekdays" aria-hidden="true">
              {['月', '火', '水', '木', '金', '土', '日'].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cal-grid" role="grid">
              {grid.map((row, i) => (
                <div className="cal-row" role="row" key={i}>
                  {row.map((d, j) =>
                    d ? (
                      <MonthCell key={d} info={days.get(d) ?? emptyDay(data, d)} selected={d === selected} today={d === today} onSelect={() => nav(month, d)} />
                    ) : (
                      <div key={`e${j}`} className="cal-cell is-outside" role="gridcell" aria-hidden="true">
                        <span className="cal-daynum">—</span>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
        <DaySidePanel info={detailDays.get(selected) ?? emptyDay(data, selected)} />
      </div>
      <Link className="cal-unplaced" to="/unplaced">
        {unplaced.total > 0 ? `未配置 ${unplaced.total}件   ${unplaced.parts.join(' / ')}` : '未配置の予定はありません'}
      </Link>
    </Page>
  );
}

export function MasterReviewBanner() {
  const { data } = useStore();
  if (!data.meta.masterReviewRequired) return null;
  return (
    <div className="banner banner-warn page-alert" role="alert">
      予定の再計算を保留しています（必要な共通マスターの確認待ち）。
      <Link to="/settings#master">マスターを確認して再計算</Link>
    </div>
  );
}

function MonthCell({ info, selected, today, onSelect }: { info: DayInfo; selected: boolean; today: boolean; onSelect: () => void }) {
  const { master } = useStore();
  const { day } = parseDate(info.date);
  const visible = info.entries.filter((e) => e.kind !== 'superseded');
  const main = visible[0];
  const tentative = visible.some((e) => e.kind === 'tentative' || e.kind === 'pending' || e.kind === 'review');
  const label = `${info.date}${info.holiday ? ' 休み' : ''} 予定${info.plannedCount}件 実施${info.doneCount}件${info.tentativeCount ? ` 仮配置${info.tentativeCount}件` : ''}`;
  return (
    <button type="button" role="gridcell" aria-selected={selected} aria-label={label} className={`cal-cell${today ? ' is-today' : ''}${selected ? ' is-selected' : ''}${info.holiday ? ' is-holiday' : ''}`} onClick={onSelect}>
      <span className="cal-daynum">{day}</span>
      {main ? (
        <>
          <span className={`cal-entry ${tentative ? 'text-warn' : main.kind === 'failure' ? 'text-fail' : main.kind === 'skip' ? 'text-sub' : 'text-ok'}`}>
            {tentative ? '仮  ' : ''}
            {entryEquipmentName(master, main)}
          </span>
          <span className="cal-entry-sub">{monthCellSummary(info.entries)}</span>
          {info.goalsCompleting.length > 0 ? <span className="cal-entry-goal">完了見込み</span> : visible.length > 1 && new Set(visible.map((v) => v.transition.equipmentId)).size > 1 ? <span className="cal-entry-goal text-sub">ほか{new Set(visible.map((v) => v.transition.equipmentId)).size - 1}件</span> : null}
        </>
      ) : info.holiday ? (
        <span className="cal-entry text-sub">休み</span>
      ) : null}
    </button>
  );
}


function helperLine(master: ReturnType<typeof useStore>['master'], e: DayEntry, projection: ReturnType<typeof useStore>['projection']): { text: string; ok: boolean } {
  const id = e.placement?.helperShipId ?? e.attempt?.helperShipId ?? null;
  if (id === null) return { text: '担当艦：未定', ok: false };
  const owned = (projection.ships.owned.get(id) ?? 0) > 0;
  return { text: `担当艦：${entryHelperName(master, e, id)} ${owned ? '✓ 所持' : '! 未所持'}`, ok: owned };
}

function DaySidePanel({ info }: { info: DayInfo }) {
  const { master, today, plan, projection } = useStore();
  const isToday = info.date === today;
  const isPast = compareDate(info.date, today) < 0;
  const entries = info.entries.filter((e) => e.kind !== 'superseded');
  const firstShort = entries.map((e) => shortageLine(master, e.placement)).find((x) => x !== null) ?? null;
  const reqs = dayRequirements(plan, info.date);
  const one = entries.length === 1 ? entries[0]! : null;
  return (
    <aside className="card cal-side" aria-label={`${formatMonthDayWeek(info.date)}の詳細`}>
      <h2 className="cal-side-date">{formatMonthDayWeek(info.date)}</h2>
      <p className="cal-side-meta">
        {isToday ? '今日' : isPast ? '過去' : formatMonthDayWeek(info.date).replace(/（.*）/, '')} • {info.holiday ? '休み' : `${info.plannedCount + info.doneCount + info.skipCount}件 / 上限${info.limit}回`}
        {info.daySkipped ? ' • この日はスキップ済み' : ''}
      </p>
      {firstShort ? (
        <div className="banner banner-warn cal-side-warn" role="note">
          <p className="cal-side-warn-main">! {firstShort}</p>
          <p className="cal-side-warn-sub">仮配置のまま、当日の入手を待ちます</p>
        </div>
      ) : null}
      {entries.length === 0 ? <p className="cal-side-empty text-sub">{info.holiday ? '休みの日です。予定を入れません。' : 'この日の予定はありません。'}</p> : null}
      {one ? (
        <SideEntry entry={one} index={0} full />
      ) : (
        <ol className="cal-side-list">
          {entries.map((e, i) => (
            <li key={e.stepKey + (e.attemptId ?? '')}>
              <SideEntry entry={e} index={i} full={false} />
            </li>
          ))}
        </ol>
      )}
      {entries.length > 0 && reqs.length > 0 && entries.some((e) => ['planned', 'tentative', 'pending', 'review', 'provisional'].includes(e.kind)) ? (
        <>
          <p className="cal-side-req-head text-sub">
            <span>必要なもの</span>
            <span>必要 / 使用可能</span>
          </p>
          <ul className="cal-side-req">
            {reqs
              .filter((r) => !['resource:1', 'resource:2', 'resource:3', 'resource:4'].includes(r.key))
              .map((r) => (
                <li key={r.key}>
                  <span>{costKeyLabel(master, r.key)}</span>
                  <span>
                    {r.need} / {r.available === null ? '不明' : r.available}
                  </span>
                </li>
              ))}
          </ul>
        </>
      ) : null}
      {one && (isToday || isPast) && ['planned', 'tentative', 'pending', 'review'].includes(one.kind) && one.attemptId ? (
        <div className="cal-side-actions">
          <Link className="btn btn-primary" to={`/attempts/${encodeURIComponent(one.attemptId)}/record`}>
            結果を記録
          </Link>
          {isToday ? (
            <Link className="btn" to={`/attempts/${encodeURIComponent(one.attemptId)}/skip`}>
              スキップ
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="cal-side-note text-sub">
        未完了分は翌日に繰り越します。
        <br />
        閉じている間の遅れは次回起動時に反映。
      </p>
      <p className="visually-hidden">{projection.equipment.known ? '' : '所持データ未取得'}</p>
    </aside>
  );
}

function SideEntry({ entry, index, full }: { entry: DayEntry; index: number; full: boolean }) {
  const { master, today, projection } = useStore();
  const helper = helperLine(master, entry, projection);
  const mode = entry.placement?.mode ?? entry.attempt?.mode ?? 'normal';
  const actionable = entry.attemptId && ['planned', 'tentative', 'pending', 'review'].includes(entry.kind) && entry.attempt && compareDate(entry.attempt.scheduledDate ?? today, today) <= 0;
  return (
    <div className={full ? 'cal-side-entry' : 'cal-side-entry is-compact'}>
      <p className="cal-side-title">
        {String(index + 1).padStart(2, '0')}
        {'   '}
        {entryEquipmentName(master, entry)}
        {'  '}
        {transitionShort(entry.transition)}
        {entry.kind !== 'planned' && !(full && entry.kind === 'tentative') ? <span className={`cal-side-kind kind-${entry.kind}`}>{KIND_LABEL[entry.kind]}</span> : null}
      </p>
      {['success', 'failure', 'skip', 'draft'].includes(entry.kind) ? null : (
        <>
          <p className={`cal-side-helper ${helper.ok ? 'text-ok' : 'text-warn'}`}>{helper.text}</p>
          <p className="cal-side-mode">{mode === 'guaranteed' ? '確実化あり' : '通常改修'}</p>
        </>
      )}
      {!full && actionable ? (
        <div className="cal-side-mini-actions">
          <Link to={`/attempts/${encodeURIComponent(entry.attemptId!)}/record`}>結果を記録</Link>
          {entry.attempt?.scheduledDate === today ? <Link to={`/attempts/${encodeURIComponent(entry.attemptId!)}/skip`}>スキップ</Link> : null}
        </div>
      ) : null}
      {entry.event ? (
        <p className="cal-side-mini-actions">
          <Link to={`/history/events/${encodeURIComponent(entry.event.eventId)}/correct`}>記録を修正</Link>
        </p>
      ) : null}
    </div>
  );
}

export function WeekPage() {
  const { data, plan, today, master } = useStore();
  const [params, setParams] = useSearchParams();
  const start = weekStartMonday(isValidDate(params.get('start') ?? '') ? params.get('start')! : today);
  const end = addDays(start, 6);
  const days = useMemo(() => buildDays(data, plan, start, end, today), [data, plan, start, end, today]);
  const unplaced = unplacedSummary(plan);
  const s = parseDate(start);
  const e = parseDate(end);
  return (
    <Page nav="calendar" title="週間予定" top={190} sub="1週間の実行順と休みを確認。日付を選ぶと日別詳細が開きます。">
      <MasterReviewBanner />
      <div className="week-toolbar">
        <h2 className="week-range">
          {s.month}月{s.day}日 — {e.month}月{e.day}日
        </h2>
        <button type="button" className="btn cal-arrow" aria-label="前の週" onClick={() => setParams({ start: addDays(start, -7) })}>
          ‹
        </button>
        <button type="button" className="btn cal-arrow" aria-label="次の週" onClick={() => setParams({ start: addDays(start, 7) })}>
          ›
        </button>
        <span className="spacer" />
        <Link className="btn week-mode" to={`/calendar?month=${monthKey(start)}&date=${start}`}>
          月
        </Link>
        <span className="btn btn-primary week-mode" aria-current="page">
          週
        </span>
        <button type="button" className="btn week-today" onClick={() => setParams({ start: weekStartMonday(today) })}>
          今日
        </button>
      </div>
      <div className="week-grid">
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
          const info = days.get(d) ?? emptyDay(data, d);
          const p = parseDate(d);
          const entries = info.entries.filter((x) => x.kind !== 'superseded');
          return (
            <section key={d} className={`card week-day${d === today ? ' is-today' : ''}`} aria-label={formatMonthDayWeek(d)}>
              <Link className="week-day-head" to={`/calendar/day/${d}`}>
                {p.day}日（{formatMonthDayWeek(d).slice(-2, -1)}）
              </Link>
              <p className="week-day-limit text-sub">{info.holiday || info.limit === 0 ? '休み' : `上限 ${info.limit}回`}</p>
              <ul className="week-cards">
                {entries.map((x) => {
                  const tone = x.kind === 'tentative' || x.kind === 'pending' || x.kind === 'review' ? 'warn' : x.kind === 'failure' ? 'fail' : x.kind === 'skip' || x.kind === 'provisional' ? 'gray' : 'ok';
                  const helperId = x.placement?.helperShipId ?? x.attempt?.helperShipId ?? null;
                  return (
                    <li key={x.stepKey + (x.attemptId ?? '')} className={`week-card tone-${tone}`}>
                      <Link to={`/calendar/day/${d}`}>
                        <span className={`week-card-kind tone-text-${tone}`}>{KIND_LABEL[x.kind]}</span>
                        <span className="week-card-title">
                          {entryEquipmentName(master, x)}
                          <br />
                          {transitionShort(x.transition)}
                        </span>
                        <span className="week-card-sub">
                          {helperId !== null ? entryHelperName(master, x, helperId) : '担当艦未定'}
                          <br />
                          {costSummaryTight(master, entryCost(master, x), x.placement?.mode ?? x.attempt?.mode ?? 'normal', ' / ')}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="week-foot">
        <Link to="/unplaced">未配置 {unplaced.total}件を見る →</Link>
        <span className="text-muted">黄：不足あり / 緑：予定・完了 / 灰：休み・スキップ</span>
      </p>
    </Page>
  );
}

function entryBlocks(entries: DayEntry[]) {
  return entries.filter((e) => e.kind !== 'superseded');
}

export function DayPage() {
  const { date: param = '' } = useParams();
  const { data, plan, today, master, projection, run, busy } = useStore();
  const navigate = useNavigate();
  const date = isValidDate(param) ? param : today;
  const days = useMemo(() => buildDays(data, plan, date, date, today), [data, plan, date, today]);
  const info = days.get(date) ?? emptyDay(data, date);
  const entries = entryBlocks(info.entries);
  const reqs = dayRequirements(plan, date).filter((r) => !['resource:1', 'resource:2', 'resource:3', 'resource:4'].includes(r.key));
  const isToday = date === today;
  const isPast = compareDate(date, today) < 0;
  const canSkipDay = isToday && entries.some((e) => e.attemptId && e.attempt && e.attempt.outcome === 'none');
  const [message, setMessage] = useState<string | null>(null);
  const retry = async (stepKey: string) => {
    const r = await run('RequestSameDayRetry', handleSameDayRetry, { stepKey, attemptId: `${stepKey}@${data.attempts.filter((a) => a.stepKey === stepKey).length + 1}`, today, limit: info.limit, now: new Date().toISOString() });
    setMessage(r.ok ? '同日の再挑戦を今日の予定に追加しました。' : r.message);
  };
  return (
    <Page nav="calendar" title="日付を指定して確認" top={195} sub="日付ごとの予定・必要数・見込み在庫を確認できます。">
      {message ? (
        <div className="banner banner-ok page-alert" role="status">
          {message}
        </div>
      ) : null}
      <div className="day-toolbar">
        <label className="visually-hidden" htmlFor="day-date">
          日付
        </label>
        <div className="day-date-wrap">
          <input id="day-date" type="date" className="select day-date" value={date} onChange={(e) => isValidDate(e.target.value) && navigate(`/calendar/day/${e.target.value}`)} />
          <span className="day-date-label" aria-hidden="true">
            {formatSlashDate(date)}  ▾
          </span>
        </div>
        <Link className="btn day-step" to={`/calendar/day/${addDays(date, -1)}`}>
          前日
        </Link>
        <Link className="btn day-step" to={`/calendar/day/${addDays(date, 1)}`}>
          翌日
        </Link>
        <span className="spacer" />
        {canSkipDay ? (
          <Link className="btn day-skip" to={`/calendar/day/${date}/skip`}>
            この日をスキップ
          </Link>
        ) : (
          <span className="btn day-skip" aria-disabled="true" title="今日の未実施の予定だけをスキップできます">
            この日をスキップ
          </span>
        )}
      </div>
      <section className="card day-card" aria-labelledby="day-title">
        <h2 className="card-title" id="day-title">
          {formatMonthDayWeek(date)} • {info.holiday ? '休み' : `${info.plannedCount + info.doneCount + info.skipCount}件 / 上限${info.limit}回`}
        </h2>
        {entries.length === 0 ? <p className="day-empty text-sub">{info.holiday ? '休みの日です。' : 'この日の予定はありません。'}</p> : null}
        {entries.map((e, i) => {
          const helper = helperLine(master, e, projection);
          const mode = e.placement?.mode ?? e.attempt?.mode ?? 'normal';
          const short = shortageLine(master, e.placement);
          const actionable = !!e.attemptId && !!e.attempt && ['planned', 'tentative', 'pending', 'review'].includes(e.kind) && (isToday || isPast);
          return (
            <article key={e.stepKey + (e.attemptId ?? '')} className="day-entry">
              <div className="day-entry-body">
                <p className="day-entry-title">
                  {String(i + 1).padStart(2, '0')}  {entryLabel(master, e)}
                  {e.kind !== 'planned' && e.kind !== 'tentative' ? <span className={`cal-side-kind kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span> : null}
                </p>
                <p className="day-entry-helper">
                  <Link className={`day-helper-link ${helper.ok ? '' : 'text-warn'}`} to={`/goals/${e.goalId}/steps`} title="担当艦の候補を確認・選択">
                    {helper.text}
                  </Link>{' '}
                  ／ {mode === 'guaranteed' ? '確実化あり' : '通常改修'}
                </p>
                <p className="day-entry-need">必要：{costSummary(master, entryCost(master, e), mode, { separator: '・' })}</p>
                {e.kind === 'pending' ? (
                  <div className="banner banner-warn day-entry-warn">前提待ち：前の工程の結果が確定していません。当日は予定を保持し、前提を満たすまで結果を確定できません。</div>
                ) : e.kind === 'review' ? (
                  <div className="banner banner-warn day-entry-warn">確認待ち：所持データの更新などで、この予定の条件が変わりました。日付は保持しています。内容を確認してから記録してください。</div>
                ) : short ? (
                  <div className="banner banner-warn day-entry-warn">仮配置：{short.replace('しています', '')}。当日は予定を保持し、翌日に未実施を判定します。</div>
                ) : null}
                {e.kind === 'failure' && isToday && !info.daySkipped ? (
                  <button type="button" className="link-button day-retry" disabled={busy} onClick={() => void retry(e.stepKey)}>
                    同日に再挑戦する（上限内で追加）
                  </button>
                ) : null}
              </div>
              <div className="day-entry-actions">
                {actionable ? (
                  <>
                    <Link className="btn btn-primary" to={`/attempts/${encodeURIComponent(e.attemptId!)}/record`}>
                      結果を記録
                    </Link>
                    {isToday && e.attempt?.outcome === 'none' ? (
                      <Link className="btn" to={`/attempts/${encodeURIComponent(e.attemptId!)}/skip`}>
                        個別にスキップ
                      </Link>
                    ) : null}
                  </>
                ) : e.event ? (
                  <Link className="btn" to={`/history/events/${encodeURIComponent(e.event.eventId)}/correct`}>
                    記録を修正
                  </Link>
                ) : e.kind === 'draft' ? (
                  <Link className="btn" to="/history?tab=drafts">
                    確認待ちを再開
                  </Link>
                ) : null}
                {e.kind === 'pending' && e.attemptId ? (
                  <Link className="btn" to={`/attempts/${encodeURIComponent(e.attemptId)}/pending`}>
                    前提待ちの内容を見る
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
      <section className="card day-total" aria-labelledby="day-total-title">
        <h2 className="card-title" id="day-total-title">
          この日の合計と、実施前の見込み在庫
        </h2>
        {reqs.length === 0 ? (
          <p className="day-empty text-sub">この日の予定で必要なものはありません。</p>
        ) : (
          <ul className="day-total-list">
            {reqs.map((r) => {
              const short = r.available === null ? null : Math.max(0, r.need - r.available);
              return (
                <li key={r.key}>
                  <span>{costKeyPlain(master, r.key)}</span>
                  <span>必要 {r.need}</span>
                  <span>使用可能 {r.available === null ? '不明' : r.available}</span>
                  <span className={short === null || short > 0 ? 'text-warn' : ''}>不足 {short === null ? '不明' : short}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="day-total-note text-sub">{isPast ? '過去の日付です。当時の在庫は記録していないため不明です。' : '見込み在庫は、前日までの予定消費と保護指定を考慮しています。'}</p>
      </section>
    </Page>
  );
}

function attemptOf(data: AppData, attemptId: string) {
  return data.attempts.find((a) => a.attemptId === attemptId);
}

export function SkipAttemptPage() {
  const { attemptId = '' } = useParams();
  const { data, master, today, run, busy } = useStore();
  const navigate = useNavigate();
  const a = attemptOf(data, attemptId);
  const commandId = useCommandId(attemptId);
  const [message, setMessage] = useState<string | null>(null);
  const [eventId] = useState(() => newId('ev'));
  if (!a) return <NotFound />;
  const valid = a.scheduledDate === today && a.outcome === 'none' && a.lifecycle === 'active';
  const skip = async () => {
    const r = await run(
      'SkipAttempt',
      handleRecordResult,
      { attemptId: a.attemptId, outcome: 'skip', occurredDateJst: today, today, deltas: [], historyOnlyScopes: [], requireScopeAnswers: false, answeredScopes: [], eventId, recipeSnapshot: null, inputSourceEventIds: [], fromDraftId: null, now: today },
      { commandId },
    );
    if (!r.ok) return setMessage(r.message);
    navigate(`/calendar?date=${today}`);
  };
  return (
    <Page nav="calendar" title="この改修をスキップ" top={196} sub="内容を確認してから記録します。">
      <SkipBody title={`${formatMonthDayWeek(a.scheduledDate ?? today)} • ${transitionLabel(master, a.transition)}`} target={`対象：${master.equipmentName(a.transition.equipmentId)}の改修1件`} message={message ?? (valid ? null : '今日の未実施の予定だけをスキップできます。')}>
        <Link className="btn" to={`/calendar/day/${a.scheduledDate ?? today}`} style={{ width: 180 }}>
          戻る
        </Link>
        <button type="button" className="btn btn-primary" style={{ width: 350 }} disabled={busy || !valid} onClick={() => void skip()}>
          この1件をスキップ
        </button>
      </SkipBody>
    </Page>
  );
}

export function SkipDayPage() {
  const { date = '' } = useParams();
  const { data, today, run, busy } = useStore();
  const navigate = useNavigate();
  const targets = data.attempts.filter((a) => a.scheduledDate === date && a.lifecycle === 'active' && a.outcome === 'none');
  const commandId = useCommandId(date, targets.length);
  const [eventIds] = useState(() => Array.from({ length: 20 }, () => newId('ev')));
  const [message, setMessage] = useState<string | null>(null);
  const valid = date === today && targets.length > 0;
  const skip = async () => {
    const ids = targets.map((_, i) => eventIds[i] ?? newId('ev'));
    const r = await run('SkipDate', handleSkipDate, { date, today, eventIds: ids, now: today }, { commandId });
    if (!r.ok) return setMessage(r.message);
    navigate(`/calendar?date=${today}`);
  };
  const done = data.attempts.filter((a) => a.scheduledDate === date && ['success', 'failure', 'draft'].includes(a.outcome)).length;
  return (
    <Page nav="calendar" title="この日の予定をスキップ" top={196} sub="内容を確認してから記録します。">
      <SkipBody title={`${isValidDate(date) ? formatMonthDayWeek(date) : date}の未実施分`} target={`対象：未実施の${targets.length}件（完了済みの記録${done > 0 ? `${done}件` : ''}は変更しません）`} message={message ?? (valid ? null : '今日の未実施の予定があるときだけ、日全体をスキップできます。')}>
        <Link className="btn" to={`/calendar/day/${date}`} style={{ width: 180 }}>
          戻る
        </Link>
        <button type="button" className="btn btn-primary" style={{ width: 350 }} disabled={busy || !valid} onClick={() => void skip()}>
          この日の{targets.length}件をスキップ
        </button>
      </SkipBody>
    </Page>
  );
}

function SkipBody({ title, target, message, children }: { title: string; target: string; message: string | null; children: React.ReactNode }) {
  return (
    <section className="card skip-card" aria-labelledby="skip-title">
      <h2 className="card-title" id="skip-title">
        {title}
      </h2>
      <p className="skip-target">{target}</p>
      <div className="skip-info">
        <p className="skip-info-main">資材・装備は消費しません。改修値も変わりません。</p>
        <p className="skip-info-sub">翌日、日本時間の日付切替後に実行可能な日へ再配置します。</p>
      </div>
      <p className="skip-same-day">当日のうちに別の日へ自動移動することはありません。</p>
      <p className="skip-undo text-sub">操作を取り消す場合は、実績からスキップ記録を修正できます。</p>
      {message ? (
        <p className="text-warn" role="alert">
          {message}
        </p>
      ) : null}
      <div className="skip-actions">{children}</div>
    </section>
  );
}

export function PendingPage() {
  const { attemptId = '' } = useParams();
  const { data, plan, master } = useStore();
  const a = attemptOf(data, attemptId);
  if (!a) return <NotFound />;
  const step = plan?.steps.find((s) => s.stepKey === a.stepKey);
  const preds = (step?.predecessorKeys ?? []).map((k) => {
    const s = plan?.steps.find((x) => x.stepKey === k);
    const latest = latestAttemptOf(data.attempts, k);
    const state = latest?.scheduledDate === a.scheduledDate ? (latest.outcome === 'none' ? '未実施' : KIND_LABEL[latest.outcome as 'skip']) : '未配置';
    return { label: s ? transitionLabel(master, s.transition) : k, state, role: s?.role ?? 'target' };
  });
  // 参照の「前提A：素材の製作 → スキップ」「後続B：その素材を使う改修」と同じ並び。前提が複数あれば全件並べる
  const succLabel = transitionLabel(master, a.transition);
  const predText = preds.map((p) => `前提 ${p.label}：${p.role === 'craft' ? '素材の製作' : '改修'} → ${p.state}`).join('　　');
  const succText = `後続 ${succLabel}：${preds.some((p) => p.role === 'craft') ? 'その素材を使う改修' : 'この改修'}`;
  return (
    <Page nav="calendar" title="前提工程を確認" top={196} sub="資材不足の仮配置と、前提工程が終わっていない状態を区別します。">
      <section className="card pend-card" aria-labelledby="pend-title">
        <h2 className="card-title" id="pend-title">
          {a.scheduledDate ? formatMonthDayWeek(a.scheduledDate).replace(/（.*）/, '') : ''} ／ 後続 {succLabel}：前提待ち
        </h2>
        <p className="pend-main">{preds.length > 0 ? `${predText}　　${succText}` : '前提の工程は計画上ありません。結果を記録できます。'}</p>
        <p className="pend-warn text-warn">この予定は今日の予定に残しますが、前提を満たすまで結果を確定できません。</p>
        <p className="pend-next">翌日になって未完了なら、前提と後続を順番に再配置します。</p>
      </section>
      <section className="card pend-card2" aria-labelledby="pend-ok-title">
        <h2 className="card-title" id="pend-ok-title">
          前提を満たした場合
        </h2>
        <p className="pend-line">前提を実施した記録があれば、実施順・在庫・日上限を再確認します。</p>
        <p className="pend-line">別途入手した素材を使うときは、取り込み後に製作経路と予約を明示的に変更します。</p>
        <p className="pend-line text-sub">スキップを成功に自動変換したり、存在しない素材を計画出力だけで消費しません。</p>
      </section>
      <div className="pend-actions">
        <Link className="btn" to={`/calendar/day/${a.scheduledDate ?? ''}`} style={{ width: 210 }}>
          日別詳細へ戻る
        </Link>
        <Link className="btn btn-primary" to={`/goals/${a.goalId}/steps`} style={{ width: 320 }}>
          工程・素材経路を確認
        </Link>
      </div>
    </Page>
  );
}

function NotFound() {
  return (
    <Page nav="calendar" title="予定が見つかりません">
      <section className="card">
        <p>指定された予定は見つかりませんでした。別のタブで変更された可能性があります。</p>
        <Link className="btn btn-primary" to="/calendar">
          カレンダーへ戻る
        </Link>
      </section>
    </Page>
  );
}
