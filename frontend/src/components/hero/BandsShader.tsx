"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./BandsShader.module.css";

/*
 * The animated "Bands" background of the hero: a WebGL2 fragment shader with the
 * exact GLSL, uniforms and render setup the Framer site uses (half-resolution
 * buffer, elapsed-time driven, paused while off screen). A still image is shown
 * until the first frame has been rendered, and stays if WebGL2 is unavailable.
 */

const VERTEX = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_uv;

void main() {
    v_uv = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

#define U_COLORS_MAX 8

uniform vec4 u_colors[U_COLORS_MAX];
uniform int u_colors_length;
uniform float u_seed;
uniform float u_speed;
uniform float u_ephemeralAmp;
uniform float u_lensScale;
uniform float u_lensSpacingX;
uniform float u_lensSpacingY;
uniform float u_lensRadius;
uniform float u_dispersionStrength;
uniform float u_edgeDisp;

uniform float u_time;
uniform vec2 u_resolution;

const int SAMPLES = 8;
const float EPHEMERAL_DRIP = 1.0;

// === PCG hash - https://www.jcgt.org/published/0009/03/02/
uvec3 hash3(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}
uvec3 seed;
vec3 random3f() {
    seed = hash3(seed);
    return vec3(seed) / float(-1u);
}

vec3 seedRandom(float seedVal) {
    uvec3 s = uvec3(
        floatBitsToUint(seedVal),
        floatBitsToUint(seedVal * 1.5 + 7.31),
        floatBitsToUint(seedVal * 2.7 + 13.37)
    );
    s = hash3(s);
    return vec3(s) / float(0xFFFFFFFFu);
}

// === PALETTE SAMPLING ===
vec3 getColor(int idx) {
    if (u_colors_length < 1) return vec3(0.0);
    int safeIdx = clamp(idx, 0, u_colors_length - 1);
    return u_colors[safeIdx].rgb;
}

vec3 paletteN(float t, int count) {
    if (count < 1) return vec3(0.0);
    if (count < 2) return getColor(0);
    t = clamp(t, 0.0, 1.0) * float(count - 1);
    int idx = min(int(floor(t)), count - 2);
    float localT = fract(t);
    localT = localT * localT * (3.0 - 2.0 * localT);
    return mix(getColor(idx), getColor(idx + 1), localT);
}

// === Gradient Flow ===
float getGradientT(vec2 uv, float t, vec3 s1, vec3 s2) {
    float angle1 = s1.x * 6.28;
    float angle2 = s1.y * 6.28;
    vec2 dir1 = vec2(cos(angle1), sin(angle1));
    vec2 dir2 = vec2(cos(angle2), sin(angle2));

    float freq1 = 1.0 + s1.z * 2.0;
    float freq2 = 1.0 + s2.x * 1.5;
    float freq3 = 1.5 + s2.y * 2.0;

    float flow = dot(uv, dir1) + sin(dot(uv, dir2) * freq1 + t) * 0.3 + t * 0.2;
    float flow2 = dot(uv, dir2.yx) + cos(dot(uv, dir1.yx) * freq2 - t * 0.8) * 0.25;

    float gradT = sin(flow * 1.5) * 0.5 + 0.5;
    gradT += cos(flow2 * 1.2) * 1.3;
    gradT += sin(dot(uv, dir1 + dir2) * freq3 + t * 3.5) * 1.2;

    return smoothstep(0.0, 4.12, gradT);
}

// === BAND LENS ===
void applyBandLens(vec2 pp, float radiusSq, float iorOffset, out vec2 warpedUV, out float edgeFactor) {
    vec2 ppLens = pp;
    float spacingX = max(u_lensSpacingX, 0.001);
    float spacingY = max(u_lensSpacingY, 0.001);
    ppLens.x = fract(pp.x / spacingX + 0.5) * spacingX - spacingX * 0.5;
    ppLens.y = fract(pp.y / spacingY + 0.5) * spacingY - spacingY * 0.5;

    float sp = radiusSq - ppLens.x * ppLens.x - ppLens.y * ppLens.y;

    float lensAmount = smoothstep(-0.1, 0.05, sp);
    float baseLens = sqrt(max(sp, -sp * 0.1) / 0.3);
    edgeFactor = (1.0 - smoothstep(0.0, radiusSq, sp)) * lensAmount;

    float warpAmount = mix(1.0, baseLens * (1.0 + iorOffset), lensAmount);

    warpedUV = pp;
    warpedUV.x += (ppLens.x * warpAmount - ppLens.x);
    warpedUV.y *= warpAmount;
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    seed = uvec3(uvec2(fragCoord), uint(fract(u_time) * 1000.0));

    vec2 r = u_resolution;
    vec2 p = (fragCoord * 2.0 - r) / r.y;
    float t = u_time * u_speed;

    int colorCount = u_colors_length;

    if (colorCount < 1) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec3 seedOff1 = seedRandom(u_seed);
    vec3 seedOff2 = seedRandom(u_seed + 100.0);

    float dice = random3f().x;

    float radiusSq = u_lensRadius * u_lensRadius;
    vec3 iorOffsets = vec3(-1.0, 0.0, 1.0) * u_dispersionStrength;

    vec3 col = vec3(0.0);

    for (int i = 0; i < SAMPLES; i++) {
        float ephemeral = (float(i) + dice) / float(SAMPLES);
        float sqEph = ephemeral * ephemeral;

        vec2 pt = p;
        pt.x += u_ephemeralAmp * sqEph * sin(p.y * 2.0 + t);
        pt.y += u_ephemeralAmp * sqEph * cos(p.x * 1.5 - t) * 0.5;
        pt.y -= (1.0 - exp(-EPHEMERAL_DRIP * sqEph)) * abs(pt.y) * sign(pt.y) * 0.3;

        vec3 tint = smoothstep(1.0, 0.0, abs(3.0 * ephemeral - vec3(1.0, 1.5, 2.0)));

        vec3 gradTs = vec3(0.0);
        vec3 edgeFactors = vec3(0.0);

        for (int c = 0; c < 3; c++) {
            vec2 pp = pt * u_lensScale;
            vec2 warpedUV;
            float edgeFactor;
            applyBandLens(pp, radiusSq, iorOffsets[c], warpedUV, edgeFactor);

            vec2 gradUV = warpedUV / u_lensScale;
            gradTs[c] = getGradientT(gradUV, t * 0.8, seedOff1, seedOff2);
            edgeFactors[c] = edgeFactor;
        }

        vec3 convergentColor = paletteN(gradTs.g, colorCount);
        float edgeMix = max(max(edgeFactors.r, edgeFactors.g), edgeFactors.b);

        vec3 dispersedColor = vec3(
            paletteN(gradTs.r, colorCount).r,
            convergentColor.g,
            paletteN(gradTs.b, colorCount).b
        );

        vec3 finalColor = mix(convergentColor, dispersedColor, edgeMix * 2.0);

        vec3 rainbow = (gradTs - gradTs.g) * 3.0;
        finalColor += rainbow * edgeMix * u_edgeDisp;

        col += tint * finalColor * (3.0 / float(SAMPLES));
    }

    fragColor = vec4(col, 1.0);
}
`;

// Shader settings of the hero instance.
const uniforms = {
  u_colors: [
    [0, 1, 136 / 255, 1], // Accent #00ff88
    [17 / 255, 17 / 255, 17 / 255, 1], // Surface #111111
    [8 / 255, 8 / 255, 8 / 255, 1], // Base #080808
  ],
  u_seed: 210,
  u_speed: 0.3,
  u_ephemeralAmp: 0,
  u_lensScale: 3.7,
  u_lensSpacingX: 1,
  u_lensSpacingY: 0.01,
  u_lensRadius: 0.41,
  u_dispersionStrength: 0,
  u_edgeDisp: 0,
};

const RESOLUTION_SCALE = 0.5;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

/** Still images per breakpoint, shown until the shader renders and as the only content without WebGL2. */
export type ShaderFallbacks = { desktop: string; tablet: string; phone: string };

type Props = {
  fallbacks: ShaderFallbacks;
  className?: string;
};

export function BandsShader({ fallbacks, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "default",
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    let program: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let frame = 0;
    let visible = true;
    let disposed = false;
    let start = performance.now() * 0.001;
    let rendered = false;

    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram();
      if (!program) throw new Error("Failed to create program");
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Program linking failed: ${gl.getProgramInfoLog(program)}`);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch {
      setFailed(true);
      return;
    }

    // Full-screen quad.
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    const aTexCoord = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);

    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API call, not a React hook
    gl.useProgram(program);
    const loc = (name: string) => gl.getUniformLocation(program as WebGLProgram, name);
    gl.uniform4fv(loc("u_colors"), new Float32Array(uniforms.u_colors.flat()));
    gl.uniform1i(loc("u_colors_length"), uniforms.u_colors.length);
    for (const key of [
      "u_seed",
      "u_speed",
      "u_ephemeralAmp",
      "u_lensScale",
      "u_lensSpacingX",
      "u_lensSpacingY",
      "u_lensRadius",
      "u_dispersionStrength",
      "u_edgeDisp",
    ] as const) {
      gl.uniform1f(loc(key), uniforms[key]);
    }
    const timeLoc = loc("u_time");
    const resolutionLoc = loc("u_resolution");

    let bufferWidth = 0;
    let bufferHeight = 0;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio * RESOLUTION_SCALE, 1);
      const w = Math.round(canvas.offsetWidth * ratio);
      const h = Math.round(canvas.offsetHeight * ratio);
      if (w === bufferWidth && h === bufferHeight) return;
      bufferWidth = w;
      bufferHeight = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };

    const render = (now: number) => {
      if (disposed) return;
      resize();
      gl.uniform1f(timeLoc, now * 0.001 - start);
      gl.uniform2f(resolutionLoc, bufferWidth, bufferHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!rendered) {
        rendered = true;
        setReady(true);
      }
    };

    const loop = (now: number) => {
      if (disposed) return;
      render(now);
      if (visible) frame = requestAnimationFrame(loop);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const wasVisible = visible;
        visible = entry.isIntersecting;
        if (visible && !wasVisible) {
          // Like the original, the clock restarts when the shader comes back on screen.
          start = performance.now() * 0.001;
          frame = requestAnimationFrame(loop);
        }
      }
    });
    observer.observe(canvas);
    const ro = new ResizeObserver(() => {
      if (!visible) render(performance.now());
    });
    ro.observe(canvas);
    frame = requestAnimationFrame(loop);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      if (vao) gl.deleteVertexArray(vao);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(texCoordBuffer);
      if (program) gl.deleteProgram(program);
    };
  }, []);

  return (
    <div className={`${styles.shader} ${className ?? ""}`}>
      <div className={styles.layer} style={{ opacity: failed ? 0 : 1 }}>
        <canvas ref={canvasRef} className={styles.canvas} draggable={false} />
      </div>
      <div
        className={styles.layer}
        style={{ opacity: ready && !failed ? 0 : 1, transition: "opacity 200ms ease-in-out" }}
      >
        {/* The browser picks the breakpoint's image from the HTML: no second download after hydration. */}
        <picture className={styles.picture}>
          <source media="(max-width: 809.98px)" srcSet={fallbacks.phone} />
          <source media="(max-width: 1199.98px)" srcSet={fallbacks.tablet} />
          <img src={fallbacks.desktop} alt="" draggable={false} decoding="async" className={styles.fallback} />
        </picture>
      </div>
    </div>
  );
}
