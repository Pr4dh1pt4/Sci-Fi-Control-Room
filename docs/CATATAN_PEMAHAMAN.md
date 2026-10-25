# Catatan Pemahaman — Sci-Fi Control Room

Dokumen ini menjelaskan kode per milestone dan konsep grafika komputer yang dipakai.
Tujuannya agar setiap anggota bisa menjelaskan **apa** yang dikerjakan kode dan **mengapa**.

---

## Milestone 1 — Core Scene

### 1. Alur program (bootstrap)

```
index.html ──> src/main.js
                 │
                 ├─ createStage()       (scene.js)  renderer, scene, camera, controls, lights, fog
                 ├─ await loadAssets()  (assets.js) GLB / HDR / texture  ──> null bila tidak ada
                 ├─ applyEnvironment()  (scene.js)  HDR atau RoomEnvironment -> scene.environment
                 ├─ buildControlRoom()  (room.js)   seluruh isi ruangan (scene graph)
                 ├─ renderer.compile()              compile shader sebelum frame pertama
                 └─ setAnimationLoop()              render loop: timer -> controls.update -> render
```

**Render loop**: `renderer.setAnimationLoop(fn)` memanggil `fn` sekitar 60x per detik (sinkron dengan
refresh layar, seperti `requestAnimationFrame`). Setiap frame: hitung `delta` (waktu sejak frame
sebelumnya) dengan `THREE.Timer`, update kontrol kamera, lalu `renderer.render(scene, camera)`.
Animasi nantinya dikalikan `delta` agar kecepatannya sama di layar 60 Hz maupun 144 Hz.

### 2. Penjelasan per file

| File | Isi utama |
|---|---|
| `vite.config.js` | Konfigurasi Vite + plugin kecil `asset-manifest` (lihat bagian 3.11). `base: './'` agar hasil build bisa dibuka dari folder mana pun. |
| `index.html` | Container canvas `#app`, layar loading, hint kontrol. `<link rel="icon" href="data:,">` mencegah request favicon 404. |
| `src/main.js` | Bootstrap & render loop. Di mode dev menyediakan `__controlRoom.printSceneGraph()` di DevTools Console. |
| `src/scene.js` | `createStage()` membuat renderer, scene, fog, camera, OrbitControls, lights, resize handler. `applyEnvironment()` membuat environment map. `CAMERA_HOME` = posisi kamera awal. |
| `src/room.js` | `buildControlRoom()` membangun semua object. Konstanta `ROOM`, `LAYOUT`, `COLORS`, `PANEL_DEFS`. Fungsi `drawScreen()` menggambar isi layar panel (dipakai lagi di Milestone 2 saat status berubah). |
| `src/assets.js` | Path konstanta asset, `loadAssets()` (LoadingManager + GLTFLoader + HDRLoader + TextureLoader), `fitModel()` (normalisasi ukuran model), dan fallback prosedural (robot, server terminal, model hologram). |
| `src/effects.js` | Untuk sekarang: `createHologramBasicMaterial()` (material additive). Shader hologram & VFX lain menyusul di Milestone 3. |
| `src/ui.js` | Layar loading (`setLoadingProgress`, `hideLoading`, `showFatalError`). |
| `src/state.js`, `interaction.js`, `animation.js` | Masih kosong, diisi di Milestone 2–3. |

### 3. Konsep grafika komputer yang dipakai

#### 3.1 Scene, Camera, Renderer
- **Scene**: wadah semua object (mesh, light, camera). Berbentuk pohon (tree).
- **PerspectiveCamera(55°, aspect, near 0.1, far 60)**: proyeksi perspektif (object jauh tampak kecil).
  FOV 55° vertikal; `near`/`far` membatasi frustum. Rentang near–far dibuat secukupnya agar presisi depth buffer baik.
- **WebGLRenderer**: menggambar scene dari sudut pandang camera ke `<canvas>` memakai GPU (WebGL).

#### 3.2 Scene graph & transform parent–child
Setiap `Object3D` punya transform **lokal** (position, rotation, scale) relatif terhadap parent-nya.
Transform **world** = matriks parent × matriks lokal (dikalikan berantai sampai ke Scene).

Struktur scene (bisa dicek dengan `__controlRoom.printSceneGraph()`):

```
Scene
├── Camera
├── Lights (Hemi, Key/Directional, Machine/Hologram/Console/Warning PointLight)
└── ControlRoom
    ├── Floor           (FloorSurface, DoorHazardStripe)
    ├── Walls           (dinding, ceiling, pilar, strip lampu, WarningLight_L/R)
    ├── ConsoleGroup    (ConsolePlatform, Station_SECURITY/POWER/NETWORK
    │                     └── Desk + <X>Panel → Base, Screen, Button, Indicator)
    ├── DoorGroup       (DoorFrame, leftLeaf, rightLeaf, LockLight, Corridor, FinalTerminal)
    ├── MachineGroup    (base, struts, core, glass, RingPivot → RingTilt_i → Ring_i)
    ├── HologramGroup   (base, emitter, beam, HoloPivot → HoloModel + HoloRing)
    └── PropsGroup      (Robot, ServerTerminal, Crates)
```

Contoh penerapan:
- **Station console**: `Station_POWER` diputar (`rotation.y`) agar menghadap pemain. Meja dan panel
  adalah child station, jadi otomatis ikut berputar. Panel sendiri dimiringkan `rotation.x = 0.5`
  relatif terhadap station. Jadi orientasi akhir panel = rotasi station ∘ rotasi panel.
