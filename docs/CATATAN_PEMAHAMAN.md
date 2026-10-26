# Catatan Pemahaman — Sci-Fi Control Room

Dokumen ini menjelaskan **apa saja yang dibangun** di website ini, **bagaimana cara kerjanya**, dan
**konsep grafika komputer** di baliknya. Disusun per topik agar mudah dipakai saat demo.

---

## 1. Ringkasan singkat (untuk pembuka demo)

Sci-Fi Control Room adalah aplikasi 3D interaktif berbasis browser (Three.js r186 + Vite). Pemain berada
di ruang kontrol fasilitas luar angkasa yang sedang **lockdown**, lalu harus mengaktifkan tiga sistem dengan
urutan benar, yaitu **POWER → NETWORK → SECURITY**, kemudian membuka pintu utama lewat **Final Terminal**.

Yang dibangun:
- Ruangan 3D lengkap dengan **scene graph** bertingkat: console 3 panel, pintu geser, reactor dengan ring
  berputar, proyektor hologram, robot, dan terminal.
- **3 model GLB** (robot, terminal, planet hologram), **material PBR**, **lighting + shadow**, dan
  **environment map**.
- **Interaksi** dengan Raycaster: hover, klik, dan fokus kamera.
- **State machine misi** dengan aturan urutan, hitungan kesalahan, completion, dan reset.
- **Animasi** dan **VFX**: shader hologram buatan sendiri, partikel percikan, emissive pulse, warning light.
- **HUD** lengkap, **musik latar** dan **efek suara sintetis**, serta alat ukur performa.

---

## 2. Alur aplikasi

```
Loading (progress bar)
  → Briefing "LOCKDOWN ALERT" (objective, aturan, kontrol)
  → [MULAI / Enter] → musik mulai + intro kamera meluncur ke posisi awal
  → Misi berjalan (timer aktif): explore → inspect → activate → animasi/VFX
  → 3 sistem aktif → Final Terminal READY → klik → pintu terbuka
  → Overlay MISSION COMPLETE (waktu, jumlah kesalahan, rekor)
  → [R / RESET] → semua kembali ke kondisi awal
```

Kondisi visual mengikuti cerita:

| Kondisi | Yang terlihat & terdengar |
|---|---|
| Lockdown (awal) | Ruangan redup, warning light merah berdenyut, hologram berkedip lemah, musik teredam |
| POWER aktif | Lampu ruangan menyala, reactor berputar cepat, musik menjadi jernih |
| NETWORK aktif | Hologram stabil dan terang |
| SECURITY aktif | Alarm padam, lockLight pintu berubah amber, pad terminal berdenyut hijau |
| Pintu terbuka | Daun pintu bergeser, lockLight hijau, lorong di belakang menyala |
| Urutan salah | Panel ACCESS DENIED, alarm berkedip cepat, percikan merah, buzzer, semua sistem kembali standby |

---

## 3. Struktur file & arsitektur

| File | Tugas |
|---|---|
| `index.html` | Canvas, layar loading, briefing, HUD, overlay selesai |
| `vite.config.js` | Konfigurasi Vite + plugin `asset-manifest` (daftar file di `public/`) |
| `src/main.js` | Titik masuk: membuat semua modul, menghubungkan event, menjalankan render loop |
| `src/scene.js` | Renderer, scene, kamera, OrbitControls, lights, environment, fog, debug helper, monitor performa |
| `src/room.js` | Membangun seluruh isi ruangan (lantai, dinding, console, pintu, mesin, hologram, props) + material |
| `src/assets.js` | Path asset, loader (GLB/HDR/texture), `fitModel`, model fallback prosedural |
| `src/state.js` | State machine misi (urutan, kesalahan, completion, reset), tanpa Three.js maupun DOM |
| `src/interaction.js` | Raycaster (hover & klik), membedakan klik vs drag, keyboard |
| `src/animation.js` | Mesin tween & easing, camera rig, animator yang menerjemahkan state menjadi visual |
| `src/effects.js` | Shader hologram & beam, partikel percikan, emissive pulse panel, warning light |
| `src/ui.js` + `src/style.css` | HUD, tooltip, toast, briefing, overlay, panel performa |
| `src/audio.js` | Musik latar + efek suara sintetis |

Cara modul saling berkomunikasi:

