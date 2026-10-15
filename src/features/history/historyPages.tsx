import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleCancelDraft } from '../../application/commands';
import { compareDate, formatShortDate } from '../../domain/jst';
import type { Attempt, ResultEvent } from '../../domain/model';
import { recordedTransitionLabel, transitionLabel } from '../../ui/format';
import './history.css';

// 実績・繰り越し（S09）・過去の記録と後続予定（S29）・確認待ちの記録を訂正（S31）。

function seqOf(a: Attempt): number {
  return Number(a.attemptId.slice(a.attemptId.lastIndexOf('@') + 1)) || 0;
}

type Row =
  | { kind: 'event'; key: string; date: string; sort: string; event: ResultEvent }
  | { kind: 'rollover'; key: string; date: string; sort: string; original: Attempt; successor: Attempt | null };

export function HistoryPage() {
  const { data, master, today } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'results';
  const [limit, setLimit] = useState(50);
  const attemptsById = new Map(data.attempts.map((a) => [a.attemptId, a]));
  const rollovers: Row[] = data.attempts
    .filter((a) => a.lifecycle === 'superseded' && a.scheduledDate)
    .map((a) => {
      const successor = data.attempts.filter((x) => x.predecessorAttemptId === a.attemptId).sort((x, y) => seqOf(x) - seqOf(y))[0] ?? null;
      // 繰り越しは移動先の日付（未配置なら元の日付）で並べる
      return { kind: 'rollover' as const, key: `r-${a.attemptId}`, date: a.scheduledDate!, sort: `${successor?.scheduledDate ?? a.scheduledDate}-9`, original: a, successor };
    });
  const events: Row[] = data.resultEvents.map((e) => ({ kind: 'event' as const, key: e.eventId, date: e.occurredDateJst, sort: `${e.occurredDateJst}-${String(e.occurredOrder).padStart(4, '0')}`, event: e }));
  const rows = (tab === 'rollover' ? rollovers : [...events, ...rollovers]).sort((a, b) => b.sort.localeCompare(a.sort));
  const drafts = data.drafts.filter((d) => d.status === 'open');
  const lr = data.meta.lastRollover;
  const showBanner = lr && lr.today === today && lr.fromDates.length > 0;
  return (
    <Page nav="history" title="実績・繰り越し" sub="過去の結果と、翌日に調整された予定を確認できます。">
      {showBanner ? (
        <div className="banner banner-ok hist-banner" role="status">
          <p className="hist-banner-main">✓ {lr.fromDates.map((f) => `${formatShortDate(f.date)}の未完了${f.count}件`).join('・')}を、実行可能な次の日へ移しました</p>
          <p className="hist-banner-sub">実施済みの記録漏れなら、元の日付の結果を修正してください。</p>
        </div>
      ) : null}
      <div className="hist-tabs" role="tablist" aria-label="表示する記録">
        <button type="button" role="tab" aria-selected={tab === 'results'} className={`btn ${tab === 'results' ? 'btn-primary' : ''}`} style={{ width: 150 }} onClick={() => setParams({ tab: 'results' })}>
          実績
        </button>
        <button type="button" role="tab" aria-selected={tab === 'rollover'} className={`btn ${tab === 'rollover' ? 'btn-primary' : ''}`} style={{ width: 190 }} onClick={() => setParams({ tab: 'rollover' })}>
          繰り越し履歴
        </button>
        <button type="button" role="tab" aria-selected={tab === 'drafts'} className={`btn hist-tab-drafts ${tab === 'drafts' ? 'btn-primary' : ''}`} style={{ width: 270 }} onClick={() => setParams({ tab: 'drafts' })}>
          消費確認待ちを再開{drafts.length > 0 ? `（${drafts.length}）` : ''}
        </button>
      </div>
      <section className="card hist-list" aria-label="記録の一覧">
        {tab === 'drafts' ? (
          drafts.length === 0 ? (
            <p className="hist-empty text-sub">消費の確認待ちの記録はありません。</p>
          ) : (
            <ul>
              {drafts.map((d) => {
                const a = attemptsById.get(d.attemptId);
                return (
                  <li key={d.draftId} className="hist-row">
                    <span className="hist-date">{formatShortDate(d.occurredDateJst)}</span>
                    <span className="hist-label">{a ? transitionLabel(master, a.transition) : d.stepKey}</span>
                    <span className="hist-status text-warn">確認待ち（{d.reportedOutcome === 'success' ? '成功' : '失敗'}・未確定{d.unknownScopes.length}項目）</span>
                    <span className="hist-buttons">
                      <Link className="btn" to={`/history/drafts/${encodeURIComponent(d.draftId)}/resume`}>
                        再開
                      </Link>
                      <Link className="btn" to={`/history/drafts/${encodeURIComponent(d.draftId)}/cancel`}>
                        実施していなかった
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : rows.length === 0 ? (
          <p className="hist-empty text-sub">{tab === 'rollover' ? '繰り越した予定はありません。' : 'まだ記録はありません。カレンダーから結果を記録できます。'}</p>
        ) : (
          <ul>
            {rows.slice(0, limit).map((r) =>
              r.kind === 'event' ? (
                <li key={r.key} className="hist-row">
                  <span className="hist-date">{formatShortDate(r.date)}</span>
                  <span className="hist-label">{r.event.recipeSnapshot ? recordedTransitionLabel(master, r.event.recipeSnapshot.transition, r.event.recipeSnapshot) : (attemptsById.get(r.event.attemptId) && transitionLabel(master, attemptsById.get(r.event.attemptId)!.transition)) || r.event.stepKey}</span>
                  <span className={`hist-status ${r.event.status === 'voided' ? 'text-sub' : r.event.outcome === 'success' ? 'text-ok' : r.event.outcome === 'failure' ? 'text-fail' : 'text-sub'}`}>
                    {r.event.status === 'voided' ? '取り消し済み' : r.event.outcome === 'success' ? '成功' : r.event.outcome === 'failure' ? '失敗' : 'スキップ'}
                    {r.event.revision > 1 ? <span className="hist-rev">（訂正{r.event.revision - 1}回）</span> : null}
                  </span>
                  <span className="hist-buttons">
                    {r.event.status === 'active' ? (
                      <Link className="btn" to={`/history/events/${encodeURIComponent(r.event.eventId)}/correct`}>
                        記録を修正
                      </Link>
                    ) : null}
                  </span>
                </li>
              ) : (
                <li key={r.key} className="hist-row">
                  <span className="hist-date">
                    {formatShortDate(r.original.scheduledDate!)} → {r.successor?.scheduledDate ? formatShortDate(r.successor.scheduledDate) : '未配置'}
                  </span>
                  <span className="hist-label">{transitionLabel(master, r.original.transition)}</span>
                  <span className="hist-status text-ok">{r.successor?.lifecycle === 'cancelled' ? '繰り越し（後継取消）' : '繰り越し'}</span>
                  <span className="hist-buttons">
                    <Link className="btn" to={`/history/rollover/${encodeURIComponent(r.original.attemptId)}`}>
                      詳細を見る
                    </Link>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
        {tab !== 'drafts' && rows.length > limit ? (
          <button type="button" className="link-button hist-more" onClick={() => setLimit((l) => l + 50)}>
            さらに表示（残り{rows.length - limit}件）
          </button>
        ) : null}
      </section>
      <section className="card hist-info" aria-labelledby="hist-info-title">
        <h2 className="card-title" id="hist-info-title">
          記録を変更するとどうなる？
        </h2>
        <p className="hist-info-text text-sub">変更前後の在庫・後続予定を確認してから反映します。再取り込み済みの在庫へ二重に減算しません。</p>
      </section>
    </Page>
  );
}

export function RolloverDetailPage() {
  const { attemptId = '' } = useParams();
  const { data, master, formCache } = useStore();
  const original = data.attempts.find((a) => a.attemptId === attemptId);
  if (!original) {
    return (
      <Page nav="history" title="過去の記録と後続予定を確認" top={196}>
        <section className="card">
          <p>対象の予定が見つかりません。</p>
          <Link className="btn btn-primary" to="/history">
            実績・繰り越しへ
          </Link>
        </section>
      </Page>
    );
  }
  const successors = data.attempts.filter((a) => a.stepKey === original.stepKey && seqOf(a) > seqOf(original)).sort((a, b) => seqOf(a) - seqOf(b));
  const pending = formCache.get(`record:${original.attemptId}`) as { outcome?: string } | undefined;
  const origState = original.outcome === 'none' ? '未記録' : original.outcome === 'success' ? '成功' : original.outcome === 'failure' ? '失敗' : original.outcome === 'skip' ? 'スキップ' : '確認待ち';
  const withResult = successors.find((s) => s.lifecycle === 'active' && s.outcome !== 'none');
  const conflict = pending?.outcome === 'success' && !!withResult;
  const succ = withResult ?? successors.find((s) => s.lifecycle === 'active') ?? successors[0];
  const succState = (s: Attempt) => (s.lifecycle === 'cancelled' ? '取消済み' : s.outcome === 'none' ? '未実施' : s.outcome === 'success' ? 'すでに成功を記録' : s.outcome === 'failure' ? 'すでに失敗を記録' : s.outcome === 'skip' ? 'スキップを記録' : '確認待ち');
  const succEvent = succ?.resultEventId ? data.resultEvents.find((e) => e.eventId === succ.resultEventId) : undefined;
  const origEvent = original.resultEventId ? data.resultEvents.find((e) => e.eventId === original.resultEventId) : undefined;
  return (
    <Page nav="history" title="過去の記録と後続予定を確認" top={196} sub="繰越前の記録を変更したときに、二重の予定や矛盾する実績を確認します。">
      <section className="card conf-card" aria-labelledby="conf-title">
        <h2 className="card-title" id="conf-title">
          今回の変更
        </h2>
        <p className="conf-line">
          元の試行：{formatShortDate(original.scheduledDate ?? '2000-01-01')} {transitionLabel(master, original.transition)}　{origState}
          {pending?.outcome ? ` → ${pending.outcome === 'success' ? '成功' : '失敗'}` : ''}
        </p>
        {succ ? (
          <p className={`conf-line ${succ.outcome !== 'none' && succ.lifecycle === 'active' ? 'text-warn' : ''}`}>
            後継試行：{succ.scheduledDate ? formatShortDate(succ.scheduledDate) : '未配置'} {transitionLabel(master, succ.transition)}　{succState(succ)}
          </p>
        ) : (
          <p className="conf-line">後継試行：なし</p>
        )}
        <p className="conf-note">結果がある後継は自動で取り消しません。実施内容を確認してください。</p>
      </section>
      <section className="card conf-card2" aria-labelledby="conf2-title">
        <h2 className="card-title" id="conf2-title">
          影響と修正
        </h2>
        <p className="conf-line2">在庫：最新JSONより前の実績は履歴だけ訂正。現在の数量を復活させません。</p>
        <p className="conf-line2">未実施の後継だけなら、取消対象を表示して元の成功記録と一括で保存します。</p>
        {conflict ? <p className="conf-warn text-warn">矛盾が未解決のため確定できません。元・後継の記録を修正してください。</p> : withResult ? <p className="conf-warn text-warn">後継には結果があります。元の試行に成功を記録すると矛盾します。</p> : null}
      </section>
      <div className="conf-actions">
        <Link className="btn" to={origEvent ? `/history/events/${encodeURIComponent(origEvent.eventId)}/correct` : `/attempts/${encodeURIComponent(original.attemptId)}/record`} style={{ width: 210 }}>
          元の記録を修正
        </Link>
        {succ ? (
          <Link className="btn" to={succEvent ? `/history/events/${encodeURIComponent(succEvent.eventId)}/correct` : `/calendar/day/${succ.scheduledDate ?? ''}`} style={{ width: 230 }}>
            後継の記録を修正
          </Link>
        ) : null}
        <span className="spacer" />
        {conflict || original.outcome !== 'none' ? (
          <span className="btn" aria-disabled="true" style={{ width: 320 }}>
            {conflict ? '未解決のため確定不可' : '記録済み'}
          </span>
        ) : (
          <Link className="btn btn-primary" to={`/attempts/${encodeURIComponent(original.attemptId)}/record`} style={{ width: 320 }}>
            元の日の結果を記録する
          </Link>
        )}
      </div>
    </Page>
  );
}

export function CancelDraftPage() {
  const { draftId = '' } = useParams();
  const { data, master, run, busy, service, refresh, today } = useStore();
  const navigate = useNavigate();
  const draft = data.drafts.find((d) => d.draftId === draftId);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const commandId = useCommandId(draftId, reason);
  if (!draft) {
    return (
      <Page nav="history" title="確認待ちの記録を訂正" top={196}>
        <section className="card">
          <p>対象の記録が見つかりません。</p>
          <Link className="btn btn-primary" to="/history?tab=drafts">
            確認待ちへ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const attempt = data.attempts.find((a) => a.attemptId === draft.attemptId);
  const submit = async () => {
    const r = await run('CancelDraftAsNotPerformed', handleCancelDraft, { draftId, reason, now: new Date().toISOString() }, { commandId });
    if (!r.ok) return setMessage(r.message);
    // 過去日の未実施に戻った場合は翌日処理の対象として再評価する
    if (compareDate(draft.occurredDateJst, today) < 0) {
      await service.rollover();
      await refresh();
    }
    navigate('/history?tab=drafts');
  };
  return (
    <Page nav="history" title="確認待ちの記録を訂正" top={196} sub="実際には改修していなかった場合の操作です。理由と変更内容を確認します。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <section className="card cancel-card" aria-labelledby="cancel-title">
        <h2 className="card-title" id="cancel-title">
          対象：{attempt ? transitionLabel(master, attempt.transition) : draft.stepKey} ／ 実施済み・消費確認待ち
        </h2>
        <label className="cancel-label" htmlFor="cancel-reason">
          訂正理由（必須）
        </label>
        <textarea id="cancel-reason" className="textarea cancel-reason" placeholder="例：予定を実績と取り違えて登録していました。" value={reason} onChange={(e) => setReason(e.target.value)} aria-required="true" />
      </section>
      <section className="card cancel-card2" aria-labelledby="cancel2-title">
        <h2 className="card-title" id="cancel2-title">
          訂正による変更
        </h2>
        <p className="cancel-line">実施回数：1回 → 0回 ／ この記録による素材の保留を解除</p>
        <p className="cancel-line2">所持数・★は増減しません。最新JSONに含まれる在庫も変えません。</p>
        <p className="cancel-line3">過去日の未完了工程は繰越対象へ戻ります。既存の後継は重複作成しません。</p>
        <p className="cancel-line3 text-sub">訂正前の内容と理由は履歴に残ります。</p>
      </section>
      <div className="cancel-actions">
        <Link className="btn" to="/history?tab=drafts" style={{ width: 220 }}>
          確認待ちに戻る
        </Link>
        <button type="button" className={`btn ${reason.trim() ? 'btn-primary' : ''}`} style={{ width: 290 }} disabled={!reason.trim() || busy} onClick={() => void submit()}>
          未実施として訂正
        </button>
      </div>
    </Page>
  );
}