- **Pintu**: `leftLeaf` & `rightLeaf` adalah child `DoorGroup`. Untuk membuka pintu cukup mengubah
  `position.x` lokal daun pintu (nilai `userData.closedX` → `userData.openX`). Seandainya seluruh
  DoorGroup dipindah, daun pintu tetap berada di tempat yang benar.
- **Ring mesin**: `RingTilt_i` menyimpan kemiringan tetap, `Ring_i` (child-nya) nanti diputar pada
  sumbunya sendiri. Memisahkan "kemiringan" dan "putaran" ke dua node menghindari rotasi yang kacau.
- **Hologram**: `HoloPivot` nanti diputar & di-bobbing; model hologram dan ring ikut karena child.

#### 3.3 Material PBR (Physically Based Rendering)
`MeshStandardMaterial` memodelkan pantulan cahaya secara fisik dengan dua parameter utama:
- **metalness** (0–1): 0 = dielektrik (cat, plastik; ada pantulan difus berwarna), 1 = logam
  (tidak ada difus; warna berasal dari pantulan lingkungan/specular berwarna).
- **roughness** (0–1): 0 = permukaan licin (pantulan tajam seperti cermin), 1 = kasar (pantulan menyebar/buram).

Pemakaian bermakna di project ini:
| Material | metalness | roughness | Alasan |
|---|---|---|---|
| `floor` | 0.75 | dari roughnessMap | pelat logam lantai; sambungan antar pelat lebih kasar |
| `wall` | 0.55 | dari roughnessMap | panel dinding logam |
| `metalLight` (ring, pipa) | 0.95 | 0.22 | logam krom mengkilap, memantulkan environment |
| `metalDark` | 0.85 | 0.38 | logam gelap rangka/mesin |
| `painted` (meja console) | 0.35 | 0.5 | logam bercat → lebih banyak difus, bentuk mudah terbaca |
| `glass` (MeshPhysicalMaterial) | 0 | 0.05 | kaca reactor + `clearcoat` (lapisan pantul tambahan) |

`roughnessMap`: nilai roughness diambil per-pixel dari texture (channel hijau) lalu dikalikan
`material.roughness` (makanya diset 1).

#### 3.4 Emissive
`emissive` + `emissiveIntensity` membuat permukaan memancarkan warna sendiri tanpa butuh cahaya
(mis. layar panel, indicator light, lockLight, strip lampu). Emissive **tidak** menerangi object lain;
untuk itu dipasang PointLight berwarna di dekatnya. Layar panel memakai `CanvasTexture` sebagai
`emissiveMap` (warna = hitam, jadi hanya emisi texture yang terlihat).

#### 3.5 Lighting
| Light | Fungsi |
|---|---|
| `HemisphereLight` | ambient dua warna (atas kebiruan, bawah gelap) agar sisi gelap tidak hitam total |
| `DirectionalLight` (KeyLight) | cahaya utama dari atas, sinarnya sejajar; **satu-satunya yang cast shadow** |
| `PointLight` cyan | di core reactor & hologram (cahaya "dari" mesin) |
| `PointLight` merah | di dua warning light (suasana lockdown) |
| `PointLight` biru | di atas console |

PointLight memakai `decay = 2` (inverse-square law: intensitas ∝ 1/jarak²) dan `distance` sebagai
batas pengaruh agar ringan.

#### 3.6 Shadow mapping
1. Renderer menggambar scene dari sudut pandang light ke **shadow map** (texture depth 2048×2048).
2. Saat render biasa, tiap pixel dibandingkan kedalamannya dengan shadow map: bila ada object lebih
   dekat ke light → pixel berada dalam bayangan.
- `castShadow = true`: object ikut digambar ke shadow map (meja, mesin, robot, pintu, crate).
- `receiveShadow = true`: permukaan bisa menerima bayangan (lantai, dinding, platform).
- Shadow camera DirectionalLight berupa **orthographic** −10..10 m yang menutupi ruangan 18×14 m.
- `shadow.bias` / `normalBias` mencegah *shadow acne* (garis-garis bayangan pada permukaan sendiri).
- Dinding & ceiling tidak cast shadow sehingga cahaya overhead tetap masuk.

#### 3.7 Environment map (Image-Based Lighting)
Material logam butuh "sesuatu untuk dipantulkan". `scene.environment` memberi semua material PBR
cahaya & pantulan dari environment map:
- Bila `public/environments/control_room.hdr` ada → dimuat dengan **HDRLoader**.
  (`RGBELoader` di soal sudah diganti namanya menjadi `HDRLoader` sejak three r180; memakai nama lama
  memunculkan warning deprecated di Console.)
- Bila tidak ada → **RoomEnvironment** (ruangan prosedural bawaan Three.js).
- **PMREMGenerator** mengubah environment menjadi mipmap yang di-blur bertingkat: material dengan
  roughness tinggi mengambil versi yang lebih blur.
- `scene.environmentIntensity` dibuat rendah (0.3) agar suasana tetap gelap/dramatis.

#### 3.8 Fog
`FogExp2(warna, density)`: faktor fog = 1 − e^−(density × jarak)². Dengan density 0.028, dinding belakang
(±12 m) hanya ~10% tertutup fog: memberi kesan kedalaman tanpa membuat ruangan buram.

