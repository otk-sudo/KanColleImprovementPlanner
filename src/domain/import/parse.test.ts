import { describe, expect, it } from 'vitest';
import { parseImportText, IMPORT_LIMITS } from './parse';

const wrap = (apiData: unknown) => `svdata=${JSON.stringify({ api_result: 1, api_result_msg: '成功', api_data: apiData })}`;

function ok(text: string, opts: Parameters<typeof parseImportText>[1] = {}) {
  const r = parseImportText(text, opts);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value;
}

function err(text: string, opts: Parameters<typeof parseImportText>[1] = {}) {
  const r = parseImportText(text, opts);
  if (r.ok) throw new Error('expected error');
  return r.error;
}

describe('簡易装備配列 [{id, lv}]', () => {
  it('同じ id/lv の行は別個体として数える（P61）', () => {
    const v = ok('[{"id":216,"lv":10},{"id":216,"lv":10},{"id":2,"lv":0}]');
    expect(v.kind).toBe('simpleEquipment');
    expect(v.updates).toEqual([
      {
        scope: 'equipment',
        granularity: 'aggregate',
        buckets: [
          { equipmentId: 2, star: 0, count: 1 },
          { equipmentId: 216, star: 10, count: 2 },
        ],
        instances: null,
      },
    ]);
  });

  it('★の範囲外・文字列の数値・負数を拒否する', () => {
    expect(err('[{"id":1,"lv":11}]').code).toBe('INVALID_QUANTITY');
    expect(err('[{"id":"1","lv":0}]').code).toBe('INVALID_QUANTITY');
    expect(err('[{"id":-1,"lv":0}]').code).toBe('INVALID_QUANTITY');
  });

  it('UTF-8 BOM を先頭だけ除く', () => {
    expect(ok('\uFEFF[{"id":1,"lv":0}]').kind).toBe('simpleEquipment');
  });
});

describe('api_get_member/slot_item', () => {
  it('個体ID・装備ID・★を読み、全件の装備として扱う', () => {
    const v = ok(wrap([
      { api_id: 10, api_slotitem_id: 2, api_locked: 0, api_level: 3 },
      { api_id: 11, api_slotitem_id: 2, api_locked: 1, api_level: 3 },
    ]));
    expect(v.kind).toBe('slotItem');
    const u = v.updates[0]!;
    expect(u.scope).toBe('equipment');
    if (u.scope !== 'equipment') throw new Error();
    expect(u.granularity).toBe('instance');
    expect(u.buckets).toEqual([{ equipmentId: 2, star: 3, count: 2 }]);
    expect(u.instances).toEqual([
      { instanceId: 10, equipmentId: 2, star: 3 },
      { instanceId: 11, equipmentId: 2, star: 3 },
    ]);
  });

  it('個体IDの重複を拒否する', () => {
    expect(err(wrap([{ api_id: 10, api_slotitem_id: 2, api_level: 0 }, { api_id: 10, api_slotitem_id: 3, api_level: 0 }])).code).toBe('DUPLICATE_ID');
  });

  it('api_level が欠けている行は不正（0 として補わない）', () => {
    expect(err(wrap([{ api_id: 10, api_slotitem_id: 2 }])).code).toBe('INVALID_QUANTITY');
  });

  it('種類を指定した空配列は「全装備0件」の置換として扱う（P57）', () => {
    const v = ok(wrap([]), { declaredKind: 'slotItem' });
    expect(v.updates).toEqual([{ scope: 'equipment', granularity: 'instance', buckets: [], instances: [] }]);
  });

  it('種類が分からない空配列は反映しない（P56）', () => {
    expect(err(wrap([])).code).toBe('AMBIGUOUS_SCOPE');
    expect(err('[]').code).toBe('AMBIGUOUS_SCOPE');
  });
});

describe('api_port/port', () => {
  const port = (over: Record<string, unknown> = {}) =>
    wrap({
      api_material: [
        { api_member_id: 99999, api_id: 1, api_value: 300 },
        { api_member_id: 99999, api_id: 8, api_value: 15 },
      ],
      api_ship: [
        { api_id: 100, api_ship_id: 434, api_lv: 90 },
        { api_id: 101, api_ship_id: 1, api_lv: 1 },
      ],
      api_basic: { api_member_id: 99999, api_nickname: '提督名' },
      ...over,
    });

  it('艦娘全件と提供された資材IDを更新する。提督情報は持ち出さない', () => {
    const v = ok(port());
    expect(v.kind).toBe('port');
    expect(v.updates).toEqual([
      { scope: 'ships', ships: [{ instanceId: 100, shipId: 434 }, { instanceId: 101, shipId: 1 }] },
      { scope: 'resource:1', value: 300 },
      { scope: 'resource:8', value: 15 },
    ]);
    expect(JSON.stringify(v)).not.toContain('提督名');
    expect(JSON.stringify(v)).not.toContain('99999');
  });

  it('api_ship が欠けた port は拒否する（P62）', () => {
    expect(err(port({ api_ship: undefined })).code).toBe('UNSUPPORTED_SHAPE');
    expect(err(port({ api_ship: null })).code).toBe('UNSUPPORTED_SHAPE');
  });

  it('空の api_ship は艦娘0件、空の api_material は資材の更新なし', () => {
    const v = ok(port({ api_ship: [], api_material: [] }));
    expect(v.updates).toEqual([{ scope: 'ships', ships: [] }]);
  });
});

