import { parseImportText, type ParseOptions, type ParseResult } from '../../domain/import/parse';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: ParseResult) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../../domain/import/parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: ParseResult }>) => {
      pending.get(e.data.id)?.(e.data.result);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/** 入力を Web Worker で解析する。Worker が使えない環境では同じ処理をこのスレッドで行う */
export function parseAsync(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(parseImportText(text, options));
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, text, options });
    window.setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(parseImportText(text, options));
      }
    }, 15_000);
  });
}
