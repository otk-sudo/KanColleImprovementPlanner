import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/Shell';
import { useCommandId, useStore } from '../../app/store';
import { handleAddHoliday, handleApplyMaster, handleRemoveHoliday, handleRestore, handleSaveSettings } from '../../application/commands';
import { backupFileName, exportBackup } from '../../application/backupExport';
import { parseBackup, summarizeBackup, type BackupCheck } from '../../domain/backup';
import { formatJstDateTime, formatSlashDate, isValidDate, WEEKDAY_LABELS } from '../../domain/jst';
import { transitionOptions } from '../../domain/master';
import { newId } from '../../infrastructure/repository';
import { DateBox, SelectBox } from '../../ui/SelectBox';
import { settingsSavedMessage } from './settingsModel';
import './settings.css';

// 予定と保存の設定（S10）・バックアップの復元（S21）・マスター不足の復元（S32）。design/10・14。

const ORDER = [1, 2, 3, 4, 5, 6, 0];

interface RestoreSession {
  fileName: string;
  check: BackupCheck;
  preSaved: boolean;
  /** S32 で「予定が保留のままになること」を確認済み（必要マスター不足のときだけ使う） */
  holdConfirmed: boolean;
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useBackupPicker() {
  const { master, formCache } = useStore();
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    const check = parseBackup(text, master.version);
    formCache.set('restore', { fileName: f.name, check, preSaved: false, holdConfirmed: false } satisfies RestoreSession);
    navigate(check.ok && check.masterMissing ? '/settings/restore/master' : '/settings/restore');
  };
  const input = <input ref={ref} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />;
  return { input, open: () => ref.current?.click() };
}

