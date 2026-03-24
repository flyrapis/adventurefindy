import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { componentTagger } from 'lovable-tagger';
import path from "path";

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

// CJS/ESM interop for Babel libs
const traverse: typeof _traverse.default = ((_traverse as any).default ?? _traverse) as any;
const generate: typeof _generate.default = ((_generate as any).default ?? _generate) as any;

function cdnPrefixImages(): Plugin {
  const DEBUG = process.env.CDN_IMG_DEBUG === '1';
  let publicDir = '';
  const imageSet = new Set<string>();

  const isAbsolute = (p: string) =>
    /^(?:[a-z]+:)?\/\//i.test(p) || p.startsWith('data:') || p.startsWith('blob:');

  const normalizeRef = (p: string) => {
    let s = p.trim();
    if (isAbsolute(s)) return s;
    s = s.replace(/^(\.\/)+/, '');
    while (s.startsWith('../')) s = s.slice(3);
    if (s.startsWith('/')) s = s.slice(1);
    if (!s.startsWith('images/')) return p;
    return '/' + s;
  };

  const toCDN = (p: string, cdn: string) => {
    const n = normalizeRef(p);
    if (isAbsolute(n)) return n;
    if (!n.startsWith('/images/')) return p;
    if (!imageSet.has(n)) return p;
    const base = cdn.endsWith('/') ? cdn : cdn + '/';
    return base + n.slice(1);
  };

  const rewriteCssUrls = (code: string, cdn: string) =>
    code.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, q, p) => `url(${q}${toCDN(p, cdn)}${q})`);

  async function collectPublicImagesFrom(dir: string) {
    const imagesDir = nodePath.join(dir, 'images');
    const stack = [imagesDir];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: any[] = [];
      try {
        entries = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = nodePath.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile()) {
          const rel = nodePath.relative(dir, full).split(nodePath.sep).join('/');
          const canonical = '/' + rel;
          imageSet.add(canonical);
          imageSet.add(canonical.slice(1));
        }
      }
    }
  }

  return {
    name: 'cdn-prefix-images-existing',
    apply: 'build',
    enforce: 'pre',

    configResolved(cfg) {
      publicDir = cfg.publicDir;
    },

    async buildStart() {
      await collectPublicImagesFrom(publicDir);
    },

    transform(code, id) {
      const cdn = process.env.CDN_IMG_PREFIX;
      if (!cdn) return null;

      if (/\.(css|scss|sass|less|styl)$/i.test(id)) {
        const out = rewriteCssUrls(code, cdn);
        return out === code ? null : { code: out, map: null };
      }

      return null;
    },
  };
}

// CONFIG PRINCIPAL
export default defineConfig(({ mode }) => {
  return {
    base: './', // 🔥 ESTA ES LA LÍNEA CLAVE

    server: {
      host: "::",
      port: 8080,
    },

    plugins: [
      tailwindcss(),
      react(),
      mode === 'development' && componentTagger(),
      cdnPrefixImages(),
    ].filter(Boolean),

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "react-router-dom": path.resolve(__dirname, "./src/lib/react-router-dom-proxy.tsx"),
        "react-router-dom-original": "react-router-dom",
      },
    },

    define: {
      __ROUTE_MESSAGING_ENABLED__: JSON.stringify(
        mode === 'production'
          ? process.env.VITE_ENABLE_ROUTE_MESSAGING === 'true'
          : process.env.VITE_ENABLE_ROUTE_MESSAGING !== 'false'
      ),
    },
  }
});