#### 3.9 Color space & tone mapping
- Texture warna (map, emissiveMap canvas) diberi `SRGBColorSpace`; normal/roughness map dibiarkan linear
  karena berisi data, bukan warna.
- Perhitungan cahaya dilakukan di ruang linear, lalu **ACESFilmic tone mapping** memetakan nilai
  terang (>1, misalnya emissive) ke rentang layar. Efek sampingnya: emissive merah yang terlalu kuat
  bergeser ke putih/salmon, jadi intensitasnya dijaga rendah (1.0–1.6).

#### 3.10 Texture prosedural & UV
- Lantai/dinding memakai texture yang digambar dengan Canvas 2D (`createPanelTextures`): color map +
  roughness map, dengan random ber-seed agar hasilnya selalu sama.
- `scaleBoxUVs()` mengalikan UV tiap sisi box dengan ukuran fisiknya, sehingga 1 tile texture = 2.75 m
  di semua dinding (tidak melar di dinding panjang). Lantai memakai cara yang sama pada PlaneGeometry.
- Bila file `public/textures/floor_*.jpg` / `wall_*.jpg` tersedia, file itulah yang dipakai.

#### 3.11 Pemuatan asset & fallback
- `THREE.LoadingManager` menghitung progres semua loader → dipakai untuk progress bar loading.
- **Masalah**: me-request file yang tidak ada menghasilkan error 404 merah di Console.
  **Solusi**: plugin `asset-manifest` di `vite.config.js` memindai `public/models`, `environments`,
  `textures`, `audio` dan menghasilkan modul `virtual:asset-manifest` (daftar file yang ada).
  `assets.js` hanya me-request file yang ada di daftar itu; sisanya memakai fallback prosedural dan
  dicatat dengan **satu** `console.info`. Saat dev, menambah/menghapus file di `public/` otomatis
  memperbarui daftar dan me-reload halaman.
- `fitModel()`: GLB dari internet punya skala & pivot sembarang. Fungsi ini menghitung **bounding box**
  (`Box3.setFromObject`), menskalakan model ke tinggi/ukuran target, lalu menggeser agar alasnya di
  y = 0 dan terpusat di XZ. Model dibungkus `Group` sehingga posisi di ruangan diatur lewat wrapper.

#### 3.12 Kamera & OrbitControls
OrbitControls memutar kamera mengelilingi `target` dalam koordinat **spherical** (jarak, sudut polar,
sudut azimuth). Batas yang dipasang:
- `minDistance 2.5` / `maxDistance 7.5`
- `minPolarAngle 1.05` (~60°) / `maxPolarAngle 1.52` (~87°): tidak menembus ceiling (5.5 m) atau lantai.
- `min/maxAzimuthAngle ±1.1`: kamera tetap di sisi depan ruangan, tidak menembus dinding.
- `enablePan = false`: target terkunci di pusat ruangan.
- `enableDamping`: gerakan melambat halus; konsekuensinya `controls.update()` wajib dipanggil tiap frame.

Batas ini sudah diuji di posisi ekstrem: kamera maksimal di x = ±6.7 (dinding di ±8.85) dan
y = 5.03 (ceiling 5.5).

**Resize**: saat jendela berubah ukuran, `camera.aspect` diperbarui lalu `updateProjectionMatrix()`
(matriks proyeksi dihitung ulang), dan `renderer.setSize()`. Pixel ratio dibatasi maksimal 2 agar
layar high-DPI tidak merender 9× pixel.

### 4. Keputusan & asumsi Milestone 1
- Urutan panel di console sengaja diacak (kiri→kanan: SECURITY, POWER, NETWORK) agar pemain harus
  membaca hint urutan. Bisa diubah lewat `slot` di `PANEL_DEFS` (room.js).
- Teks di layar dalam ruangan memakai bahasa Inggris (gaya sci-fi); HUD nanti berbahasa Indonesia.
- `THREE.Clock` sudah deprecated (r183), diganti `THREE.Timer`. `PCFSoftShadowMap` deprecated (r186),
  dipakai `PCFShadowMap`.
- Animasi (ring, hologram, pintu) & VFX shader dikerjakan di Milestone 2–3; Milestone 1 fokus scene statis.

### 5. Latihan tanya-jawab (persiapan demo)
- **Kenapa daun pintu dibuat child DoorGroup?** Agar animasi cukup mengubah posisi lokal (x) dan
  tetap benar walau DoorGroup dipindah/diputar. Transform world dihitung otomatis dari parent.
- **Beda metalness dan roughness?** Metalness = jenis material (logam vs non-logam), roughness =
  kehalusan mikro-permukaan (tajam vs buram pantulannya).
- **Kenapa hanya satu light yang cast shadow?** Tiap light ber-shadow butuh render pass tambahan ke
  shadow map; PointLight bahkan 6 pass (cube map). Satu DirectionalLight cukup untuk bayangan utama.
- **Apa fungsi PMREMGenerator?** Mem-prefilter environment map menjadi beberapa tingkat blur supaya
  pantulan material kasar terlihat buram dan material licin terlihat tajam.
- **Kenapa emissive tidak menerangi object di sekitarnya?** Emissive hanya menambah warna pada
  permukaannya sendiri; penerangan ke object lain butuh light (PointLight) atau post-processing (bloom).

