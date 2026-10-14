import { useState } from 'react';

// ゲーム画像の表示（R22）。画像の配布条件が未確認のため、既定では画像を同梱・直リンクしない。
// VITE_IMAGE_BASE_URL を設定した場合だけ読み込み、失敗・未設定でも名称と操作を維持する。

const BASE = (import.meta.env.VITE_IMAGE_BASE_URL ?? '').replace(/\/$/, '');

export const IMAGES_ENABLED = BASE.length > 0;

function Fallback({ width, height, label }: { width: number; height: number; label: string }) {
  return (
    <span className="thumb" style={{ width, height }} aria-hidden="true" title={label}>
      <span style={{ padding: 2 }}>画像なし</span>
    </span>
  );
}

export function EquipmentImage({ equipmentId, name, size = 58 }: { equipmentId: number; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!IMAGES_ENABLED || failed) return <Fallback width={size} height={size} label={name} />;
  return (
    <span className="thumb" style={{ width: size, height: size }}>
      <img src={`${BASE}/equipment/${equipmentId}.png`} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

export function ShipImage({ shipId, name, width = 65, height = 43 }: { shipId: number; name: string; width?: number; height?: number }) {
  const [failed, setFailed] = useState(false);
  if (!IMAGES_ENABLED || failed) return <Fallback width={width} height={height} label={name} />;
  return (
    <span className="thumb" style={{ width, height }}>
      <img src={`${BASE}/ships/${shipId}.png`} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
