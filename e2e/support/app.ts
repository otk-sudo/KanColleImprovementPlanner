import { expect, type Page } from '@playwright/test';
import type { MasterFile } from '../../src/domain/master/schema';
import type { AppData } from '../../src/infrastructure/repository';
import { screenMaster } from './masters';
import { backup, fixClock, openScenario, serveFixtureMaster, type BackupSpec } from './scenario';

// 機能E2Eの共通操作。架空マスター（e2e/support/masters.ts）と架空データだけを使い、時刻は固定する。

export async function start(page: Page, opts: { data?: BackupSpec; route?: string; clockIso?: string; master?: MasterFile } = {}) {
  const master = opts.master ?? screenMaster();
  if (opts.data) {
    await openScenario(page, { master, data: backup(opts.data), route: opts.route ?? '/', clockIso: opts.clockIso });
    return;
  }
  await serveFixtureMaster(page, master);
  await fixClock(page, opts.clockIso);
  await page.goto(`/#${opts.route ?? '/'}`);
  await page.waitForSelector('h1');
}

export async function state(page: Page): Promise<AppData> {
  return (await page.evaluate(() => window.__kaishu!.state())) as AppData;
}

/** 貼り付けで取り込み、確認画面を経て反映する */
export async function pasteAndApply(page: Page, text: string) {
  await page.goto('/#/import');
  await page.getByLabel('コピーしたレスポンス').fill(text);
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.waitForURL(/#\/import\/preview/);
  await page.getByRole('button', { name: '反映内容を確認' }).click();
  await page.waitForURL(/#\/import\/confirm/);
  await page.getByRole('button', { name: '最新の所持データとして反映' }).click();
  await page.waitForURL(/#\/inventory\//);
}

export function equipmentCounts(d: AppData): Map<string, number> {
  const b = d.baselines.find((x) => x.scope === 'equipment');
  const out = new Map<string, number>();
  for (const k of b?.equipment?.buckets ?? []) out.set(`${k.equipmentId}:${k.star}`, k.count);
  return out;
}

export async function noHorizontalScroll(page: Page, label = '') {
  const r = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect.soft(r.scroll, `ページ全体の横スクロール ${label}（${r.scroll} > ${r.width}）`).toBeLessThanOrEqual(r.width);
}