---

## Milestone 2 — Core Interaction

### 1. Arsitektur: siapa bicara dengan siapa

```
  klik / hover / keyboard
          │
   interaction.js ── Raycaster ──> target {type, id}
          │
       main.js  (orkestrator: memutuskan aksi untuk tiap target)
          │
   state.js  mission.activate(id) / openDoor() / reset()
          │   memancarkan event: activated · rejected · already-active · ready · locked · complete · reset · change
          ▼
   ┌──────────────┬────────────────┬──────────────────┐
 animation.js    ui.js             camera rig (animation.js)
 (visual scene)  (HUD, toast)      (focus panel / hologram / pintu)
```

Prinsip penting: **state.js tidak tahu apa pun tentang Three.js maupun HTML.** Ia hanya menyimpan
aturan misi. Visual dan HUD *bereaksi* terhadap event. Keuntungannya: aturan misi mudah dibaca dan
diuji, dan tampilan bisa diubah tanpa menyentuh logika.

### 2. Penjelasan per file

| File | Isi utama |
|---|---|
| `src/state.js` | `createMission()`: data `active[]`, `errors`, `doorOpen`, waktu. Fungsi `activate(id)`, `openDoor()`, `reset()`, `start()`, `snapshot()`, `on(event, fn)`. Konstanta `SEQUENCE` (urutan benar) dan `PHASE` (LOCKDOWN → READY → COMPLETE). |
| `src/interaction.js` | `createInteraction()`: Raycaster, konversi kursor → NDC, membedakan klik vs drag, satu raycast hover per frame, cursor pointer, keyboard (R, Esc). |
| `src/animation.js` | Mesin **tween** (`tween`, `delay`, `cancelTween`, `updateTweens`), fungsi **easing**, **camera rig** (`playIntro`, `focus`, `release`, `goHome`), fungsi pose focus (panel/hologram/pintu), dan **animator** yang menerjemahkan state misi menjadi visual. |
| `src/effects.js` | + `createWarningLightEffect()`: denyut lambat saat lockdown, kedip cepat saat alarm. |
| `src/ui.js` | HUD: `renderMission`, `setTime`, `showTooltip`, `showToast`, `flashAlarm`, `showHoloInfo`, `showComplete`, dll. |
| `src/main.js` | Menghubungkan semua modul: event misi → animator/HUD/kamera; target interaktif; render loop. |
| `src/room.js` | + `panel.station`, hit-box hologram (`HoloHitProxy`), `drawScreen` mendukung warna status terpisah. |

### 3. State machine misi

```
            activate(urutan benar)            activate(ke-3 benar)        openDoor()
 LOCKDOWN ─────────────────────────> LOCKDOWN ───────────────────> READY ───────────> COMPLETE
 (0 aktif)                           (1-2 aktif)                   (3 aktif)          (pintu terbuka)
    ▲                                    │
    └──── activate(urutan salah): errors+1, semua sistem kembali standby ────┘
 reset(): dari fase mana pun kembali ke LOCKDOWN, errors = 0, waktu dihitung ulang
```

- Sistem berikutnya yang benar = `SEQUENCE[active.length]`. Jadi "urutan" cukup dicek dengan
  membandingkan id yang diklik dengan elemen urutan pada indeks jumlah sistem yang sudah aktif.
- Klik panel yang sudah aktif → `already-active` (bukan kesalahan).
- Final Terminal sebelum READY → `locked` (bukan kesalahan, hanya pesan).
- `snapshot()` mengembalikan salinan data, sehingga modul lain tidak bisa mengubah state secara langsung.

### 4. Raycasting (konsep inti interaksi)

1. **Koordinat kursor → NDC** (Normalized Device Coordinates):
   `x = (clientX / lebar) * 2 − 1`, `y = −(clientY / tinggi) * 2 + 1` → rentang −1..1 (y dibalik karena
   di layar y bertambah ke bawah, di NDC ke atas).
2. `raycaster.setFromCamera(ndc, camera)` membuat **sinar** dari posisi kamera melewati titik itu
   (memakai inverse projection matrix kamera).
3. `raycaster.intersectObjects(meshes)` menguji perpotongan sinar dengan segitiga mesh
   (diawali uji cepat bounding sphere). Hasil diurutkan dari yang **terdekat**.
4. Mesh menyimpan `userData.target`, sehingga dari mesh yang terkena kita tahu panel/objek mana yang dipilih.

Optimasi sesuai syarat:
- Raycast **hanya** terhadap daftar mesh interaktif (station panel, Final Terminal, hit-box hologram),
  bukan seluruh scene.
- Event `pointermove` hanya **menyimpan** posisi kursor; raycast hover dilakukan **sekali per frame** di
  render loop (event pointermove bisa terjadi berkali-kali dalam satu frame).
- **Hit-box tak terlihat**: hologram tipis & transparan sulit diklik, jadi dibuat bola `visible = false`.
  Object tak terlihat tidak dirender, tetapi Raycaster tetap mengujinya.
- **Klik vs drag**: OrbitControls juga memakai drag mouse kiri. Klik dianggap valid bila kursor bergeser
  < 6 px dan ditekan < 500 ms, agar memutar kamera tidak ikut mengaktifkan panel.

### 5. Animasi

