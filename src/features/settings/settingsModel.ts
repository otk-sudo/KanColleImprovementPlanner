import type { RecalcStatus } from '../../application/service';

// 設定画面の表示用の判定。

/** 設定を保存した後の表示。予定の再計算が終わったときだけ「再計算しました」とし、保留・失敗はそのとおり伝える */
export function settingsSavedMessage(recalc: RecalcStatus | null): { text: string; ok: boolean } {
  if (recalc === 'UPDATED' || recalc === 'UNCHANGED') return { text: '設定を保存しました。将来の予定を再計算しました。', ok: true };
  if (recalc === 'MASTER_REVIEW') return { text: '設定を保存しました。共通マスターの確認待ちのため、予定の再計算を保留しています。', ok: false };
  return { text: '設定を保存しました。予定の再計算は完了していません（再計算待ち）。画面を開き直すか、時間をおいて確認してください。', ok: false };
}
