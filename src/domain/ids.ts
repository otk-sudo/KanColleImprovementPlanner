// ID の名前空間を型で分ける。装備マスターID・装備個体ID・艦娘ID・資材ID・アイテムIDを混同しない。
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 装備マスターID（api_slotitem_id / 簡易配列の id） */
export type EquipmentId = Brand<number, 'EquipmentId'>;
/** 装備の個体ID（api_get_member/slot_item の api_id） */
export type EquipmentInstanceId = Brand<number, 'EquipmentInstanceId'>;
/** 艦娘マスターID（api_ship_id） */
export type ShipId = Brand<number, 'ShipId'>;
/** 艦娘の個体ID（api_port/port api_ship[].api_id） */
export type ShipInstanceId = Brand<number, 'ShipInstanceId'>;
/** 資材ID（api_get_member/material 1〜8） */
export type ResourceId = Brand<number, 'ResourceId'>;
/** アイテムID（api_get_member/useitem） */
export type UseItemId = Brand<number, 'UseItemId'>;

export const equipmentId = (n: number) => n as EquipmentId;
export const equipmentInstanceId = (n: number) => n as EquipmentInstanceId;
export const shipId = (n: number) => n as ShipId;
export const shipInstanceId = (n: number) => n as ShipInstanceId;
export const resourceId = (n: number) => n as ResourceId;
export const useItemId = (n: number) => n as UseItemId;

/** 資材ID（api_get_member/material）の固定値 */
export const RESOURCE = {
  fuel: resourceId(1),
  ammo: resourceId(2),
  steel: resourceId(3),
  bauxite: resourceId(4),
  burner: resourceId(5),
  bucket: resourceId(6),
  devmat: resourceId(7),
  screw: resourceId(8),
} as const;

export const MAX_STAR = 10;
