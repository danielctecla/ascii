'use strict';

/*
 * Lirios en arte ASCII
 * --------------------
 *  - El ramo se pinta como un dibujo normal (pétalos con degradados, hojas y
 *    tallos) en un lienzo diminuto, de una celda por píxel. Después cada celda
 *    se convierte en un carácter de color: más brillo = carácter más denso.
 *    La conversión la hace la GPU con WebGL; si no hay WebGL, Canvas 2D.
 *  - Texto opcional cifrado (AES-GCM): solo se muestra si la dirección lleva
 *    la clave después de «#». Entonces se dibuja en arte ASCII y las letras
 *    se forman con pétalos.
 */
// <dedicatoria>
const DEDICATORIA = { iteraciones: 200000, sal: 'YTsMFLYRpG0Vjb8Fry3B6Q==', iv: '3xdCVPDNK7oiEldf', datos: 'RkzjP6DDhgrdPmgeQTuLG2leKEdu44f17IMvb2F5GOYdOi4Fc/34WfiqBJgDQU2qcKQLRd1gkjfsHmHudFcNyDIWlXQ3UscLdVy8zRIP+jpBB1Ek7LB+e5xPIMpBbjpW/gcZWbVurhJXE+MYfAhzGcGX2lMY1H570eaa9nJ0Ijj/NrxX8g==' };
// </dedicatoria>

let CONFIG = null; // { titulo, nombre, frases, linea } una vez descifrada