| Animasi | Teknik |
|---|---|
| Tombol panel tertekan | tween 0.35 s, `y = restY − 0.035·sin(πt)` (turun lalu naik) |
| Daun pintu geser | progres 0→1 dengan kecepatan konstan (2.4 s), dibentuk easing `inOutCubic`, lalu `x = lerp(closedX, openX, e)`; reset menutup kembali |
| Ring reactor berputar | `rotation.y += kecepatan · dt`; kecepatan naik saat POWER aktif |
| Hologram berputar + bobbing | `rotation.y += …·dt`, `y = base + 0.06·sin(1.6t)`; jauh lebih cepat saat difokus |
| Warning light | lockdown: sinus lambat; alarm salah urutan: gelombang kotak cepat (`sin(28t) > 0`) |
| Camera focus / intro / reset | tween posisi & titik pandang dengan `lerpVectors` + easing |

**Delta time (`dt`)**: semua gerakan dikalikan `dt` (detik sejak frame sebelumnya) supaya kecepatannya
sama di 30 FPS maupun 144 FPS. `dt` dibatasi maksimal 0.1 s agar tidak "loncat" saat lag.

**Tween & easing**: tween menghitung progres `t = elapsed / duration` (0..1). Easing mengubah `t`
menjadi kurva yang lebih natural; misalnya `inOutCubic` pelan di awal, cepat di tengah, pelan di akhir.
Interpolasi linear: `lerp(a, b, t) = a + (b − a)·t`.

**Animator berbasis level**: setiap sistem punya nilai `level` 0..1 yang bergerak halus menuju
`goal` (0 atau 1) dengan *exponential smoothing*:
`level = lerp(level, goal, 1 − e^(−rate·dt))`. Rumus ini tidak bergantung frame rate. Semua visual
dihitung dari level:
- **POWER** → kecepatan ring, intensitas core & MachineLight, lampu ceiling, KeyLight, HemiLight
  (ruangan terang setelah power pulih).
- **NETWORK** → hologram dari berkedip lemah menjadi stabil, HologramLight menyala.
- **SECURITY** → warning light berhenti berdenyut (lockdown dicabut).
- **READY / OPEN** → warna lockLight & strip pintu merah → amber → hijau; pad Final Terminal berdenyut.

Reset cukup mengembalikan semua goal ke 0, dan visual kembali dengan mulus.

### 6. Camera rig

- **Mode orbit**: OrbitControls aktif dengan batas dari Milestone 1.
- **Mode cinematic**: kamera digerakkan tween. OrbitControls **dimatikan** dan `controls.update()`
  tidak dipanggil, karena batas polar/azimuth/jarak akan "menarik" kamera keluar dari pose focus.
  Kamera diarahkan dengan `camera.lookAt(target)`.
- `focus()` menyimpan pose orbit terakhir (`returnPose`); `release()` terbang kembali ke pose itu.
- **Pose focus panel** dihitung dari world transform: posisi world panel + normal panel
  (sumbu +Y lokal yang diputar dengan world quaternion panel) × 1.7 m. Hasilnya kamera tepat menghadap
  permukaan panel walaupun panel diputar & dimiringkan oleh parent-nya. Ini contoh langsung kegunaan
  scene graph.
- Intro: kamera meluncur dari sudut kiri-atas ke posisi home; timer misi mulai setelah intro selesai.

### 7. Cara uji manual Milestone 2
1. Tunggu intro selesai. HUD menampilkan "Sistem berikutnya: POWER", ruangan masih redup, alarm berdenyut.
2. Hover panel → tooltip + highlight. Hover hologram/Final Terminal → tooltip.
3. Klik **NETWORK** dulu (salah) → ACCESS DENIED di layar panel, warning light berkedip cepat, vignette
   merah, toast error, ERROR = 1.
4. Klik POWER → NETWORK → SECURITY. Setiap aktivasi: kamera fokus ke panel, tombol tertekan, layar ONLINE.
   Setelah POWER: lampu terang & ring cepat. Setelah NETWORK: hologram stabil. Setelah SECURITY: alarm padam.
5. Klik POWER lagi saat sudah aktif → toast "sudah aktif" (tidak menambah ERROR).
6. Klik hologram → kamera fokus + panel info status. Klik lagi / Esc → kembali.
7. Klik Final Terminal → kamera ke pintu, pintu terbuka, overlay MISSION COMPLETE (waktu + kesalahan).
8. Tekan R / tombol RESET → semua kembali ke kondisi awal, kamera ke home.

### 8. Keputusan & asumsi Milestone 2
- "Inspect panel" = hover tooltip (nama & status) + kamera fokus singkat ke panel saat diklik
  (otomatis kembali setelah ~1 s).
- Seluruh station (meja + panel) menjadi area klik panel, agar mudah diklik.
- HUD sudah berfungsi penuh untuk kebutuhan misi; polish visual & toggle (bloom, dsb.) di Milestone 4.
- Server rack prop dipindah ke kiri pintu (simetris dengan Final Terminal) agar tidak menumpuk dengan
  hologram dari sudut pandang awal.

### 9. Latihan tanya-jawab (Milestone 2)
- **Bagaimana sistem tahu urutannya salah?** `expected = SEQUENCE[active.length]`; jika id yang diklik
  ≠ expected → ditolak, `errors++`, `active = []`.
- **Kenapa raycast hover tidak dilakukan di event pointermove?** Event bisa terjadi berkali-kali per frame;
  cukup simpan posisi kursor lalu raycast sekali per frame.
