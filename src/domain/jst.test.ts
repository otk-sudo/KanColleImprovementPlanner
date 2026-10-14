import { describe, expect, it } from 'vitest';
import { addDays, compareDate, daysBetween, formatJstDateTime, isValidDate, monthGrid, todayJst, weekdayOf, weekStartMonday } from './jst';

describe('日本時間の日付処理', () => {
  it('UTC 14:59 は日本時間の同日、15:00 は翌日になる', () => {
    expect(todayJst(Date.UTC(2026, 9, 13, 14, 59, 59))).toBe('2026-10-13');
    expect(todayJst(Date.UTC(2026, 9, 13, 15, 0, 0))).toBe('2026-10-14');
  });

  it('曜日は 0=日曜〜6=土曜で返す（2026-10-14 は水曜）', () => {
    expect(weekdayOf('2026-10-14')).toBe(3);
    expect(weekdayOf('2026-10-18')).toBe(0);
  });

  it('月末・年末・うるう年をまたいで日付を加算できる', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('日付の比較と日数差', () => {
    expect(compareDate('2026-10-13', '2026-10-14')).toBeLessThan(0);
    expect(daysBetween('2026-10-14', '2026-10-17')).toBe(3);
  });

  it('不正な日付文字列を拒否する', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-10-14')).toBe(true);
    expect(isValidDate('2026/10/14')).toBe(false);
  });

  it('週の始まりは月曜', () => {
    expect(weekStartMonday('2026-10-14')).toBe('2026-10-12');
    expect(weekStartMonday('2026-10-18')).toBe('2026-10-12');
  });

  it('月表示は月曜始まりで、前後月の日を null で埋める', () => {
    const grid = monthGrid(2026, 10);
    expect(grid[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(grid.at(-1)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
  });

  it('日時を日本時間で表示する', () => {
    expect(formatJstDateTime('2026-10-14T00:00:00.000Z')).toBe('2026/10/14 09:00');
  });
});