```
  mouse / keyboard
        │
  interaction.js ── Raycaster ──> target yang diklik {type, id}
        │
     main.js  (memutuskan aksi)
        │
  state.js  mission.activate() / openDoor() / reset()
        │   memancarkan event: activated · rejected · ready · locked · complete · reset · change
        ▼
  ┌─────────────┬──────────┬──────────────┬──────────┐
 animation.js   ui.js      camera rig     audio.js
 (visual 3D)    (HUD)      (fokus)        (suara)
```

Prinsip utama: **logika misi (`state.js`) terpisah dari tampilan.** State hanya menyimpan aturan dan
memberi tahu lewat event; visual, HUD, kamera, dan suara bereaksi terhadap event itu.

---

## 4. Render loop

`renderer.setAnimationLoop(fn)` memanggil `fn` setiap frame (±60 kali per detik, sinkron dengan layar).
Urutan kerja setiap frame:

1. `THREE.Timer` menghitung **delta time** (`dt`, detik sejak frame sebelumnya), dibatasi maks 0.1 s.
2. Update tween (animasi berdurasi) dan kamera.
3. **Satu raycast** untuk hover, lalu tooltip.
4. Animator memperbarui semua visual (ring, hologram, lampu, pintu, partikel, warna).
5. Audio: filter musik mengikuti level POWER.
6. `renderer.render(scene, camera)`.
7. Monitor performa membaca statistik render.

Semua gerakan dikalikan `dt` supaya kecepatannya sama di layar 30 Hz, 60 Hz, maupun 144 Hz.
`THREE.Timer` dipakai karena `THREE.Clock` sudah deprecated sejak r183.

---

## 5. Scene graph

Setiap object punya transform **lokal** (position, rotation, scale) relatif terhadap parent.
Transform **world** = matriks parent × matriks lokal, dikalikan berantai sampai ke Scene.

```
Scene
├── Camera ── AudioListener (telinga untuk suara)
├── Lights (HemiLight, KeyLight, MachineLight, HologramLight, ConsoleLight, WarningPointLight ×2)
├── SparkParticles
└── ControlRoom
    ├── Floor          FloorSurface, DoorHazardStripe
    ├── Walls          dinding, ceiling, Pillars (InstancedMesh), strip lampu, WarningLight_L/R
    ├── ConsoleGroup   ConsolePlatform, Station_SECURITY / Station_POWER / Station_NETWORK
    │                    └── Desk + <X>Panel → Base, Screen, Button, Indicator
    ├── DoorGroup      DoorFrame, leftLeaf, rightLeaf, LockLight, Corridor, FinalTerminal
    ├── MachineGroup   base, strut, core, kaca, pipa, RingPivot → RingTilt_i → Ring_i
    ├── HologramGroup  base, emitter, beam, HoloHitProxy, HoloPivot → HoloModel + HoloRing
    └── PropsGroup     Robot, ServerTerminal, Crates
```

Hierarki bisa dicetak saat `npm run dev` lewat DevTools Console: `__controlRoom.printSceneGraph()`.

Contoh manfaat parent–child:
- **Station console**: station diputar menghadap pemain; meja dan panel sebagai child ikut berputar.
  Panel lalu dimiringkan sendiri (`rotation.x = 0.5`) relatif terhadap station.
- **Pintu**: `leftLeaf` & `rightLeaf` adalah child `DoorGroup`. Membuka pintu cukup dengan menggeser
  `position.x` lokal daun pintu. Kalau DoorGroup dipindah, daun pintu tetap di tempat yang benar.
- **Ring reactor**: `RingTilt_i` menyimpan kemiringan tetap, `Ring_i` (child) berputar di sumbunya
  sendiri. Memisahkan "miring" dan "putar" ke dua node membuat rotasinya rapi.
- **Hologram**: `HoloPivot` diputar dan naik-turun; model planet dan ring ikut karena child.
- **AudioListener** ditempel ke kamera sehingga "telinga" selalu mengikuti posisi pandang.
- **Fokus kamera ke panel** memakai world transform panel (lihat bagian 9).

---

## 6. Isi ruangan

Ruangan berukuran 18 × 14 m dengan tinggi 5,5 m. Semua dibangun dari geometry Three.js, kecuali 3 model GLB.

