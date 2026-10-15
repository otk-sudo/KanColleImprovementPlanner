import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { AppService } from '../application/service';
import type { ParseResult } from '../domain/import/parse';
import { projectInventory, type InventoryProjection } from '../domain/inventory/projection';
import type { ScopeKey } from '../domain/inventory/types';
import { todayJst, type DateJst } from '../domain/jst';
import type { MasterIndex } from '../domain/master';
import type { MasterManifest } from '../domain/master/schema';
import type { PlanResult } from '../domain/planning/types';
import { newId, type AppData, type CommandOutcome, type Handler, type ValidationIssue } from '../infrastructure/repository';

// 画面と操作の窓口をつなぐ状態。DB を正本とし、画面は保存済みデータから計算した結果を表示する。

export type SaveState = 'saved' | 'saving' | 'error' | 'dirty' | 'review';

/** 確定操作の前提とした保存データの版。画面やフォームを開いた時点の値を使い、他タブの変更を上書きしない */
export interface CommandBase {
  datasetEpoch: string;
  expectedRevision: number;
}

export function baseOf(d: AppData): CommandBase {
  return { datasetEpoch: d.meta.datasetEpoch, expectedRevision: d.meta.revision };
}

export interface RunResult<R> {
  ok: boolean;
  outcome: CommandOutcome<R>;
  message: string | null;
  errors: ValidationIssue[];
  result: R | null;
  /** 実行後に読み直した最新のデータと版（競合時にフォームを読み直すために使う） */
  latest: AppData;
  latestBase: CommandBase;
}

export interface ImportInput {
  name: string;
  route: 'browser' | '74en';
  result: ParseResult;
  excluded: boolean;
}

export interface ImportSession {
  route: 'browser' | '74en';
  inputs: ImportInput[];
  selection: Partial<Record<ScopeKey, number>>;
  /** プレビューを作った時点の版（確定時に再確認する） */
  datasetEpoch: string;
  revision: number;
  commandId: string;
  /** 確認操作を始めた日時（再送で同じ内容にするため固定） */
  startedAt: string;
  text: string;
}

interface StoreValue {
  service: AppService;
  master: MasterIndex;
  manifest: MasterManifest;
  data: AppData;
  plan: PlanResult | null;
  projection: InventoryProjection;
  today: DateJst;
  saveState: SaveState;
  saveMessage: string | null;
  busy: boolean;
  /** options.base を省略すると、画面を開いた時点（またはこのタブの直前の確定後）の版で確定する */
  run: <P, R>(commandType: string, handler: Handler<P, R>, payload: P, options?: { commandId?: string; base?: CommandBase }) => Promise<RunResult<R>>;
  refresh: () => Promise<AppData>;
  /** 画面を開いた時点の版を記録する（画面遷移ごとに呼ぶ） */
  capturePageBase: () => void;
  recalculate: () => Promise<void>;
  importSession: ImportSession | null;
  setImportSession: (s: ImportSession | null) => void;
  formCache: Map<string, unknown>;
  notice: string | null;
  setNotice: (s: string | null) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('StoreProvider がありません');
  return v;
}

function messageFor(outcome: CommandOutcome<unknown>): string | null {
  switch (outcome.status) {
    case 'APPLIED':
    case 'ALREADY_APPLIED':
      return null;
    case 'CONFLICT':
      return '別のタブなどで内容が変更されました。最新の内容を表示しています。内容を確認してから、もう一度確定してください。';
    case 'EPOCH_MISMATCH':
      return 'バックアップの復元などでデータが置き換わりました。最新の内容を確認してください。この画面の操作は保存していません。';
    case 'WRITER_INCOMPATIBLE':
      return '新しい版のアプリで保存されたデータです。このタブを再読み込みしてください（読み取り専用で表示しています）。';
    case 'COMMAND_ID_REUSED':
      return '確定内容が変わったため、もう一度確定してください。';
    case 'STORAGE_ERROR':
      return outcome.message;
    case 'VALIDATION_ERROR':
      return outcome.errors[0]?.message ?? '入力内容を確認してください。';
  }
}

const CHANNEL = 'kancolle-improvement-planner';
const ROLLOVER_FAILED = '日付変更の処理（未完了の予定の繰越）を保存できませんでした。保存容量を確認してください。画面を開き直すと再試行します。';

