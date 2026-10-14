import { quickHash } from '../../shared/hash';
import type { EquipmentBucket, EquipmentInstance, ScopeUpdate, ShipEntry } from '../inventory/types';
import { bucketKey } from '../inventory/types';

// 2経路（ブラウザのレスポンス貼り付け／74式ENの保存ファイル）を同じ正規化器で読む（design/07・13）。
// 入力テキストは実行しない。必要な項目だけを許可リストで取り出し、提督情報・認証情報・原文は保持しない。

export type ImportKind = 'simpleEquipment' | 'slotItem' | 'requireInfo' | 'port' | 'material' | 'useItem';

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  simpleEquipment: '装備の簡易配列（id/lv）',
  slotItem: '装備一覧（api_get_member/slot_item）',
  requireInfo: '起動時データ（api_get_member/require_info）',
  port: '母港（api_port/port）',
  material: '資材（api_get_member/material）',
  useItem: 'アイテム（api_get_member/useitem）',
};

export const IMPORT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxFiles: 20,
  maxTotalBytes: 50 * 1024 * 1024,
  maxDepth: 64,
  maxRows: 100_000,
} as const;

export type ImportErrorCode =
  | 'PARSE_ERROR'
  | 'UNSUPPORTED_SHAPE'
  | 'INVALID_QUANTITY'
  | 'AMBIGUOUS_SCOPE'
  | 'API_ERROR'
  | 'DUPLICATE_ID'
  | 'NULL_DATA'
  | 'TOO_LARGE'
  | 'TOO_DEEP'
  | 'EMPTY_INPUT';

export interface ImportError {
  code: ImportErrorCode;
  message: string;
  hint: string;
  fieldPath?: string;
}

export interface ImportWarning {
  code: 'USEITEM_PARTIAL' | 'EMPTY_EQUIPMENT' | 'EMPTY_SHIPS';
  message: string;
}

export interface ParsedImport {
  kind: ImportKind;
  label: string;
  updates: ScopeUpdate[];
  warnings: ImportWarning[];
  noUpdateReason: string | null;
  inputHash: string;
  sourceName: string | null;
  byteLength: number;
}

export type ParseResult = { ok: true; value: ParsedImport } | { ok: false; error: ImportError };

export interface ParseOptions {
  declaredKind?: ImportKind;
  fileName?: string;
}

const fail = (code: ImportErrorCode, message: string, hint: string, fieldPath?: string): ParseResult => ({
  ok: false,
  error: { code, message, hint, ...(fieldPath ? { fieldPath } : {}) },
});

class InputError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly hint: string,
    readonly fieldPath?: string,
  ) {
    super(message);
  }
}

function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** 文字列リテラル外の括弧の入れ子を数える（JSON.parse 前の深さ判定） */
function maxNesting(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      depth++;
      if (depth > max) max = depth;
    } else if (c === '}' || c === ']') depth--;
  }
  return max;
}

function describeJsonError(e: unknown, text: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /position (\d+)/.exec(msg);
  const truncated = /Unexpected end|unterminated|end of JSON/i.test(msg) || (m && Number(m[1]) >= text.length - 1);
  if (truncated) return 'JSONの途中で内容が切れている可能性があります。レスポンス本文を最後までコピーしてください。';
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return `JSONとして読み取れません（${line}行目 ${col}文字目付近）。レスポンス本文だけをコピーしているか確認してください。`;
  }
  return 'JSONとして読み取れません。レスポンス本文だけをコピーしているか確認してください。';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function int(v: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new InputError('INVALID_QUANTITY', `${path} の値が不正です（${v === undefined ? '欠落' : JSON.stringify(v)}）。`, '取得したレスポンスを加工せずに貼り付けてください。数値を推測して補うことはしません。', path);
  }
  return v;
}

function rows(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new InputError('UNSUPPORTED_SHAPE', `${path} が配列ではありません。`, '対応するレスポンスか確認してください。', path);
  if (v.length > IMPORT_LIMITS.maxRows) throw new InputError('TOO_LARGE', `${path} の件数が上限（${IMPORT_LIMITS.maxRows.toLocaleString()}件）を超えています。`, 'ファイルを分けて取り込んでください。', path);
  return v;
}

