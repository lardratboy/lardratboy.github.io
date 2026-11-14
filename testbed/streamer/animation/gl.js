/* ================== THE ANIMATION'S RENDERER ==========================
   Raw WebGL2, as the rest of the repo, and nothing the viewer's tests
   compare: this is a teaching picture, so it draws what reads best.

   Four kinds of thing, in this order every frame:
   1. the background: a sky gradient and an infinite floor grid, traced per
      pixel from the inverse view-projection (no geometry, no depth);
   2. opaque cubes: a dynamic list rebuilt each frame (instanced, 11 floats
      a cube), static batches drawn with a model matrix (a town at some lod,
      uploaded once), and face batches (a world chunk's shown faces, 2 words
      a face, chunk-local, placed by a uniform origin and cell size: the
      viewer's records, flattened to faces so a million cubes are ~1.4
      million quads instead of 36 vertices each);
   3. glass: cubes with alpha < 1, sorted back to front, blended;
   4. lines: capsules expanded in screen space, so widths are in pixels and
      ends are round, depth-tested or drawn on top, blended or additive.

   A batch that fades is dithered rather than blended (screen-door), so a
   whole town can fade without sorting its insides.
   ======================================================================== */

/* ---- mat4 (column-major) ---------------------------------------------- */
export const M4 = {
  ident: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  mul(a, b){
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fovy, aspect, near, far){
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0]);
  },
  lookAt(e, t, up = [0, 1, 0]){
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
      -(xx*e[0] + xy*e[1] + xz*e[2]), -(yx*e[0] + yy*e[1] + yz*e[2]), -(zx*e[0] + zy*e[1] + zz*e[2]), 1]);
  },
  invert(m){
    const a = m, o = new Float32Array(16);
    const b00 = a[0]*a[5] - a[1]*a[4], b01 = a[0]*a[6] - a[2]*a[4], b02 = a[0]*a[7] - a[3]*a[4];
    const b03 = a[1]*a[6] - a[2]*a[5], b04 = a[1]*a[7] - a[3]*a[5], b05 = a[2]*a[7] - a[3]*a[6];
    const b06 = a[8]*a[13] - a[9]*a[12], b07 = a[8]*a[14] - a[10]*a[12], b08 = a[8]*a[15] - a[11]*a[12];
    const b09 = a[9]*a[14] - a[10]*a[13], b10 = a[9]*a[15] - a[11]*a[13], b11 = a[10]*a[15] - a[11]*a[14];
    const det = 1 / (b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06);
    o[0] = (a[5]*b11 - a[6]*b10 + a[7]*b09) * det; o[1] = (a[2]*b10 - a[1]*b11 - a[3]*b09) * det;
    o[2] = (a[13]*b05 - a[14]*b04 + a[15]*b03) * det; o[3] = (a[10]*b04 - a[9]*b05 - a[11]*b03) * det;
    o[4] = (a[6]*b08 - a[4]*b11 - a[7]*b07) * det; o[5] = (a[0]*b11 - a[2]*b08 + a[3]*b07) * det;
    o[6] = (a[14]*b02 - a[12]*b05 - a[15]*b01) * det; o[7] = (a[8]*b05 - a[10]*b02 + a[11]*b01) * det;
    o[8] = (a[4]*b10 - a[5]*b08 + a[7]*b06) * det; o[9] = (a[1]*b08 - a[0]*b10 - a[3]*b06) * det;
    o[10] = (a[12]*b04 - a[13]*b02 + a[15]*b00) * det; o[11] = (a[9]*b02 - a[8]*b04 - a[11]*b00) * det;
    o[12] = (a[5]*b07 - a[4]*b09 - a[6]*b06) * det; o[13] = (a[0]*b09 - a[1]*b07 + a[2]*b06) * det;
    o[14] = (a[13]*b01 - a[12]*b03 - a[14]*b00) * det; o[15] = (a[8]*b03 - a[9]*b01 + a[10]*b00) * det;
    return o;
  },
  // translate · rotateY(a) · scale(s), the only model matrix the scenes need.
  trs(tx, ty, tz, a = 0, s = 1){
    const c = Math.cos(a) * s, n = Math.sin(a) * s;
    return new Float32Array([c,0,-n,0, 0,s,0,0, n,0,c,0, tx,ty,tz,1]);
  },
};

