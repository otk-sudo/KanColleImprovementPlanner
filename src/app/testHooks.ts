import type { AppService } from '../application/service';
import { handleRestore } from '../application/commands';
import { parseBackup } from '../domain/backup';
import { loadData, newId } from '../infrastructure/repository';

// E2E・画面比較の状態を作るための入口。VITE_TEST_HOOKS=1 のビルドだけで有効（本番ビルドでは読み込まない）。

declare global {
  interface Window {
    __kaishu?: {
      restore(json: string): Promise<string>;
      state(): Promise<unknown>;
      recalc(): Promise<string>;
      /** 次の n 回の翌日処理を「保存できなかった」にする（保存失敗の表示の確認用） */
      failRollover(times: number): void;
      /** 次の n 回の読み込みを失敗させる（保存後の読み直しが失敗したときの再送の確認用） */
      failLoad(times: number): void;
    };
  }
}

export function installTestHooks(service: AppService): void {
  window.__kaishu = {
    async restore(json: string) {
      const parsed = parseBackup(json, service.master.version);
      if (!parsed.ok) return `invalid: ${parsed.message} ${parsed.issues.join('; ')}`;
      // 起動直後の翌日処理・再計算と競合したら最新の revision で再試行する
      const payload = { backup: parsed.backup, newEpoch: newId('epoch'), masterMissing: parsed.masterMissing, bundledMasterVersion: service.master.version, confirmedPlanHold: true, nowMs: service.clock.nowMs(), now: service.nowIso() };
      let status = 'CONFLICT';
      for (let i = 0; i < 5 && status === 'CONFLICT'; i++) {
        const data = await loadData(service.db);
        const r = await service.run('RestoreBackup', handleRestore, payload, { datasetEpoch: data.meta.datasetEpoch, expectedRevision: data.meta.revision, commandId: `restore-${payload.newEpoch}-${i}` });
        status = r.status;
      }
      return status;
    },
    async state() {
      return loadData(service.db);
    },
    async recalc() {
      return service.recalculate();
    },
    failRollover(times: number) {
      let left = times;
      const original = service.rollover.bind(service);
      service.rollover = async () => {
        if (left > 0) {
          left--;
          return { moved: 0, recalc: null, saved: false };
        }
        return original();
      };
    },
    failLoad(times: number) {
      let left = times;
      const original = service.load.bind(service);
      service.load = async () => {
        if (left > 0) {
          left--;
          throw new Error('読み込みの失敗（テスト）');
        }
        return original();
      };
    },
  };
}
