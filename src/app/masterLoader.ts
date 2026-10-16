import { buildMasterIndex, type MasterIndex } from '../domain/master';
import { manifestSchema, masterSchema, type MasterManifest } from '../domain/master/schema';

// ビルドに同梱した共通マスターを読む。manifest の SHA-256 と照合し、破損した版を使わない（design/14）。
// ハッシュは破損検出であり、配布元の真正性保証ではない。

export class MasterLoadError extends Error {}

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function loadMaster(baseUrl = import.meta.env.BASE_URL): Promise<{ master: MasterIndex; manifest: MasterManifest }> {
  let manifest: MasterManifest;
  try {
    const res = await fetch(`${baseUrl}master/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = manifestSchema.parse(await res.json());
  } catch (e) {
    throw new MasterLoadError(`共通マスターの目録を読み込めませんでした（${e instanceof Error ? e.message : '不明'}）。`);
  }
  const res = await fetch(`${baseUrl}master/${manifest.file}`);
  if (!res.ok) throw new MasterLoadError(`共通マスター（${manifest.masterVersion}）を読み込めませんでした（HTTP ${res.status}）。`);
  const buf = await res.arrayBuffer();
  const hash = await sha256Hex(buf);
  if (hash !== null && hash !== manifest.sha256.toUpperCase()) {
    throw new MasterLoadError('共通マスターの内容が目録のハッシュと一致しません。ページを再読み込みしてください。解決しない場合は配布物の更新途中の可能性があります。');
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new MasterLoadError('共通マスターの形式が不正です（JSON として読めません）。');
  }
  const parsed = masterSchema.safeParse(json);
  if (!parsed.success) throw new MasterLoadError('共通マスターの形式が不正です。');
  if (parsed.data.masterVersion !== manifest.masterVersion) throw new MasterLoadError('共通マスターの版が目録と一致しません。');
  return { master: buildMasterIndex(parsed.data), manifest };
}