export function StoreProvider({ service, master, manifest, initialData, children }: { service: AppService; master: MasterIndex; manifest: MasterManifest; initialData: AppData; children: ReactNode }) {
  const [data, setData] = useState<AppData>(initialData);
  const [today, setToday] = useState<DateJst>(() => service.today());
  const [saveState, setSaveState] = useState<SaveState>(initialData.meta.planDirty ? 'dirty' : 'saved');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importSession, setImportSession] = useState<ImportSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formCache] = useState(() => new Map<string, unknown>());
  const channel = useRef<BroadcastChannel | null>(null);
  const busyRef = useRef(false);
  const dataRef = useRef<AppData>(initialData);
  const rolloverFailed = useRef(false);
  // 他タブの通知で表示用のデータを読み直しても、この版は更新しない（開いていた画面の確定を競合として扱う）
  const pageBase = useRef<CommandBase>(baseOf(initialData));

  const refresh = useCallback(async () => {
    const d = await service.load();
    dataRef.current = d;
    setData(d);
    setToday(service.today());
    setSaveState(d.meta.masterReviewRequired ? 'review' : d.meta.planDirty ? 'dirty' : 'saved');
    return d;
  }, [service]);

  const capturePageBase = useCallback(() => {
    pageBase.current = baseOf(dataRef.current);
  }, []);

  const broadcast = useCallback(() => {
    try {
      channel.current?.postMessage({ type: 'changed' });
    } catch {
      // 通知は再読込の合図であり、失敗しても保存結果には影響しない
    }
  }, []);

  const recalculate = useCallback(async () => {
    setSaveState('saving');
    const r = await service.recalculate();
    // 利用者がこのタブで実行した再計算なので、画面の版も最新にする
    pageBase.current = baseOf(await refresh());
    if (r === 'FAILED') {
      setSaveState('dirty');
      setSaveMessage('在庫は保存済みです。計画の再計算に失敗したため、再計算待ちです。');
    }
    broadcast();
  }, [service, refresh, broadcast]);

  const run = useCallback(
    async <P, R>(commandType: string, handler: Handler<P, R>, payload: P, options?: { commandId?: string; base?: CommandBase }): Promise<RunResult<R>> => {
      if (busyRef.current) {
        const latest = dataRef.current;
        return { ok: false, outcome: { status: 'CONFLICT', revision: latest.meta.revision }, message: '保存中です。完了までお待ちください。', errors: [], result: null, latest, latestBase: baseOf(latest) };
      }
      busyRef.current = true;
      setBusy(true);
      setSaveState('saving');
      setSaveMessage(null);
      try {
        const base = options?.base ?? pageBase.current;
        const outcome = await service.run(commandType, handler, payload, { ...base, commandId: options?.commandId ?? newId('cmd') });
        const latest = await refresh();
        const message = messageFor(outcome);
        const ok = outcome.status === 'APPLIED' || outcome.status === 'ALREADY_APPLIED';
        // このタブの確定が保存された後と、競合を知らせた後は、最新の版を画面の版にする
        if (ok || outcome.status === 'CONFLICT' || outcome.status === 'EPOCH_MISMATCH') pageBase.current = baseOf(latest);
        if (ok) {
          broadcast();
          if ('recalc' in outcome && outcome.recalc === 'FAILED') {
            setSaveState('dirty');
            setSaveMessage('保存済みです。計画の再計算に失敗したため、再計算待ちです。');
          }
        } else if (outcome.status === 'STORAGE_ERROR') {
          setSaveState('error');
          setSaveMessage(message);
        }
        return {
          ok,
          outcome,
          message,
          errors: outcome.status === 'VALIDATION_ERROR' ? outcome.errors : [],
          result: outcome.status === 'APPLIED' || outcome.status === 'ALREADY_APPLIED' ? outcome.result : null,
          latest,
          latestBase: baseOf(latest),
        };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [service, refresh, broadcast],
  );

  // 起動・フォーカス復帰・日付変更・他タブの変更
  useEffect(() => {
    let disposed = false;
    const check = async () => {
      if (disposed) return;
      const r = await service.rollover();
      if (r.moved > 0) broadcast();
      await refresh();
      // 保存できなかった場合は、次に画面を開き直す（フォーカス復帰）まで消えない警告にする
      if (!r.saved) {
        rolloverFailed.current = true;
        setSaveState('error');
        setSaveMessage(ROLLOVER_FAILED);
      } else if (rolloverFailed.current) {
        rolloverFailed.current = false;
        setSaveMessage((m) => (m === ROLLOVER_FAILED ? null : m));
      }
    };
    try {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => void refresh();
    } catch {
      channel.current = null;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    let lastDay = todayJst(service.clock.nowMs());
    const timer = window.setInterval(() => {
      const d = todayJst(service.clock.nowMs());
      if (d !== lastDay) {
        lastDay = d;
        void check();
      }
    }, 30_000);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
      channel.current?.close();
    };
  }, [service, refresh, broadcast]);

  const projection = useMemo(() => projectInventory(data.baselines, data.resultEvents, data.drafts), [data]);
  const plan = useMemo(() => {
    if (data.meta.masterReviewRequired) return null;
    try {
      return service.computePlan(data);
    } catch {
      return null;
    }
    // today が変わったら再計算する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, data, today]);

  const value: StoreValue = {
    service,
    master,
    manifest,
    data,
    plan,
    projection,
    today,
    saveState,
    saveMessage,
    busy,
    run,
    refresh,
    capturePageBase,
    recalculate,
    importSession,
    setImportSession,
    formCache,
    notice,
    setNotice,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** 確定操作ごとの commandId。依存値（入力内容）が変わったら新しい ID にする */
export function useCommandId(...deps: unknown[]): string {
  const key = JSON.stringify(deps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => newId('cmd'), [key]);
}

/** 画面遷移ごとに、その画面を開いた時点の版を記録する（ルーターの内側に置く） */
export function PageBaseTracker() {
  const location = useLocation();
  const { capturePageBase } = useStore();
  useLayoutEffect(() => {
    capturePageBase();
  }, [location.key, capturePageBase]);
  return null;
}