describe('api_get_member/material と useitem', () => {
  it('資材は提供IDだけ更新し、順番に依存しない', () => {
    const v = ok(wrap([{ api_id: 8, api_value: 2 }, { api_id: 7, api_value: 40 }]));
    expect(v.kind).toBe('material');
    expect(v.updates).toEqual([
      { scope: 'resource:7', value: 40 },
      { scope: 'resource:8', value: 2 },
    ]);
  });

  it('資材の同一ID重複は同値でも拒否する（P60）', () => {
    expect(err(wrap([{ api_id: 8, api_value: 2 }, { api_id: 8, api_value: 2 }])).code).toBe('DUPLICATE_ID');
  });

  it('資材の空配列は「更新対象なし」（P58 の前提）', () => {
    const v = ok(wrap([]), { declaredKind: 'material' });
    expect(v.updates).toEqual([]);
    expect(v.noUpdateReason).toBe('更新対象の資材IDが含まれていません');
  });

  it('アイテムは配列にあるIDだけを更新し、明示0は既知の0（P59）', () => {
    const v = ok(wrap([{ api_id: 2, api_count: 0 }]), { declaredKind: 'useItem' });
    expect(v.updates).toEqual([{ scope: 'item:2', value: 0 }]);
    expect(v.warnings.map((w) => w.code)).toContain('USEITEM_PARTIAL');
  });

  it('アイテムの api_data が null なら反映しない', () => {
    expect(err(wrap(null), { declaredKind: 'useItem' }).code).toBe('NULL_DATA');
  });

  it('数量フィールドの欠落・null は不正', () => {
    expect(err(wrap([{ api_id: 2, api_count: null }]), { declaredKind: 'useItem' }).code).toBe('INVALID_QUANTITY');
  });
});

describe('api_get_member/require_info', () => {
  it('api_slot_item を装備全件、api_useitem を提供IDのアイテムとして読む', () => {
    const v = ok(wrap({
      api_basic: { api_member_id: 1 },
      api_slot_item: [{ api_id: 1, api_slotitem_id: 3, api_level: 0 }],
      api_useitem: [{ api_id: 4, api_count: 7 }],
      api_kdock: [],
    }));
    expect(v.kind).toBe('requireInfo');
    expect(v.updates.map((u) => u.scope)).toEqual(['equipment', 'item:4']);
  });
});

describe('ラッパー・エラー', () => {
  it('svdata= は先頭1回だけ除く', () => {
    expect(ok(wrap([{ api_id: 1, api_value: 5 }])).kind).toBe('material');
    expect(err(`svdata=svdata=${JSON.stringify({ api_result: 1, api_data: [] })}`).code).toBe('PARSE_ERROR');
  });

  it('途中で切れたJSONは位置付きの構文エラー', () => {
    const e = err('{ "api_data": [1, 2');
    expect(e.code).toBe('PARSE_ERROR');
    expect(e.message).toContain('JSONの途中で内容が切れている可能性があります');
  });

  it('api_result が 1 以外は失敗応答として拒否する', () => {
    expect(err(JSON.stringify({ api_result: 100, api_result_msg: 'エラー' })).code).toBe('API_ERROR');
  });

  it('対応していない形は理由付きで拒否する', () => {
    expect(err(wrap({ api_ship_data: [] })).code).toBe('UNSUPPORTED_SHAPE');
    expect(err('"text"').code).toBe('UNSUPPORTED_SHAPE');
  });

  it('入れ子が深すぎる入力を JSON.parse 前に拒否する', () => {
    const deep = '['.repeat(IMPORT_LIMITS.maxDepth + 1) + ']'.repeat(IMPORT_LIMITS.maxDepth + 1);
    expect(err(deep).code).toBe('TOO_DEEP');
  });

  it('api_data だけを切り出した本文は形が一意なら受け付ける', () => {
    expect(ok(JSON.stringify([{ api_id: 1, api_slotitem_id: 3, api_level: 2 }])).kind).toBe('slotItem');
    expect(ok(JSON.stringify([{ api_member_id: 1, api_id: 7, api_value: 3 }])).kind).toBe('material');
  });

  it('ファイル名は補助情報。本文と矛盾すれば拒否する', () => {
    expect(err(wrap([{ api_id: 1, api_value: 5 }]), { fileName: '20261014_S@api_get_member@slot_item.json' }).code).toBe('UNSUPPORTED_SHAPE');
  });

  it('同じ本文から同じハッシュを得る', () => {
    const a = ok('[{"id":1,"lv":0}]');
    const b = ok('[{"id":1,"lv":0}]');
    expect(a.inputHash).toBe(b.inputHash);
  });
});