export function SettingsPage() {
  const { data, master, run, busy } = useStore();
  const [limits, setLimits] = useState<number[]>(data.settings.weekdayLimits);
  const [searchDays, setSearchDays] = useState(data.settings.searchDays);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ text: string; ok: boolean } | null>(null);
  const picker = useBackupPicker();
  const settingsId = useCommandId(limits, searchDays);
  const holidayId = useCommandId(start, end);
  const save = async () => {
    const r = await run('SaveSettings', handleSaveSettings, { weekdayLimits: limits, searchDays }, { commandId: settingsId });
    setMessage(r.ok ? null : r.message);
    setSaved(r.ok ? settingsSavedMessage(r.recalc) : null);
  };
  const addHoliday = async () => {
    if (!isValidDate(start) || !isValidDate(end)) return setMessage('開始日と終了日を入力してください。');
    const r = await run('AddHoliday', handleAddHoliday, { holiday: { holidayId: newId('holiday'), start, end } }, { commandId: holidayId });
    setMessage(r.ok ? null : r.message);
    if (r.ok) {
      setStart('');
      setEnd('');
    }
  };
  const exportNow = () => {
    const now = new Date().toISOString();
    download(backupFileName(now), exportBackup(data, data.meta.activeMasterVersion ?? master.version, __APP_VERSION__, now));
  };
  return (
    <Page nav="settings" title="予定と保存の設定" top={195} sub="改修できる曜日・回数と、お休みの日を設定します。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      {saved ? (
        <div className={`banner ${saved.ok ? 'banner-ok' : 'banner-warn'} page-alert`} role="status">
          {saved.text}
        </div>
      ) : null}
      <div className="set-top">
        <section className="card set-week" aria-labelledby="set-week-title">
          <h2 className="card-title" id="set-week-title">
            曜日ごとの改修上限
          </h2>
          <div className="set-week-grid">
            {ORDER.map((w) => (
              <div key={w} className="set-week-col">
                <label className="set-week-label" htmlFor={`limit-${w}`}>
                  {WEEKDAY_LABELS[w]}
                </label>
                <span className="set-week-select">
                  <SelectBox
                    id={`limit-${w}`}
                    width={83}
                    caret={false}
                    value={String(limits[w])}
                    options={Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: n === 0 ? '休み' : `${n} 回` }))}
                    onChange={(v) => {
                      const next = [...limits];
                      next[w] = Number(v);
                      setLimits(next);
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="set-week-note text-sub">上限は予定を組むときの目安です。実績は個別に記録します。</p>
          <div className="set-week-actions">
            <button type="button" className="btn btn-primary" style={{ width: 148 }} disabled={busy} onClick={() => void save()}>
              設定を保存
            </button>
            <label className="set-search" htmlFor="search-days">
              予定を探す期間
              <select id="search-days" className="select" value={searchDays} onChange={(e) => setSearchDays(Number(e.target.value))}>
                {[90, 180, 366, 730, 1095].map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="card set-holiday" aria-labelledby="set-holiday-title">
          <h2 className="card-title" id="set-holiday-title">
            日付を指定して休む
          </h2>
          <label className="set-field-label" htmlFor="holiday-start">
            開始日
          </label>
          <span className="set-date">
            <DateBox id="holiday-start" width="100%" value={start} onChange={setStart} placeholder="開始日を選ぶ" />
          </span>
          <label className="set-field-label set-gap" htmlFor="holiday-end">
            終了日
          </label>
          <span className="set-date">
            <DateBox id="holiday-end" width="100%" value={end} min={start || undefined} onChange={setEnd} placeholder="終了日を選ぶ" />
          </span>
          <button type="button" className="btn btn-primary set-holiday-add" style={{ width: 150 }} disabled={busy || !start || !end} onClick={() => void addHoliday()}>
            休みを追加
          </button>
          {data.settings.holidays.length > 0 ? (
            <ul className="set-holiday-list" aria-label="登録済みの休み">
              {data.settings.holidays.map((h) => (
                <li key={h.holidayId}>
                  {formatSlashDate(h.start)}〜{formatSlashDate(h.end)}{' '}
                  <button type="button" className="link-button" disabled={busy} onClick={() => void run('RemoveHoliday', handleRemoveHoliday, { holidayId: h.holidayId })}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
      <section className="card set-backup" aria-labelledby="set-backup-title">
        <h2 className="card-title" id="set-backup-title">
          バックアップ
        </h2>
        <p className="set-backup-text">データはこのブラウザに保存されます。別のPCへ移すときはファイルを使います。</p>
        <div className="set-backup-actions">
          <button type="button" className="btn btn-primary" style={{ width: 245 }} onClick={exportNow}>
            バックアップを書き出す
          </button>
          <button type="button" className="btn" style={{ width: 245 }} onClick={picker.open}>
            バックアップを読み込む
          </button>
          {picker.input}
        </div>
        <p className="set-backup-note text-sub">読み込む前に、対象データ・保存日時・変更件数を確認します。</p>
        <p className="set-backup-note2 text-sub">日付の切り替え：日本時間 0:00 ／ 未実施の予定は翌日に繰り越し判定</p>
      </section>
      <MasterCard />
    </Page>
  );
}

function MasterCard() {
  const { data, master, run, busy } = useStore();
  const commandId = useCommandId(master.version);
  if (!data.meta.masterReviewRequired && data.meta.activeMasterVersion === master.version) {
    return (
      <p className="set-master-line text-sub" id="master">
        共通マスター：{master.version}（装備{master.equipment.size}件・改修レシピ{master.recipes.size}件・出典確認日 {master.file.sources[0]?.checkedAt}）
      </p>
    );
  }
  const missingGoals = data.goals.filter((g) => !master.equipment.has(g.equipmentId));
  const brokenAttempts = data.attempts.filter((a) => a.lifecycle === 'active' && a.outcome === 'none' && transitionOptions(master, a.transition).length === 0);
  return (
    <section className="card set-master" id="master" aria-labelledby="set-master-title">
      <h2 className="card-title" id="set-master-title">
        共通マスターの確認
      </h2>
      <p>
        保存データの計画は {data.meta.activeMasterVersion ?? '不明な版'} で作られています。このアプリには {master.version} が同梱されています。予定の再計算を保留しています。
      </p>
      <ul>
        <li>このマスターにない目標の装備：{missingGoals.length}件</li>
        <li>このマスターで条件が見つからない未実施の予定：{brokenAttempts.length}件（確認待ちになります）</li>
        <li>過去の実績は保存済みの改修条件で表示し、新しいマスターで書き換えません。</li>
      </ul>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run('ApplyMasterVersion', handleApplyMaster, { masterVersion: master.version }, { commandId })}>
        このマスターを適用して再計算
      </button>
    </section>
  );
}

function useRestore() {
  const { formCache } = useStore();
  return formCache.get('restore') as RestoreSession | undefined;
}

export function RestorePage({ masterMode }: { masterMode: boolean }) {
  const { data, master, run, busy, formCache, setNotice, service, refresh } = useStore();
  const navigate = useNavigate();
  const session = useRestore();
  const picker = useBackupPicker();
  const [confirmHold, setConfirmHold] = useState(session?.holdConfirmed ?? false);
  const [preSaved, setPreSaved] = useState(session?.preSaved ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [epoch] = useState(() => newId('epoch'));
  const commandId = useCommandId(session?.fileName, confirmHold);
  // 復元後の日付変更の処理を保存できなかった場合は、完了と表示せず再試行を求める（復元自体は保存済み）
  const [rolloverRetry, setRolloverRetry] = useState<{ masterMissing: boolean } | null>(null);
  const finishRestore = async (masterMissing: boolean) => {
    const rolled = await service.rollover();
    await refresh();
    if (!rolled.saved) {
      setRolloverRetry({ masterMissing });
      return;
    }
    setRolloverRetry(null);
    setNotice(masterMissing ? 'バックアップを復元しました。必要なマスターの確認が終わるまで予定の再計算を保留しています。' : 'バックアップを復元しました。');
    navigate('/calendar');
  };
  const preSave = () => {
    const now = new Date().toISOString();
    download(`before-restore-${backupFileName(now)}`, exportBackup(data, data.meta.activeMasterVersion ?? master.version, __APP_VERSION__, now));
    setPreSaved(true);
    if (session) formCache.set('restore', { ...session, preSaved: true });
  };
  const restore = async () => {
    if (!session?.check.ok) return;
    const r = await run('RestoreBackup', handleRestore, { backup: session.check.backup, newEpoch: epoch, masterMissing: session.check.masterMissing, confirmedPlanHold: session.holdConfirmed || confirmHold, nowMs: Date.now(), now: new Date().toISOString() }, { commandId });
    if (!r.ok) return setMessage(r.message);
    formCache.delete('restore');
    await finishRestore(session.check.masterMissing);
  };
  if (rolloverRetry) {
    return (
      <Page nav="settings" title="バックアップを復元" top={196}>
        <div className="banner banner-warn page-alert" role="alert">
          バックアップは復元しましたが、日付変更の処理（未完了の予定の繰越）を保存できませんでした。保存容量を確認してから再試行してください。
        </div>
        <section className="card restore-card">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void finishRestore(rolloverRetry.masterMissing)}>
            日付変更の処理を再試行
          </button>
        </section>
      </Page>
    );
  }
  if (!session) {
    return (
      <Page nav="settings" title="バックアップを復元" top={196} sub="復元する範囲と日時を確認してください。">
        <section className="card restore-card">
          <p>復元するバックアップファイルを選んでください。選んだだけではデータは変更されません。</p>
          <button type="button" className="btn btn-primary" onClick={picker.open} style={{ width: 260 }}>
            バックアップファイルを選ぶ
          </button>
          {picker.input}
        </section>
      </Page>
    );
  }
  const check = session.check;
  if (!check.ok) {
    return (
      <Page nav="settings" title="バックアップを復元" top={196} sub="復元する範囲と日時を確認してください。">
        <div className="banner banner-error restore-error" role="alert">
          <p className="restore-error-title">このファイルは復元できません</p>
          <p>{check.message}</p>
          {check.issues.length > 0 ? (
            <ul>
              {check.issues.slice(0, 8).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <section className="card restore-card">
          <p>ファイル：{session.fileName}</p>
          <p className="text-sub">現在のデータは変更していません。破損したファイル・非対応の保存形式は部分的にも復元しません。</p>
          <div className="btn-row">
            <Link className="btn" to="/settings" style={{ width: 200 }}>
              設定へ戻る
            </Link>
            <button type="button" className="btn btn-primary" onClick={picker.open} style={{ width: 240 }}>
              別のファイルを選ぶ
            </button>
            {picker.input}
          </div>
        </section>
      </Page>
    );
  }
  const s = summarizeBackup(check.backup);
  const scopes = [s.scopes.includes('equipment') ? '装備' : null, s.scopes.includes('ships') ? '艦娘' : null, s.scopes.some((x) => x.startsWith('resource:')) ? '資材' : null, s.scopes.some((x) => x.startsWith('item:')) ? 'アイテム' : null].filter(Boolean);
  // 必要マスターが不足するときは、先に S32 で計算保留を確認してから S21 の復元前確認へ戻る
  if (masterMode || (check.masterMissing && !session.holdConfirmed)) {
    const backToConfirm = () => {
      formCache.set('restore', { ...session, holdConfirmed: true });
      navigate('/settings/restore');
    };
    return (
      <Page nav="settings" title="マスター不足のバックアップを復元" top={196} sub="ファイルの構造は正常です。予定の再計算に必要なマスターが見つかりません。">
        {message ? (
          <div className="banner banner-warn page-alert" role="alert">
            {message}
          </div>
        ) : null}
        <section className="card rm-card" aria-labelledby="rm-title">
          <h2 className="card-title" id="rm-title">
            復元できる内容
          </h2>
          <p className="rm-line">所持データ・目標・設定・実績は、バックアップの状態に置き換えます。</p>
          <p className="rm-line2">過去の結果は保存済みの改修条件で表示できます。</p>
          <p className="rm-line3 text-sub">
            目標 {s.goals}件 ／ 必要マスター {check.backup.masterVersion}（利用中：{master.version}・保存形式 v{check.backup.schemaVersion}）
          </p>
        </section>
        <section className="banner banner-warn rm-warn" aria-labelledby="rm-warn-title">
          <h2 className="rm-warn-title" id="rm-warn-title">
            復元後、予定の再計算を保留します
          </h2>
          <p className="rm-warn-line">対応するマスターを適用し、変更された改修経路を確認すると再計算できます。</p>
          <label className="rm-check">
            <input type="checkbox" className="visually-hidden" checked={confirmHold} onChange={(e) => setConfirmHold(e.target.checked)} />
            <span className="rm-check-mark" aria-hidden="true">
              {confirmHold ? '☑' : '☐'}
            </span>
            予定が保留のままになることを確認しました
          </label>
          <p className="rm-warn-note">破損したファイル・非対応の保存形式は、この操作でも復元できません。</p>
        </section>
        <p className="rm-note text-sub">次に復元前の状態を保存します。保存・復元に失敗した場合は現在の状態を維持します。</p>
        <div className="rm-actions">
          <Link className="btn" to="/settings" style={{ width: 220 }} onClick={() => formCache.delete('restore')}>
            復元をやめる
          </Link>
          <button type="button" className="btn" style={{ width: 330 }} disabled={!confirmHold} onClick={backToConfirm}>
            復元前の確認へ戻る
          </button>
        </div>
      </Page>
    );
  }
  return (
    <Page nav="settings" title="バックアップを復元" top={196} sub="復元する範囲と日時を確認してください。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <section className="card restore-card" aria-labelledby="restore-title">
        <h2 className="card-title" id="restore-title">
          バックアップの内容
        </h2>
        <p className="restore-file">ファイル：{session.fileName}</p>
        <p className="restore-date text-sub">保存日時：{formatJstDateTime(check.backup.createdAt)} JST</p>
        <dl className="restore-grid">
          <dt>改修目標</dt>
          <dd>
            現在{data.goals.length}件 → {s.goals}件
          </dd>
          <dt>所持データ</dt>
          <dd>{scopes.length > 0 ? `${scopes.join('・')}を置き換え` : '所持データなし（未取得の状態に戻す）'}</dd>
          <dt>実績・設定</dt>
          <dd>
            ファイル内の状態に戻す（実績 {s.results}件{s.drafts > 0 ? `・確認待ち ${s.drafts}件` : ''}）
          </dd>
        </dl>
        <div className="banner banner-warn restore-warn">
          {preSaved ? '復元前の状態を書き出しました。この内容で全体を置き換えます。' : '復元前の状態をバックアップしてから、全体を置き換えます。'}
          {check.masterMissing ? '必要なマスターがないため、復元後は予定の再計算を保留します（確認済み）。' : ''}
        </div>
      </section>
      <div className="restore-actions">
        <Link className="btn" to="/settings" style={{ width: 200 }} onClick={() => formCache.delete('restore')}>
          キャンセル
        </Link>
        {preSaved ? (
          <button type="button" className="btn btn-primary" style={{ width: 380 }} disabled={busy} onClick={() => void restore()}>
            この内容で復元する
          </button>
        ) : (
          <button type="button" className="btn btn-primary" style={{ width: 380 }} onClick={preSave}>
            復元前の保存へ進む
          </button>
        )}
      </div>
      <p className="restore-foot text-sub">ファイルが不正・非対応の場合は復元しません。保存に失敗した場合も現在の状態を維持します。</p>
    </Page>
  );
}