/* ---- shaders ------------------------------------------------------------ */
const SHADE = `
uniform vec3 uEye, uFogCol; uniform float uFog, uEdge;
vec3 shade(vec3 base, vec3 n, vec3 wp, float edgeDist, float edgeW, float glow){
  vec3 L = normalize(vec3(0.45, 0.88, 0.32));
  float d = max(dot(n, L), 0.0), hemi = 0.5 + 0.5 * n.y;
  vec3 c = base * (0.20 + 0.66 * d + 0.26 * hemi);
  c += base * vec3(0.03, 0.05, 0.10) * (1.0 - d);
  vec3 V = normalize(uEye - wp);
  c += pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.07;
  float fw = max(fwidth(edgeDist), 1e-5);
  float e = 1.0 - smoothstep(edgeW - fw, edgeW + fw, edgeDist);
  e *= clamp(edgeW / (fw * 1.8), 0.0, 1.0);
  c *= 1.0 - uEdge * 0.38 * e;
  c += base * glow;
  float dist = length(uEye - wp);
  float f = 1.0 - exp(-pow(max(dist * uFog, 0.0), 1.5));
  return mix(c, uFogCol, clamp(f, 0.0, 1.0));
}
float dither(vec2 p){
  // 4×4 Bayer, for screen-door fades.
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + 4 * q.y;
  int b[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(b[i]) + 0.5) / 16.0;
}`;

