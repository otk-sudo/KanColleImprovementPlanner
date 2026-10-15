import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../../app/Shell';
import { useStore, type ImportInput, type ImportSession } from '../../app/store';
import { handleImport } from '../../application/commands';
import { buildImportPreview, scopeLabel, type ImportPreview } from '../../domain/import/apply';
import { IMPORT_KIND_LABELS, IMPORT_LIMITS, type ImportKind } from '../../domain/import/parse';
import { isItemScope, isResourceScope, scopeId, type ScopeKey } from '../../domain/inventory/types';
import { newId } from '../../infrastructure/repository';
import { parseAsync } from './parseAsync';
import './import.css';

// 取り込み（S07 貼り付け・S08 ファイル・S20 エラー・S26 内容確認・S27 反映）。design/06・07・13。

function RouteTabs({ active, right }: { active: 'browser' | '74en'; right: { label: string; to: string } }) {
  return (
    <div className="import-tabs">
      <Link className={`btn ${active === 'browser' ? 'btn-primary' : ''}`} to="/import" style={{ width: 250 }} aria-current={active === 'browser' ? 'page' : undefined}>
        Chrome・Edgeなど
      </Link>
      <Link className={`btn ${active === '74en' ? 'btn-primary' : ''}`} to="/import/file" style={{ width: 200 }} aria-current={active === '74en' ? 'page' : undefined}>
        74式EN
      </Link>
      <span className="spacer" />
      <Link className="btn" to={right.to} style={{ width: 228 }}>
        {right.label}
      </Link>
    </div>
  );
}

function usePreview(session: ImportSession | null): ImportPreview | null {
  const { projection, data, master } = useStore();
  return useMemo(() => {
    if (!session) return null;
    const ok = session.inputs.filter((i) => !i.excluded && i.result.ok).map((i) => (i.result.ok ? i.result.value : null)).filter((x) => x !== null);
    return buildImportPreview(ok, session.selection, projection, data.baselines, data.protections, master);
  }, [session, projection, data, master]);
}

export function ImportPastePage() {
  const { importSession, setImportSession, data } = useStore();
  const navigate = useNavigate();
  const [text, setText] = useState(importSession?.route === 'browser' ? importSession.text : '');
  const [working, setWorking] = useState(false);

  const check = async () => {
    setWorking(true);
    const result = await parseAsync(text, {});
    setWorking(false);
    const session: ImportSession = { route: 'browser', inputs: [{ name: '貼り付けた内容', route: 'browser', result, excluded: false }], selection: {}, revision: data.meta.revision, commandId: newId('cmd'), startedAt: new Date().toISOString(), text };
    setImportSession(session);
    navigate(result.ok ? '/import/preview' : '/import/error');
  };

  return (
    <Page nav="import" title="データ取り込み" sub="ゲームから取得したデータを、このブラウザ内で読み込みます。">
      <RouteTabs active="browser" right={{ label: '取得方法を見る', to: '/guide/browser' }} />
      <section className="card import-paste" aria-labelledby="paste-title">
        <h2 className="card-title" id="paste-title">
          レスポンスを貼り付け
        </h2>
        <p className="import-paste-desc" id="paste-desc">
          装備 / 艦娘 / 資材 / アイテムの形式を自動判別します。
        </p>
        <label className="visually-hidden" htmlFor="paste-input">
          コピーしたレスポンス
        </label>
        <textarea
          id="paste-input"
          className="textarea import-textarea"
          aria-describedby="paste-desc paste-note"
          placeholder={'ここにコピーしたレスポンスを貼り付け\n\n例：[{"id":216,"lv":10}, …]'}
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <p className="import-note" id="paste-note">
          必要な所持情報だけを抽出します。サーバーへ送信しません。
        </p>
        <div className="import-actions">
          <button type="button" className="btn btn-primary" style={{ width: 224 }} disabled={working} onClick={() => void check()}>
            {working ? '読み込み中…' : '内容を確認'}
          </button>
        </div>
      </section>
      <section className="card import-after" aria-labelledby="after-title">
        <h2 className="card-title" id="after-title">
          読み込み後の確認
        </h2>
        <p className="import-flow">①&nbsp;形式と件数を確認&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;②&nbsp;更新内容をプレビュー&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;③&nbsp;所持データへ反映</p>
        <p className="import-note">まだデータは変更されません。未提供のカテゴリはそのまま保持します。</p>
      </section>
    </Page>
  );
}