- **Kenapa OrbitControls dimatikan saat camera focus?** Batas sudut/jarak OrbitControls dihitung terhadap
  target orbit; pose focus berada di luar batas itu sehingga kamera akan ditarik kembali.
- **Kenapa animasi dikalikan delta time?** Agar kecepatan animasi dalam satuan per-detik, bukan per-frame.
- **Apa itu NDC?** Koordinat layar ternormalisasi −1..1 yang dipakai Raycaster untuk membuat sinar dari kamera.

---

## Milestone 3 — Visual Integration

### 1. Ringkasan perubahan

| File | Perubahan |
|---|---|
| `src/effects.js` | Shader hologram & beam (`createHologramMaterial`, `createBeamMaterial`), `createHologramEffect` (pasang shader + fallback), `updatePanelGlow` (emissive pulse), `createSparkSystem` (partikel `THREE.Points` + pooling), `createWarningLightEffect`. |
| `src/animation.js` | Animator memakai VFX di atas: flash + spark saat aktivasi, spark merah saat ditolak, spark hijau saat pintu terbuka, pulse panel aktif, environment & ring ikut level POWER, idle robot (AnimationMixer bila GLB punya animasi, selain itu gerakan menoleh prosedural). |
| `src/room.js` | Texture prosedural kini juga punya **normal map** (dihitung dari height map); fallback nilai roughness bila texture user tidak punya roughness map. |
| `src/scene.js` | `shadow.radius` (bayangan lebih lembut), `updateProjectionMatrix()` shadow camera, `createDebugHelpers()` (tombol **H**). |
| `src/main.js` | `renderer.debug.onShaderError` → fallback hologram otomatis; tombol H. |

### 2. Shader hologram (ShaderMaterial custom)

Shader = program kecil yang berjalan di GPU.
- **Vertex shader**: dijalankan per vertex. Menghitung posisi layar
  (`projectionMatrix * viewMatrix * modelMatrix * position`) dan mengirim data ke fragment shader lewat
  `varying`: normal di view space, posisi di view space, dan tinggi world (`vWorldY`).
- **Fragment shader**: dijalankan per pixel. Menghitung warna & alpha:
  - **Fresnel**: `pow(1 − |dot(N, V)|, p)`. N = normal, V = arah ke kamera. Di tengah object N ≈ V
    (hasil ≈ 0), di tepi N ⟂ V (hasil ≈ 1) → tepi bercahaya seperti hologram/kaca.
  - **Scanline**: `step(0.5, fract(vWorldY * density − time * 0.8))` → garis-garis horizontal yang bergerak.
    Memakai tinggi **world** sehingga garis tetap horizontal walau model berputar.
  - **Sweep**: `smoothstep(0.9, 1.0, fract(...))` → pita terang yang menyapu ke atas.
  - **Flicker**: angka pseudo-acak `hash(floor(time * 20))` berganti 20× per detik; kekuatannya
    (`uFlicker`) = 1 − level NETWORK, jadi hologram berkedip saat jaringan offline dan stabil saat online.
- **Uniform**: variabel dari JavaScript ke shader (`uTime`, `uOpacity`, `uFlicker`, `uColor`, …) yang
  di-update setiap frame tanpa compile ulang.
- Pengaturan material: `transparent: true`, `blending: AdditiveBlending` (warna dijumlahkan → bercahaya),
  `depthWrite: false` (tidak menutupi object di belakangnya), `side: DoubleSide`.
- `#include <tonemapping_fragment>` & `#include <colorspace_fragment>`: chunk bawaan Three.js agar output
  shader custom ikut tone mapping & dikonversi ke sRGB seperti material lain.
- **Beam proyektor**: shader kedua yang memudarkan alpha berdasarkan `uv.y` silinder (terang di bawah,
  hilang di atas) + garis vertikal halus.

**Fallback**: `renderer.debug.onShaderError` dipanggil Three.js bila shader gagal di-compile. Handler kita
memanggil `hologramEffect.useFallback()` yang mengganti material ke `MeshBasicMaterial` additive (dari
Milestone 1). Sudah diuji dengan menyuntikkan shader rusak: hologram otomatis beralih ke fallback.

### 3. Emissive pulse panel
`updatePanelGlow()` dipanggil setiap frame:
- Panel **aktif**: tombol & indicator berdenyut `0.5 + 0.5·sin(3t + phase)`; `phase` berbeda tiap panel
  agar tidak berdenyut serempak.
- **Flash** aktivasi: nilai 1 → 0 dalam ~0.6 s, menambah emissive tombol, base, dan layar (kilatan).
- **Ditolak**: indicator berkedip cepat (`sin(30t) > 0`).
- **Hover**: base & layar sedikit lebih terang.

### 4. Spark particles (THREE.Points + pooling)
- `THREE.Points` menggambar setiap vertex sebagai sprite persegi; texture radial gradient membuatnya bulat lembut.
- **Pool**: 240 partikel dibuat sekali (Float32Array posisi, warna, kecepatan, umur). `burst()` memakai
  slot berikutnya secara bergiliran (*ring buffer*); bila penuh, partikel tertua dipakai ulang.
  Tidak ada object/geometry baru saat runtime → tanpa alokasi memori & garbage collection.
- Simulasi per partikel: gravitasi (`v.y += g·dt`), hambatan udara (`v *= e^(−k·dt)`), posisi
  (`p += v·dt`), memantul pelan di lantai.