const CUBE_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
layout(location=2) in vec3 iPos; layout(location=3) in vec3 iScale;
layout(location=4) in vec4 iCol; layout(location=5) in float iGlow;
uniform mat4 uVP, uModel;
out vec3 vWorld, vNor, vLocal, vScale; out vec4 vCol; out float vGlow;
void main(){
  vec3 p = iPos + aPos * iScale;
  vec4 w = uModel * vec4(p, 1.0);
  vWorld = w.xyz; vNor = normalize(mat3(uModel) * aNor); vLocal = aPos;
  float s = length(uModel[0].xyz);
  vScale = iScale * s; vCol = iCol; vGlow = iGlow;
  gl_Position = uVP * w;
}`;
const CUBE_FS = `#version 300 es
precision highp float;
in vec3 vWorld, vNor, vLocal, vScale; in vec4 vCol; in float vGlow;
uniform float uAlpha, uDither, uGlowAdd; uniform vec3 uTint; uniform float uTintAmt;
out vec4 o;
${SHADE}
void main(){
  float a = vCol.a * uAlpha;
  if (uDither > 0.5 && a < dither(gl_FragCoord.xy)) discard;
  vec3 q = (0.5 - abs(vLocal)) * vScale;
  float e = q.x + q.y + q.z - min(q.x, min(q.y, q.z)) - max(q.x, max(q.y, q.z));
  float ew = 0.075 * min(vScale.x, min(vScale.y, vScale.z));
  vec3 base = mix(vCol.rgb, uTint, uTintAmt);
  vec3 c = shade(base, normalize(vNor), vWorld, e, ew, vGlow + uGlowAdd);
  o = vec4(c, uDither > 0.5 ? 1.0 : a);
}`;

// A face of a chunk record: word = x | y<<6 | z<<12 | face<<18, colour rgb8.
const FACE_VS = `#version 300 es
layout(location=0) in vec2 aUV;
layout(location=1) in uint iWord; layout(location=2) in uint iCol;
uniform mat4 uVP; uniform vec3 uOrigin; uniform float uCell;
out vec3 vWorld, vNor; out vec2 vFace; out vec4 vCol;
const vec3 N[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
const vec3 U[6] = vec3[6](vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0));
const vec3 W[6] = vec3[6](vec3(0,1,0), vec3(0,1,0), vec3(0,0,-1), vec3(0,0,1), vec3(0,1,0), vec3(0,1,0));
void main(){
  uint f = (iWord >> 18) & 7u;
  vec3 cell = vec3(float(iWord & 63u), float((iWord >> 6) & 63u), float((iWord >> 12) & 63u));
  vec3 c = uOrigin + (cell + 0.5) * uCell;
  vec3 p = c + (N[f] * 0.5 + U[f] * (aUV.x - 0.5) + W[f] * (aUV.y - 0.5)) * uCell;
  vWorld = p; vNor = N[f]; vFace = aUV * uCell;
  vCol = vec4(float(iCol & 255u), float((iCol >> 8) & 255u), float((iCol >> 16) & 255u), 255.0) / 255.0;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const FACE_FS = `#version 300 es
precision highp float;
in vec3 vWorld, vNor; in vec2 vFace; in vec4 vCol;
uniform float uCell, uAlpha;
out vec4 o;
${SHADE}
void main(){
  if (uAlpha < 0.999 && uAlpha < dither(gl_FragCoord.xy)) discard;
  vec2 q = min(vFace, uCell - vFace);
  float e = min(q.x, q.y);
  o = vec4(shade(vCol.rgb, vNor, vWorld, e, 0.075 * uCell, 0.0), 1.0);
}`;

const SEG_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iA; layout(location=2) in vec3 iB;
layout(location=3) in vec4 iCol; layout(location=4) in float iW;
uniform mat4 uVP; uniform vec2 uRes; uniform float uBias;
out vec4 vCol; out vec3 vUVw; out float vLen, vHW;
void main(){
  vec4 a = uVP * vec4(iA, 1.0), b = uVP * vec4(iB, 1.0);
  const float n = 0.02;
  if (a.w < n && b.w < n){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (a.w < n) a = mix(a, b, (n - a.w) / (b.w - a.w));
  if (b.w < n) b = mix(b, a, (n - b.w) / (a.w - b.w));
  vec2 h = uRes * 0.5, sa = a.xy / a.w * h, sb = b.xy / b.w * h;
  vec2 d = sb - sa; float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0), nr = vec2(-dir.y, dir.x);
  float hw = iW * 0.5 + 1.0;
  bool end = aCorner.x > 0.5;
  vec4 c = end ? b : a;
  vec2 s = (end ? sb : sa) + dir * (end ? hw : -hw) + nr * aCorner.y * hw;
  gl_Position = vec4(s / h * c.w, c.z - uBias * c.w, c.w);
  vec2 uv = vec2(end ? L + hw : -hw, aCorner.y * hw);
  vUVw = vec3(uv * c.w, c.w);
  vLen = L; vHW = iW * 0.5; vCol = iCol;
}`;
const SEG_FS = `#version 300 es
precision highp float;
in vec4 vCol; in vec3 vUVw; in float vLen, vHW;
out vec4 o;
void main(){
  vec2 uv = vUVw.xy / vUVw.z;
  float dx = max(max(-uv.x, uv.x - vLen), 0.0);
  float d = length(vec2(dx, uv.y));
  float a = clamp(vHW + 0.5 - d, 0.0, 1.0) * vCol.a;
  if (a <= 0.003) discard;
  o = vec4(vCol.rgb * a, a);
}`;

const BG_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 vNdc;
void main(){ vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0); }`;
const BG_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP; uniform vec3 uEye, uTop, uHorizon, uBottom, uGridCol;
uniform float uGrid, uGridY, uGridStep, uGridFade;
out vec4 o;
void main(){
  vec4 f = uInvVP * vec4(vNdc, 1.0, 1.0); vec3 far = f.xyz / f.w;
  vec3 d = normalize(far - uEye);
  float y = d.y;
  vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.5));
  if (uGrid > 0.0 && d.y < -1e-4){
    float t = (uGridY - uEye.y) / d.y;
    if (t > 0.0){
      vec3 p = uEye + d * t;
      vec2 g = p.xz / uGridStep, fw = fwidth(g);
      vec2 l = abs(fract(g - 0.5) - 0.5) / fw;
      float line = 1.0 - clamp(min(l.x, l.y), 0.0, 1.0);
      vec2 G = p.xz / (uGridStep * 8.0), FW = fwidth(G);
      vec2 L2 = abs(fract(G - 0.5) - 0.5) / FW;
      float major = 1.0 - clamp(min(L2.x, L2.y) * 0.7, 0.0, 1.0);
      float fade = exp(-t / uGridFade) * clamp(1.0 - max(fw.x, fw.y) * 0.6, 0.0, 1.0);
      c = mix(c, uGridCol, (line * 0.35 + major * 0.6) * fade * uGrid);
    }
  }
  float r = length(vNdc * vec2(0.9, 1.0));
  c *= 1.0 - 0.32 * smoothstep(0.5, 1.6, r);
  // A little grain, so the gradient doesn't band.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(c + (n - 0.5) / 255.0, 1.0);
}`;

function compile(gl, vs, fs){
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const U = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++){ const u = gl.getActiveUniform(p, i); U[u.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, u.name); }
  return { p, U };
}

/* A cube's 36 vertices, position and normal, wound counter-clockwise. */
function cubeVerts(){
  const F = [
    [[1,0,0], [0,0,-1], [0,1,0]], [[-1,0,0], [0,0,1], [0,1,0]],
    [[0,1,0], [1,0,0], [0,0,-1]], [[0,-1,0], [1,0,0], [0,0,1]],
    [[0,0,1], [1,0,0], [0,1,0]], [[0,0,-1], [-1,0,0], [0,1,0]],
  ];
  const out = [];
  for (const [n, u, w] of F){
    const P = (a, b) => [0, 1, 2].map(i => n[i] * 0.5 + u[i] * a + w[i] * b);
    const q = [P(-.5, -.5), P(.5, -.5), P(.5, .5), P(-.5, .5)];
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...q[i], ...n);
  }
  return new Float32Array(out);
}

/* A growable float list, so a frame's cubes and lines cost no allocation. */
class FList {
  constructor(stride, n = 4096){ this.stride = stride; this.a = new Float32Array(stride * n); this.n = 0; }
  push(...v){
    if ((this.n + 1) * this.stride > this.a.length){ const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a.set(v, this.n * this.stride); this.n++;
  }
  reserve(k){
    if ((this.n + k) * this.stride > this.a.length){
      let len = this.a.length; while ((this.n + k) * this.stride > len) len *= 2;
      const b = new Float32Array(len); b.set(this.a); this.a = b;
    }
  }
  clear(){ this.n = 0; }
}

export function createRenderer(canvas){
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');
  const cube = compile(gl, CUBE_VS, CUBE_FS), face = compile(gl, FACE_VS, FACE_FS);
  const seg = compile(gl, SEG_VS, SEG_FS), bg = compile(gl, BG_VS, BG_FS);
  gl.getExtension('OES_standard_derivatives');

  const cubeVB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVB); gl.bufferData(gl.ARRAY_BUFFER, cubeVerts(), gl.STATIC_DRAW);
  const quadVB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVB); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]), gl.STATIC_DRAW);
  const segVB = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, segVB); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,-1, 1,-1, 1,1, 0,-1, 1,1, 0,1]), gl.STATIC_DRAW);
  const bgVAO = gl.createVertexArray();

  // Cube VAOs: one per instance buffer.
  function cubeVAO(ib){
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVB);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    const S = 44;
    [[2, 3, 0], [3, 3, 12], [4, 4, 24], [5, 1, 40]].forEach(([loc, n, off]) => {
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off); gl.vertexAttribDivisor(loc, 1);
    });
    gl.bindVertexArray(null);
    return vao;
  }
  const dynIB = gl.createBuffer(), dynVAO = cubeVAO(dynIB);
  const glassIB = gl.createBuffer(), glassVAO = cubeVAO(glassIB);
  const segIB = gl.createBuffer(), segVAO = gl.createVertexArray();
  gl.bindVertexArray(segVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, segVB);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, segIB);
  [[1, 3, 0], [2, 3, 12], [3, 4, 24], [4, 1, 40]].forEach(([loc, n, off]) => {
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 44, off); gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindVertexArray(null);

  /* Static batches. */
  function makeBatch(inst, count = inst.length / 11){
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    return { vao: cubeVAO(ib), ib, count };
  }
  function makeFaceBatch(words, cols){
    const vao = gl.createVertexArray(), wb = gl.createBuffer(), cb = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVB);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, wb); gl.bufferData(gl.ARRAY_BUFFER, words, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 4, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, cols, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_INT, 4, 0); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return { vao, wb, cb, count: words.length };
  }
  const freeBatch = b => { gl.deleteVertexArray(b.vao); for (const k of ['ib', 'wb', 'cb']) if (b[k]) gl.deleteBuffer(b[k]); };

  /* ---- the frame ---------------------------------------------------------- */
  const cubes = new FList(11, 65536), glass = new FList(11, 4096);
  const segLists = { blend: new FList(11), add: new FList(11), topBlend: new FList(11), topAdd: new FList(11) };
  const batches = [], faceDraws = [];
  const view = { vp: M4.ident(), invVP: M4.ident(), eye: [0, 0, 50], w: 1, h: 1, dpr: 1 };
  const env = { fog: 0.004, fogCol: [0.06, 0.075, 0.11], top: [0.025, 0.03, 0.05], horizon: [0.07, 0.085, 0.12], bottom: [0.03, 0.035, 0.05],
                grid: 1, gridY: 0, gridStep: 8, gridFade: 260, gridCol: [0.25, 0.55, 0.75], edge: 1 };

  const F = {
    env,
    view,
    cube(x, y, z, s, r, g, b, a = 1, glow = 0){
      (a < 0.999 ? glass : cubes).push(x, y, z, s, s, s, r, g, b, a, glow);
    },
    box(x, y, z, sx, sy, sz, r, g, b, a = 1, glow = 0){
      (a < 0.999 ? glass : cubes).push(x, y, z, sx, sy, sz, r, g, b, a, glow);
    },
    cubeList: cubes,
    batch(b, model, { alpha = 1, tint = null, tintAmt = 0, glow = 0 } = {}){ if (alpha > 0.002) batches.push({ b, model, alpha, tint, tintAmt, glow }); },
    faces(b, origin, cell, alpha = 1){ if (alpha > 0.002) faceDraws.push({ b, origin, cell, alpha }); },
    seg(a, b, col, w = 2, { add = false, top = false } = {}){
      if (col[3] <= 0.002) return;
      segLists[top ? (add ? 'topAdd' : 'topBlend') : (add ? 'add' : 'blend')]
        .push(a[0], a[1], a[2], b[0], b[1], b[2], col[0], col[1], col[2], col[3], w);
    },
    wire(lo, hi, col, w = 1.5, opts){
      const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
      const P = [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
      for (const [i, j] of EDGES) F.seg(P[i], P[j], col, w, opts);
    },
    project(p){
      const m = view.vp, x = p[0], y = p[1], z = p[2];
      const cx = m[0]*x + m[4]*y + m[8]*z + m[12], cy = m[1]*x + m[5]*y + m[9]*z + m[13], cw = m[3]*x + m[7]*y + m[11]*z + m[15];
      if (cw <= 0.01) return null;
      return [(cx / cw * 0.5 + 0.5) * view.w, (1 - (cy / cw * 0.5 + 0.5)) * view.h, cw];
    },
  };
  const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

  function begin(cam, w, h, dpr){
    view.w = w; view.h = h; view.dpr = dpr;
    const ct = Math.cos(cam.pitch), eye = [cam.target[0] + cam.dist * ct * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * ct * Math.cos(cam.yaw)];
    if (cam.eye){ eye[0] = cam.eye[0]; eye[1] = cam.eye[1]; eye[2] = cam.eye[2]; }
    view.eye = eye;
    const near = cam.near ?? Math.max(0.05, cam.dist * 0.01), far = cam.far ?? Math.max(4000, cam.dist * 40);
    const P = M4.persp(cam.fov ?? 0.75, w / h, near, far), V = M4.lookAt(eye, cam.target);
    view.vp = M4.mul(P, V); view.invVP = M4.invert(view.vp);
    cubes.clear(); glass.clear(); for (const k in segLists) segLists[k].clear();
    batches.length = 0; faceDraws.length = 0;
  }

  function setShade(prog){
    const U = prog.U;
    gl.uniformMatrix4fv(U.uVP, false, view.vp);
    gl.uniform3fv(U.uEye, view.eye); gl.uniform3fv(U.uFogCol, env.fogCol);
    gl.uniform1f(U.uFog, env.fog); gl.uniform1f(U.uEdge, env.edge);
  }
  const ID = M4.ident();
  function drawCubes(vao, count, model, alpha, dither, tint, tintAmt, glow){
    const U = cube.U;
    gl.uniformMatrix4fv(U.uModel, false, model || ID);
    gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uDither, dither ? 1 : 0);
    gl.uniform3fv(U.uTint, tint || [0, 0, 0]); gl.uniform1f(U.uTintAmt, tintAmt || 0); gl.uniform1f(U.uGlowAdd, glow || 0);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);
  }

  function end(){
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 1. background
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    gl.useProgram(bg.p);
    gl.uniformMatrix4fv(bg.U.uInvVP, false, view.invVP); gl.uniform3fv(bg.U.uEye, view.eye);
    gl.uniform3fv(bg.U.uTop, env.top); gl.uniform3fv(bg.U.uHorizon, env.horizon); gl.uniform3fv(bg.U.uBottom, env.bottom);
    gl.uniform3fv(bg.U.uGridCol, env.gridCol); gl.uniform1f(bg.U.uGrid, env.grid); gl.uniform1f(bg.U.uGridY, env.gridY);
    gl.uniform1f(bg.U.uGridStep, env.gridStep); gl.uniform1f(bg.U.uGridFade, env.gridFade);
    gl.bindVertexArray(bgVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. opaque
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(cube.p); setShade(cube);
    if (cubes.n){
      gl.bindBuffer(gl.ARRAY_BUFFER, dynIB); gl.bufferData(gl.ARRAY_BUFFER, cubes.a.subarray(0, cubes.n * 11), gl.STREAM_DRAW);
      drawCubes(dynVAO, cubes.n, null, 1, false);
    }
    for (const d of batches) drawCubes(d.b.vao, d.b.count, d.model, d.alpha, d.alpha < 0.999, d.tint, d.tintAmt, d.glow);
    if (faceDraws.length){
      gl.useProgram(face.p); setShade(face);
      for (const d of faceDraws){
        gl.uniform3fv(face.U.uOrigin, d.origin); gl.uniform1f(face.U.uCell, d.cell); gl.uniform1f(face.U.uAlpha, d.alpha);
        gl.bindVertexArray(d.b.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, d.b.count);
      }
    }
    // 3. glass, back to front
    if (glass.n){
      const n = glass.n, a = glass.a, e = view.eye, idx = new Uint32Array(n), dist = new Float32Array(n);
      for (let i = 0; i < n; i++){ idx[i] = i; const o = i * 11; dist[i] = (a[o]-e[0])**2 + (a[o+1]-e[1])**2 + (a[o+2]-e[2])**2; }
      idx.sort((p, q) => dist[q] - dist[p]);
      const s = new Float32Array(n * 11);
      for (let i = 0; i < n; i++) s.set(a.subarray(idx[i] * 11, idx[i] * 11 + 11), i * 11);
      gl.useProgram(cube.p); setShade(cube);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, glassIB); gl.bufferData(gl.ARRAY_BUFFER, s, gl.STREAM_DRAW);
      drawCubes(glassVAO, n, null, 1, false);
    }
    // 4. lines
    gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.depthMask(false);
    gl.useProgram(seg.p);
    gl.uniformMatrix4fv(seg.U.uVP, false, view.vp); gl.uniform2f(seg.U.uRes, W, H);
    const dpr = view.dpr;
    const drawSegs = (L, add, top) => {
      if (!L.n) return;
      if (dpr !== 1) for (let i = 0; i < L.n; i++) L.a[i * 11 + 10] *= dpr;
      if (top) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(seg.U.uBias, top ? 0 : 0.0004);
      gl.bindBuffer(gl.ARRAY_BUFFER, segIB); gl.bufferData(gl.ARRAY_BUFFER, L.a.subarray(0, L.n * 11), gl.STREAM_DRAW);
      gl.bindVertexArray(segVAO); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, L.n);
    };
    drawSegs(segLists.blend, false, false); drawSegs(segLists.add, true, false);
    drawSegs(segLists.topBlend, false, true); drawSegs(segLists.topAdd, true, true);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.bindVertexArray(null);
  }

  return { gl, F, begin, end, makeBatch, makeFaceBatch, freeBatch, view, env };
}
