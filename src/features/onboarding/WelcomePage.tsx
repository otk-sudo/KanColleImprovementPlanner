import { Link } from 'react-router';
import { Page } from '../../app/Shell';
import './welcome.css';

// S15 はじめての改修計画。所持データも目標もないときのカレンダーの入口。
export function WelcomeContent() {
  return (
    <>
      <section className="card welcome-hero" aria-labelledby="welcome-title">
        <h2 className="card-title" id="welcome-title">
          まずは所持データを取り込みましょう
        </h2>
        <p className="welcome-lead">装備だけのJSONでも始められます。艦娘・資材の不明な情報は後から追加できます。</p>
        <div className="btn-row welcome-actions">
          <Link className="btn btn-primary" to="/import" style={{ width: 250 }}>
            所持データを取り込む
          </Link>
          <Link className="btn" to="/guide/browser" style={{ width: 230 }}>
            取り込み方法を見る
          </Link>
        </div>
      </section>
      <ol className="welcome-steps">
        <li>
          <Link className="card welcome-step" to="/import">
            <span className="welcome-step-no">01</span>
            <span className="welcome-step-title">所持データを取り込む</span>
            <span className="welcome-step-sub">ブラウザの貼り付け／74式ENのファイル</span>
          </Link>
        </li>
        <li>
          <Link className="card welcome-step" to="/goals/new">
            <span className="welcome-step-no">02</span>
            <span className="welcome-step-title">改修したい装備を登録する</span>
            <span className="welcome-step-sub">改修値・最終的に欲しい個数を設定</span>
          </Link>
        </li>
        <li>
          <Link className="card welcome-step" to="/settings">
            <span className="welcome-step-no">03</span>
            <span className="welcome-step-title">改修できる日を設定する</span>
            <span className="welcome-step-sub">曜日ごとの回数と休みの日を設定</span>
          </Link>
        </li>
      </ol>
      <p className="welcome-note">アカウント作成は不要です。データはこのブラウザに保存されます。</p>
      <Link className="btn welcome-restore" to="/settings/restore" style={{ width: 260 }}>
        バックアップから復元
      </Link>
    </>
  );
}

export function WelcomePage() {
  return (
    <Page nav="calendar" title="はじめての改修計画" top={196} sub="データを取り込んで、目標を決めるところから始めましょう。">
      <WelcomeContent />
    </Page>
  );
}
