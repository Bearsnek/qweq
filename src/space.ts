import * as THREE from 'three';

const starVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  attribute vec3 starColor;
  uniform float time;
  uniform float pixelRatio;
  varying vec3 vColor;

  void main() {
    float twinkle = 0.78 + 0.22 * sin(time * (0.7 + phase * 1.9) + phase * 37.0);
    vColor = starColor * twinkle;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = pow(smoothstep(0.5, 0.0, d), 1.8);
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

const STAR_TINTS = [
  new THREE.Color('#9db4ff'),
  new THREE.Color('#cad7ff'),
  new THREE.Color('#f8f7ff'),
  new THREE.Color('#fff4ea'),
  new THREE.Color('#ffd2a1'),
];

export function createStars(count = 9000, radius = 600) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  // A fraction of the stars is squeezed towards a tilted plane to hint at the Milky Way band.
  const galacticNormal = new THREE.Vector3(0.35, 0.85, -0.4).normalize();
  const dir = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    dir.randomDirection();
    if (Math.random() < 0.4) {
      const h = dir.dot(galacticNormal);
      dir.addScaledVector(galacticNormal, -h * 0.85).normalize();
    }
    dir.multiplyScalar(radius * (0.9 + Math.random() * 0.1)).toArray(positions, i * 3);

    const brightness = Math.random() ** 5;
    sizes[i] = 0.7 + brightness * 3.4;
    phases[i] = Math.random();

    const tint = STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)];
    const intensity = 0.25 + brightness * 1.4 + Math.random() * 0.25;
    colors[i * 3] = tint.r * intensity;
    colors[i * 3 + 1] = tint.g * intensity;
    colors[i * 3 + 2] = tint.b * intensity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { time: { value: 0 }, pixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    update(time: number, pixelRatio: number) {
      material.uniforms.time.value = time;
      material.uniforms.pixelRatio.value = pixelRatio;
    },
  };
}

function glowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.06, 'rgba(255,250,235,0.95)');
  g.addColorStop(0.16, 'rgba(255,214,150,0.35)');
  g.addColorStop(0.45, 'rgba(255,170,90,0.07)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Billboard glow far away in the Sun's direction; hidden by the planet's depth when behind it. */
export function createSun(distance = 300) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(2.2, 2.0, 1.8),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.scale.setScalar(110);

  return {
    sprite,
    setDirection(direction: THREE.Vector3) {
      sprite.position.copy(direction).multiplyScalar(distance);
    },
  };
}