- **Fade out**: warna dikalikan `life / maxLife`. Karena blending additive, warna hitam = tak terlihat,
  jadi partikel mati cukup diberi warna 0.
- `DynamicDrawUsage` + `needsUpdate = true` → buffer di-upload ulang ke GPU hanya saat ada partikel hidup.
- `frustumCulled = false` karena bounding sphere geometry tidak dihitung ulang setiap frame.

### 5. PBR: normal map prosedural
- **Normal map** menyimpan arah normal permukaan per pixel (RGB = XYZ). Shader memakai normal ini
  untuk perhitungan cahaya, sehingga permukaan datar tampak punya alur, bevel, dan baut tanpa menambah polygon.
- Cara membuatnya (`heightToNormalMap`): dari height map (sambungan rendah, panel tinggi, baut menonjol),
  kemiringan dihitung dengan beda hingga: `dx = h(x+1) − h(x−1)`, `dy = h(y+1) − h(y−1)`,
  `normal = normalize(−dx·s, dy·s, 1)`, lalu dikodekan `(n·0.5 + 0.5)·255`.
- Kombinasi material lantai/dinding sekarang: `map` (warna) + `roughnessMap` (sambungan kasar,
  panel lebih licin) + `normalMap` (bevel) + `metalness` tinggi + environment map → pantulan logam
  yang berbeda di setiap bagian panel.

### 6. Lighting & shadow
- POWER mengubah `KeyLight`, `HemiLight`, lampu ceiling, `MachineLight`, dan `scene.environmentIntensity`
  → transisi dari ruangan gelap lockdown ke ruangan terang.
- `shadow.radius = 3`: PCF mengambil beberapa sampel di sekitar texel shadow map → tepi bayangan lembut.
- `shadow.camera.updateProjectionMatrix()` wajib dipanggil setelah mengubah left/right/top/bottom.
- **Tombol H**: menampilkan frustum shadow camera (garis oranye, `depthTest = false` agar terlihat
  menembus dinding), arah KeyLight, dan posisi PointLight. Berguna untuk menjelaskan shadow saat demo.

### 7. Animasi GLB (robot)
Bila `robot.glb` punya animasi, `THREE.AnimationMixer` memutar clip bernama "idle" (atau clip pertama)
dan di-update dengan `mixer.update(dt)`. Bila tidak ada, robot menoleh pelan secara prosedural.

### 8. Performa (diukur di Milestone 3)
- ±214 draw call, ±29k segitiga, 16 program shader.
- 1 light dengan shadow; 5 PointLight tanpa shadow; maksimal 240 partikel (1 draw call).
- Raycast hanya ke target interaktif, sekali per frame.

### 9. Cara uji manual Milestone 3
1. Lihat hologram dari dekat (klik hologram): garis scanline bergerak, tepi lebih terang (fresnel),
   pita terang menyapu. Saat NETWORK offline hologram berkedip; setelah online stabil.
2. Aktifkan panel: tombol berkilat dan percikan berwarna sistem keluar; panel aktif berdenyut.
3. Salah urutan: percikan merah + indicator berkedip cepat + warning light alarm.
4. Buka pintu: percikan hijau dari lockLight.
5. Putar kamera ke dinding/lantai: bevel & baut panel menangkap cahaya (normal map).
6. Tekan **H**: helper shadow camera & light tampil; tekan lagi untuk menyembunyikan.

### 10. Latihan tanya-jawab (Milestone 3)
- **Apa beda vertex shader dan fragment shader?** Vertex: per titik sudut, menghitung posisi di layar.
  Fragment: per pixel, menghitung warna.
- **Apa itu uniform dan varying?** Uniform: nilai sama untuk semua vertex/pixel, dikirim dari JS.
  Varying: nilai dari vertex shader yang diinterpolasi ke setiap pixel.
- **Kenapa depthWrite false pada hologram?** Object transparan tidak boleh menulis depth agar object di
  belakangnya (dan bagian hologram lain) tetap tergambar.
- **Kenapa partikel memakai pooling?** Membuat & menghapus object tiap burst memicu alokasi memori dan
  garbage collection yang bisa membuat frame patah-patah.
- **Apa fungsi normal map?** Mengubah arah normal per pixel sehingga cahaya bereaksi seolah permukaan
  punya detail relief, tanpa menambah geometri.

---

## Milestone 4 — Polish

### 1. Ringkasan perubahan

| File | Perubahan |
|---|---|
| `public/models/robot.glb` | Robot GLB hasil optimasi (lihat bagian 2). File asli di `assets-source/Robot.original.glb`. |
| `index.html`, `src/ui.js`, `src/style.css` | Layar **briefing** (objective, aturan, kontrol, tombol MULAI), panel misi bisa diciutkan, panel performa, catatan rekor di overlay selesai. |
| `src/main.js` | Alur loading → briefing → intro → misi; tombol P; waktu terbaik di `localStorage`. |
| `src/scene.js` | `createPerfMonitor()` (FPS + `renderer.info` + dynamic resolution), `setPixelRatioCap()`. |
| `src/animation.js` | `rig.hold()` — kamera diam di pose awal selama briefing. |
| `src/room.js` | 12 pilar → satu `InstancedMesh`; posisi & ukuran robot disesuaikan. |
| `src/assets.js` | 18 LED server rack fallback → dua `InstancedMesh` dengan warna per-instance. |

