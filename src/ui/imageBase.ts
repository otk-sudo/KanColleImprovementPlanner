// ゲーム画像の配信元。画像のパスには装備・艦のIDが入る（所持や計画の一部が分かる）ため、
// 別のサイトへは要求を送らない。同じサイトの相対パス（同梱・同じ配信元）だけを使う。

/** 同じサイトの相対パスなら末尾の / を除いて返し、絶対URL・プロトコル相対URLなどは空文字（画像を使わない）にする */
export function sameOriginImageBase(raw: string): string {
  const v = raw.trim();
  if (v === '' || v.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return '';
  return v.replace(/\/$/, '');
}