| Bagian | Isi |
|---|---|
| Lantai & dinding | Box/plane dengan texture panel logam prosedural, 12 pilar, strip lampu cyan, lampu ceiling |
| Console | Platform melingkar + 3 station. Urutan kiri→kanan **SECURITY, POWER, NETWORK**, sengaja tidak berurutan agar pemain membaca hint |
| Panel | Base (pelat), Screen (layar CanvasTexture), Button (tombol), Indicator (lampu status) |
| Pintu | Frame, 2 daun pintu geser, lockLight, lorong di belakang pintu, Final Terminal di kanan pintu |
| Reactor | Base, rangka, core bercahaya, tabung kaca, 3 ring miring yang berputar, pipa ke ceiling |
| Proyektor hologram | Base, emitter, beam kerucut, planet hologram, ring |
| Props | Robot GLB (kiri depan), terminal GLB (kiri pintu), tumpukan crate |

**Layar panel** digambar dengan Canvas 2D (`drawScreen`) lalu dipakai sebagai texture. Saat status berubah
(STANDBY / ONLINE / ACCESS DENIED), canvas digambar ulang dan `texture.needsUpdate = true`.

---

## 7. Asset & pemuatan

### Model GLB
| Model | Sumber | Lisensi | Catatan |
|---|---|---|---|
| Robot | PixelLabs (Pixabay) | Pixabay Content License | Dioptimasi 48 MB → 2,4 MB |
| Terminal | lazarosv (Pixabay) | Pixabay Content License | Tidak diubah |
| Planet (hologram) | ScanLife / AhmetGuner3d (Sketchfab) | CC BY 4.0 | Material diganti shader hologram |

Detail credits ada di README.

### Cara memuat
- `GLTFLoader` (model), `HDRLoader` (HDR, nama baru `RGBELoader` sejak r180), `TextureLoader`.
- `THREE.LoadingManager` menghitung progres semua loader untuk progress bar.
- **Plugin `asset-manifest`** (buatan sendiri, di `vite.config.js`) memindai isi `public/` saat build/dev.
  `assets.js` hanya me-request file yang benar-benar ada, sehingga **Console tidak dipenuhi error 404**
  bila ada asset yang belum disediakan. Yang tidak ada memakai **fallback prosedural** (model dari primitive
  geometry) dan dicatat dengan satu `console.info`.
- **`fitModel()`**: model dari internet punya skala dan titik pusat sembarang. Fungsi ini menghitung
  **bounding box**, menskalakan model ke ukuran target (robot 1,25 m, terminal 2,1 m, planet 1,25 m), lalu
  memindahkan alasnya ke lantai dan memusatkannya. Model dibungkus `Group` agar penempatannya mudah.

### Optimasi robot GLB
File asli 48 MB berisi 3 texture PNG 4096×4096, yang memakan ±270 MB memori GPU.
- Memori GPU texture ≈ lebar × tinggi × 4 byte × 1,33 (mipmap). 4096² ≈ 89 MB, 1024² ≈ 5,6 MB per texture.
- Robot di layar hanya ±200–300 px, jadi texture 1024 sudah cukup.
- Memakai tool `gltf-transform`: resize ke 1024 lalu konversi ke JPEG. Hasil **2,4 MB**, geometri tidak
  berubah, validator glTF tanpa error. File asli disimpan di `assets-source/`.

---

## 8. Material, texture, dan cahaya

### Material PBR
`MeshStandardMaterial` memodelkan pantulan cahaya secara fisik:
- **metalness** (0–1): 0 = bukan logam (cat/plastik, punya warna difus), 1 = logam (warna dari pantulan).
- **roughness** (0–1): 0 = licin (pantulan tajam), 1 = kasar (pantulan buram).

| Material | metalness | roughness | Dipakai untuk |
|---|---|---|---|
| floor | 0,75 | dari roughnessMap | pelat lantai logam |
| wall | 0,55 | dari roughnessMap | panel dinding |
| metalLight | 0,95 | 0,22 | krom: ring, pipa, rangka |
| metalDark | 0,85 | 0,38 | logam gelap: mesin, frame |
| painted | 0,35 | 0,5 | meja console (logam bercat) |
| glass (`MeshPhysicalMaterial`) | 0 | 0,05 | tabung reactor + clearcoat |

### Texture prosedural
Lantai dan dinding memakai texture yang **dibuat dengan kode** (Canvas 2D), lengkap 3 jenis map:
- **Color map**: warna panel dengan variasi, sambungan gelap, baut.
- **Roughness map**: sambungan lebih kasar daripada permukaan panel, plus goresan halus.
- **Normal map**: dihitung dari *height map* (sambungan rendah, panel tinggi, baut menonjol) dengan beda
  hingga: `dx = h(x+1) − h(x−1)`, `dy = h(y+1) − h(y−1)`, `normal = normalize(−dx·s, dy·s, 1)`.
  Hasilnya bevel dan baut menangkap cahaya tanpa menambah polygon.
