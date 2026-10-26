# Sci-Fi Control Room

Project ETS Grafika Komputer.
**Interactive 3D Application** berbasis browser menggunakan **Three.js** (r186) + **Vite**, tanpa framework lain.

## Anggota

| Nama | NRP |
|---|---|
| Agil Lukman Hakim | 5025241037 |
| Pradhipta Raja Mahendra | 5025241055 |

## Deskripsi

Sebuah fasilitas luar angkasa berada dalam keadaan **lockdown**. Pemain berada di ruang kontrol futuristik berisi
console dengan tiga panel sistem, reactor dengan ring berputar, proyektor hologram, warning light merah, robot
penjaga, dan pintu utama yang terkunci. Tujuannya adalah memulihkan sistem fasilitas dengan **urutan yang benar**
lalu membuka pintu utama.

## Alur Misi

```
Explore → Inspect Panel → Activate System → Trigger Animation/VFX → Complete Sequence → Mission Complete
```

1. **Briefing**: layar awal menjelaskan situasi, objective, dan kontrol. Tekan **MULAI MISI** (Enter).
2. **Explore & Inspect**: orbit kamera; hover panel untuk melihat nama & status, atau klik hologram untuk
   melihat status fasilitas.
3. **Activate**: aktifkan sistem dengan urutan **POWER → NETWORK → SECURITY**.
   - POWER: reactor berputar cepat, lampu ruangan menyala.
   - NETWORK: hologram berhenti berkedip dan stabil.
   - SECURITY: alarm lockdown padam.
   - Urutan salah: sistem menolak (ACCESS DENIED), warning light berkedip, percikan merah, progres di-reset,
     jumlah kesalahan bertambah.
4. **Complete Sequence**: setelah ketiganya aktif, **Final Terminal** di samping pintu berubah READY.
5. **Mission Complete**: klik Final Terminal, pintu bergeser terbuka, lalu overlay menampilkan waktu
   penyelesaian, jumlah kesalahan, dan waktu terbaik.
6. **Reset**: tombol **R** / tombol RESET mengembalikan semua state, animasi, dan kamera ke kondisi awal.

## Kontrol

| Input | Aksi |
|---|---|
| Enter / tombol MULAI | Mulai misi dari layar briefing |
| Drag mouse kiri | Orbit kamera (dibatasi agar tidak menembus dinding) |
| Scroll | Zoom in/out |
| Hover panel / hologram / Final Terminal | Highlight + tooltip nama & status |
| Klik panel | Aktivasi sistem (kamera fokus singkat ke panel) |
| Klik hologram | Fokus kamera ke hologram + info status fasilitas; klik lagi untuk kembali |
| Klik Final Terminal | Membuka pintu utama (setelah 3 sistem aktif) |
| Esc | Kembali dari fokus hologram |
| R / tombol RESET | Reset misi |
| P | Panel performa (FPS, draw call, segitiga, memori GPU) |
| H | Debug helper (frustum shadow camera, arah KeyLight, posisi PointLight) |
| Tombol − / + di panel misi | Ciutkan / buka panel misi |

## Graphics Features

