import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Folder di dalam public/ yang dipindai untuk membuat daftar asset yang tersedia.
const SCANNED_DIRS = ['models', 'environments', 'textures', 'audio'];
const VIRTUAL_ID = 'virtual:asset-manifest';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Plugin kecil buatan sendiri: membuat modul virtual `virtual:asset-manifest`
 * berisi daftar file yang benar-benar ada di public/.
 * Tujuannya: assets.js bisa tahu file GLB/HDR/texture mana yang ada SEBELUM
 * me-request-nya, sehingga Console tidak dipenuhi error 404 saat asset belum
 * disediakan (cukup pakai fallback prosedural).
 */
function assetManifest() {
  let publicDir = '';

  const scan = () =>
    SCANNED_DIRS.flatMap((dir) => {
      const abs = path.join(publicDir, dir);
      if (!fs.existsSync(abs)) return [];
      return fs
        .readdirSync(abs)
        .filter((name) => !name.startsWith('.'))
        .map((name) => `${dir}/${name}`);
    });

  return {
    name: 'asset-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(scan())};` : null;
    },
    configureServer(server) {
      // Saat dev: bila file ditambah/dihapus di public/, perbarui manifest lalu reload halaman.
      const refresh = (file) => {
        if (!path.resolve(file).startsWith(path.resolve(publicDir))) return;
        const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph;
        const mod = graph.getModuleById(RESOLVED_ID);
        if (mod) graph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

export default defineConfig({
  // Path relatif agar hasil build (dist/) bisa dibuka dari sub-folder mana pun.
  base: './',
  plugins: [assetManifest()],
  build: {
    // Bundle Three.js memang ~700 KB; batas dinaikkan agar build tidak memberi warning palsu.
    chunkSizeWarningLimit: 1000,
  },
});