const RESOURCE_ORDER = [8, 7, 5, 6, 1, 2, 3, 4];

function previewLine(p: ImportPreview, master: ReturnType<typeof useStore>['master']): string {
  const rank = (s: ScopeKey) => (isResourceScope(s) ? RESOURCE_ORDER.indexOf(scopeId(s)) : 100 + (isItemScope(s) ? scopeId(s) : 0));
  const items = p.items.filter((i) => i.scope !== 'equipment' && i.scope !== 'ships').sort((a, b) => rank(a.scope) - rank(b.scope));
  const shown = items.slice(0, 3).map((i) => `${shortScope(i.scope, master)}   ${i.before ?? '不明'} → ${i.after}`);
  return shown.join('       ') + (items.length > 3 ? `       ほか${items.length - 3}項目` : '');
}

function shortScope(scope: ScopeKey, master: ReturnType<typeof useStore>['master']): string {
  if (isResourceScope(scope)) return master.resources.get(scopeId(scope))?.shortName ?? scope;
  if (isItemScope(scope)) return master.useItemName(scopeId(scope));
  return scope === 'equipment' ? '装備' : '艦娘';
}

export function ImportFilePage() {
  const { importSession, setImportSession, data, master } = useStore();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = importSession?.route === '74en' ? importSession : null;
  const preview = usePreview(session);

  const readFiles = async (files: File[]) => {
    setError(null);
    if (files.length === 0) return;
    if (files.length > IMPORT_LIMITS.maxFiles) return setError(`一度に選べるファイルは${IMPORT_LIMITS.maxFiles}件までです。`);
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > IMPORT_LIMITS.maxTotalBytes) return setError(`合計サイズが上限（${IMPORT_LIMITS.maxTotalBytes / 1024 / 1024}MiB）を超えています。ファイルを分けて取り込んでください。`);
    const inputs: ImportInput[] = [];
    for (const f of files) {
      if (f.size > IMPORT_LIMITS.maxFileBytes) {
        inputs.push({ name: f.name, route: '74en', excluded: false, result: { ok: false, error: { code: 'TOO_LARGE', message: `${f.name} が上限（${IMPORT_LIMITS.maxFileBytes / 1024 / 1024}MiB）を超えています。`, hint: '必要なレスポンスのファイルだけを選んでください。' } } });
        continue;
      }
      const text = await f.text();
      inputs.push({ name: f.name, route: '74en', excluded: false, result: await parseAsync(text, { fileName: f.name }) });
    }
    const next: ImportSession = { route: '74en', inputs, selection: {}, revision: data.meta.revision, commandId: newId('cmd'), startedAt: new Date().toISOString(), text: '' };
    setImportSession(next);
    if (inputs.every((i) => !i.result.ok)) navigate('/import/error');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFiles([...e.dataTransfer.files]);
  };

  const failed = session?.inputs.filter((i) => !i.result.ok && !i.excluded) ?? [];
  const first = session?.inputs.find((i) => i.result.ok && !i.excluded);
  const canConfirm = !!preview && preview.conflicts.length === 0 && failed.length === 0 && session !== null && session.inputs.some((i) => i.result.ok && !i.excluded);

  return (
    <Page nav="import" title="74式ENから取り込む" sub="保存したレスポンスファイルを選び、更新内容を確認します。">
      <RouteTabs active="74en" right={{ label: '74式ENの設定方法', to: '/guide/74en' }} />
      <section className="card import-drop-card">
        <div
          className={`import-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="import-drop-title">ファイルをここへドロップ</p>
          <p className="import-drop-sub">または、保存先から選択</p>
          <button type="button" className="btn btn-primary import-drop-btn" style={{ width: 230 }} onClick={() => fileRef.current?.click()}>
            ファイルを選ぶ
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json,text/plain"
            multiple
            hidden
            onChange={(e) => {
              void readFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <section className="card import-file-preview" aria-labelledby="file-preview-title">
        <h2 className="card-title" id="file-preview-title">
          更新内容のプレビュー
        </h2>
        {!session || session.inputs.length === 0 ? (
          <p className="import-note">ファイルを選ぶと、種類・件数・反映後の数量を表示します。まだデータは変更されません。</p>
        ) : (
          <>
            {session.inputs.map((input, i) => (
              <p key={i} className={`import-file-line ${input.result.ok ? 'text-ok' : 'text-error'}`}>
                {input.result.ok ? (
                  <>
                    <span>{fileKindTitle(input.result.value.kind)}</span>
                    <span>
                      読み込み成功 • {input.result.value.updates.length}項目
                    </span>
                    {session.inputs.length > 1 ? <span className="text-sub">（{input.name}）</span> : null}
                  </>
                ) : (
                  <>
                    <span>{input.name}</span>
                    <span>読み込めません：{input.result.error.message}</span>
                  </>
                )}
              </p>
            ))}
            {preview && first?.result.ok ? <p className="import-file-values">{previewLine(preview, master) || summarizeEquipShips(preview)}</p> : null}
            {preview ? <ConflictPicker preview={preview} session={session} /> : null}
            {preview ? <PreviewWarnings preview={preview} /> : null}
            <p className="import-note">{keptSentence(preview)}加算せず最新値へ置き換えます。</p>
          </>
        )}
        <div className="import-actions import-actions-split">
          <button type="button" className="btn" style={{ width: 175 }} onClick={() => setImportSession(null)}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" style={{ width: 234 }} disabled={!canConfirm} onClick={() => navigate('/import/confirm')}>
            反映内容を確認
          </button>
        </div>
      </section>
    </Page>
  );
}

function fileKindTitle(kind: ImportKind): string {
  switch (kind) {
    case 'material':
      return '資材のレスポンス';
    case 'useItem':
      return 'アイテムのレスポンス';
    case 'slotItem':
      return '装備のレスポンス';
    case 'requireInfo':
      return '起動時のレスポンス（装備・アイテム）';
    case 'port':
      return '母港のレスポンス（艦娘・資材）';
    case 'simpleEquipment':
      return '装備の簡易配列';
  }
}

function summarizeEquipShips(p: ImportPreview): string {
  return p.items.map((i) => `${i.label}   ${i.before ?? '不明'} → ${i.after}`).join('       ');
}

function keptSentence(p: ImportPreview | null): string {
  if (!p) return '';
  const names: Record<string, string> = { equipment: '装備', ships: '艦娘', resources: '資材', items: 'その他アイテム' };
  const kept = p.kept.map((k) => names[k]);
  return kept.length > 0 ? `${kept.join('・')}は変更しません。` : '';
}

function ConflictPicker({ preview, session }: { preview: ImportPreview; session: ImportSession }) {
  const { setImportSession, master } = useStore();
  if (preview.conflicts.length === 0) return null;
  return (
    <div className="banner banner-warn import-conflicts" role="group" aria-label="採用する入力の選択">
      <p>同じ種類を含むファイルが複数あります。種類ごとに採用するファイルを選んでください（ファイル名や日時で自動的には選びません）。</p>
      {preview.conflicts.map((c) => (
        <fieldset key={c.scope} className="import-conflict">
          <legend>{scopeLabel(master, c.scope)}</legend>
          {c.sources.map((s) => {
            const input = session.inputs.filter((x) => !x.excluded && x.result.ok)[s];
            return (
              <label key={s} className="import-conflict-option">
                <input type="radio" name={`conflict-${c.scope}`} onChange={() => setImportSession({ ...session, selection: { ...session.selection, [c.scope]: s } })} /> {input?.name ?? `入力${s + 1}`}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function PreviewWarnings({ preview }: { preview: ImportPreview }) {
  const items = preview.items;
  const { master } = useStore();
  const warnings: string[] = [];
  if (preview.unknownIds.equipment.length > 0) warnings.push(`共通マスターにない装備ID：${preview.unknownIds.equipment.join('、')}。名称を推測せず「未登録の装備」として保持し、改修計画には使いません。`);
  if (preview.unknownIds.ships.length > 0) warnings.push(`共通マスターにない艦娘ID：${preview.unknownIds.ships.join('、')}。担当艦の判定には使いません。`);
  if (preview.unknownIds.items.length > 0) warnings.push(`共通マスターにないアイテムID：${preview.unknownIds.items.join('、')}。`);
  for (const issue of preview.protectionIssues) {
    warnings.push(`${master.equipmentName(issue.equipmentId)} ★${issue.star}：最新所持${issue.newOwned}個に対し手動保護${issue.requested}個。反映後に保護設定の確認が必要です（保護数は自動で減らしません）。`);
  }
  if (items.some((i) => i.scope === 'equipment' && i.after === 0)) warnings.push('装備が0件の入力です。反映すると保存済みの装備がすべて0件に置き換わります。');
  if (items.some((i) => i.scope === 'ships' && i.after === 0)) warnings.push('艦娘が0件の入力です。反映すると保存済みの艦娘がすべて0件に置き換わります。');
  for (const r of preview.noChangeReasons) warnings.push(r);
  if (warnings.length === 0) return null;
  return (
    <ul className="import-warnings" aria-label="確認が必要な点">
      {warnings.map((w, i) => (
        <li key={i} className="text-warn">
          ! {w}
        </li>
      ))}
    </ul>
  );
}

export function ImportErrorPage() {
  const { importSession, setImportSession } = useStore();
  const navigate = useNavigate();
  const failed = importSession?.inputs.find((i) => !i.result.ok);
  const [kind, setKind] = useState<ImportKind | ''>('');
  if (!importSession || !failed || failed.result.ok) {
    return (
      <Page nav="import" title="取り込みエラー" top={196} sub="入力に問題があるときは、保存せず修正方法を案内します。">
        <section className="card">
          <p>確認中の入力はありません。</p>
          <Link className="btn btn-primary" to="/import">
            取り込みへ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const err = failed.result.error;
  const back = importSession.route === 'browser' ? '/import' : '/import/file';
  const snippet = importSession.route === 'browser' ? importSession.text.trim().slice(0, 16) : failed.name;
  const retryAs = async () => {
    if (!kind) return;
    const result = await parseAsync(importSession.text, { declaredKind: kind });
    setImportSession({ ...importSession, inputs: [{ ...failed, result }] });
    navigate(result.ok ? '/import/preview' : '/import/error');
  };
  return (
    <Page nav="import" title="取り込みエラー" top={196} sub="入力に問題があるときは、保存せず修正方法を案内します。">
      <div className="banner banner-error import-error-banner" role="alert">
        <p className="import-error-title">取り込めませんでした</p>
        <p className="import-error-msg">{err.message}</p>
      </div>
      <section className="card import-error-input">
        <h2 className="card-title">入力内容</h2>
        <p className="import-error-snippet">{snippet ? `${snippet}${snippet.length >= 16 ? ' …' : ''}` : '（空）'}</p>
        <p className="import-error-kept">現在の所持データは変更されていません。</p>
        {err.code === 'AMBIGUOUS_SCOPE' && importSession.route === 'browser' ? (
          <div className="import-kind-picker">
            <label className="field-label" htmlFor="declared-kind">
              取り込む種類を指定
            </label>
            <select id="declared-kind" className="select" style={{ width: 360 }} value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
              <option value="">選んでください</option>
              {(['slotItem', 'simpleEquipment', 'material', 'useItem'] as ImportKind[]).map((k) => (
                <option key={k} value={k}>
                  {IMPORT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" disabled={!kind} onClick={() => void retryAs()}>
              この種類として確認
            </button>
          </div>
        ) : null}
        <div className="btn-row import-error-actions">
          <Link className="btn btn-primary" to={back} style={{ width: 190 }}>
            入力を修正
          </Link>
          <Link className="btn" to={importSession.route === 'browser' ? '/guide/browser' : '/guide/74en'} style={{ width: 230 }}>
            取り込み方法を見る
          </Link>
        </div>
      </section>
      <section className="card import-error-retry">
        <h2 className="card-title">やり直すには</h2>
        <p className="import-error-step">1&nbsp;&nbsp;{err.code === 'PARSE_ERROR' ? 'レスポンス本文を、先頭から末尾までコピーし直してください。' : err.hint}</p>
        <p className="import-error-step">2&nbsp;&nbsp;{importSession.route === 'browser' ? '貼り付け欄の内容を置き換え、もう一度確認してください。' : 'ファイルを選び直して、もう一度確認してください。'}</p>
        <p className="import-error-foot">解決しない場合は、対応するデータ形式と取り込み手順を確認してください。</p>
      </section>
    </Page>
  );
}

function previewTitle(p: ImportPreview): string {
  const scopes = p.items.map((i) => i.scope);
  const hasEq = scopes.includes('equipment');
  const hasShips = scopes.includes('ships');
  const hasRes = scopes.some(isResourceScope);
  const hasItems = scopes.some(isItemScope);
  const kinds = [hasEq, hasShips, hasRes, hasItems].filter(Boolean).length;
  if (kinds === 1) {
    if (hasEq) return '装備データだけを更新';
    if (hasShips) return '艦娘データだけを更新';
    if (hasRes) return '資材データだけを更新';
    return 'アイテムデータだけを更新';
  }
  return '所持データを更新';
}

export function ImportPreviewPage() {
  const { importSession, master } = useStore();
  const navigate = useNavigate();
  const preview = usePreview(importSession);
  if (!importSession || !preview) {
    return (
      <Page nav="import" title="更新内容の確認">
        <section className="card">
          <p>確認中の入力はありません。</p>
          <Link className="btn btn-primary" to="/import">
            取り込みへ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const input = importSession.inputs.find((i) => i.result.ok);
  const parsed = input?.result.ok ? input.result.value : null;
  const eq = preview.items.find((i) => i.scope === 'equipment');
  const ships = preview.items.find((i) => i.scope === 'ships');
  const res = preview.items.filter((i) => isResourceScope(i.scope) || isItemScope(i.scope));
  const kindTitle = parsed ? IMPORT_KIND_LABELS[parsed.kind] : '';
  return (
    <Page nav="import" top={196} title={previewTitle(preview)} sub={`${kindTitle}を読み取りました。まだ保存していません。更新する種類と保持する種類を確認します。`}>
      <div className="banner banner-ok import-ok-banner" role="status">
        ✓ {previewTitle(preview).replace('だけを更新', '').replace('を更新', '')}を読み取れました。まだ保存していません。
      </div>
      <section className="card import-scope-card" aria-labelledby="scope-title">
        <h2 className="card-title" id="scope-title">
          更新内容
        </h2>
        <dl className="import-scope-grid">
          <dt>装備</dt>
          <dd className={eq ? 'text-ok' : ''}>{eq ? '今回のJSONで置き換え' : '変更しない'}</dd>
          <dd>{eq ? `${eq.after}個・${eq.kindsAfter}種類` : '保存済みのデータを保持'}</dd>
          <dt>艦娘</dt>
          <dd className={ships ? 'text-ok' : ''}>{ships ? '今回のJSONで置き換え' : '変更しない'}</dd>
          <dd>{ships ? `${ships.after}隻` : '保存済みのデータを保持'}</dd>
          <dt>資材・アイテム</dt>
          <dd className={res.length > 0 ? 'text-ok' : ''}>{res.length > 0 ? `含まれる${res.length}項目を置き換え` : '変更しない'}</dd>
          <dd>{res.length > 0 ? res.map((r) => `${shortScope(r.scope, master)} ${r.after}`).join('・') : '未取得の場合は「不明」のまま'}</dd>
        </dl>
        <PreviewWarnings preview={preview} />
        <ConflictPicker preview={preview} session={importSession} />
        <p className="import-captured">取得日時：データ内に情報なし ／ 取り込み日時と区別して表示</p>
      </section>
      <section className="card import-noadd" aria-labelledby="noadd-title">
        <h2 className="card-title" id="noadd-title">
          {eq ? '装備の個数は加算されません' : '数量は加算されません'}
        </h2>
        <p>同じJSONをもう一度取り込んでも、所持数は増えません。</p>
      </section>
      <div className="import-bottom-actions">
        <Link className="btn" to={importSession.route === 'browser' ? '/import' : '/import/file'} style={{ width: 200 }}>
          入力に戻る
        </Link>
        <button type="button" className="btn btn-primary" style={{ width: 330 }} disabled={preview.conflicts.length > 0} onClick={() => navigate('/import/confirm')}>
          反映内容を確認
        </button>
      </div>
    </Page>
  );
}

export function ImportConfirmPage() {
  const { importSession, setImportSession, data, master, projection, run, busy, setNotice } = useStore();
  const navigate = useNavigate();
  const preview = usePreview(importSession);
  const [message, setMessage] = useState<string | null>(null);
  if (!importSession || !preview) {
    return (
      <Page nav="import" title="最新の所持データを反映" top={196}>
        <section className="card">
          <p>確認中の入力はありません。</p>
          <Link className="btn btn-primary" to="/import">
            取り込みへ戻る
          </Link>
        </section>
      </Page>
    );
  }
  const stale = importSession.revision !== data.meta.revision;
  const confirm = async () => {
    const sources = importSession.inputs.filter((i) => i.result.ok && !i.excluded).map((i) => (i.result.ok ? { kind: i.result.value.kind, inputHash: i.result.value.inputHash, capturedAt: null } : null)).filter((x) => x !== null);
    // 再送で同じ内容になるよう、ID・日時は確認画面の操作単位で固定する
    const r = await run('ImportInventory', handleImport, { updates: preview.updates, sources, snapshotId: `snap-${importSession.commandId}`, now: importSession.startedAt }, { commandId: importSession.commandId });
    if (!r.ok) {
      setMessage(r.message);
      if (r.outcome.status === 'CONFLICT' || r.outcome.status === 'EPOCH_MISMATCH' || r.outcome.status === 'COMMAND_ID_REUSED') {
        setImportSession({ ...importSession, revision: data.meta.revision, commandId: newId('cmd'), startedAt: new Date().toISOString() });
      }
      return;
    }
    const changed = r.result?.changedScopes ?? [];
    setImportSession(null);
    setNotice(changed.length > 0 ? `所持データを反映しました（${changed.map((s) => scopeLabel(master, s)).slice(0, 6).join('・')}${changed.length > 6 ? ' ほか' : ''}）。` : '更新対象がなかったため、所持データは変更していません。');
    navigate(preview.protectionIssues.length > 0 ? '/inventory/equipment' : changed.includes('ships') && !changed.includes('equipment') ? '/inventory/ships' : changed.some((s) => s.startsWith('resource') || s.startsWith('item')) && !changed.includes('equipment') ? '/inventory/items' : '/inventory/equipment');
  };
  const rows = preview.items.map((i) => {
    const base = data.baselines.find((b) => b.scope === i.scope);
    let consumed = 0;
    if (base && base.value !== null && i.before !== null) consumed = Math.max(0, base.value - i.before);
    if (i.scope === 'equipment' && base?.equipment) consumed = 0;
    return { ...i, consumed };
  });
  const main = rows.slice(0, 8);
  return (
    <Page nav="import" title="最新の所持データを反映" top={196} sub="取り込んだJSONを最新の在庫として、対象の種類を置き換えます。">
      {message ? (
        <div className="banner banner-warn page-alert" role="alert">
          {message}
        </div>
      ) : null}
      <section className="card import-apply-card" aria-labelledby="apply-title">
        <h2 className="card-title" id="apply-title">
          今回の反映内容
        </h2>
        {main.map((row) => (
          <div key={row.scope} className="import-apply-row">
            <span className="import-apply-label">{row.scope === 'equipment' ? '装備（総数）' : row.scope === 'ships' ? '艦娘（総数）' : row.label.replace(/（.*）$/, '')}</span>
            <span className="import-apply-before">現在の見込み：{row.before === null ? '不明' : `${row.before}${row.scope === 'ships' ? '隻' : '個'}`}</span>
            <span className="import-apply-after">
              反映後：{row.after}
              {row.scope === 'ships' ? '隻' : '個'}
            </span>
          </div>
        ))}
        {rows.length > main.length ? <p className="text-sub">ほか {rows.length - main.length} 項目も同様に置き換えます。</p> : null}
        {rows
          .filter((r) => r.consumed > 0)
          .slice(0, 3)
          .map((r) => (
            <p key={r.scope} className="import-apply-note">
              JSONの{r.after}個をそのまま最新の所持数にします。過去の消費{r.consumed}個は再び差し引きません。
            </p>
          ))}
        {rows.every((r) => r.consumed === 0) ? <p className="import-apply-note">JSONの数量をそのまま最新の所持数にします。これまでの実績の消費は再び差し引きません。</p> : null}
        {stale ? <p className="text-warn">! 確認画面を開いた後に保存データが変わりました。反映時に最新の状態で再確認します。</p> : null}
      </section>
      <section className="card import-keep-card" aria-labelledby="keep-title">
        <h2 className="card-title" id="keep-title">
          反映後も保持するもの
        </h2>
        <p className="import-keep-item">✓ 今回含まれない装備・艦娘・他のアイテムの所持データ</p>
        <p className="import-keep-item">✓ これまでの改修実績と目標・保護設定</p>
        <p className="import-keep-note">反映後に記録する新しい改修の消費から、この在庫へ反映します。</p>
        <p className="import-keep-warn">資材不足は警告付きで仮配置し、当日の予定を自動で翌日へ送りません。</p>
        {projection.equipment.known && preview.protectionIssues.length > 0 ? <p className="text-warn">! 手動保護が最新所持を上回る装備があります。反映後に「保護設定を確認」で選び直してください。</p> : null}
      </section>
      <div className="import-bottom-actions import-confirm-actions">
        <button type="button" className="btn" style={{ width: 120 }} onClick={() => navigate(-1)}>
          戻る
        </button>
        <button type="button" className="btn btn-primary" style={{ width: 350 }} disabled={busy} onClick={() => void confirm()}>
          {busy ? '保存中…' : '最新の所持データとして反映'}
        </button>
      </div>
    </Page>
  );
}
