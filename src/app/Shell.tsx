import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useStore } from './store';

export type NavKey = 'calendar' | 'goals' | 'materials' | 'inventory' | 'import' | 'history' | 'settings' | 'guide';

const NAV: { key: NavKey; label: string; short: string; to: string }[] = [
  { key: 'calendar', label: 'カレンダー', short: '予定', to: '/calendar' },
  { key: 'goals', label: '改修目標', short: '目標', to: '/goals' },
  { key: 'materials', label: '必要素材', short: '素材', to: '/materials' },
  { key: 'inventory', label: '所持データ', short: '所持', to: '/inventory/equipment' },
  { key: 'import', label: '取り込み', short: '取込', to: '/import' },
  { key: 'history', label: '実績・繰り越し', short: '実績', to: '/history' },
  { key: 'settings', label: '設定', short: '設定', to: '/settings' },
  { key: 'guide', label: '使い方ガイド', short: '案内', to: '/guide' },
];

function SaveStatus() {
  const { saveState, saveMessage, busy } = useStore();
  let text = '✓ 保存済み   •   日本時間';
  let state = 'ok';
  if (busy || saveState === 'saving') {
    text = '保存中…   •   日本時間';
    state = 'busy';
  } else if (saveState === 'error') {
    text = '! 保存に失敗しました   •   日本時間';
    state = 'error';
  } else if (saveState === 'dirty') {
    text = '! 計画の再計算待ち   •   日本時間';
    state = 'dirty';
  } else if (saveState === 'review') {
    text = '! マスターの確認待ち   •   日本時間';
    state = 'dirty';
  }
  return (
    <span className="header-status" data-state={state} role="status" aria-live="polite" title={saveMessage ?? undefined} style={{ whiteSpace: 'pre' }}>
      {text}
    </span>
  );
}

export function Shell({ nav, children }: { nav: NavKey; children: ReactNode }) {
  const { manifest } = useStore();
  return (
    <div className="shell">
      <nav className="nav" aria-label="主要機能">
        <div className="nav-brand">
          <span className="nav-brand-name">改修航路</span>
          <span className="nav-brand-sub">KAISHU PLANNER</span>
        </div>
        <ul className="nav-list">
          {NAV.map((n) => (
            <li key={n.key}>
              <Link className="nav-link" to={n.to} aria-current={n.key === nav ? 'page' : undefined} title={n.label}>
                <span className="nav-label">{n.label}</span>
                <span className="nav-short" aria-hidden="true">
                  {n.short}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-foot">
          <span className="nav-foot-main">このブラウザに保存</span>
          <span className="nav-foot-sub">同期なし・ログイン不要</span>
        </div>
      </nav>
      <div className="main-col">
        <header className="header">
          <p className="header-title">艦これ改修スケジューラ</p>
          <SaveStatus />
        </header>
        <main className="main" id="main">
          {children}
        </main>
        <footer className="app-footer">
          改修航路 v{__APP_VERSION__} • マスター {manifest.masterVersion}（出典確認 {manifest.sources[0]?.checkedAt ?? '不明'}）
        </footer>
      </div>
    </div>
  );
}

/** top：画面設計（1440×940）での本文の開始位置（px）。見出しとの間隔をそろえる */
export function Page({ nav, title, sub, actions, children, docTitle, top = 190 }: { nav: NavKey; title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; docTitle?: string; top?: number }) {
  const { saveMessage, notice, setNotice } = useStore();
  useEffect(() => {
    document.title = `${docTitle ?? (typeof title === 'string' ? title : '改修航路')} — 改修航路`;
  }, [title, docTitle]);
  return (
    <Shell nav={nav}>
      <div className="page-head" style={{ ['--head-gap' as string]: `${28 + (top - 190)}px` }}>
        <div>
          <h1 className="page-title">{title}</h1>
          {sub ? <p className="page-sub">{sub}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {saveMessage ? (
        <div className="banner banner-warn page-alert" role="alert">
          {saveMessage}
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner-ok page-alert" role="status">
          {notice}{' '}
          <button type="button" className="link-button" onClick={() => setNotice(null)}>
            閉じる
          </button>
        </div>
      ) : null}
      {children}
    </Shell>
  );
}
