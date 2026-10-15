// E2E 用のテスト入口（src/app/testHooks.ts。VITE_TEST_HOOKS=1 のときだけ存在する）
export {};

declare global {
  interface Window {
    __kaishu?: {
      restore(json: string): Promise<string>;
      state(): Promise<unknown>;
      recalc(): Promise<string>;
      failRollover(times: number): void;
    };
  }
}