| Fitur | Implementasi |
|---|---|
| **Scene graph** | `Scene → ControlRoom → Floor, Walls, ConsoleGroup (Station → Desk + Panel → Base/Screen/Button/Indicator), DoorGroup (DoorFrame, leftLeaf, rightLeaf, LockLight, Corridor, FinalTerminal), MachineGroup (RingPivot → RingTilt → Ring), HologramGroup (HoloPivot → HoloModel + HoloRing), PropsGroup (Robot, ServerTerminal, Crates)`, plus `Lights` dan `Camera`. Animasi memakai transform lokal child (daun pintu, ring, hologram). |
| **Asset GLB** | Robot (`public/models/robot.glb`) via `GLTFLoader`; ukuran & posisi dinormalisasi otomatis dengan bounding box (`fitModel`). Slot GLB lain (terminal, hologram) memakai fallback prosedural bila file belum ada. |
| **PBR** | `MeshStandardMaterial` dengan metalness/roughness bermakna (lantai logam 0.75, dinding 0.55, krom 0.95/0.22, cat 0.35/0.5); color + roughness + normal map prosedural (normal map dihitung dari height map); `MeshPhysicalMaterial` + clearcoat untuk kaca reactor; material PBR bawaan GLB robot. |
| **Emissive** | Layar panel (CanvasTexture sebagai emissiveMap), tombol, indicator, lockLight, warning light, strip lampu, core reactor, Final Terminal. |
| **Lighting** | HemisphereLight, DirectionalLight (KeyLight, satu-satunya yang cast shadow), 5 PointLight berwarna (cyan reactor/hologram, biru console, merah warning). Intensitas berubah sesuai state (lockdown gelap → power pulih terang). |
| **Shadow** | PCF shadow map 2048×2048 dengan `radius` (tepi lembut); robot, meja, mesin, pintu, crate `castShadow`; lantai, dinding, platform `receiveShadow`. |
| **Environment** | HDR via `HDRLoader` (nama baru `RGBELoader` sejak r180) bila file tersedia, fallback `RoomEnvironment` + `PMREMGenerator`; `FogExp2` tipis; ACES Filmic tone mapping. |
| **Animation** | Daun pintu geser, ring reactor berputar, hologram berputar + bobbing, tombol tertekan, warning light berdenyut/berkedip, robot idle, intro camera dolly, camera focus tween (panel, hologram, pintu). Semua berbasis delta time + easing. |
| **Raycasting** | `THREE.Raycaster` untuk hover & klik pada daftar target interaktif saja (station panel, hit-box hologram tak terlihat, Final Terminal), satu raycast hover per frame; klik dibedakan dari drag orbit. |
| **VFX** | (a) Hologram `ShaderMaterial` custom: fresnel + scanline + sweep + flicker, additive, `depthWrite: false`, dengan fallback otomatis via `renderer.debug.onShaderError`; beam proyektor shader. (b) Emissive pulse & flash panel. (c) Spark particles `THREE.Points` dengan pooling (maks 240). (d) Warning light animasi (lockdown & alarm). |
| **HUD/UI** | Briefing, objective list per langkah, progress bar, hint urutan, error count, timer, tooltip, toast, info hologram, overlay MISSION COMPLETE (waktu, kesalahan, rekor), tombol reset, panel performa, loading screen (`LoadingManager`). |
| **Camera** | OrbitControls dengan damping & batas (jarak 2.5–7.5, polar 60°–87°, azimuth ±63°, pan dimatikan); camera rig untuk intro & focus; resize handler; pixel ratio maks 2 dengan penurunan otomatis ke 1 bila FPS < 40. |

## Asset Credits

Semua asset dimuat lokal dari folder `public/` (tidak ada request ke CDN saat runtime).

| Asset | File | Pembuat | Sumber (URL) | Lisensi | Modifikasi |
|---|---|---|---|---|---|
| Robot | `public/models/robot.glb` | _isi_ | _isi_ | _isi_ | Texture di-resize 4096→1024 px dan dikonversi PNG→JPEG (gltf-transform) untuk performa; geometri tidak diubah. File asli disimpan di `assets-source/` (tidak ikut repo). |
| Terminal / server rack | `public/models/terminal.glb` | lazarosv | https://pixabay.com/id/3d-models/data-terminal-futuristik-kios-3797/ | | |
| Model hologram | `public/models/hologram.glb` | ScanLife | ttps://sketchfab.com/3d-models/low-poly-planet-ac9420fefb84451eb17b34c513cfe8db | | |
| HDRI environment | `public/environments/control_room.hdr` | _belum dipakai — RoomEnvironment_ | | | |

Asset prosedural buatan sendiri (tanpa file eksternal): texture & normal map panel lantai/dinding, hazard stripe,
layar panel (Canvas 2D), texture partikel, model fallback server rack & hologram, seluruh geometri ruangan.
Font memakai font sistem (Consolas / Courier New), tidak ada file font eksternal.

## Struktur Project