- Random memakai seed tetap supaya texture selalu sama setiap dibuka.
- UV box diskalakan sesuai ukuran fisik (`scaleBoxUVs`) agar texture tidak melar di dinding panjang.

### Emissive
`emissive` + `emissiveIntensity` membuat permukaan bercahaya sendiri: layar panel, tombol, indicator,
lockLight, warning light, strip lampu, core reactor, layar Final Terminal. Emissive tidak menerangi object
lain, jadi di dekatnya dipasang PointLight berwarna.

### Lighting
| Light | Fungsi |
|---|---|
| HemisphereLight | Cahaya ambient dua warna (atas kebiruan, bawah gelap) |
| DirectionalLight (KeyLight) | Cahaya utama dari atas; **satu-satunya yang cast shadow** |
| PointLight cyan ×2 | Reactor & hologram |
| PointLight biru | Di atas console |
| PointLight merah ×2 | Warning light (berdenyut/berkedip) |

PointLight memakai `decay = 2` (hukum kuadrat terbalik) dan `distance` sebagai batas pengaruh.
Intensitas cahaya berubah sesuai state: gelap saat lockdown, terang setelah POWER aktif.

### Shadow
1. Renderer menggambar scene dari sudut pandang KeyLight ke **shadow map** (texture kedalaman 2048×2048).
2. Saat render biasa, setiap pixel dibandingkan dengan shadow map: bila ada object yang lebih dekat ke
   light, pixel itu berada dalam bayangan.
- `castShadow`: robot, terminal, meja, reactor, pintu, crate. `receiveShadow`: lantai, dinding, platform.
- Shadow camera orthographic ±10 m menutupi ruangan. `bias`/`normalBias` mencegah *shadow acne*.
- `PCFShadowMap` + `radius = 3` membuat tepi bayangan lembut.

### Environment, fog, tone mapping
- **Environment map** memberi pantulan pada material logam: HDR bila ada, bila tidak `RoomEnvironment`.
  **PMREMGenerator** membuat versi ber-blur bertingkat sehingga material kasar memantul buram dan material
  licin memantul tajam. Intensitasnya ikut redup saat lockdown.
- **FogExp2** (density 0,028): kabut tipis yang memberi kesan kedalaman.
- **ACES Filmic tone mapping** memetakan nilai cahaya terang (>1) ke rentang layar. Texture warna diberi
  `SRGBColorSpace`, sedangkan normal/roughness map tetap linear karena berisi data, bukan warna.

---

## 9. Kamera

### OrbitControls (mode bebas)
Kamera mengorbit titik `target` di pusat ruangan dalam koordinat spherical. Batasnya dihitung dari ukuran
ruangan agar kamera tidak menembus dinding, lantai, atau ceiling:
- Jarak 2,5–7,5 m; sudut vertikal 60°–87°; sudut horizontal ±63°; pan dimatikan (target terkunci).
- `enableDamping`: gerakan melambat halus, sehingga `controls.update()` dipanggil tiap frame.

### Camera rig (mode sinematik)
- **Intro**: setelah klik MULAI, kamera meluncur dari sudut kiri atas ke posisi awal; timer misi dimulai
  setelah intro selesai.
- **Fokus panel**: saat panel diklik, kamera terbang ke depan panel, berhenti ±1 detik, lalu kembali.
  Posisinya dihitung dari **world transform** panel: posisi panel + normal panel × 1,7 m. Hasilnya kamera
  selalu tepat menghadap panel walau panel diputar dan dimiringkan oleh parent-nya.
- **Fokus hologram**: kamera mendekat ke hologram dan panel info muncul; klik lagi atau Esc untuk kembali.
- **Fokus pintu**: saat misi selesai, kamera menghadap pintu yang terbuka.
- Saat mode sinematik, OrbitControls dimatikan agar batas-batasnya tidak menarik kamera; pose orbit
  terakhir disimpan untuk kembali.

### Resize
Saat jendela berubah ukuran: `camera.aspect` diperbarui, `updateProjectionMatrix()`, `renderer.setSize()`.
Pixel ratio dibatasi maksimal 2.

---

## 10. Interaksi & raycasting

