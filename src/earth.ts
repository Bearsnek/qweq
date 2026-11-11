import * as THREE from 'three';

export const ATMOSPHERE_SCALE = 1.04;
const CLOUD_SCALE = 1.005;

export interface EarthTextures {
  day: THREE.Texture;
  night: THREE.Texture;
  /** R = elevation, G = land mask (ocean is 0), B = clouds. */
  bumpRoughnessClouds: THREE.Texture;
}

export interface Earth {
  group: THREE.Group;
  /** World-space direction towards the Sun. */
  sunDirection: THREE.Vector3;
  /** Horizontal drift of the cloud layer in UV units. */
  setCloudShift(value: number): void;
}

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vEastW;
  varying vec3 vNorthW;
  varying vec3 vPositionW;

  void main() {
    vUv = uv;
    vec3 n = normalize(position);
    // Analytic tangent frame of the sphere: +U is east, +V is north.
    vec3 east = vec3(n.z, 0.0, -n.x);
    float len = length(east);
    east = len > 1e-5 ? east / len : vec3(1.0, 0.0, 0.0);
    vec3 north = cross(n, east);

    mat3 m = mat3(modelMatrix);
    vNormalW = normalize(m * n);
    vEastW = normalize(m * east);
    vNorthW = normalize(m * north);

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D brcMap;
  uniform vec3 sunDirection;
  uniform vec3 atmosphereDayColor;
  uniform vec3 atmosphereTwilightColor;
  uniform vec2 texelSize;
  uniform float cloudShift;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vEastW;
  varying vec3 vNorthW;
  varying vec3 vPositionW;

  float elevation(vec2 uv) { return texture2D(brcMap, uv).r; }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 E = normalize(vEastW);
    vec3 T = normalize(vNorthW);
    vec3 L = normalize(sunDirection);
    vec3 V = normalize(cameraPosition - vPositionW);

    // Relief from the elevation channel.
    vec2 du = vec2(texelSize.x, 0.0);
    vec2 dv = vec2(0.0, texelSize.y);
    float hx = elevation(vUv + du) - elevation(vUv - du);
    float hy = elevation(vUv + dv) - elevation(vUv - dv);
    vec3 Nb = normalize(N - 0.9 * (hx * E + hy * T));

    vec4 brc = texture2D(brcMap, vUv);
    float ocean = 1.0 - smoothstep(0.05, 0.5, brc.g);

    float sunOrientation = dot(N, L);
    float daylight = smoothstep(-0.06, 0.12, sunOrientation);

    // Clouds float above the ground, so their shadow is offset away from the Sun.
    vec2 toSun = vec2(dot(L, E), dot(L, T));
    float shadow = smoothstep(0.2, 0.9, texture2D(brcMap, vUv + toSun * 0.0016 - vec2(cloudShift, 0.0)).b);

    vec3 dayAlbedo = texture2D(dayMap, vUv).rgb;
    // Slightly deepen the oceans so they read as water rather than flat blue paint.
    dayAlbedo = mix(dayAlbedo, dayAlbedo * vec3(0.55, 0.75, 1.0), ocean * 0.6);

    vec3 sunColor = mix(vec3(1.0, 0.55, 0.32), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, sunOrientation));
    float diffuse = max(dot(Nb, L), 0.0);
    vec3 color = dayAlbedo * sunColor * diffuse * 1.75 * (1.0 - 0.55 * shadow);

    // Sun glint on water: tight core plus a broad sheen.
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float glint = pow(nh, 320.0) * 1.3 + pow(nh, 32.0) * 0.07;
    color += ocean * glint * (0.6 + fresnel) * sunColor * smoothstep(0.0, 0.2, sunOrientation) * (1.0 - shadow);

    // City lights: strip the dim blue base of the night map and keep the warm lights.
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 lights = max(night - vec3(0.004, 0.004, 0.012), 0.0) * vec3(1.6, 1.25, 0.85) * 3.2;
    float nightSide = 1.0 - smoothstep(-0.14, 0.04, sunOrientation);
    color += (lights * (1.0 - 0.7 * shadow) + night * 0.35) * nightSide;

    // Atmospheric scattering seen through the air column, strongest towards the limb.
    float rim = 1.0 - abs(dot(V, N));
    vec3 atmosphereColor = mix(atmosphereTwilightColor, atmosphereDayColor, smoothstep(-0.25, 0.75, sunOrientation));
    float atmosphereMix = clamp(smoothstep(-0.35, 1.0, sunOrientation) * pow(rim, 2.2), 0.0, 1.0);
    color = mix(color, atmosphereColor * 1.4, atmosphereMix);
    color += atmosphereDayColor * 0.035 * daylight;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shellVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D brcMap;
  uniform vec3 sunDirection;
  uniform float cloudShift;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(sunDirection);
    vec3 V = normalize(cameraPosition - vPositionW);

    float density = smoothstep(0.18, 0.95, texture2D(brcMap, vUv - vec2(cloudShift, 0.0)).b);
    // Longer path through the cloud deck towards the limb.
    float rim = 1.0 - abs(dot(N, V));
    float alpha = clamp(density * (0.95 + rim * 0.4), 0.0, 1.0);

    float s = dot(N, L);
    vec3 tint = mix(vec3(1.0, 0.5, 0.28), vec3(1.0), smoothstep(-0.02, 0.3, s));
    vec3 color = tint * smoothstep(-0.1, 0.55, s) * 1.25 + vec3(0.006, 0.008, 0.016);

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 sunDirection;
  uniform vec3 atmosphereDayColor;
  uniform vec3 atmosphereTwilightColor;
  uniform float limbFresnel;

  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPositionW);
    float s = dot(N, normalize(sunDirection));

    // 1 at the planet's limb, fading to 0 at the outer edge of the shell.
    float fresnel = 1.0 - abs(dot(V, N));
    float falloff = 1.0 - clamp((fresnel - limbFresnel) / (1.0 - limbFresnel), 0.0, 1.0);
    float alpha = pow(falloff, 3.0) * smoothstep(-0.4, 0.8, s);

    vec3 color = mix(atmosphereTwilightColor, atmosphereDayColor, smoothstep(-0.25, 0.75, s));
    gl_FragColor = vec4(color * 1.6, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createEarth(textures: EarthTextures): Earth {
  const group = new THREE.Group();
  const sunDirection = new THREE.Vector3(1, 0, 0);

  const shared = {
    sunDirection: { value: sunDirection },
    atmosphereDayColor: { value: new THREE.Color('#4db2ff') },
    atmosphereTwilightColor: { value: new THREE.Color('#bc490b') },
    cloudShift: { value: 0 },
  };

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 96),
    new THREE.ShaderMaterial({
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      uniforms: {
        ...shared,
        dayMap: { value: textures.day },
        nightMap: { value: textures.night },
        brcMap: { value: textures.bumpRoughnessClouds },
        texelSize: { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
      },
    }),
  );

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(CLOUD_SCALE, 192, 96),
    new THREE.ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: cloudFragment,
      uniforms: {
        sunDirection: shared.sunDirection,
        cloudShift: shared.cloudShift,
        brcMap: { value: textures.bumpRoughnessClouds },
      },
      transparent: true,
      depthWrite: false,
    }),
  );

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(ATMOSPHERE_SCALE, 128, 64),
    new THREE.ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        sunDirection: shared.sunDirection,
        atmosphereDayColor: shared.atmosphereDayColor,
        atmosphereTwilightColor: shared.atmosphereTwilightColor,
        // |V·N| on the shell where a ray grazes the planet; independent of camera distance.
        limbFresnel: { value: 1 - Math.sqrt(1 - 1 / ATMOSPHERE_SCALE ** 2) },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  clouds.renderOrder = 1;
  atmosphere.renderOrder = 2;
  group.add(surface, clouds, atmosphere);

  return {
    group,
    sunDirection,
    setCloudShift(value) {
      shared.cloudShift.value = value;
    },
  };
}