```
├── index.html               # canvas + markup HUD/briefing/overlay
├── vite.config.js           # konfigurasi Vite + plugin asset-manifest
├── public/
│   ├── models/              # GLB (robot.glb)
│   ├── textures/            # texture opsional (floor_*, wall_*)
│   ├── environments/        # HDR opsional
│   └── audio/
├── assets-source/           # file asset asli sebelum dioptimasi (di-.gitignore)
├── src/
│   ├── main.js              # bootstrap, wiring modul, render loop
│   ├── scene.js             # renderer, camera, controls, lights, environment, fog, helper, monitor performa
│   ├── room.js              # floor, walls, console/panels, door, machine, hologram, props
│   ├── assets.js            # path konstanta, loader, fitModel, fallback prosedural
│   ├── state.js             # state machine misi (urutan, error, completion, reset)
│   ├── interaction.js       # raycaster, hover, click, keyboard
│   ├── animation.js         # tween, easing, camera rig, animator berbasis state
│   ├── effects.js           # shader hologram, spark particles, emissive pulse, warning light
│   ├── ui.js                # HUD, briefing, tooltip, toast, overlay, panel performa
│   └── style.css
└── docs/CATATAN_PEMAHAMAN.md  # penjelasan kode & konsep grafika per milestone
```

## Cara Menjalankan

Prasyarat: Node.js 18+ (diuji dengan Node 24).

```bash
npm install
npm run dev       # server development (http://localhost:5173)
npm run build     # build produksi ke folder dist/
npm run preview   # menjalankan hasil build
```

Menambah asset: taruh file sesuai path di `src/assets.js` (`MODEL_FILES`, `HDR_FILE`, `TEXTURE_FILES`).
Nama file **case-sensitive** (pakai huruf kecil). Bila file belum ada, project tetap berjalan dengan fallback.
GLB sebaiknya tidak dikompres Draco/Meshopt dan texture-nya maksimal 1024–2048 px.

## Challenge Teknis

- **Asset belum tersedia tanpa error 404 di Console**: plugin Vite `asset-manifest` memindai `public/` sehingga
  hanya file yang ada yang di-request; sisanya memakai fallback prosedural dengan satu `console.info`.
- **GLB terlalu berat (48 MB, texture 4096² ×3 ≈ 270 MB VRAM)**: texture di-resize ke 1024 dan dikonversi
  ke JPEG sehingga file menjadi 2,4 MB (~17 MB VRAM) tanpa perbedaan visual berarti pada ukuran robot di layar.
- **Model GLB dengan skala/pivot sembarang**: `fitModel()` menormalkan ukuran & posisi lewat bounding box.
- **API Three.js yang berubah**: `RGBELoader` → `HDRLoader`, `Clock` → `Timer`, `PCFSoftShadowMap` →
  `PCFShadowMap`, dan `compile` sinkron (bukan `compileAsync`) agar Console bebas warning.
- **Kamera menembus dinding**: batas OrbitControls dihitung dari ukuran ruangan dan diuji pada posisi ekstrem.
- **Klik vs drag**: klik hanya dihitung bila kursor bergeser < 6 px dan ditekan < 500 ms.
- **Camera focus vs batas OrbitControls**: saat tween, OrbitControls dimatikan dan pose orbit disimpan untuk kembali.
- **Hologram sulit diklik**: hit-box bola tak terlihat (`visible = false` tetap bisa di-raycast).
- **Logika vs tampilan**: state misi dipisah dari Three.js/DOM dan berkomunikasi lewat event; visual diturunkan
  dari nilai level 0..1 yang dihaluskan eksponensial, sehingga reset berjalan mulus.
- **Fallback shader**: bila shader hologram gagal di-compile, material otomatis beralih ke versi additive biasa
  (diuji dengan shader yang sengaja dirusak).
- **Performa**: 12 pilar & 18 LED memakai `InstancedMesh` (draw call 214 → 157); partikel memakai pooling;
  hanya satu light ber-shadow; raycast terbatas; dynamic resolution bila FPS rendah.
- **Helper shadow camera tidak terlihat**: frustum lebih besar dari ruangan; diselesaikan dengan `depthTest = false`.

## Pembagian Kontribusi

| Anggota | Kontribusi |
|---|---|
| _Nama Anggota 1_ | _isi (mis. scene & room, PBR/lighting/shadow, asset)_ |
| _Nama Anggota 2_ | _isi (mis. state machine, interaction, animation, VFX, HUD)_ |
