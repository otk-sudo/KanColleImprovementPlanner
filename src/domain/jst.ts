// 日本時間（JST, UTC+9・夏時間なし）の日付を YYYY-MM-DD 文字列で扱う。
// OS のタイムゾーンに依存させないため、Date のローカル時刻 API は使わない。

export type DateJst = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function toUtcMs(date: DateJst): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`日付の形式が不正です: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): DateJst {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  return fromUtcMs(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === value;
}

/** epoch ミリ秒から日本時間の日付を求める */
export function todayJst(nowMs: number): DateJst {
  return fromUtcMs(nowMs + JST_OFFSET_MS);
}

export function weekdayOf(date: DateJst): Weekday {
  return new Date(toUtcMs(date)).getUTCDay() as Weekday;
}

export function addDays(date: DateJst, days: number): DateJst {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

export function compareDate(a: DateJst, b: DateJst): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(from: DateJst, to: DateJst): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function weekStartMonday(date: DateJst): DateJst {
  const w = weekdayOf(date);
  return addDays(date, w === 0 ? -6 : 1 - w);
}

/** 月曜始まりの月カレンダー。前後月の日は null。 */
export function monthGrid(year: number, month: number): (DateJst | null)[][] {
  const first = `${year}-${pad(month)}-01`;
  const start = weekStartMonday(first);
  const rows: (DateJst | null)[][] = [];
  let cursor = start;
  const prefix = `${year}-${pad(month)}-`;
  for (;;) {
    const row: (DateJst | null)[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(cursor.startsWith(prefix) ? cursor : null);
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
    if (!cursor.startsWith(prefix)) break;
  }
  return rows;
}

export function parseDate(date: DateJst): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`日付の形式が不正です: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 10月14日（水） */
export function formatMonthDayWeek(date: DateJst): string {
  const { month, day } = parseDate(date);
  return `${month}月${day}日（${WEEKDAY_LABELS[weekdayOf(date)]}）`;
}

/** 10/14 */
export function formatShortDate(date: DateJst): string {
  const { month, day } = parseDate(date);
  return `${pad(month)}/${pad(day)}`;
}

/** 2026 / 10 / 14 */
export function formatSlashDate(date: DateJst): string {
  const { year, month, day } = parseDate(date);
  return `${year} / ${pad(month)} / ${pad(day)}`;
}

/** ISO 日時を日本時間の 2026/10/14 09:00 形式で返す */
export function formatJstDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '不明';
  const d = new Date(ms + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** ISO 日時を日本時間の 10月14日 09:00 形式で返す */
export function formatJstMonthDayTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '不明';
  const d = new Date(ms + JST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function dateRange(from: DateJst, to: DateJst): DateJst[] {
  const out: DateJst[] = [];
  for (let d = from; compareDate(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}