1. Posisi kursor diubah ke **NDC** (−1..1): `x = (clientX / lebar)·2 − 1`, `y = −(clientY / tinggi)·2 + 1`.
2. `raycaster.setFromCamera(ndc, camera)` membuat **sinar** dari kamera melewati titik kursor.
3. `raycaster.intersectObjects(meshes)` mencari mesh yang terkena, diurutkan dari yang terdekat.
4. Setiap mesh menyimpan `userData.target`, jadi ketahuan panel/objek mana yang dipilih.

Desain yang dipakai:
- Raycast **hanya** ke daftar object interaktif: 3 station panel, Final Terminal, hit-box hologram.
- `pointermove` hanya menyimpan posisi kursor; raycast hover dilakukan **sekali per frame**.
- **Hit-box hologram**: bola tak terlihat (`visible = false`) karena hologram tipis sulit diklik.
  Object tak terlihat tidak dirender tetapi tetap bisa terkena raycast.
- **Klik vs drag**: klik hanya dihitung bila kursor bergeser < 6 px dan ditekan < 500 ms, supaya memutar
  kamera tidak ikut mengaktifkan panel.
- Target yang aktif bergantung kondisi: tidak ada saat briefing/intro atau setelah selesai; saat fokus
  hologram hanya hologram yang bisa diklik.

| Aksi | Hasil |
|---|---|
| Hover panel / hologram / terminal | Highlight + tooltip nama & status, cursor pointer |
| Klik panel | Tombol tertekan, kamera fokus, aktivasi (atau ditolak) |
| Klik hologram | Fokus kamera + info status fasilitas |
| Klik Final Terminal | Buka pintu (bila READY) atau pesan terkunci |
| Keyboard | Enter (mulai), R (reset), Esc (kembali), M (suara), P (performa), H (helper) |

---

## 11. State machine misi (`state.js`)

```
            activate (urutan benar)          activate (ke-3 benar)       openDoor()
 LOCKDOWN ────────────────────────> LOCKDOWN ─────────────────> READY ───────────> COMPLETE
 (0 aktif)                          (1–2 aktif)                 (3 aktif)          (pintu terbuka)
    ▲                                   │
    └── activate (urutan salah): errors + 1, semua sistem kembali standby ──┘
 reset(): dari fase mana pun kembali ke LOCKDOWN, errors = 0, waktu diulang
```

- Urutan benar disimpan di `SEQUENCE = ['power', 'network', 'security']`.
- Sistem yang diharapkan berikutnya = `SEQUENCE[active.length]`. Bila id yang diklik berbeda → ditolak.
- Klik panel yang sudah aktif → hanya pesan "sudah aktif" (bukan kesalahan).
- Klik Final Terminal sebelum READY → pesan terkunci (bukan kesalahan).
- `snapshot()` memberi salinan data agar modul lain tidak bisa mengubah state langsung.
- Waktu dihitung dari mulai misi sampai pintu terbuka; waktu terbaik disimpan di `localStorage`.

---

## 12. Animasi

### Teknik dasar
- **Delta time**: `posisi += kecepatan × dt` → kecepatan dalam satuan per detik.
- **Tween**: progres `t = waktu berjalan / durasi` (0..1), lalu `lerp(a, b, t) = a + (b − a)·t`.
- **Easing**: membentuk kurva gerak, mis. `inOutCubic` (pelan–cepat–pelan) untuk pintu dan kamera.
- **Animator berbasis level**: setiap sistem punya nilai **level 0..1** yang bergerak halus menuju target
  dengan *exponential smoothing* `level = lerp(level, target, 1 − e^(−rate·dt))`. Semua visual dihitung
  dari level, sehingga transisi selalu mulus dan reset cukup mengembalikan target ke 0.

### Daftar animasi
| Animasi | Cara kerja |
|---|---|
| Tombol panel tertekan | `y = posisiAwal − 0,035·sin(πt)` selama 0,35 s (turun lalu naik) |
| Pintu geser | Progres 0→1 dalam 2,4 s + easing; `x = lerp(tertutup, terbuka, e)`; reset menutup kembali |
| Ring reactor | `rotation += kecepatan·dt`; kecepatan naik saat POWER aktif |
| Hologram | Berputar + naik-turun `0,06·sin(1,6t)`; jauh lebih cepat saat difokus |
| Warning light | Denyut sinus lambat saat lockdown; kedip cepat saat alarm salah urutan |
| Robot | Menoleh pelan (prosedural, karena GLB tidak punya animasi; bila ada dipakai `AnimationMixer`) |
| Kamera | Intro, fokus panel/hologram/pintu, kembali ke posisi awal saat reset |
| Lampu & warna | Intensitas cahaya, warna lockLight (merah → amber → hijau), pad terminal berdenyut |