(() => {
  // ───────────────────────── DOM ─────────────────────────
  const lienzo = document.getElementById('escena');
  const ctx = lienzo.getContext('2d');
  const panel = document.getElementById('panel');
  const zonaSegura = document.getElementById('zona-segura');
  const lineaMensaje = document.getElementById('mensaje');
  const btnOtraVez = document.getElementById('btn-otra-vez');
  const movReducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────── Utilidades ─────────────────────────
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  const entre = (a, b) => a + Math.random() * (b - a);
  const azarDe = (lista) => lista[(Math.random() * lista.length) | 0];
  const suaveIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const suaveSalida = (x) => 1 - Math.pow(1 - x, 3);
  const suaveRebote = (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

  // Generador con semilla: el ramo se arma igual en cada visita
  function semilla(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  const cacheRGB = new Map();
  function rgb(hex) {
    let v = cacheRGB.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      cacheRGB.set(hex, v);
    }
    return v;
  }

  const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

  function mezclar(a, b, k) {
    const A = rgb(a), B = rgb(b);
    return `rgb(${(A[0] + (B[0] - A[0]) * k) | 0},${(A[1] + (B[1] - A[1]) * k) | 0},${(A[2] + (B[2] - A[2]) * k) | 0})`;
  }

  // ───────────────────────── Constantes ─────────────────────────
  const FUENTE = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';
  const FUENTE_JP = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
  const ALTO_LINEA = 1.15;
  const FONDO = '#030204';
  const RAMPA = ' .:-=+*#%@';           // texto japonés: de menos a más tinta
  const RAMPA_RAMO = '.,:;=+*x#%@';     // ramo: de menos a más brillo
  const VOLTEO = ["'", '`', '-', ',', '.', ','];
  const ROSAS = ['#ffc2d1', '#ffb3c6', '#ff8fab', '#fde2e4', '#fff0f3'];
  const K = 2;                          // píxeles de pintura por celda (se promedian)
  const ASPECTO = 0.8;                  // ancho / alto de la caja del ramo

  // Colores de cada lirio, del centro a la punta del pétalo
  const PALETAS = {
    roja: { garganta: '#ffb703', base: '#9d0208', medio: '#e5383b', punta: '#ff8080', borde: '#4a000c', manchas: '#3d0008' },
    rosa: { garganta: '#fbe7a1', base: '#c9184a', medio: '#ff4d8d', punta: '#ffe0ec', borde: '#5c0b26', manchas: '#6b0a28' },
    blanca: { garganta: '#d9ed92', base: '#c9b98f', medio: '#f3ead3', punta: '#fffdf6', borde: '#5e5643', manchas: null },
    amarilla: { garganta: '#f77f00', base: '#d68c1e', medio: '#ffd166', punta: '#fff3b0', borde: '#5c3d00', manchas: '#8a4b00' },
    melocoton: { garganta: '#f6bd60', base: '#d9734e', medio: '#f7b39b', punta: '#fff1e6', borde: '#5e2a1e', manchas: null },
    magenta: { garganta: '#ffd6e0', base: '#6e0a37', medio: '#c2185b', punta: '#f48fb1', borde: '#2e0418', manchas: '#2e0418' },
  };

  // Lirios: posición (u, v de 0 a 1 dentro de la caja), largo del pétalo (s, relativo al ancho),
  // giro (r) e inclinación (ty: 1 = de frente). Se pintan en este orden: los últimos quedan delante.
  const LIRIOS = [
    { u: 0.36, v: 0.22, s: 0.12, p: 'melocoton', r: 0.2, ty: 0.75 },
    { u: 0.27, v: 0.15, s: 0.14, p: 'blanca', r: 0.3, ty: 0.72 },
    { u: 0.76, v: 0.16, s: 0.14, p: 'amarilla', r: -0.4, ty: 0.75 },
    { u: 0.2, v: 0.34, s: 0.17, p: 'amarilla', r: 0.8, ty: 0.85 },
    { u: 0.79, v: 0.36, s: 0.19, p: 'magenta', r: -0.2, ty: 0.8 },
    { u: 0.52, v: 0.27, s: 0.23, p: 'roja', r: 0.15, ty: 0.85 },
    { u: 0.5, v: 0.43, s: 0.16, p: 'amarilla', r: 0.5, ty: 0.85 },
    { u: 0.17, v: 0.67, s: 0.15, p: 'amarilla', r: -0.5, ty: 0.8 },
    { u: 0.84, v: 0.65, s: 0.16, p: 'roja', r: 0.6, ty: 0.8 },
    { u: 0.68, v: 0.77, s: 0.14, p: 'rosa', r: -0.3, ty: 0.8 },
    { u: 0.31, v: 0.48, s: 0.25, p: 'rosa', r: -0.25, ty: 0.9 },
    { u: 0.67, v: 0.5, s: 0.25, p: 'blanca', r: 0.4, ty: 0.85 },
    { u: 0.48, v: 0.67, s: 0.24, p: 'melocoton', r: 0.1, ty: 0.8 },
  ];

  // Capullos cerrados en lo alto del ramo
  const CAPULLOS = [
    { u: 0.47, v: 0.15, s: 0.1, ang: -0.08, color: '#9d174d' },
    { u: 0.62, v: 0.14, s: 0.085, ang: 0.4, color: '#e9c46a' },
    { u: 0.38, v: 0.17, s: 0.075, ang: -0.5, color: '#e5383b' },
  ];

  // ───────────────────────── Ramo (datos fijos) ─────────────────────────
  const azar = semilla(520);
  const lirios = LIRIOS.map((l) => ({ ...l, fase: azar() * TAU, giro: azar() * TAU, tFlor: 0, tPulso: -99, brillo: 0, orden: 0 }));
  [...lirios].sort((a, b) => b.v - a.v).forEach((l, i) => { l.orden = i; }); // abren de abajo hacia arriba
  const capullos = CAPULLOS.map((c) => ({ ...c, fase: azar() * TAU, tFlor: 0 }));

  const hojas = [];
  for (let i = 0; i < 18; i++) {
    const lado = i % 2 ? 1 : -1;
    const atras = i < 8; // las primeras asoman por detrás de las flores
    hojas.push({
      u0: 0.5 + lado * azar() * 0.05,
      v0: atras ? 0.45 + azar() * 0.35 : 0.86 + azar() * 0.12,
      ang: lado * (0.3 + azar() * 1.05),
      largo: atras ? 0.16 + azar() * 0.12 : 0.13 + azar() * 0.17,
      ancho: 0.028 + azar() * 0.02,
      curva: lado * (0.06 + azar() * 0.12),
      atras,
      retraso: azar() * 0.4,
      fase: azar() * TAU,
    });
  }

  // ───────────────────────── Estado ─────────────────────────
  let W = 0, H = 0, dpr = 1, proporcion = 0.6;
  let fsUI = 14, esc = 1, cwUI = 8.4;
  let caja = { x: 0, y: 0, w: 1, h: 1 };
  let cols = 1, filas = 1, cwR = 4, lw = 4, escCaja = 1;
  let horizontal = false;
  let zonaNombre = { cx: 0, cy: 0, w: 1, h: 1 };
  let zonaMsg = { cx: 0, cy: 0, w: 1, h: 1 };
  let rectNombre = zonaNombre, rectMsg = zonaMsg;
  let fuenteBase = '', fuenteChica = '', fuenteGrande = '';
  let nombreArte = null;
  let frasesArte = [];
  let gradAmbiente = null;
  let estrellas = [], luciernagas = [];
  const petalos = [], chispas = [], particulas = [];
  let mariposa = null;
  let t = 0, ultimoCuadro = 0, intro = movReducido ? 99 : 0;
  let viento = 0, vientoDedo = 0, brilloNombre = 0;
  let acumFlor = 0, acumNombre = 0, cantidadPetalos = 30;
  // Ciclo: al terminar el mensaje el ramo se cierra soltando pétalos y la animación vuelve a empezar
  const DUR_CIERRE = 1.6;
  let tCierre = -1; // momento en que empezó a cerrarse (-1 = no se está cerrando)
  let cierre = 1;   // 1 = ramo abierto, 0 = cerrado del todo
  const puntero = { x: -9999, y: -9999, activo: false, abajo: false, t: 0, ultimoRastro: 0 };
  const msg = { idx: -1, fase: 'espera', tFase: 0 };
  const lienzoTexto = document.createElement('canvas');
  const ctxTexto = lienzoTexto.getContext('2d', { willReadFrequently: true });
  const lienzoPintura = document.createElement('canvas');
  let ctxPintura = null;
  let render = null;

  // ───────────────────────── Pintura → ASCII con WebGL ─────────────────────────
  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uPintura;
uniform sampler2D uAtlas;
uniform vec2 uCelda;   // tamaño de una celda en píxeles
uniform vec2 uCeldas;  // columnas y filas
uniform float uAlto;
uniform float uN;      // caracteres de la rampa
uniform float uT;
uniform float uMov;    // 0 si el sistema pide menos movimiento
float azar(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, uAlto - gl_FragCoord.y);
  vec2 celda = floor(px / uCelda);
  vec2 dentro = (px - celda * uCelda) / uCelda;
  vec4 c = texture2D(uPintura, (celda + 0.5) / uCeldas);
  float m = max(c.r, max(c.g, c.b));
  float lum = m * c.a;
  if (lum < 0.06) { gl_FragColor = vec4(0.0); return; }
  // un reflejo de luz cruza el ramo en diagonal y los caracteres titilan un poco
  float s = (celda.x * 0.5 + celda.y) / (uCeldas.x * 0.5 + uCeldas.y);
  float d = s - fract(uT / 7.0) * 1.8 + 0.4;
  float banda = exp(-d * d * 160.0) * 0.25 * uMov;
  float ruido = (azar(celda + floor(uT * 5.0)) - 0.5) * 0.035 * uMov;
  // como en un tapiz: caracteres densos casi siempre; el sombreado lo da el color
  float l = clamp(pow(lum, 0.45) + banda + ruido, 0.0, 0.999);
  float idx = floor(l * uN);
  float g = texture2D(uAtlas, vec2((idx + dentro.x) / uN, dentro.y)).a;
  vec3 col = min(c.rgb * 1.2 + banda * 0.8, 1.0);
  // fondo tenue del mismo color en cada celda (como el arte ANSI de las terminales)
  float a = g + 0.24 * c.a * (1.0 - g);
  gl_FragColor = vec4(col * a, a);
}`;

  function crearAsciiGL() {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    try {
      const compilar = (tipo, fuente) => {
        const s = gl.createShader(tipo);
        gl.shaderSource(s, fuente);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      const textura = (unidad, filtro) => {
        const tx = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unidad);
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtro);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtro);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tx;
      };
      const texPintura = textura(0, gl.LINEAR);
      const texAtlas = textura(1, gl.NEAREST);
      const u = (n) => gl.getUniformLocation(prog, n);
      const U = { celda: u('uCelda'), celdas: u('uCeldas'), alto: u('uAlto'), n: u('uN'), t: u('uT'), mov: u('uMov') };
      gl.uniform1i(u('uPintura'), 0);
      gl.uniform1i(u('uAtlas'), 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

      return {
        lienzo: c,
        lee: false,
        preparar(co, fi, cW, cH, atlas, n) {
          c.width = co * cW;
          c.height = fi * cH;
          gl.viewport(0, 0, c.width, c.height);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, texAtlas);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
          gl.uniform2f(U.celda, cW, cH);
          gl.uniform2f(U.celdas, co, fi);
          gl.uniform1f(U.alto, c.height);
          gl.uniform1f(U.n, n);
          gl.uniform1f(U.mov, movReducido ? 0 : 1);
        },
        pintar(pintura, tiempo) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texPintura);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pintura);
          gl.uniform1f(U.t, tiempo);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
      };
    } catch (error) {
      console.warn('WebGL no disponible, se usa Canvas 2D:', error);
      return null;
    }
  }

  // Alternativa sin WebGL: lo mismo con Canvas 2D, refrescando uno de cada tres cuadros
  function crearAscii2D() {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    let co = 1, fi = 1, cW = 1, cH = 1, n = 0;
    return {
      lienzo: c,
      lee: true,
      preparar(co2, fi2, cW2, cH2) {
        co = co2; fi = fi2; cW = cW2; cH = cH2;
        c.width = co * cW;
        c.height = fi * cH;
      },
      pintar() {
        if (n++ % 3) return;
        const datos = ctxPintura.getImageData(0, 0, lienzoPintura.width, lienzoPintura.height).data;
        const ancho = lienzoPintura.width;
        g.clearRect(0, 0, c.width, c.height);
        g.font = `700 ${cH / ALTO_LINEA}px ${FUENTE}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (let f = 0; f < fi; f++) {
          for (let k = 0; k < co; k++) {
            const i = ((f * K + 1) * ancho + k * K + 1) * 4;
            const a = datos[i + 3] / 255;
            const m = Math.max(datos[i], datos[i + 1], datos[i + 2]) / 255;
            const lum = m * a;
            if (lum < 0.06) continue;
            g.fillStyle = `rgb(${Math.min(255, datos[i] * 1.2) | 0},${Math.min(255, datos[i + 1] * 1.2) | 0},${Math.min(255, datos[i + 2] * 1.2) | 0})`;
            g.globalAlpha = 0.24 * a;
            g.fillRect(k * cW, f * cH, cW, cH);
            g.globalAlpha = 1;
            g.fillText(RAMPA_RAMO[Math.min(RAMPA_RAMO.length - 1, Math.floor(Math.pow(lum, 0.45) * RAMPA_RAMO.length))], k * cW + cW / 2, f * cH + cH / 2);
          }
        }
      },
    };
  }

  function construirAtlas(cW, cH) {
    const a = document.createElement('canvas');
    a.width = cW * RAMPA_RAMO.length;
    a.height = cH;
    const g = a.getContext('2d');
    g.font = `700 ${cH / ALTO_LINEA}px ${FUENTE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    [...RAMPA_RAMO].forEach((chr, i) => g.fillText(chr, i * cW + cW / 2, cH / 2));
    return a;
  }

  // ───────────────────────── Pintura del ramo ─────────────────────────
  function posLirio(l) {
    const altura = 1 - l.v;
    const vaiven = (Math.sin(t * 0.8 + l.fase) * (1.5 + 5 * altura) + clamp(viento, -150, 150) * 0.03 * altura) * escCaja;
    const e = clamp01((t - l.tFlor) / 1.1);
    const k = t < l.tFlor ? 0 : suaveRebote(e);
    const dp = t - l.tPulso;
    const pulso = dp < 2 ? Math.exp(-dp * 3) * Math.sin(dp * 14) * 0.1 : 0;
    return {
      x: l.u * caja.w + vaiven,
      y: l.v * caja.h,
      L: l.s * caja.w * Math.max(0, k + pulso) * cierre,
      rot: l.r + Math.sin(t * 0.6 + l.fase) * 0.05,
      k,
    };
  }

  function posCapullo(b) {
    const altura = 1 - b.v;
    const vaiven = (Math.sin(t * 0.9 + b.fase) * (1.5 + 6 * altura) + clamp(viento, -150, 150) * 0.03 * altura) * escCaja;
    return { x: b.u * caja.w + vaiven, y: b.v * caja.h, k: clamp01((t - b.tFlor) / 0.8) * cierre };
  }

  function pintarTallos(g, crece) {
    if (crece <= 0) return;
    g.strokeStyle = '#2d6a4f';
    g.lineCap = 'round';
    g.lineWidth = lw * 1.1;
    const x0 = caja.w * 0.5, y0 = caja.h * 1.02;
    const destinos = [...lirios.map(posLirio), ...capullos.map(posCapullo)];
    const n = 14, hasta = Math.round(n * crece);
    for (const d of destinos) {
      const cx = (x0 + d.x) / 2 + (d.x - x0) * 0.15;
      const cy = d.y + (y0 - d.y) * 0.55;
      g.beginPath();
      g.moveTo(x0, y0);
      for (let i = 1; i <= hasta; i++) {
        const s = i / n, u = 1 - s;
        g.lineTo(u * u * x0 + 2 * u * s * cx + s * s * d.x, u * u * y0 + 2 * u * s * cy + s * s * d.y);
      }
      g.stroke();
    }
  }

  function pintarHoja(g, h, crece) {
    const k = suaveSalida(clamp01(crece * 1.4 - h.retraso));
    if (k <= 0) return;
    const altura = 1 - h.v0;
    const vaiven = Math.sin(t * 0.7 + h.fase) * (0.03 + 0.05 * altura);
    const L = h.largo * caja.h * k;
    const A = h.ancho * caja.w;
    const curva = h.curva * L;
    g.save();
    g.translate(h.u0 * caja.w, h.v0 * caja.h);
    g.rotate(h.ang - Math.PI / 2 + vaiven);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.3, -A, L * 0.75, -A * 0.6 + curva, L, curva * 1.4);
    g.bezierCurveTo(L * 0.75, A * 0.6 + curva, L * 0.3, A, 0, 0);
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, h.atras ? '#123524' : '#1b4332');
    gr.addColorStop(0.5, h.atras ? '#2d6a4f' : '#40916c');
    gr.addColorStop(1, h.atras ? '#52b788' : '#95d5b2');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = '#081c15';
    g.lineWidth = lw * 0.7;
    g.stroke();
    g.strokeStyle = '#b7e4c7';
    g.globalAlpha = 0.45;
    g.lineWidth = lw * 0.5;
    g.beginPath();
    g.moveTo(L * 0.05, 0);
    g.quadraticCurveTo(L * 0.6, curva * 0.5, L * 0.92, curva * 1.3);
    g.stroke();
    g.globalAlpha = 1;
    g.restore();
  }

  function pintarCapullo(g, b) {
    const p = posCapullo(b);
    if (p.k <= 0) return;
    const L = b.s * caja.w * suaveSalida(p.k);
    const A = L * 0.24;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(b.ang - Math.PI / 2 + Math.sin(t * 0.9 + b.fase) * 0.05);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.2, -A * 1.2, L * 0.8, -A, L, 0);
    g.bezierCurveTo(L * 0.8, A, L * 0.2, A * 1.2, 0, 0);
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, '#2d6a4f');
    gr.addColorStop(0.45, mezclar('#2d6a4f', b.color, 0.5));
    gr.addColorStop(1, b.color);
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = '#0b2618';
    g.lineWidth = lw * 0.7;
    g.stroke();
    g.restore();
  }

  function pintarPetalo(g, L, A, P, interior) {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.25, -A * 0.9, L * 0.7, -A * 0.75, L, 0);
    g.bezierCurveTo(L * 0.7, A * 0.75, L * 0.25, A * 0.9, 0, 0);
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, P.base);
    gr.addColorStop(0.28, P.medio);
    gr.addColorStop(1, P.punta);
    g.fillStyle = gr;
    g.fill();
    // sombra hacia los bordes: el pétalo se ve curvo y los caracteres se aclaran en los lados
    const sombra = g.createLinearGradient(0, -A * 0.8, 0, A * 0.8);
    sombra.addColorStop(0, 'rgba(0,0,0,0.4)');
    sombra.addColorStop(0.5, 'rgba(0,0,0,0)');
    sombra.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = sombra;
    g.fill();
    g.strokeStyle = P.borde;
    g.lineWidth = lw * 0.9;
    g.stroke();
    // nervio central
    g.strokeStyle = interior ? P.punta : P.medio;
    g.globalAlpha = 0.55;
    g.lineWidth = lw * 0.45;
    g.beginPath();
    g.moveTo(L * 0.15, 0);
    g.lineTo(L * 0.85, 0);
    g.stroke();
    g.globalAlpha = 1;
    // motas cerca del centro
    if (P.manchas) {
      g.fillStyle = P.manchas;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(L * (0.18 + 0.07 * i), (i % 2 ? 1 : -1) * A * 0.2, lw * 0.45, 0, TAU);
        g.fill();
      }
    }
  }

  function pintarLirio(g, l) {
    const p = posLirio(l);
    if (p.L <= 0.5) return;
    const P = PALETAS[l.p];
    const L = p.L;
    const A = L * 0.22; // ancho del pétalo: estrecho, para que se vea la estrella de seis puntas
    const abre = (1 - Math.min(1, p.k)) * 0.5; // los pétalos se despliegan al abrir
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.scale(1, l.ty);
    for (const interior of [0, 1]) {
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate((i * TAU) / 3 + interior * (TAU / 6) + l.giro + (interior ? -abre : abre));
        pintarPetalo(g, L * (interior ? 0.92 : 1), A * (interior ? 0.85 : 1) * (0.45 + 0.55 * Math.min(1, p.k)), P, interior);
        g.restore();
      }
    }
    // garganta
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.24);
    gr.addColorStop(0, P.garganta);
    gr.addColorStop(1, rgba(P.garganta, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, L * 0.24, 0, TAU);
    g.fill();
    // estambres
    if (p.k > 0.6) {
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + TAU / 12 + l.giro;
        const r = L * 0.5 * Math.min(1, p.k);
        g.strokeStyle = '#d8f3dc';
        g.lineWidth = lw * 0.4;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        g.stroke();
        g.fillStyle = '#a0461a';
        g.beginPath();
        g.ellipse(Math.cos(a) * r, Math.sin(a) * r, lw * 0.8, lw * 0.5, a, 0, TAU);
        g.fill();
      }
    }
    // brillo al abrirse o al tocarlo
    if (l.brillo > 0.02) {
      g.globalCompositeOperation = 'lighter';
      const gb = g.createRadialGradient(0, 0, 0, 0, 0, L);
      gb.addColorStop(0, `rgba(255,255,255,${0.5 * l.brillo})`);
      gb.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gb;
      g.beginPath();
      g.arc(0, 0, L, 0, TAU);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
  }

  function pintarRamo() {
    const g = ctxPintura;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, lienzoPintura.width, lienzoPintura.height);
    g.setTransform((K * cols) / caja.w, 0, 0, (K * filas) / caja.h, 0, 0);
    const crece = clamp01((intro - 0.2) / 1.0) * cierre;
    pintarTallos(g, crece);
    for (const h of hojas) if (h.atras) pintarHoja(g, h, crece);
    for (const b of capullos) pintarCapullo(g, b);
    for (const l of lirios) pintarLirio(g, l);
    for (const h of hojas) if (!h.atras) pintarHoja(g, h, crece);
  }

  // ───────────────────────── Texto en capas pre-renderizadas ─────────────────────────
  function prepararTexto(g, fuente) {
    g.font = fuente;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  }

  function nuevaCapa(x, y, w, h, fuente) {
    const dx = Math.floor(x * dpr);
    const dy = Math.floor(y * dpr);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((x + w) * dpr) - dx);
    c.height = Math.max(1, Math.ceil((y + h) * dpr) - dy);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -dx, -dy);
    prepararTexto(g, fuente);
    return { c, g, dx, dy };
  }

  function capaDeCeldas(celdas, fuente, cwC, chC) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const k of celdas) {
      if (k.x < x0) x0 = k.x;
      if (k.x > x1) x1 = k.x;
      if (k.y < y0) y0 = k.y;
      if (k.y > y1) y1 = k.y;
    }
    if (!celdas.length) x0 = x1 = y0 = y1 = 0;
    const capa = nuevaCapa(x0 - cwC, y0 - chC, x1 - x0 + cwC * 2, y1 - y0 + chC * 2, fuente);
    for (const k of celdas) {
      capa.g.globalAlpha = k.a ?? 1;
      capa.g.fillStyle = k.color;
      capa.g.fillText(k.ch, k.x, k.y);
    }
    capa.g.globalAlpha = 1;
    return capa;
  }

  function pintarCapa(capa) {
    if (!capa) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(capa.c, capa.dx, capa.dy);
    ctx.restore();
  }

  const cacheBrillos = new Map();
  function brillo(color) {
    let s = cacheBrillos.get(color);
    if (s) return s;
    const [r, g, b] = rgb(color);
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const x = s.getContext('2d');
    const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.2, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.14)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grad;
    x.fillRect(0, 0, 64, 64);
    cacheBrillos.set(color, s);
    return s;
  }

  function pintarBrillo(color, x, y, radio, alfa) {
    if (alfa <= 0.01 || radio <= 0) return;
    ctx.globalAlpha = Math.min(1, alfa);
    ctx.drawImage(brillo(color), x - radio, y - radio, radio * 2, radio * 2);
  }

  // ───────────────────────── Texto japonés → arte ASCII ─────────────────────────
  // filasPorLetra: cuántas filas de caracteres ocupa cada letra japonesa (más = más legible)
  function arteTexto(texto, zona, filasPorLetra, colorDe) {
    let S = zona.h * 0.9;
    ctxTexto.font = `900 ${S}px ${FUENTE_JP}`;
    let ancho = ctxTexto.measureText(texto).width;
    if (ancho > zona.w) {
      S *= zona.w / ancho;
      ctxTexto.font = `900 ${S}px ${FUENTE_JP}`;
      ancho = ctxTexto.measureText(texto).width;
    }
    // la rejilla se ajusta al tamaño final de la letra, no al hueco disponible
    const fsF = Math.max(3.5, S / filasPorLetra / ALTO_LINEA);
    const chF = fsF * ALTO_LINEA;
    const cwF = fsF * proporcion;
    const columnas = Math.ceil(ancho / cwF) + 2;
    const renglones = Math.ceil((S * 1.15) / chF) + 1;
    const k = 2;
    lienzoTexto.width = Math.ceil(columnas * cwF * k);
    lienzoTexto.height = Math.ceil(renglones * chF * k);
    const g = ctxTexto;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, columnas * cwF, renglones * chF);
    g.font = `900 ${S}px ${FUENTE_JP}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(texto, (columnas * cwF) / 2, (renglones * chF) / 2);
    const { data, width, height } = g.getImageData(0, 0, lienzoTexto.width, lienzoTexto.height);

    const celdas = [];
    for (let f = 0; f < renglones; f++) {
      for (let c = 0; c < columnas; c++) {
        let suma = 0;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const sx = Math.min(width - 1, Math.floor((c + (i + 0.5) / 3) * cwF * k));
            const sy = Math.min(height - 1, Math.floor((f + (j + 0.5) / 3) * chF * k));
            suma += data[(sy * width + sx) * 4 + 3];
          }
        }
        const cov = suma / (9 * 255);
        if (cov < 0.12) continue;
        const u = columnas > 1 ? c / (columnas - 1) : 0.5;
        celdas.push({
          x: (c + 0.5 - columnas / 2) * cwF,
          y: (f + 0.5 - renglones / 2) * chF,
          ch: RAMPA[Math.min(9, Math.floor(cov * 10))],
          cov,
          u,
          color: colorDe(u, cov),
        });
      }
    }
    return { celdas, fuente: `400 ${fsF}px ${FUENTE}`, fsF, cwF, chF, ancho: columnas * cwF, alto: renglones * chF };
  }

  function construirTextos() {
    if (!CONFIG) {
      // sin dedicatoria: solo el ramo
      nombreArte = null;
      frasesArte = [];
      rectNombre = rectMsg = { cx: -9999, cy: -9999, w: 0, h: 0 };
      return;
    }
    const zn = zonaNombre;
    nombreArte = arteTexto(CONFIG.nombre, zn, 14, (u) => mezclar('#ff8fab', '#ffd6a5', u));
    const A = nombreArte;
    const celdas = A.celdas.map((c) => ({
      x: zn.cx + c.x,
      y: zn.cy + c.y,
      ch: c.ch,
      color: c.color,
      a: 0.6 + 0.4 * c.cov,
      revela: 0.35 + c.u * 1.1 + Math.random() * 0.35,
    }));
    A.abs = celdas;
    A.capaColor = capaDeCeldas(celdas, A.fuente, A.cwF, A.chF);
    A.capaBrillo = capaDeCeldas(celdas.map((c) => ({ ...c, color: '#ffffff', a: 1 })), A.fuente, A.cwF, A.chF);
    A.tmp = document.createElement('canvas');
    A.tmp.width = A.capaBrillo.c.width;
    A.tmp.height = A.capaBrillo.c.height;
    A.tmpCtx = A.tmp.getContext('2d');
    A.halos = celdas.filter((c, i) => i % 6 === 0 && c.a > 0.85);
    rectNombre = { cx: zn.cx, cy: zn.cy, w: A.ancho, h: A.alto };

    // más filas por letra que el nombre: los kanji tienen muchos trazos
    frasesArte = CONFIG.frases.map((f) => arteTexto(f, zonaMsg, 18, (u, cov) => mezclar('#ff8fab', '#fff0f3', clamp01(cov * 1.1 - 0.1))));
    const anchoMax = Math.max(1, ...frasesArte.map((a) => a.ancho));
    const altoMax = Math.max(1, ...frasesArte.map((a) => a.alto));
    rectMsg = { cx: zonaMsg.cx, cy: zonaMsg.cy, w: anchoMax, h: altoMax };
  }

  // ───────────────────────── Cielo y luciérnagas ─────────────────────────
  function dentroDe(x, y, z, m = 0) {
    return Math.abs(x - z.cx) < z.w / 2 + m && Math.abs(y - z.cy) < z.h / 2 + m;
  }

  const zonaCaja = () => ({ cx: caja.x + caja.w / 2, cy: caja.y + caja.h / 2, w: caja.w, h: caja.h });

  function construirCielo() {
    estrellas = [];
    const n = Math.round((W * H) / 6500);
    const zc = zonaCaja();
    for (let i = 0; i < n * 3 && estrellas.length < n; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      if (dentroDe(x, y, rectNombre, 8) || dentroDe(x, y, rectMsg, 8) || dentroDe(x, y, zc, -caja.w * 0.08)) continue;
      const r = Math.random(), q = Math.random();
      estrellas.push({
        x, y,
        ch: r < 0.65 ? '.' : r < 0.85 ? '+' : r < 0.95 ? "'" : '*',
        color: q < 0.6 ? '#e8e4ff' : q < 0.85 ? '#ffe3ec' : '#fff1d6',
        base: 0.15 + Math.random() * 0.5,
        vel: 0.4 + Math.random() * 2,
        fase: Math.random() * TAU,
      });
    }
  }

  function construirLuciernagas() {
    const n = Math.round(clamp((W * H) / 40000, 6, 16));
    luciernagas = Array.from({ length: n }, () => ({
      x0: clamp(caja.x + entre(-0.15, 1.15) * caja.w, 12, W - 12),
      y0: caja.y + entre(0, 0.9) * caja.h,
      ax: entre(18, 55) * esc,
      ay: entre(10, 35) * esc,
      fx: entre(0.08, 0.25),
      fy: entre(0.1, 0.3),
      f1: Math.random() * TAU,
      f2: Math.random() * TAU,
      pulso: entre(0.6, 1.4),
      f3: Math.random() * TAU,
    }));
  }

  // ───────────────────────── Disposición (primero móvil) ─────────────────────────
  function recalcular() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    lienzo.width = Math.round(W * dpr);
    lienzo.height = Math.round(H * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `400 100px ${FUENTE}`;
    proporcion = ctx.measureText('M').width / 100;

    fsUI = clamp(Math.min(W, H) / 30, 12, 20);
    esc = fsUI / 14;
    cwUI = fsUI * proporcion;
    fuenteBase = `400 ${fsUI}px ${FUENTE}`;
    fuenteChica = `400 ${fsUI * 0.85}px ${FUENTE}`;
    fuenteGrande = `700 ${fsUI * 1.15}px ${FUENTE}`;

    const arriba = zonaSegura.getBoundingClientRect().height + 12;
    const abajo = panel.getBoundingClientRect().height + 6;
    const alto = Math.max(320, H - arriba - abajo);
    horizontal = W >= 720 && W > H * 1.15;

    let bw, bh, bxC, byTop;
    if (!CONFIG) {
      // sin dedicatoria: el ramo ocupa todo el espacio, centrado
      bh = alto * 0.96;
      bw = Math.min(W - 24, bh * ASPECTO);
      bh = bw / ASPECTO;
      bxC = W / 2;
      byTop = arriba + (alto - bh) / 2;
    } else if (horizontal) {
      // pantallas anchas: ramo a la izquierda, nombre y mensaje a la derecha
      bh = alto;
      bw = Math.min(W * 0.5 - 24, bh * ASPECTO);
      bh = bw / ASPECTO;
      bxC = Math.max(W * 0.29, bw / 2 + 16);
      byTop = arriba + (alto - bh) / 2;
      const derecha = bxC + bw / 2;
      const cxTexto = (derecha + W) / 2;
      const anchoTexto = W - derecha - 48;
      zonaNombre = { cx: cxTexto, cy: arriba + alto * 0.33, w: anchoTexto, h: clamp(alto * 0.24, 70, 190) };
      zonaMsg = { cx: cxTexto, cy: arriba + alto * 0.66, w: anchoTexto, h: clamp(alto * 0.21, 60, 170) };
    } else {
      // móvil y pantallas verticales: nombre arriba, ramo en medio, mensaje abajo
      const hN0 = clamp(alto * 0.14, 56, 150);
      const hM0 = clamp(alto * 0.16, 56, 150);
      const hueco0 = clamp(alto * 0.02, 6, 18);
      bh = alto - hN0 - hM0 - hueco0 * 2;
      bw = Math.min(W - 24, bh * ASPECTO);
      bh = bw / ASPECTO;
      const resto = alto - bh;
      const hN = clamp(resto * 0.44, 56, 170);
      const hM = clamp(resto * 0.48, 56, 160);
      const hueco = Math.max(0, (resto - hN - hM) / 3);
      const yNombre = arriba + hueco * 0.5;
      byTop = yNombre + hN + hueco;
      bxC = W / 2;
      zonaNombre = { cx: W / 2, cy: yNombre + hN / 2, w: W - 32, h: hN };
      zonaMsg = { cx: W / 2, cy: byTop + bh + hueco + hM / 2, w: W - 32, h: hM };
    }

    // rejilla del ramo: celdas con un número entero de píxeles del dispositivo
    const cellW = Math.max(2, Math.round(clamp(bw / 110, 3, 6) * dpr));
    const cellH = Math.max(4, Math.round((cellW * ALTO_LINEA) / proporcion));
    cols = Math.max(10, Math.floor((bw * dpr) / cellW));
    filas = Math.max(10, Math.floor((bh * dpr) / cellH));
    cwR = cellW / dpr;
    lw = cwR;
    const anchoReal = cols * cwR, altoReal = (filas * cellH) / dpr;
    caja = {
      x: Math.round((bxC - anchoReal / 2) * dpr) / dpr,
      y: Math.round((byTop + (bh - altoReal) / 2) * dpr) / dpr,
      w: anchoReal,
      h: altoReal,
    };
    escCaja = caja.w / 360;
    lienzoPintura.width = cols * K;
    lienzoPintura.height = filas * K;
    render.preparar(cols, filas, cellW, cellH, construirAtlas(cellW, cellH), RAMPA_RAMO.length);

    prepararTexto(ctx, fuenteBase);
    construirTextos();
    construirCielo();
    construirLuciernagas();
    cantidadPetalos = Math.round(clamp((W * H) / 14000, 16, 60) * (movReducido ? 0.4 : 1));

    const cx = caja.x + caja.w / 2, cy = caja.y + caja.h * 0.45;
    gradAmbiente = ctx.createRadialGradient(cx, cy, 0, cx, cy, caja.h * 0.7);
    gradAmbiente.addColorStop(0, 'rgba(255,150,190,0.09)');
    gradAmbiente.addColorStop(0.55, 'rgba(255,120,170,0.03)');
    gradAmbiente.addColorStop(1, 'rgba(255,120,170,0)');

    if (msg.idx >= 0 && msg.fase !== 'espera') iniciarFrase(msg.idx); // recoloca el mensaje
  }

  // ───────────────────────── Flores ─────────────────────────
  function programarFloracion(base) {
    const r = movReducido ? -5 : 0;
    for (const l of lirios) l.tFlor = base + (r || 1.2 + l.orden * 0.22);
    capullos.forEach((b, i) => { b.tFlor = base + (r || 1.0 + i * 0.15); });
  }

  // posición de un lirio en la pantalla
  function centroLirio(l) {
    const p = posLirio(l);
    return { x: caja.x + p.x, y: caja.y + p.y, L: p.L, k: p.k };
  }

  function lirioAbiertoAlAzar() {
    const abiertos = lirios.filter((l) => t - l.tFlor > 0.6);
    return abiertos.length ? azarDe(abiertos) : azarDe(lirios);
  }

  function tocarLirio(l) {
    l.tPulso = t;
    l.brillo = 1;
    const c = centroLirio(l);
    const P = PALETAS[l.p];
    rafagaPetalos(c.x, c.y, 12, [P.medio, P.punta, P.base]);
  }

  // ───────────────────────── Partículas: pétalos y destellos ─────────────────────────
  function nuevoPetalo(x, y, color, vx = 0, vy = null) {
    const z = Math.random();
    const caida = (16 + z * 26) * esc * (movReducido ? 0.5 : 1);
    return {
      x, y, z, color,
      vx,
      vy: vy === null ? caida : vy,
      caida,
      giro: Math.random() * 6,
      velGiro: entre(3, 8),
      frec: entre(0.6, 1.6),
      fase: Math.random() * TAU,
      amp: entre(6, 18) * esc,
    };
  }

  function rafagaPetalos(x, y, n, colores) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const v = entre(50, 170) * esc;
      if (petalos.length < 220) petalos.push(nuevoPetalo(x, y, azarDe(colores), Math.cos(ang) * v, Math.sin(ang) * v - 50 * esc));
    }
    for (let i = 0; i < 4; i++) centelleo(x + entre(-2, 2) * cwUI, y + entre(-1.5, 1.5) * cwUI * 2, '#fff0f3', entre(0.4, 0.8));
  }

  function centelleo(x, y, color, vida) {
    if (chispas.length < 300) chispas.push({ x, y, color, vida, max: vida });
  }

  // ───────────────────────── Mensaje hecho de pétalos ─────────────────────────
  const DUR_VUELO = movReducido ? 0.01 : 1.7;

  function nuevaParticula() {
    return { x: 0, y: 0, sx: 0, sy: 0, cx: 0, cy: 0, tx: 0, ty: 0, ch: '.', color: '#fff', colorPetalo: azarDe(ROSAS), alfa: 0, estado: 'cae', desaparecer: true, retraso: 0, giro: Math.random() * 6, velGiro: entre(4, 9), vx: 0, vy: 0 };
  }

  function salirDeFlor(p) {
    const l = lirioAbiertoAlAzar();
    const c = centroLirio(l);
    const ang = Math.random() * TAU, r = Math.random() * c.L * 0.6;
    p.x = c.x + Math.cos(ang) * r;
    p.y = c.y + Math.sin(ang) * r * l.ty;
    p.alfa = 0;
    p.colorPetalo = PALETAS[l.p].medio;
  }

  function iniciarFrase(k) {
    const arte = frasesArte[k];
    if (!arte) return;
    msg.idx = k;
    msg.fase = 'reunir';
    msg.tFase = t;
    marcarFrase(k);

    const objetivos = arte.celdas.map((c) => ({ x: zonaMsg.cx + c.x, y: zonaMsg.cy + c.y, ch: c.ch, color: c.color }));
    objetivos.sort((a, b) => a.x - b.x);
    while (particulas.length < objetivos.length) particulas.push(nuevaParticula());

    // primero se reutilizan los pétalos que ya están a la vista; el resto sale de las flores
    const visibles = particulas.filter((p) => p.alfa > 0.05);
    const ocultas = particulas.filter((p) => p.alfa <= 0.05);
    const usar = visibles.slice(0, objetivos.length);
    for (const p of visibles.slice(objetivos.length)) {
      p.estado = 'cae';
      p.desaparecer = true;
    }
    for (const p of ocultas) {
      if (usar.length >= objetivos.length) break;
      salirDeFlor(p);
      usar.push(p);
    }
    usar.sort((a, b) => a.x - b.x);
    usar.forEach((p, i) => {
      const o = objetivos[i];
      p.sx = p.x;
      p.sy = p.y;
      p.tx = o.x;
      p.ty = o.y;
      p.ch = o.ch;
      p.color = o.color;
      p.cx = (p.sx + p.tx) / 2 + entre(-40, 40) * esc;
      p.cy = Math.min(p.sy, p.ty) - entre(40, 130) * esc;
      p.retraso = ((o.x - zonaMsg.cx) / Math.max(1, rectMsg.w) + 0.5) * 0.6 + Math.random() * 0.3;
      p.estado = 'vuela';
      p.desaparecer = false;
    });
  }

  function soltarFrase() {
    msg.fase = 'soltar';
    msg.tFase = t;
    for (const p of particulas) {
      if (p.estado === 'cae') continue;
      p.estado = 'cae';
      p.desaparecer = false;
      p.vx = entre(-25, 25) * esc;
      p.vy = -entre(10, 50) * esc;
      p.colorPetalo = azarDe(ROSAS);
    }
  }

  function marcarFrase(k) {
    lineaMensaje.querySelectorAll('.frase').forEach((s, i) => s.classList.toggle('activa', i === k));
  }

  function caer(p, dt) {
    p.vy = Math.min(p.vy + 40 * esc * dt, 55 * esc);
    p.x += (p.vx + viento * 0.6 + Math.sin(t * 2 + p.giro) * 12 * esc) * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.5, dt);
    p.giro += p.velGiro * dt;
  }

  function actualizarMensaje(dt) {
    if (!frasesArte.length) return;
    if (msg.fase === 'espera') {
      if (intro > 4.4) iniciarFrase(0);
    } else if (msg.fase === 'reunir') {
      if (!particulas.some((p) => p.estado === 'vuela') || t - msg.tFase > 4) {
        msg.fase = 'mostrar';
        msg.tFase = t;
      }
    } else if (msg.fase === 'mostrar') {
      const ultima = msg.idx === frasesArte.length - 1;
      if (t - msg.tFase > (ultima ? 5 : 3.2)) {
        soltarFrase();
        if (ultima) iniciarCierre(); // tras la última frase, el ramo se cierra y todo vuelve a empezar
      }
    } else if (msg.fase === 'soltar' && t - msg.tFase > 1.3 && tCierre < 0) {
      if (msg.idx + 1 >= frasesArte.length) iniciarCierre();
      else iniciarFrase(msg.idx + 1);
    }

    for (const p of particulas) {
      if (p.estado === 'vuela') {
        const tau = clamp01((t - msg.tFase - p.retraso) / DUR_VUELO);
        if (tau <= 0) {
          // mientras espera su turno sigue cayendo, y el vuelo saldrá desde ahí
          if (p.alfa > 0.05) {
            caer(p, dt);
            p.sx = p.x;
            p.sy = p.y;
          }
          continue;
        }
        p.alfa = Math.min(1, p.alfa + dt * 3);
        const e = suaveIO(tau), u = 1 - e;
        p.x = u * u * p.sx + 2 * u * e * p.cx + e * e * p.tx;
        p.y = u * u * p.sy + 2 * u * e * p.cy + e * e * p.ty;
        p.giro += p.velGiro * dt;
        if (tau >= 1) p.estado = 'quieta';
      } else if (p.estado === 'cae' && p.alfa > 0) {
        caer(p, dt);
        if (p.desaparecer || p.y > H + 10) p.alfa = Math.max(0, p.alfa - dt * 0.8);
      }
    }
  }

  // ───────────────────────── Actualización ─────────────────────────
  function actualizar(dt) {
    brilloNombre = Math.max(0, brilloNombre - dt * 0.6);
    vientoDedo *= Math.pow(0.25, dt);
    const brisa = Math.sin(t * 0.17) * 10 + Math.sin(t * 0.43 + 1) * 6;
    viento += (brisa + vientoDedo - viento) * Math.min(1, dt * 2);

    for (const l of lirios) {
      // destello al terminar de abrirse
      if (!l.abierto && t - l.tFlor > 0.9) {
        l.abierto = true;
        l.brillo = Math.max(l.brillo, 0.7);
        const c = centroLirio(l);
        for (let i = 0; i < 4; i++) centelleo(c.x + entre(-1, 1) * c.L, c.y + entre(-0.6, 0.6) * c.L, '#fff0f3', entre(0.4, 0.9));
      }
      if (t < l.tFlor) l.abierto = false;
      l.brillo = Math.max(0, l.brillo - dt * 1.6);
    }

    // cierre del ramo y vuelta a empezar (sin mensaje, el ciclo lo marca el tiempo)
    if (!frasesArte.length && tCierre < 0 && intro > 16) iniciarCierre();
    cierre = tCierre < 0 ? 1 : 1 - suaveIO(clamp01((t - tCierre) / DUR_CIERRE));
    if (tCierre >= 0 && t - tCierre > DUR_CIERRE + 0.5) reiniciar();

    actualizarPetalos(dt);
    actualizarMensaje(dt);
    actualizarMariposa(dt);

    for (let i = chispas.length - 1; i >= 0; i--) {
      chispas[i].vida -= dt;
      if (chispas[i].vida <= 0) {
        chispas[i] = chispas[chispas.length - 1];
        chispas.pop();
      }
    }

    // destellos que recorren el nombre de vez en cuando
    if (intro > 2.2 && nombreArte && nombreArte.halos.length) {
      acumNombre += dt * (1.2 + brilloNombre * 10);
      while (acumNombre >= 1) {
        acumNombre -= 1;
        const c = azarDe(nombreArte.halos);
        centelleo(c.x, c.y, '#fff7e6', entre(0.4, 0.8));
      }
    }
  }

  function actualizarPetalos(dt) {
    // pétalos que caen desde arriba
    if (intro > 2.5 && petalos.length < cantidadPetalos && Math.random() < dt * 3) {
      petalos.push(nuevoPetalo(Math.random() * W, -12, azarDe(ROSAS)));
    }
    // y alguno que se suelta de los lirios
    if (intro > 3.5 && !movReducido) {
      acumFlor += dt * 0.7;
      while (acumFlor >= 1) {
        acumFlor -= 1;
        const l = lirioAbiertoAlAzar();
        const c = centroLirio(l);
        petalos.push(nuevoPetalo(c.x + entre(-0.6, 0.6) * c.L, c.y, PALETAS[l.p].medio, entre(-15, 15) * esc, 5 * esc));
      }
    }

    const R = 60 + 30 * esc;
    for (let i = petalos.length - 1; i >= 0; i--) {
      const p = petalos[i];
      p.vx += (viento * (0.4 + p.z * 0.8) - p.vx) * Math.min(1, dt * 0.9);
      p.vy += (p.caida - p.vy) * Math.min(1, dt * 1.2);
      if (puntero.activo) {
        const dx = p.x - puntero.x, dy = p.y - puntero.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 > 1) {
          const d = Math.sqrt(d2), f = (1 - d / R) * 900 * dt;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
      p.x += (p.vx + Math.sin(t * p.frec + p.fase) * p.amp) * dt;
      p.y += p.vy * dt;
      p.giro += p.velGiro * dt;
      if (p.y > H + 20 || p.x < -60 || p.x > W + 60) {
        petalos[i] = petalos[petalos.length - 1];
        petalos.pop();
      }
    }
  }

  function destinoMariposa(m) {
    if (m.flor) {
      const c = centroLirio(m.flor);
      return { x: c.x, y: c.y - c.L * 0.25 * m.flor.ty };
    }
    return m.objetivo;
  }

  function elegirDestino(m) {
    if (Math.random() < 0.55) {
      m.flor = lirioAbiertoAlAzar();
      m.objetivo = null;
    } else {
      m.flor = null;
      m.objetivo = { x: clamp(caja.x + entre(-0.15, 1.15) * caja.w, 20, W - 20), y: clamp(caja.y + entre(0, 0.7) * caja.h, 20, H - 20) };
    }
  }

  function actualizarMariposa(dt) {
    if (!mariposa) {
      if (intro > 5) {
        mariposa = { x: -20, y: caja.y + caja.h * 0.3, vx: 40 * esc, vy: 0, objetivo: null, flor: null, estado: 'vuela', hasta: 0, aleteo: 0 };
        elegirDestino(mariposa);
      }
      return;
    }
    const m = mariposa;
    // si el ramo se está cerrando, la mariposa no se queda en una flor
    if (tCierre >= 0 && m.flor) {
      m.flor = null;
      m.objetivo = { x: clamp(caja.x + entre(-0.2, 1.2) * caja.w, 20, W - 20), y: clamp(caja.y - entre(0, 0.2) * caja.h, 20, H - 20) };
      m.estado = 'vuela';
    }
    const d0 = destinoMariposa(m);
    if (m.estado === 'posada') {
      m.x = d0.x;
      m.y = d0.y;
      m.aleteo += dt * 2.2;
      if (t > m.hasta) {
        m.estado = 'vuela';
        m.vy = -40 * esc;
        elegirDestino(m);
      }
      return;
    }
    const dx = d0.x - m.x, dy = d0.y - m.y, d = Math.hypot(dx, dy);
    const vel = (movReducido ? 30 : 70) * esc;
    m.vx += ((dx / (d || 1)) * vel - m.vx) * Math.min(1, dt * 1.6) + Math.sin(t * 7) * 30 * esc * dt;
    m.vy += ((dy / (d || 1)) * vel - m.vy) * Math.min(1, dt * 1.6) + Math.cos(t * 5.3) * 40 * esc * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.aleteo += dt * 14;
    if (d < 6 * esc) {
      if (m.flor) {
        m.estado = 'posada';
        m.hasta = t + entre(2.5, 4.5);
      } else {
        elegirDestino(m);
      }
    }
  }

  // ───────────────────────── Dibujo ─────────────────────────
  function dibujar() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = FONDO;
    ctx.fillRect(0, 0, W, H);

    if (intro > 0.4) {
      ctx.globalAlpha = clamp01((intro - 0.4) / 1.5);
      ctx.fillStyle = gradAmbiente;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    dibujarEstrellas();
    dibujarRamo();
    dibujarLuciernagas();
    dibujarMariposa();
    dibujarNombre();
    dibujarMensaje();
    dibujarPetalos();
    dibujarChispas();
    ctx.globalAlpha = 1;
  }

  function dibujarEstrellas() {
    ctx.font = fuenteChica;
    for (const s of estrellas) {
      ctx.globalAlpha = s.base * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.vel + s.fase)));
      ctx.fillStyle = s.color;
      ctx.fillText(s.ch, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  function dibujarRamo() {
    pintarRamo();
    render.pintar(lienzoPintura, t);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(render.lienzo, Math.round(caja.x * dpr), Math.round(caja.y * dpr));
    ctx.restore();
  }

  function dibujarLuciernagas() {
    const a = clamp01((intro - 1) / 1.5);
    if (a <= 0) return;
    ctx.font = fuenteChica;
    for (const l of luciernagas) {
      const x = l.x0 + Math.sin(t * l.fx + l.f1) * l.ax;
      const y = l.y0 + Math.cos(t * l.fy + l.f2) * l.ay;
      const b = Math.pow(0.5 + 0.5 * Math.sin(t * l.pulso + l.f3), 2) * a;
      ctx.globalCompositeOperation = 'lighter';
      pintarBrillo('#d8ff7a', x, y, cwUI * 2.2, b * 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = b;
      ctx.fillStyle = '#f3ffbd';
      ctx.fillText('.', x, y);
    }
    ctx.globalAlpha = 1;
  }

  function dibujarMariposa() {
    if (!mariposa) return;
    const m = mariposa;
    const alas = ['}{', ')(', '||', ')('][Math.floor(m.aleteo) % 4];
    ctx.globalCompositeOperation = 'lighter';
    pintarBrillo('#b8a1ff', m.x, m.y, cwUI * 2, 0.25);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.font = fuenteGrande;
    ctx.fillStyle = '#cdb4ff';
    ctx.fillText(alas, m.x, m.y);
  }

  function dibujarNombre() {
    const A = nombreArte;
    if (!A) return;

    // al cargar, el nombre se "decodifica" de izquierda a derecha
    if (intro < 2.2) {
      ctx.font = A.fuente;
      for (const c of A.abs) {
        if (intro < c.revela - 0.45) continue;
        if (intro < c.revela) {
          ctx.globalAlpha = 0.35 * cierre;
          ctx.fillStyle = '#ff8fab';
          ctx.fillText(RAMPA[1 + ((Math.random() * 9) | 0)], c.x, c.y);
        } else {
          ctx.globalAlpha = c.a * cierre;
          ctx.fillStyle = c.color;
          ctx.fillText(c.ch, c.x, c.y);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const c of A.halos) pintarBrillo('#ff8fab', c.x, c.y, A.cwF * 6, (0.05 + brilloNombre * 0.06) * cierre);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = cierre; // el nombre se desvanece cuando el ramo se cierra
    pintarCapa(A.capaColor);

    // reflejo de luz que recorre el nombre
    const ciclo = brilloNombre > 0.05 ? 1 - brilloNombre : (t % 5) / 5;
    const u = -0.25 + ciclo * 1.6;
    if (u > -0.2 && u < 1.2) {
      const g = A.tmpCtx;
      const w = A.tmp.width, hh = A.tmp.height;
      const centro = u * w, mitad = w * 0.12;
      g.globalCompositeOperation = 'copy';
      g.drawImage(A.capaBrillo.c, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      const grad = g.createLinearGradient(centro - mitad, 0, centro + mitad, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, hh);
      g.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(A.tmp, A.capaBrillo.dx, A.capaBrillo.dy);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function dibujarMensaje() {
    if (!particulas.length || msg.idx < 0) return;
    const arte = frasesArte[msg.idx];
    ctx.font = arte ? arte.fuente : fuenteChica;
    for (const p of particulas) {
      if (p.alfa <= 0.01) continue;
      if (p.estado === 'quieta') {
        ctx.globalAlpha = p.alfa * (0.8 + 0.2 * Math.sin(t * 2.2 + p.tx * 0.05));
        ctx.fillStyle = p.color;
        ctx.fillText(p.ch, p.x, p.y);
      } else {
        ctx.globalAlpha = p.alfa;
        ctx.fillStyle = p.colorPetalo;
        ctx.fillText(VOLTEO[(Math.floor(p.giro) % 6 + 6) % 6], p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function dibujarPetalos() {
    for (let capa = 0; capa < 2; capa++) {
      ctx.font = capa === 0 ? fuenteChica : fuenteBase;
      for (const p of petalos) {
        if ((p.z < 0.5 ? 0 : 1) !== capa) continue;
        ctx.globalAlpha = capa === 0 ? 0.5 : 0.9;
        ctx.fillStyle = p.color;
        ctx.fillText(VOLTEO[(Math.floor(p.giro) % 6 + 6) % 6], p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function dibujarChispas() {
    if (!chispas.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const c of chispas) pintarBrillo(c.color, c.x, c.y, cwUI * 1.4, Math.sin(Math.PI * (c.vida / c.max)) * 0.5);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = fuenteBase;
    for (const c of chispas) {
      const a = Math.sin(Math.PI * (c.vida / c.max));
      ctx.globalAlpha = a;
      ctx.fillStyle = c.color;
      ctx.fillText(a < 0.4 ? '.' : a < 0.8 ? '+' : '*', c.x, c.y);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────── Bucle ─────────────────────────
  function cuadro(ahora) {
    const dt = Math.min(0.05, Math.max(0, (ahora - ultimoCuadro) / 1000));
    ultimoCuadro = ahora;
    t += dt;
    intro += dt;
    actualizar(dt);
    dibujar();
    requestAnimationFrame(cuadro);
  }

  // ───────────────────────── Interacción ─────────────────────────
  function lirioEn(x, y) {
    if (tCierre >= 0) return null;
    for (let i = lirios.length - 1; i >= 0; i--) {
      const l = lirios[i];
      if (t < l.tFlor) continue;
      const c = centroLirio(l);
      const dx = x - c.x, dy = (y - c.y) / l.ty;
      if (dx * dx + dy * dy < (c.L * 0.8) ** 2) return l;
    }
    return null;
  }

  lienzo.addEventListener('pointerdown', (e) => {
    puntero.abajo = true;
    puntero.activo = true;
    puntero.x = e.clientX;
    puntero.y = e.clientY;
    puntero.t = performance.now();
    const l = lirioEn(e.clientX, e.clientY);
    if (l) {
      tocarLirio(l);
    } else if (dentroDe(e.clientX, e.clientY, rectNombre, 10)) {
      brilloNombre = 1;
    } else if (dentroDe(e.clientX, e.clientY, rectMsg, 10) && (msg.fase === 'mostrar' || msg.fase === 'reunir')) {
      soltarFrase();
    } else {
      rafagaPetalos(e.clientX, e.clientY, 12, ROSAS);
    }
  });

  lienzo.addEventListener('pointermove', (e) => {
    const ahora = performance.now();
    const dtp = Math.max(8, ahora - puntero.t) / 1000;
    if (puntero.activo) {
      const vx = (e.clientX - puntero.x) / dtp;
      vientoDedo += (vx * 0.3 - vientoDedo) * 0.2;
      vientoDedo = clamp(vientoDedo, -260, 260);
    }
    // al arrastrar el dedo se deja un rastro de pétalos
    if (puntero.abajo && ahora - puntero.ultimoRastro > 45 && petalos.length < 220) {
      puntero.ultimoRastro = ahora;
      petalos.push(nuevoPetalo(e.clientX, e.clientY, azarDe(ROSAS), ((e.clientX - puntero.x) / dtp) * 0.15, -20 * esc));
    }
    puntero.x = e.clientX;
    puntero.y = e.clientY;
    puntero.t = ahora;
    if (e.pointerType === 'mouse') {
      puntero.activo = true;
      lienzo.style.cursor = lirioEn(e.clientX, e.clientY) ? 'pointer' : 'default';
    }
  });

  const soltarPuntero = (e) => {
    puntero.abajo = false;
    if (e.pointerType !== 'mouse') puntero.activo = false;
  };
  lienzo.addEventListener('pointerup', soltarPuntero);
  lienzo.addEventListener('pointercancel', soltarPuntero);
  lienzo.addEventListener('pointerleave', () => { puntero.activo = false; puntero.abajo = false; });

  // El ramo suelta sus pétalos, se cierra y el nombre se desvanece
  function iniciarCierre() {
    if (tCierre >= 0) return;
    tCierre = t;
    if (msg.fase === 'reunir' || msg.fase === 'mostrar') soltarFrase();
    for (const l of lirios) {
      if (t - l.tFlor < 0.3) continue;
      const c = centroLirio(l);
      const P = PALETAS[l.p];
      for (let i = 0; i < 6 && petalos.length < 220; i++) {
        const ang = Math.random() * TAU, v = entre(30, 110) * esc;
        petalos.push(nuevoPetalo(c.x + Math.cos(ang) * c.L * 0.4, c.y + Math.sin(ang) * c.L * 0.3, azarDe([P.medio, P.punta]), Math.cos(ang) * v, Math.sin(ang) * v - 30 * esc));
      }
    }
  }

  // Todo vuelve a empezar: el nombre se decodifica, crecen las hojas y abren los lirios
  function reiniciar() {
    tCierre = -1;
    cierre = 1;
    intro = movReducido ? 99 : 0;
    programarFloracion(t);
    msg.idx = -1;
    msg.fase = 'espera';
    for (const p of particulas) {
      p.estado = 'cae';
      p.desaparecer = true;
    }
    marcarFrase(-1);
  }

  btnOtraVez.addEventListener('click', iniciarCierre);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === 'r' || e.key === 'R') iniciarCierre();
    else if (e.key === ' ') {
      e.preventDefault();
      if (msg.fase === 'mostrar' || msg.fase === 'reunir') soltarFrase();
    }
  });

  // ───────────────────────── Texto del panel ─────────────────────────
  function construirLinea() {
    lineaMensaje.textContent = '';
    if (!CONFIG) {
      lineaMensaje.hidden = true;
      return;
    }
    lineaMensaje.hidden = false;
    let resto = CONFIG.linea || CONFIG.frases.join(' ');
    // el saludo «nombre + へ» solo se añade si el mensaje no lleva ya el nombre
    if (!resto.includes(CONFIG.nombre)) {
      const saludo = document.createElement('span');
      saludo.className = 'saludo';
      saludo.textContent = `${CONFIG.nombre}へ`;
      lineaMensaje.append(saludo, '　');
    }
    // envuelve cada frase dentro de la línea para poder resaltarla
    for (const f of CONFIG.frases) {
      const i = resto.indexOf(f);
      const s = document.createElement('span');
      s.className = 'frase';
      s.textContent = f;
      if (i < 0) {
        lineaMensaje.append(s, ' ');
        continue;
      }
      lineaMensaje.append(resto.slice(0, i), s);
      resto = resto.slice(i + f.length);
    }
    lineaMensaje.append(resto);
    lienzo.setAttribute('aria-label', `ASCIIで描いた百合の花束。${CONFIG.linea || ''}`);
  }

  // ───────────────────────── Dedicatoria cifrada ─────────────────────────
  // La clave va en la dirección después de «#» (no se envía a ningún servidor).
  async function abrirDedicatoria() {
    const clave = decodeURIComponent(location.hash.slice(1));
    if (!DEDICATORIA || !clave || !window.crypto || !crypto.subtle) return null;
    try {
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
      const llave = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: bytes(DEDICATORIA.sal), iterations: DEDICATORIA.iteraciones, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      );
      const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(DEDICATORIA.iv) }, llave, bytes(DEDICATORIA.datos));
      return JSON.parse(new TextDecoder().decode(claro));
    } catch (error) {
      return null; // clave incorrecta: se muestra solo el ramo
    }
  }

  // ───────────────────────── Arranque ─────────────────────────
  function esperarFuentes() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const cargas = [document.fonts.load(`400 16px "JetBrains Mono"`)];
    if (CONFIG) cargas.push(document.fonts.load(`900 64px "Zen Maru Gothic"`, CONFIG.nombre + CONFIG.frases.join('') + 'へ'));
    return Promise.race([
      Promise.all(cargas).catch(() => {}),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  }

  let listo = false;
  let temporizador = 0;
  function recalcularPronto() {
    if (!listo) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(recalcular, 150);
  }

  render = crearAsciiGL() || crearAscii2D();
  ctxPintura = lienzoPintura.getContext('2d', { willReadFrequently: render.lee });

  window.addEventListener('resize', recalcularPronto);
  if ('ResizeObserver' in window) new ResizeObserver(recalcularPronto).observe(panel);
  window.addEventListener('hashchange', () => location.reload());

  abrirDedicatoria().then((dedicatoria) => {
    CONFIG = dedicatoria;
    if (CONFIG && CONFIG.titulo) {
      document.title = CONFIG.titulo;
      document.querySelector('h1').textContent = CONFIG.titulo;
    }
    construirLinea();
    return esperarFuentes();
  }).then(() => {
    recalcular();
    programarFloracion(t);
    listo = true;
    ultimoCuadro = performance.now();
    requestAnimationFrame(cuadro);
    if (document.fonts) document.fonts.addEventListener('loadingdone', recalcularPronto);
  });
})();
