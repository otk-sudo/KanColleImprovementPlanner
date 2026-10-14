import { parseImportText, type ParseOptions } from './parse';

// 大きな入力の解析で画面を止めないため、Web Worker で解析する。入力は実行せず JSON として読むだけ。
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; text: string; options: ParseOptions }>) => void) | null; postMessage(message: unknown): void };

scope.onmessage = (e) => {
  const { id, text, options } = e.data;
  scope.postMessage({ id, result: parseImportText(text, options) });
};
