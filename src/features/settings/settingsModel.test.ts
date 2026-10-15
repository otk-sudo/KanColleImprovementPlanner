import { describe, expect, it } from 'vitest';
import { settingsSavedMessage } from './settingsModel';

describe('設定の保存後の表示', () => {
  it('予定の再計算が終わったときだけ「再計算しました」と表示し、保留・失敗はそのとおり伝える', () => {
    expect(settingsSavedMessage('UPDATED')).toEqual({ text: '設定を保存しました。将来の予定を再計算しました。', ok: true });
    expect(settingsSavedMessage('UNCHANGED')).toEqual({ text: '設定を保存しました。将来の予定を再計算しました。', ok: true });
    expect(settingsSavedMessage('MASTER_REVIEW')).toEqual({ text: '設定を保存しました。共通マスターの確認待ちのため、予定の再計算を保留しています。', ok: false });
    expect(settingsSavedMessage('FAILED').ok).toBe(false);
    expect(settingsSavedMessage('CONFLICT').text).toContain('再計算待ち');
    expect(settingsSavedMessage(null).ok).toBe(false);
  });
});
