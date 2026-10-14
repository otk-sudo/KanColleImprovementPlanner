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
    };
  }
}

export function installTestHooks(service: AppService): void {
  window.__kaishu = {
    async restore(json: string) {
      const parsed = parseBackup(json, service.master.version);
      if (!parsed.ok) return `invalid: ${parsed.message} ${parsed.issues.join('; ')}`;
      // 起動直後の翌日処理・再計算と競合したら最新の revision で再試行する
      const payload = { backup: parsed.backup, newEpoch: newId('epoch'), masterMissing: parsed.masterMissing, confirmedPlanHold: true, nowMs: service.clock.nowMs(), now: service.nowIso() };
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
  };
}
