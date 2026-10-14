import { useEffect, useState } from 'react';
import { HashRouter } from 'react-router';
import { AppService, systemClock } from '../application/service';
import type { MasterIndex } from '../domain/master';
import type { MasterManifest } from '../domain/master/schema';
import { KaishuDb } from '../infrastructure/db';
import type { AppData } from '../infrastructure/repository';
import { loadMaster } from './masterLoader';
import { AppRoutes } from './routes';
import { StoreProvider } from './store';
import { installTestHooks } from './testHooks';

type Boot =
  | { state: 'loading' }
  | { state: 'ready'; service: AppService; master: MasterIndex; manifest: MasterManifest; data: AppData }
  | { state: 'fatal'; title: string; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!('indexedDB' in window)) {
          setBoot({ state: 'fatal', title: 'このブラウザでは保存できません', message: 'IndexedDB が使えないため、所持データと計画を保存できません。通常のウィンドウの Chrome または Edge で開いてください。' });
          return;
        }
        const { master, manifest } = await loadMaster();
        const db = new KaishuDb();
        db.on('versionchange', () => {
          db.close();
          setBoot({ state: 'fatal', title: '新しい版のアプリが開かれました', message: '別のタブで新しい版のアプリがデータを更新しようとしています。このタブを閉じるか、再読み込みしてください。保存済みのデータは消えていません。' });
        });
        const service = new AppService(db, master, systemClock);
        await service.init();
        if (import.meta.env.VITE_TEST_HOOKS === '1') installTestHooks(service);
        await service.rollover();
        const data = await service.load();
        if (!cancelled) setBoot({ state: 'ready', service, master, manifest, data });
      } catch (e) {
        if (!cancelled) setBoot({ state: 'fatal', title: '起動できませんでした', message: e instanceof Error ? e.message : '不明なエラーです。' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.state === 'loading') {
    return (
      <div className="app-loading" role="status">
        読み込み中…
      </div>
    );
  }
  if (boot.state === 'fatal') {
    return (
      <div className="app-fatal">
        <div className="card" role="alert">
          <h1 className="card-title">{boot.title}</h1>
          <p>{boot.message}</p>
          <p className="text-sub">保存済みのデータはこのブラウザ内に残っています。</p>
        </div>
      </div>
    );
  }
  return (
    <StoreProvider service={boot.service} master={boot.master} manifest={boot.manifest} initialData={boot.data}>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </StoreProvider>
  );
}