---

## 13. VFX (efek visual)

### a. Shader hologram (`ShaderMaterial` buatan sendiri)
- **Vertex shader** (per titik): menghitung posisi layar dan mengirim normal, posisi, dan tinggi world ke
  fragment shader lewat `varying`.
- **Fragment shader** (per pixel):
  - **Fresnel** `pow(1 − |dot(N, V)|, p)`: tepi object lebih terang dari bagian tengah.
  - **Scanline**: garis horizontal bergerak, dihitung dari tinggi **world** agar tetap horizontal walau
    model berputar.
  - **Sweep**: pita terang yang menyapu ke atas.
  - **Flicker**: kedip acak; kekuatannya = 1 − level NETWORK (berkedip saat offline, stabil saat online).
- **Uniform** (`uTime`, `uOpacity`, `uFlicker`, `uColor`) diubah dari JavaScript setiap frame.
- `AdditiveBlending` (warna dijumlahkan → bercahaya), `transparent: true`, `depthWrite: false`.
- Beam proyektor memakai shader kedua yang memudar ke atas.
- **Fallback**: bila shader gagal di-compile, `renderer.debug.onShaderError` mengganti material hologram ke
  `MeshBasicMaterial` additive sehingga aplikasi tetap berjalan (sudah diuji dengan shader yang sengaja dirusak).

### b. Emissive pulse panel
Panel aktif: tombol & indicator berdenyut sinus (fase berbeda tiap panel). Saat aktivasi ada **kilatan**
yang meluruh dalam ±0,6 s. Panel yang ditolak: indicator berkedip cepat. Hover: panel sedikit lebih terang.

### c. Partikel percikan (`THREE.Points`)
- Percikan warna sistem saat aktivasi, merah saat ditolak, hijau saat pintu terbuka.
- **Pooling**: 240 partikel dibuat sekali di awal; setiap ledakan memakai slot berikutnya secara bergiliran
  (*ring buffer*). Tidak ada object baru saat berjalan → tidak ada garbage collection yang bikin patah-patah.
- Simulasi sederhana: gravitasi, hambatan udara, memantul di lantai, memudar sesuai umur.
- Texture titik bulat lembut dibuat dengan gradient Canvas.

### d. Warning light
Mengatur emissive lampu dan 2 PointLight merah sekaligus: denyut lambat selama lockdown, kedip cepat saat
alarm, padam setelah SECURITY aktif. Ditambah vignette merah di layar (CSS) saat urutan salah.

---

## 14. HUD & UI

| Elemen | Fungsi |
|---|---|
| Loading screen | Progress bar dari `LoadingManager` |
| Briefing | Cerita, objective, aturan urutan, kontrol, tombol MULAI |
| Panel misi | Objective per langkah (OFFLINE / NEXT / ONLINE, pintu LOCKED / READY / OPEN), progress bar, jumlah error, timer, hint "sistem berikutnya"; bisa diciutkan |
| Tooltip | Nama & status object yang di-hover |
| Toast | Pesan singkat: sistem aktif, akses ditolak, terminal terkunci, reset |
| Info hologram | Status semua sistem + penjelasan protokol |
| Overlay MISSION COMPLETE | Waktu, jumlah kesalahan, rekor waktu terbaik, tombol reset |
| Tombol kanan atas | SUARA (M) dan RESET (R) |
| Panel performa (P) | FPS, draw call, segitiga, memori GPU, resolusi |

HUD berupa HTML + CSS di atas canvas. Container HUD memakai `pointer-events: none` supaya klik tembus ke
scene 3D, kecuali pada tombol.

---

## 15. Audio

### Musik latar
```
<audio> mp3 (streaming) → THREE.Audio → filter lowpass → volume → AudioListener (di kamera) → speaker
```
- `THREE.AudioListener` ditempel ke kamera; `THREE.Audio` sebagai sumber suara non-posisional.
- Musik di-*streaming* (tidak di-decode seluruhnya ke memori) sehingga tidak menahan layar loading.
- **Filter lowpass** mengikuti level POWER: 600 Hz saat lockdown (teredam) sampai 18 kHz (jernih).
- Browser melarang suara sebelum ada interaksi pengguna, sehingga audio baru dimulai saat tombol MULAI
  ditekan. Tanpa warning di Console.

