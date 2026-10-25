// effects.js — material & efek visual (VFX):
//   (a) hologram ShaderMaterial custom (scanline + fresnel + flicker) + fallback material biasa
//   (b) emissive pulse pada panel (aktif berdenyut, flash saat aktivasi, blink saat ditolak)
//   (c) spark partikel THREE.Points dengan pooling
//   (d) warning light animasi (lockdown & alarm)
import * as THREE from 'three';

/**
 * Material hologram sederhana: warna dijumlahkan ke pixel di belakangnya (AdditiveBlending),
 * transparan, dan tidak menulis depth buffer agar tidak "memotong" object di belakangnya.
 * Dipakai sebagai fallback bila shader custom bermasalah.
 */
export function createHologramBasicMaterial(color = 0x2ee6ff, opacity = 0.55) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ====================================================================
// (a) HOLOGRAM SHADER
// ====================================================================
const hologramVertexShader = /* glsl */ `
  varying vec3 vNormalView;   // normal di view space (relatif kamera)
  varying vec3 vPositionView; // posisi di view space
  varying float vWorldY;      // tinggi world -> scanline tetap horizontal walau model berputar

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * worldPosition;
    vNormalView = normalize(normalMatrix * normal);
    vPositionView = viewPosition.xyz;
    vWorldY = worldPosition.y;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const hologramFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;      // kecerahan keseluruhan (dikendalikan level NETWORK & hover)
  uniform float uFlicker;      // 0 = stabil, 1 = berkedip kuat (sinyal lemah)
  uniform float uScanDensity;  // jumlah garis scanline per meter
  uniform float uFresnelPower;

  varying vec3 vNormalView;
  varying vec3 vPositionView;
  varying float vWorldY;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3 normal = normalize(vNormalView);
    if (!gl_FrontFacing) normal = -normal; // material DoubleSide: balik normal sisi belakang
    vec3 viewDir = normalize(-vPositionView);

    // Fresnel: tepi object (normal tegak lurus arah pandang) lebih terang dari bagian tengah.
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), uFresnelPower);

    // Scanline: garis horizontal bergerak ke atas + satu pita terang yang menyapu.
    float lines = 0.55 + 0.45 * step(0.5, fract(vWorldY * uScanDensity - uTime * 0.8));
    float sweep = smoothstep(0.9, 1.0, fract(vWorldY * 0.5 - uTime * 0.35));

    // Flicker: nilai acak yang berganti ~20x per detik.
    float noise = hash(floor(uTime * 20.0));
    float flicker = mix(1.0, 0.35 + 0.65 * noise, uFlicker);

    float alpha = ((0.12 + 0.88 * fresnel) * lines + 0.6 * sweep) * flicker * uOpacity;
    gl_FragColor = vec4(uColor * (1.0 + sweep), alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHologramMaterial(color = 0x2ee6ff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uFlicker: { value: 0 },
      uScanDensity: { value: 28 },
      uFresnelPower: { value: 2.2 },
    },
    vertexShader: hologramVertexShader,
    fragmentShader: hologramFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Beam proyektor: kerucut cahaya yang memudar ke atas (pakai koordinat uv.y silinder).
const beamFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float fade = pow(1.0 - vUv.y, 1.6);                         // terang di bawah, hilang di atas
    float streak = 0.75 + 0.25 * sin(vUv.x * 60.0 + uTime * 2.0); // garis vertikal halus
    gl_FragColor = vec4(uColor, fade * streak * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createBeamMaterial(color = 0x2ee6ff) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: 0.2 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: beamFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Mengelola tampilan hologram: memasang shader ke model & beam, meng-update uniform tiap frame,
 * dan bisa beralih ke material additive biasa (fallback) bila shader gagal di-compile.
 */
export function createHologramEffect(hologram) {
  const shader = createHologramMaterial();
  const beamShader = createBeamMaterial();
  const basic = hologram.materials.model; // material fallback dari room.js
  const basicBeam = hologram.materials.beam;
  let fallback = false;

  const setModelMaterial = (material) => {
    hologram.model.traverse((child) => {
      if (child.isMesh) child.material = material;
    });
  };
  setModelMaterial(shader);
  hologram.beam.material = beamShader;

  return {
    get isFallback() {
      return fallback;
    },
    /** Dipakai bila shader error: kembali ke MeshBasicMaterial additive. */
    useFallback() {
      if (fallback) return;
      fallback = true;
      setModelMaterial(basic);
      hologram.beam.material = basicBeam;
      shader.dispose();
      beamShader.dispose();
    },
    /**
     * @param {number} time detik
     * @param {{signal:number, hover:number, focus:number}} p signal = level NETWORK (0..1)
     */
    update(time, { signal, hover, focus }) {
      const brightness = 0.35 + 0.65 * signal + 0.3 * hover + 0.2 * focus;
      if (fallback) {
        const flicker = signal > 0.98 ? 1 : 0.6 + 0.4 * Math.sin(time * 23) * Math.sin(time * 7.3);
        basic.opacity = 0.32 * brightness * flicker;
        basicBeam.opacity = 0.03 + 0.06 * signal;
        return;
      }
      shader.uniforms.uTime.value = time;
      shader.uniforms.uOpacity.value = brightness;
      shader.uniforms.uFlicker.value = 1 - signal; // sinyal lemah = berkedip kuat
      beamShader.uniforms.uTime.value = time;
      beamShader.uniforms.uOpacity.value = 0.06 + 0.16 * signal;
    },
  };
}

// ====================================================================
// (b) EMISSIVE PULSE PANEL
// ====================================================================
/**
 * Menghitung intensitas emissive panel setiap frame.
 * - standby : tombol redup, indicator merah redup
 * - active  : tombol & indicator berdenyut (sinus) — "sistem hidup"
 * - denied  : indicator berkedip cepat
 * - flash   : lonjakan cahaya sesaat setelah aktivasi (nilai 1 -> 0)
 * - hover   : highlight base & layar
 */
export function updatePanelGlow(panel, { status, hover, flash, time, phase }) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 3 + phase);
  let button = 0.6;
  let indicator = 1.0;
  if (status === 'active') {
    button = 1.1 + 0.8 * pulse;
    indicator = 1.6 + 1.4 * pulse;
  } else if (status === 'denied') {
    button = 0.25;
    indicator = Math.sin(time * 30) > 0 ? 3.5 : 0.3;
  }
  panel.button.material.emissiveIntensity = button + 3 * flash;
  panel.indicator.material.emissiveIntensity = indicator;
  panel.base.material.emissiveIntensity = 0.18 * hover + 0.7 * flash + (status === 'active' ? 0.05 * pulse : 0);
  panel.screen.material.emissiveIntensity = 1.3 + 0.6 * hover + 0.8 * flash;
}

// ====================================================================
// (c) SPARK PARTICLES — THREE.Points + object pooling
// ====================================================================
function createSparkTexture() {
  // Titik bulat lembut (radial gradient) agar partikel tidak tampak kotak.
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Sistem partikel percikan. Semua partikel (maks `maxParticles`) dibuat SEKALI di awal (pool);
 * burst() hanya "menghidupkan" slot berikutnya secara bergiliran (ring buffer), tanpa membuat
 * object/geometry baru -> tidak ada alokasi memori & garbage collection saat runtime.
 */
export function createSparkSystem({ maxParticles = 240 } = {}) {
  const positions = new Float32Array(maxParticles * 3);
  const colors = new Float32Array(maxParticles * 3);
  const velocities = new Float32Array(maxParticles * 3);
  const life = new Float32Array(maxParticles); // sisa umur (detik); <= 0 berarti mati
  const maxLife = new Float32Array(maxParticles);
  const baseColors = new Float32Array(maxParticles * 3);
  let cursor = 0;
  let aliveCount = 0;

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colorAttr);

  const material = new THREE.PointsMaterial({
    size: 0.07,
    map: createSparkTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending, // warna hitam = tidak terlihat -> partikel mati cukup diberi warna 0
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'SparkParticles';
  points.frustumCulled = false; // bounding sphere geometry berubah-ubah, jadi culling dimatikan

  const tmpColor = new THREE.Color();
  const tmpDir = new THREE.Vector3();

  return {
    points,

    /** Memancarkan `count` partikel dari `origin` ke arah sekitar `direction`. */
    burst(origin, color, { count = 40, direction = new THREE.Vector3(0, 1, 0), speed = 2.4, spread = 0.9 } = {}) {
      tmpColor.set(color);
      for (let n = 0; n < count; n++) {
        const i = cursor;
        cursor = (cursor + 1) % maxParticles; // slot tertua dipakai ulang
        tmpDir
          .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(2 * spread)
          .add(direction)
          .normalize()
          .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
        const k = i * 3;
        positions[k] = origin.x;
        positions[k + 1] = origin.y;
        positions[k + 2] = origin.z;
        velocities[k] = tmpDir.x;
        velocities[k + 1] = tmpDir.y;
        velocities[k + 2] = tmpDir.z;
        // Sebagian partikel diberi warna lebih putih agar percikan terlihat "panas".
        const whiten = Math.random() * 0.5;
        baseColors[k] = THREE.MathUtils.lerp(tmpColor.r, 1, whiten);
        baseColors[k + 1] = THREE.MathUtils.lerp(tmpColor.g, 1, whiten);
        baseColors[k + 2] = THREE.MathUtils.lerp(tmpColor.b, 1, whiten);
        maxLife[i] = life[i] = 0.5 + Math.random() * 0.7;
      }
      aliveCount = maxParticles; // pastikan update berjalan
    },

    update(dt) {
      if (aliveCount === 0) return; // tidak ada partikel hidup -> tidak perlu upload ke GPU
      aliveCount = 0;
      const gravity = -6.5;
      const drag = Math.exp(-1.8 * dt);
      for (let i = 0; i < maxParticles; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        const k = i * 3;
        if (life[i] <= 0) {
          colors[k] = colors[k + 1] = colors[k + 2] = 0;
          continue;
        }
        aliveCount++;
        velocities[k + 1] += gravity * dt;
        velocities[k] *= drag;
        velocities[k + 1] *= drag;
        velocities[k + 2] *= drag;
        positions[k] += velocities[k] * dt;
        positions[k + 1] += velocities[k + 1] * dt;
        positions[k + 2] += velocities[k + 2] * dt;
        if (positions[k + 1] < 0.02) {
          // memantul pelan di lantai
          positions[k + 1] = 0.02;
          velocities[k + 1] *= -0.35;
        }
        const fade = life[i] / maxLife[i]; // 1 -> 0 seiring umur
        colors[k] = baseColors[k] * fade;
        colors[k + 1] = baseColors[k + 1] * fade;
        colors[k + 2] = baseColors[k + 2] * fade;
      }
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    },

    reset() {
      life.fill(0);
      colors.fill(0);
      colorAttr.needsUpdate = true;
      aliveCount = 0;
    },
  };
}

// ====================================================================
// (d) WARNING LIGHT
// ====================================================================
/**
 * Warning light (VFX animasi): mengatur emissive lampu + PointLight merah sekaligus.
 * - lockdown (0..1): denyut lambat selama fasilitas masih lockdown (SECURITY belum aktif).
 * - alarm (boolean): kedip cepat on/off saat pemain salah urutan.
 */
export function createWarningLightEffect(material, pointLights) {
  return {
    update(time, { lockdown, alarm }) {
      let strength;
      if (alarm) {
        strength = Math.sin(time * 28) > 0 ? 1 : 0.05; // gelombang kotak ~4.5 Hz
      } else {
        const breathe = 0.5 + 0.5 * Math.sin(time * 2.2); // gelombang sinus halus
        strength = lockdown * (0.3 + 0.7 * breathe);
      }
      material.emissiveIntensity = 0.12 + 2.0 * strength;
      for (const light of pointLights) light.intensity = 12 * strength;
    },
  };
}
