import { describe, expect, it } from 'vitest';
import { sameOriginImageBase } from './imageBase';

describe('ゲーム画像の配信元', () => {
  it('同じサイトの相対パスだけを使い、別のサイト（絶対URL・プロトコル相対URL）には装備・艦のIDを送らない', () => {
    expect(sameOriginImageBase('./local-images')).toBe('./local-images');
    expect(sameOriginImageBase('images/')).toBe('images');
    expect(sameOriginImageBase('/assets/img')).toBe('/assets/img');
    expect(sameOriginImageBase('https://cdn.example.com/img')).toBe('');
    expect(sameOriginImageBase('http://example.com')).toBe('');
    expect(sameOriginImageBase('//cdn.example.com/img')).toBe('');
    expect(sameOriginImageBase('data:image/png;base64,')).toBe('');
    expect(sameOriginImageBase('')).toBe('');
  });
});