### Efek suara sintetis (tanpa file)
Dibuat langsung oleh kode dengan Web Audio API:
- **Oscillator** menghasilkan gelombang `sine` / `triangle` / `square` / `sawtooth`.
- **Envelope** (GainNode): volume naik cepat lalu meluruh, supaya tidak terdengar "klik".
- **Noise** putih + filter bandpass yang bergeser untuk desis hidrolik pintu.

| Kejadian | Suara |
|---|---|
| Klik panel | Klik pendek |
| Sistem aktif | Chime naik; nada dasar berbeda per sistem (POWER rendah → SECURITY tinggi) |
| Urutan salah | Buzzer 2× (dua gelombang sawtooth 110 & 116 Hz → efek bergetar) |
| 3 sistem aktif | Akor "sistem siap" |
| Terminal terkunci | Beep rendah 2× |
| Pintu terbuka | Dentum + desis hidrolik |
| Mission Complete | Fanfare singkat |
| Fokus / kembali hologram | Sapuan naik / turun |
| Reset | Blip turun |

Tombol **M** mematikan musik & efek sekaligus (diingat lewat `localStorage`). Musik dijeda saat tab
disembunyikan.

---

## 16. Performa

| Teknik | Manfaat |
|---|---|
| Hanya 1 light yang cast shadow | Setiap light ber-shadow butuh render tambahan (PointLight bahkan 6×) |
| `InstancedMesh` untuk 12 pilar | 12 draw call → 1 (satu geometry, transform berbeda per instance) |
| Pooling partikel (maks 240) | Tanpa alokasi memori saat berjalan; 1 draw call |
| Raycast terbatas, sekali per frame | Hemat CPU |
| Texture robot 4096 → 1024 | Memori GPU ±270 MB → ±17 MB |
| Pixel ratio maks 2 | Layar high-DPI tidak merender 9× pixel |
| Dynamic resolution | Bila FPS < 40 selama 3 detik, pixel ratio diturunkan ke 1 secara otomatis |
| Compile shader sebelum frame pertama | Tidak patah-patah saat mulai |

Angka saat ini (3 GLB terpasang, 1280×720): ±200 draw call dan ±187 ribu segitiga per frame (termasuk
shadow pass). Bisa dipantau langsung dengan tombol **P**.

---

## 17. Alat bantu demo

| Alat | Cara | Untuk menjelaskan |
|---|---|---|
| Panel performa | Tombol **P** | FPS, draw call, segitiga, memori GPU |
| Debug helper | Tombol **H** | Kotak frustum shadow camera (oranye), arah KeyLight, posisi PointLight |
| Scene graph | DevTools Console saat `npm run dev`: `__controlRoom.printSceneGraph()` | Hierarki parent–child |

---

## 18. Kendala teknis & solusinya

| Kendala | Solusi |
|---|---|
| Asset belum tersedia membuat error 404 di Console | Plugin `asset-manifest` + fallback prosedural |
| GLB dari internet berskala/pivot sembarang | `fitModel()` berbasis bounding box |
| GLB robot 48 MB (texture 4K) | Resize 1024 + JPEG → 2,4 MB |
| API Three.js berubah (warning deprecated) | `HDRLoader`, `THREE.Timer`, `PCFShadowMap`, `renderer.compile()` |
| Kamera menembus dinding | Batas OrbitControls dihitung dari ukuran ruangan dan diuji di posisi ekstrem |
| Drag kamera ikut terhitung klik | Batas gerak 6 px & waktu 500 ms |
| Fokus kamera dilawan batas OrbitControls | OrbitControls dimatikan saat mode sinematik |
| Hologram sulit diklik | Hit-box bola tak terlihat |
| Shader bisa gagal di GPU tertentu | Fallback otomatis lewat `onShaderError` |
| Helper shadow tertutup dinding | `depthTest = false` pada helper |
| Browser memblokir suara otomatis | Audio dimulai saat tombol MULAI ditekan |

---

## 19. Skenario demo (urutan yang disarankan)

1. **Buka halaman**: tunjukkan loading lalu briefing. Jelaskan cerita dan objective.
2. **Klik MULAI**: intro kamera, musik teredam. Jelaskan suasana lockdown (lampu redup, alarm, hologram kedip).
3. **Orbit & hover**: tunjukkan batas kamera, tooltip, highlight. Sebut Raycaster.
4. **Klik NETWORK dulu (sengaja salah)**: ACCESS DENIED, alarm, percikan merah, buzzer, ERROR = 1.
   Jelaskan state machine.