function aggregate(instances: { equipmentId: number; star: number }[]): EquipmentBucket[] {
  const counts = new Map<string, EquipmentBucket>();
  for (const i of instances) {
    const key = bucketKey(i.equipmentId, i.star);
    const b = counts.get(key);
    if (b) b.count++;
    else counts.set(key, { equipmentId: i.equipmentId, star: i.star, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.equipmentId - b.equipmentId || a.star - b.star);
}

function parseSimpleEquipment(data: unknown[]): ScopeUpdate[] {
  const list = data.map((row, i) => {
    if (!isObj(row)) throw new InputError('UNSUPPORTED_SHAPE', `${i + 1}件目が {id, lv} の形ではありません。`, '装備の簡易配列か確認してください。', `[${i}]`);
    return { equipmentId: int(row.id, `[${i}].id`, 1), star: int(row.lv, `[${i}].lv`, 0, 10) };
  });
  return [{ scope: 'equipment', granularity: 'aggregate', buckets: aggregate(list), instances: null }];
}

function parseSlotItems(data: unknown[], path: string): ScopeUpdate {
  const seen = new Set<number>();
  const instances: EquipmentInstance[] = data.map((row, i) => {
    if (!isObj(row)) throw new InputError('UNSUPPORTED_SHAPE', `${path}[${i}] が装備の形ではありません。`, '装備一覧のレスポンスか確認してください。', `${path}[${i}]`);
    const instanceId = int(row.api_id, `${path}[${i}].api_id`, 1);
    if (seen.has(instanceId)) throw new InputError('DUPLICATE_ID', `装備の個体ID ${instanceId} が重複しています。`, 'レスポンスを加工していないか確認してください。複数のレスポンスを連結しないでください。', `${path}[${i}].api_id`);
    seen.add(instanceId);
    return { instanceId, equipmentId: int(row.api_slotitem_id, `${path}[${i}].api_slotitem_id`, 1), star: int(row.api_level, `${path}[${i}].api_level`, 0, 10) };
  });
  instances.sort((a, b) => a.instanceId - b.instanceId);
  return { scope: 'equipment', granularity: 'instance', buckets: aggregate(instances), instances };
}

function parseShips(data: unknown[], path: string): ScopeUpdate {
  const seen = new Set<number>();
  const ships: ShipEntry[] = data.map((row, i) => {
    if (!isObj(row)) throw new InputError('UNSUPPORTED_SHAPE', `${path}[${i}] が艦娘の形ではありません。`, '母港のレスポンスか確認してください。', `${path}[${i}]`);
    const instanceId = int(row.api_id, `${path}[${i}].api_id`, 1);
    if (seen.has(instanceId)) throw new InputError('DUPLICATE_ID', `艦娘の個体ID ${instanceId} が重複しています。`, 'レスポンスを加工していないか確認してください。', `${path}[${i}].api_id`);
    seen.add(instanceId);
    return { instanceId, shipId: int(row.api_ship_id, `${path}[${i}].api_ship_id`, 1) };
  });
  ships.sort((a, b) => a.instanceId - b.instanceId);
  return { scope: 'ships', ships };
}

function parseIdValues(data: unknown[], path: string, valueKey: 'api_value' | 'api_count', prefix: 'resource' | 'item'): ScopeUpdate[] {
  const seen = new Set<number>();
  const out: ScopeUpdate[] = [];
  data.forEach((row, i) => {
    if (!isObj(row)) throw new InputError('UNSUPPORTED_SHAPE', `${path}[${i}] の形が対応していません。`, 'レスポンスを加工していないか確認してください。', `${path}[${i}]`);
    const id = int(row.api_id, `${path}[${i}].api_id`, 1, prefix === 'resource' ? 8 : Number.MAX_SAFE_INTEGER);
    if (seen.has(id)) throw new InputError('DUPLICATE_ID', `${prefix === 'resource' ? '資材' : 'アイテム'}ID ${id} が重複しています。`, '同じIDが複数ある入力は反映しません。レスポンスを取り直してください。', `${path}[${i}].api_id`);
    seen.add(id);
    const value = int(row[valueKey], `${path}[${i}].${valueKey}`, 0);
    out.push(prefix === 'resource' ? { scope: `resource:${id}`, value } : { scope: `item:${id}`, value });
  });
  return out.sort((a, b) => Number(a.scope.split(':')[1]) - Number(b.scope.split(':')[1]));
}

type Shape = { kind: ImportKind; data: unknown };

function looksLike(row: unknown, keys: string[], forbid: string[] = []): boolean {
  return isObj(row) && keys.every((k) => k in row) && forbid.every((k) => !(k in row));
}

/** 本文の形から種類を判定する。空配列など曖昧な場合は null。 */
function detectShape(apiData: unknown, wrapped: boolean): Shape | null {
  if (isObj(apiData)) {
    if ('api_slot_item' in apiData && ('api_kdock' in apiData || 'api_basic' in apiData || 'api_useitem' in apiData)) return { kind: 'requireInfo', data: apiData };
    if ('api_ship' in apiData || 'api_material' in apiData || 'api_deck_port' in apiData) return { kind: 'port', data: apiData };
    return null;
  }
  if (Array.isArray(apiData)) {
    if (apiData.length === 0) return null;
    const first = apiData[0];
    if (!wrapped && looksLike(first, ['id', 'lv'])) return { kind: 'simpleEquipment', data: apiData };
    if (looksLike(first, ['api_slotitem_id'])) return { kind: 'slotItem', data: apiData };
    if (looksLike(first, ['api_id', 'api_value'])) return { kind: 'material', data: apiData };
    if (looksLike(first, ['api_id', 'api_count'])) return { kind: 'useItem', data: apiData };
  }
  return null;
}

function kindFromFileName(fileName: string | undefined): ImportKind | null {
  if (!fileName) return null;
  const n = fileName.toLowerCase();
  if (!n.includes('s@')) return null;
  if (n.includes('api_get_member@slot_item')) return 'slotItem';
  if (n.includes('api_get_member@require_info')) return 'requireInfo';
  if (n.includes('api_port@port')) return 'port';
  if (n.includes('api_get_member@material')) return 'material';
  if (n.includes('api_get_member@useitem')) return 'useItem';
  return null;
}

function buildUpdates(kind: ImportKind, data: unknown): { updates: ScopeUpdate[]; warnings: ImportWarning[]; noUpdateReason: string | null } {
  const warnings: ImportWarning[] = [];
  switch (kind) {
    case 'simpleEquipment': {
      const updates = parseSimpleEquipment(rows(data, 'api_data'));
      return { updates, warnings, noUpdateReason: null };
    }
    case 'slotItem':
      return { updates: [parseSlotItems(rows(data, 'api_data'), 'api_data')], warnings, noUpdateReason: null };
    case 'requireInfo': {
      if (!isObj(data)) throw new InputError('UNSUPPORTED_SHAPE', '起動時データの形が対応していません。', 'レスポンスを加工せずに貼り付けてください。');
      const updates: ScopeUpdate[] = [parseSlotItems(rows(data.api_slot_item, 'api_data.api_slot_item'), 'api_data.api_slot_item')];
      if (data.api_useitem !== undefined && data.api_useitem !== null) {
        updates.push(...parseIdValues(rows(data.api_useitem, 'api_data.api_useitem'), 'api_data.api_useitem', 'api_count', 'item'));
        warnings.push(partialItemWarning());
      }
      return { updates, warnings, noUpdateReason: null };
    }
    case 'port': {
      if (!isObj(data) || !Array.isArray(data.api_ship) || !Array.isArray(data.api_material)) {
        throw new InputError('UNSUPPORTED_SHAPE', '母港のレスポンスに艦娘一覧（api_ship）または資材（api_material）がありません。', '母港画面に戻ったときのレスポンス全体をコピーしてください。欠けた一覧を空として扱うことはしません。', 'api_data');
      }
      const updates: ScopeUpdate[] = [parseShips(rows(data.api_ship, 'api_data.api_ship'), 'api_data.api_ship')];
      updates.push(...parseIdValues(rows(data.api_material, 'api_data.api_material'), 'api_data.api_material', 'api_value', 'resource'));
      return { updates, warnings, noUpdateReason: null };
    }
    case 'material': {
      const updates = parseIdValues(rows(data, 'api_data'), 'api_data', 'api_value', 'resource');
      return { updates, warnings, noUpdateReason: updates.length === 0 ? '更新対象の資材IDが含まれていません' : null };
    }
    case 'useItem': {
      if (data === null) throw new InputError('NULL_DATA', 'アイテム一覧が null です。意味が確認できないため反映しません。', '「アイテム」画面を開いたときのレスポンスを取り直してください。');
      const updates = parseIdValues(rows(data, 'api_data'), 'api_data', 'api_count', 'item');
      if (updates.length > 0) warnings.push(partialItemWarning());
      return { updates, warnings, noUpdateReason: updates.length === 0 ? '更新対象のアイテムIDが含まれていません（全アイテム0とは扱いません）' : null };
    }
  }
}

function partialItemWarning(): ImportWarning {
  return {
    code: 'USEITEM_PARTIAL',
    message: '含まれていないアイテムは前回の値を保持し「今回未取得」と表示します。省略が0を意味するかは未確認です。',
  };
}

export function parseImportText(raw: string, options: ParseOptions = {}): ParseResult {
  const byteLength = utf8Length(raw);
  if (byteLength > IMPORT_LIMITS.maxFileBytes) {
    return fail('TOO_LARGE', `入力が上限（${IMPORT_LIMITS.maxFileBytes / 1024 / 1024}MiB）を超えています。`, '必要なレスポンスだけを取り込んでください。');
  }
  let text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  text = text.trim();
  if (text.length === 0) return fail('EMPTY_INPUT', '入力が空です。', 'コピーしたレスポンス本文を貼り付けてください。');
  let wrapped = false;
  if (text.startsWith('svdata=')) {
    text = text.slice('svdata='.length);
    wrapped = true;
  }
  if (maxNesting(text) > IMPORT_LIMITS.maxDepth) {
    return fail('TOO_DEEP', `入れ子が深すぎます（上限${IMPORT_LIMITS.maxDepth}）。`, '対応するレスポンスか確認してください。');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return fail('PARSE_ERROR', describeJsonError(e, text), 'レスポンス本文を先頭から末尾までコピーし直してください。');
  }

  let apiData: unknown = json;
  if (isObj(json) && 'api_result' in json) {
    wrapped = true;
    if (json.api_result !== 1) {
      return fail('API_ERROR', `ゲームの応答が成功ではありません（api_result=${JSON.stringify(json.api_result)}）。`, '正常に表示された画面のレスポンスを取得してください。');
    }
    if (!('api_data' in json)) return fail('UNSUPPORTED_SHAPE', '応答に api_data がありません。', '対応するレスポンスか確認してください。');
    apiData = json.api_data;
  }

  const fileKind = kindFromFileName(options.fileName);
  const detected = detectShape(apiData, wrapped);
  let kind: ImportKind;
  if (detected) {
    kind = detected.kind;
    if (options.declaredKind && options.declaredKind !== kind) {
      return fail('UNSUPPORTED_SHAPE', `指定した種類（${IMPORT_KIND_LABELS[options.declaredKind]}）と本文の形（${IMPORT_KIND_LABELS[kind]}）が一致しません。`, '種類の指定を見直してください。');
    }
    if (fileKind && fileKind !== kind) {
      return fail('UNSUPPORTED_SHAPE', `ファイル名（${IMPORT_KIND_LABELS[fileKind]}）と本文の形（${IMPORT_KIND_LABELS[kind]}）が一致しません。`, '別のファイルを選んでいないか確認してください。');
    }
  } else {
    const hinted = options.declaredKind ?? null;
    if (!hinted) {
      if (Array.isArray(apiData) && apiData.length === 0) {
        return fail('AMBIGUOUS_SCOPE', '空の一覧のため、装備・資材・アイテムのどれか判定できません。', '取り込む種類を指定してください。指定がないまま0件として反映することはしません。');
      }
      if (apiData === null) return fail('AMBIGUOUS_SCOPE', 'api_data が null のため種類を判定できません。', '取り込む種類を指定してください。');
      return fail('UNSUPPORTED_SHAPE', '対応していないデータ形式です。', '装備一覧・母港・資材・アイテム・装備の簡易配列（id/lv）に対応しています。取り込み手順を確認してください。');
    }
    kind = hinted;
    if (fileKind && fileKind !== kind) {
      return fail('UNSUPPORTED_SHAPE', `ファイル名（${IMPORT_KIND_LABELS[fileKind]}）と指定した種類が一致しません。`, '別のファイルを選んでいないか確認してください。');
    }
    if (!(Array.isArray(apiData) && apiData.length === 0) && !(apiData === null && kind === 'useItem')) {
      return fail('UNSUPPORTED_SHAPE', `本文の形が${IMPORT_KIND_LABELS[kind]}と一致しません。`, '種類の指定を見直してください。');
    }
  }

  try {
    const { updates, warnings, noUpdateReason } = buildUpdates(kind, apiData);
    for (const u of updates) {
      if (u.scope === 'equipment' && u.buckets.length === 0) warnings.push({ code: 'EMPTY_EQUIPMENT', message: '装備が0件の入力です。反映すると保存済みの装備がすべて0件に置き換わります。' });
      if (u.scope === 'ships' && u.ships.length === 0) warnings.push({ code: 'EMPTY_SHIPS', message: '艦娘が0件の入力です。反映すると保存済みの艦娘がすべて0件に置き換わります。' });
    }
    return {
      ok: true,
      value: {
        kind,
        label: IMPORT_KIND_LABELS[kind],
        updates,
        warnings,
        noUpdateReason,
        inputHash: quickHash(text),
        sourceName: options.fileName ?? null,
        byteLength,
      },
    };
  } catch (e) {
    if (e instanceof InputError) return fail(e.code, e.message, e.hint, e.fieldPath);
    throw e;
  }
}
