import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { sameOriginImageBase } from './src/ui/imageBase';

// 本番ビルドだけに Content-Security-Policy を付ける（開発サーバーの HMR はインラインスクリプトを使うため）。
// 所持データを外部へ送らないよう connect-src は自サイトのみ。画像も自サイトだけ（装備・艦のIDを別のサイトへ送らない）。
function cspPlugin(): Plugin {
  const img = ["'self'", 'data:', 'blob:'].join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'kaishu-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

// public/local-images は画面比較用のローカル専用画像（Git対象外・配布不可）。ビルド成果物から必ず除く
function excludeLocalImages(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kaishu-exclude-local-images',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      rmSync(path.resolve(outDir, 'local-images'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const imageBase = env.VITE_IMAGE_BASE_URL ?? '';
  // 画像のパスには装備・艦のIDが入るため、別のサイトの配信元は使わない（同じサイトの相対パスだけ）
  if (imageBase.trim() !== '' && sameOriginImageBase(imageBase) === '') {
    throw new Error(`VITE_IMAGE_BASE_URL には同じサイトの相対パスを指定してください（別のサイトへ装備・艦のIDを送らないため）：${imageBase}`);
  }
  return {
    base: './',
    plugins: [react(), cspPlugin(), excludeLocalImages()],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      // PC向け・単一ページのため 1MB 未満は分割しない（gzip 約220KB）
      chunkSizeWarningLimit: 1000,
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});