5. **POWER → NETWORK → SECURITY**: tunjukkan kamera fokus, percikan, chime, dan perubahan ruangan
   (lampu menyala, reactor cepat, hologram stabil, alarm padam).
6. **Klik hologram**: jelaskan shader (fresnel, scanline, flicker) dan info status. Esc untuk kembali.
7. **Tekan H**: jelaskan shadow map & shadow camera, lalu PBR (pantulan lantai/ring, normal map dinding).
8. **Klik Final Terminal**: pintu terbuka (parent–child), overlay MISSION COMPLETE.
9. **Tekan R**: reset. **Tekan P**: tunjukkan performa.
10. Bila ditanya scene graph: `__controlRoom.printSceneGraph()` di Console (mode dev).

---

## 20. Latihan tanya-jawab

**Scene & scene graph**
- *Apa itu scene graph?* Struktur pohon object; transform child relatif terhadap parent, dan world
  transform = matriks parent × matriks lokal.
- *Kenapa daun pintu dibuat child DoorGroup?* Animasi cukup mengubah posisi lokal x; tetap benar walau
  DoorGroup dipindah atau diputar.

**Material & cahaya**
- *Beda metalness dan roughness?* Metalness = logam atau bukan; roughness = halus/kasarnya permukaan
  (pantulan tajam atau buram).
- *Apa fungsi normal map?* Mengubah arah normal per pixel sehingga cahaya bereaksi seolah ada relief,
  tanpa menambah geometri.
- *Kenapa emissive tidak menerangi object lain?* Emissive hanya menambah warna permukaannya sendiri; untuk
  menerangi sekitar dibutuhkan light.
- *Bagaimana shadow map bekerja?* Scene digambar dari sudut light ke texture kedalaman; pixel yang lebih
  jauh dari light daripada nilai di shadow map berada dalam bayangan.
- *Kenapa hanya satu light ber-shadow?* Setiap light ber-shadow menambah render pass; satu sudah cukup.
- *Apa fungsi PMREMGenerator?* Membuat environment map ber-blur bertingkat untuk berbagai roughness.

**Interaksi & logika**
- *Bagaimana raycasting bekerja?* Kursor → NDC → sinar dari kamera → cek perpotongan dengan mesh → ambil
  yang terdekat.
- *Kenapa raycast tidak di setiap pointermove?* Event bisa terjadi berkali-kali per frame; cukup sekali per frame.
- *Bagaimana sistem tahu urutan salah?* Membandingkan id yang diklik dengan `SEQUENCE[active.length]`.
- *Kenapa state.js dipisah dari Three.js?* Logika mudah dibaca dan diuji; tampilan bisa diubah tanpa
  menyentuh aturan misi.

**Animasi & kamera**
- *Kenapa dikalikan delta time?* Agar kecepatan per detik, bukan per frame.
- *Apa itu easing?* Kurva yang mengubah progres linear menjadi gerak natural (pelan–cepat–pelan).
- *Kenapa OrbitControls dimatikan saat fokus?* Batasnya akan menarik kamera keluar dari pose fokus.

**Shader & VFX**
- *Beda vertex dan fragment shader?* Vertex per titik (posisi); fragment per pixel (warna).
- *Uniform vs varying?* Uniform: nilai dari JavaScript, sama untuk semua pixel. Varying: nilai dari vertex
  shader yang diinterpolasi ke setiap pixel.
- *Kenapa hologram `depthWrite: false`?* Object transparan tidak boleh menutupi object di belakangnya.
- *Kenapa partikel memakai pooling?* Menghindari pembuatan/penghapusan object yang memicu garbage collection.

**Performa & asset**
- *Apa itu draw call?* Perintah CPU ke GPU untuk menggambar satu mesh; terlalu banyak membebani CPU.
- *Beda InstancedMesh dan clone?* Clone = banyak draw call; InstancedMesh = satu draw call dengan transform
  berbeda per instance.
- *Kenapa texture robot diperkecil?* Memori GPU sebanding jumlah pixel texture; detail 4K tidak terlihat
  pada ukuran robot di layar.

**Audio**
- *Bagaimana efek suara dibuat tanpa file?* Oscillator dan noise dari Web Audio API, dibentuk oleh
  envelope dan filter.
- *Kenapa musik tidak langsung berbunyi saat halaman dibuka?* Kebijakan autoplay browser: suara hanya
  boleh dimulai setelah interaksi pengguna.
