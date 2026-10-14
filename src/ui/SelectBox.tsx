import type { ReactNode } from 'react';

// 画面設計の選択欄（値の直後に ▾）を再現する。操作はブラウザ標準の select / input を使い、キーボード・読み上げを保つ。

export interface Option {
  value: string;
  label: string;
}

export function SelectBox({ id, value, options, onChange, width, caret = true, primary = false, ariaLabel }: { id?: string; value: string; options: Option[]; onChange: (v: string) => void; width: number | string; caret?: boolean; primary?: boolean; ariaLabel?: string }) {
  const label = options.find((o) => o.value === value)?.label ?? '';
  return (
    <span className={`selectbox${primary ? ' is-primary' : ''}`} style={{ width }}>
      <select id={id} className="selectbox-native" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="selectbox-face" aria-hidden="true">
        {label}
        {caret ? '  ▾' : ''}
      </span>
    </span>
  );
}

/** 日付入力（表示は「2026 / 10 / 20」） */
export function DateBox({ id, value, onChange, width, min, max, placeholder = '日付を選ぶ', children }: { id?: string; value: string; onChange: (v: string) => void; width: number | string; min?: string; max?: string; placeholder?: string; children?: ReactNode }) {
  const face = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replaceAll('-', ' / ') : placeholder;
  return (
    <span className="selectbox" style={{ width }}>
      <input id={id} type="date" className="selectbox-native" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
      <span className={`selectbox-face${value ? '' : ' is-placeholder'}`} aria-hidden="true">
        {face}
        {children}
      </span>
    </span>
  );
}
