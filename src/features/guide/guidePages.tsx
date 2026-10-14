import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '../../app/Shell';
import { CONFIRMED, OVERVIEW, STEPS, TROUBLE, type GuideEnv } from './guideData';
import './guide.css';

// 取り込みガイド（S11 Chrome・Edge、S12 74式EN、S23 画像でわかる手順）。R06・R23。

function EnvTabs({ env, base }: { env: GuideEnv; base: string }) {
  return (
    <div className="guide-tabs">
      <Link className={`btn ${env === 'browser' ? 'btn-primary' : ''}`} to={base === 'steps' ? '/guide/steps/browser/1' : '/guide/browser'} style={{ width: base === 'steps' ? 225 : 230 }} aria-current={env === 'browser' ? 'page' : undefined}>
        Chrome・Edge
      </Link>
      <Link className={`btn ${env === '74en' ? 'btn-primary' : ''}`} to={base === 'steps' ? '/guide/steps/74en/1' : '/guide/74en'} style={{ width: base === 'steps' ? 225 : 230 }} aria-current={env === '74en' ? 'page' : undefined}>
        74式EN
      </Link>
    </div>
  );
}

export function GuidePage({ env }: { env: GuideEnv }) {
  const c = CONFIRMED[env];
  return (
    <Page nav="guide" top={194} title={env === 'browser' ? '取り込みガイド' : '74式ENの取り込みガイド'} sub={env === 'browser' ? '利用している環境を選んで、所持データを取り込みます。' : '保存したレスポンスファイルを、選択またはドラッグ＆ドロップします。'}>
      <EnvTabs env={env} base="guide" />
      <div className="banner banner-warn guide-banner" role="note">
        対象：{c.target} ／ {c.state}（確認日 {c.checkedAt}）
      </div>
      <ol className="guide-steps">
        {OVERVIEW[env].map((s, i) => (
          <li key={s.title} className="card guide-step">
            <span className="guide-no" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h2 className="guide-step-title">{s.title}</h2>
              <p className="guide-step-desc">{s.desc}</p>
            </div>
            <Link className="guide-step-link" to={`/guide/steps/${env}/${i + 1}`}>
              画像付きで見る →
            </Link>
          </li>
        ))}
      </ol>
      <div className="guide-foot">
        <Link className="btn btn-primary" to={env === 'browser' ? '/import' : '/import/file'} style={{ width: env === 'browser' ? 190 : 215 }}>
          {env === 'browser' ? '貼り付け画面へ' : 'ファイル取り込みへ'}
        </Link>
        <p className="guide-foot-note text-sub">{env === 'browser' ? '確認対象：Chrome・Edge ／ 実機での検証済みバージョンは公開時に記載' : '困ったとき：形式が違う ／ データが古い ／ 一部の種類がない'}</p>
      </div>
      <details className="guide-trouble">
        <summary>困ったとき</summary>
        <dl>
          {TROUBLE.map((t) => (
            <div key={t.q}>
              <dt>{t.q}</dt>
              <dd>{t.a}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Page>
  );
}

export function GuideStepsPage() {
  const { env: envParam = 'browser', step: stepParam = '1' } = useParams();
  const env: GuideEnv = envParam === '74en' ? '74en' : 'browser';
  const steps = STEPS[env];
  const index = Math.min(Math.max(Number(stepParam) || 1, 1), steps.length) - 1;
  const step = steps[index]!;
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const image = step.image && failed !== step.image.src ? step.image : null;
  return (
    <Page nav="guide" title="画像でわかるJSONの反映手順" top={195} sub="1つの操作に1枚の画像。番号・枠・矢印と短い説明で案内します。">
      <div className="guide-steps-head">
        <EnvTabs env={env} base="steps" />
        <p className="guide-flow text-sub">取得 → 貼付／ファイル → 内容確認 → 反映完了</p>
      </div>
      <div className="guide-steps-grid">
        <section className="card guide-shot-card" aria-labelledby="shot-title">
          <h2 className="card-title" id="shot-title">
            {String(index + 1).padStart(2, '0')}  {step.title}
          </h2>
          {image ? (
            <>
              <button type="button" className="guide-shot" onClick={() => dialog.current?.showModal()} aria-label="画像を拡大する">
                <img src={image.src} alt={image.alt} onError={() => setFailed(image.src)} />
                {image.annotations.map((a) => (
                  <span key={a.n} className="guide-mark" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}>
                    <span className="guide-mark-no">{a.n}</span>
                  </span>
                ))}
              </button>
              <p className="guide-shot-note text-sub">
                {step.desc} 画像をクリックすると拡大します。出典：{image.source}
              </p>
              <dialog ref={dialog} className="guide-dialog" aria-label="拡大画像" onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
                <img src={image.src} alt={image.alt} />
                <button type="button" className="btn" onClick={() => dialog.current?.close()}>
                  閉じる
                </button>
              </dialog>
            </>
          ) : (
            <>
              <div className="guide-placeholder" role="img" aria-label="操作画面のスクリーンショットは未撮影">
                <p className="guide-ph-title">操作画面のスクリーンショット</p>
                <p className="guide-ph-sub">実機撮影後に配置・クリック位置を番号で案内</p>
                <p className="guide-ph-zoom">{step.desc}</p>
              </div>
              <p className="guide-shot-warn text-warn">画像未取得：実画面を撮影し、個人情報・トークンを隠して掲載</p>
            </>
          )}
        </section>
        <section className="card guide-check-card" aria-labelledby="check-title">
          <h2 className="card-title" id="check-title">
            ここを確認
          </h2>
          <ol className="guide-checks">
            {step.checks.map((c, i) => (
              <li key={c.title}>
                <p className="guide-check-title">
                  {'①②③'[i]} {c.title}
                </p>
                <p className="guide-check-desc text-sub">{c.desc}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="guide-nav">
        <button type="button" className="btn" style={{ width: 160 }} disabled={index === 0} onClick={() => navigate(`/guide/steps/${env}/${index}`)}>
          前の手順
        </button>
        <span className="guide-nav-pos text-sub" aria-live="polite">
          {index + 1} / {steps.length}
        </span>
        {index < steps.length - 1 ? (
          <button type="button" className="btn btn-primary" style={{ width: 210 }} onClick={() => navigate(`/guide/steps/${env}/${index + 2}`)}>
            次の手順
          </button>
        ) : (
          <Link className="btn btn-primary" to={env === 'browser' ? '/import' : '/import/file'} style={{ width: 210 }}>
            取り込みへ進む
          </Link>
        )}
      </div>
    </Page>
  );
}
