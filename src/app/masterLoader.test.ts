import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureMaster } from '../test-support/fixtureMaster';
import { loadMaster, MasterLoadError } from './masterLoader';

// P34：新しいマスターの一部が壊れていたら読み込みを中止し、保存済みの有効版・予定に触れない（design/14）。
// 読み込みは DB を開く前に行うため、ここで失敗すれば保存データは変更されない（App.tsx の起動順）。

function serve(files: Record<string, string>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = url.split('/').pop()!;
    const body = files[name];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200 });
  });
}

async function sha(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function manifest(file: string, body: string, version: string) {
  return JSON.stringify({ schemaVersion: 1, masterVersion: version, file, sha256: await sha(body), counts: {}, sources: [] });
}

afterEach(() => vi.unstubAllGlobals());

describe('共通マスターの読み込み', () => {
  it('目録のハッシュと一致する版を読み込む', async () => {
    const m = fixtureMaster({ masterVersion: 'm1' });
    const body = JSON.stringify(m);
    serve({ 'manifest.json': await manifest('master-m1.json', body, 'm1'), 'master-m1.json': body });
    const r = await loadMaster('/');
    expect(r.master.version).toBe('m1');
  });

  it('P34：内容がハッシュと一致しない（一部破損）なら使わない', async () => {
    const m = fixtureMaster({ masterVersion: 'm2' });
    const body = JSON.stringify(m);
    serve({ 'manifest.json': await manifest('master-m2.json', body, 'm2'), 'master-m2.json': body.slice(0, -20) });
    await expect(loadMaster('/')).rejects.toBeInstanceOf(MasterLoadError);
  });

  it('P34：ハッシュが一致しても JSON として壊れていれば MasterLoadError（例外の種類で起動処理を分ける）', async () => {
    const broken = '{"masterVersion":"m3","equipment":[';
    serve({ 'manifest.json': await manifest('master-m3.json', broken, 'm3'), 'master-m3.json': broken });
    await expect(loadMaster('/')).rejects.toBeInstanceOf(MasterLoadError);
  });

  it('目録と本体の版が違えば使わない', async () => {
    const m = fixtureMaster({ masterVersion: 'm4' });
    const body = JSON.stringify(m);
    serve({ 'manifest.json': await manifest('master-x.json', body, 'other'), 'master-x.json': body });
    await expect(loadMaster('/')).rejects.toBeInstanceOf(MasterLoadError);
  });
});