### 2. Optimasi asset GLB (robot)
Hasil inspeksi file asli: 50k segitiga (wajar), tetapi **3 texture PNG 4096×4096** (normal, base color,
metallic-roughness) → file 48 MB dan ±270 MB memori GPU.

- Memori GPU texture ≈ lebar × tinggi × 4 byte (RGBA) × 1.33 (mipmap). 4096² → ±89 MB per texture.
  1024² → ±5.6 MB per texture. Ukuran file JPEG/PNG tidak menentukan memori GPU; texture selalu
  di-decode menjadi pixel mentah sebelum di-upload ke GPU.
- Robot tingginya 1,25 m dan di layar paling besar ±200–300 px, jadi texture 1024 sudah lebih dari cukup
  (lebih tinggi dari jumlah pixel yang tampil).
- Langkah (memakai tool `gltf-transform`, bukan dependency project):
  `gltf-transform resize --width 1024 --height 1024` lalu `gltf-transform jpeg --formats png --quality 88`.
  Hasil: **48,4 MB → 2,4 MB**, validator glTF tanpa error. Geometri tidak diubah.
- Nama file disesuaikan menjadi huruf kecil `robot.glb`: server Linux (hosting) membedakan huruf besar/kecil.
- Model tidak punya animasi, sehingga robot memakai idle prosedural (menoleh pelan).

### 3. InstancedMesh (instancing)
Setiap `Mesh` biasa = minimal satu **draw call** (perintah gambar CPU → GPU). Object identik yang banyak
(pilar, LED) lebih efisien digambar dengan `InstancedMesh`: satu geometry + satu material + daftar
**matriks transform per instance** → GPU menggambar semuanya dalam **satu draw call**.
- `setMatrixAt(i, matrix)` mengisi transform instance ke-i (dibuat dengan `Object3D` dummy:
  atur position/rotation → `updateMatrix()`).
- `setColorAt(i, color)` memberi warna berbeda per instance (dipakai LED cyan/amber).
- `computeBoundingSphere()` agar frustum culling memperhitungkan semua instance.
- Hasil: draw call 214 → 157 (termasuk shadow pass).

### 4. Monitor performa & dynamic resolution
- **FPS** = jumlah frame / waktu, dihitung tiap 0.5 s dari delta asli (bukan delta yang dibatasi 0.1 s).
- `renderer.info.render.calls` (draw call) dan `.triangles` di-reset otomatis setiap `render()`, jadi
  dibaca setelah render. `renderer.info.memory` = jumlah geometry & texture di GPU.
- **Dynamic resolution**: bila rata-rata FPS < 40 selama 3 detik dan pixel ratio > 1, batas pixel ratio
  diturunkan ke 1. Pada layar 2× ini mengurangi jumlah pixel yang dirender hingga 4×. Hanya terjadi sekali,
  dicatat dengan `console.info` dan toast.

Angka saat ini (1280×720): ±157 draw call, ±127k segitiga (robot 50k digambar 2× karena render utama +
shadow pass), 20 program shader, 19 texture.

### 5. Alur aplikasi final
```
Loading (LoadingManager) → Briefing (kamera diam: rig.hold) → [MULAI/Enter] → Intro dolly
→ Orbit + misi (timer berjalan) → Mission Complete (overlay) → [R] → kembali ke kondisi awal
```
- Selama briefing hanya tombol Enter yang aktif; klik objek dinonaktifkan sampai intro selesai.
- Waktu terbaik disimpan di `localStorage` (dibungkus try/catch karena bisa diblokir di mode privat).

### 6. Cara uji manual Milestone 4
1. Muat halaman: loading → layar briefing merah "LOCKDOWN ALERT". Tekan Enter/MULAI → intro kamera.
2. Klik tombol − di panel misi → panel menciut (progress/hint tetap tampil). Klik + untuk membuka.
3. Tekan **P** → panel performa (FPS, draw call, segitiga, dll.). Di laptop normal FPS seharusnya ±60.
4. Selesaikan misi → overlay menampilkan waktu, kesalahan, dan "Rekor waktu baru!" / waktu terbaik.
   Selesaikan sekali lagi untuk melihat perbandingan dengan rekor.
5. Lihat robot GLB di kiri depan: texture, normal map, dan bayangannya.
6. Buka DevTools → Console: hanya satu `console.info` daftar asset fallback.

### 7. Latihan tanya-jawab (Milestone 4)
- **Apa itu draw call dan kenapa perlu dikurangi?** Perintah CPU ke GPU untuk menggambar satu mesh;
  tiap draw call punya overhead CPU (ganti state, uniform). Terlalu banyak → CPU menjadi bottleneck.
- **Kenapa texture 4096 diturunkan ke 1024?** Memori GPU ∝ jumlah pixel texture (16× lebih kecil), dan
  pada ukuran robot di layar detail 4096 tidak terlihat.
- **Apa beda InstancedMesh dengan clone mesh biasa?** Clone = banyak object & draw call;
  InstancedMesh = satu object, satu draw call, transform berbeda per instance.
- **Kenapa pixel ratio dibatasi?** Pada layar high-DPI (2×–3×) jumlah pixel bisa 4–9× lipat; fragment
  shader dijalankan per pixel sehingga beban GPU naik drastis.
