const canvas = document.getElementById("canvas");
const gl = canvas.getContext("webgl2");

const IDENTITY_VS = `#version 300 es
  in vec4 position;
  void main() { gl_Position = position; }
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
    throw "shader compilation error";
  }

  return shader;
}

function createProgram(vs, fs) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    conole.error("program link error:", gl.getProgramInfoLog(program));
    throw "program link error";
  }

  return program;
}

class Sim {
  constructor(gl, width, height) {
    const makeTexture = (pixels) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return tex;
    };

    const len = Math.pow(2, Math.ceil(Math.log2(width * height)));
    const pixels = new Uint8Array(len);
    for (let i = 0; i < width * height; i++) {
      pixels[i] = Math.random() < 0.2 ? 255 : 0;
    }

    this.width = width;
    this.height = height;
    this.framebuffer = gl.createFramebuffer();
    this.tex0 = makeTexture(pixels);
    this.tex1 = makeTexture(null);
    this.prog = createProgram(
      IDENTITY_VS,
      `#version 300 es
      precision mediump float;
      uniform sampler2D tex;
      out vec4 color;
      
      void main() { 
        ivec2 grid_size = ivec2(${width}, ${height});
        ivec2 grid_pos = ivec2(gl_FragCoord.xy);

        int neighbours = 0;
        for(int i = -1; i <= 1; i++) {
          for(int j = -1; j <= 1; j++) {
            if(i == 0 && j == 0) continue;
            ivec2 neighbour_pos = (grid_pos + ivec2(i, j) + grid_size) % grid_size;
            float value = texture(tex, vec2(neighbour_pos) / vec2(grid_size)).r;
            if(value == 1.0) neighbours++;
          }
        }
      
        bool self = texture(tex, gl_FragCoord.xy / vec2(grid_size)).r == 1.0;
        bool alive = (self && neighbours == 2) || neighbours == 3;
      
        color = vec4(alive ? 1 : 0, 0.0, 0, 1); 
      }
    `
    );

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(this.prog, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  render() {
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    gl.uniform1i(gl.getUniformLocation(this.prog, "tex"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  renderCanvas() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); 
    this.render();
  }

  step() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex1, 0); // render into tex1

    this.render();
    [this.tex0, this.tex1] = [this.tex1, this.tex0];
  }
}

class Blend {
  constructor(gl, width, height) {
    this.width = width;
    this.height = height;
    this.prog = createProgram(
      IDENTITY_VS,
      `#version 300 es
      precision mediump float;

      uniform sampler2D tex0;
      uniform sampler2D tex1;
      uniform float ratio;
      out vec4 color;
      
      float ease(float x) {
        return 2.08333 * x * x * x +
        -3.125 * x * x +
        2.04167 *x;
      }

      void main() {
        vec2 pos = gl_FragCoord.xy / vec2(${width}, ${height});
        float a = texture(tex0, pos).r;
        float b = texture(tex1, pos).r;
        float eased = ease(ratio);
        color = vec4(a * (1. - eased) + b * eased, 0, 0, 1); 
      }
    `
    );
    this.framebuffer = gl.createFramebuffer();
    this.outTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.outTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  blend(tex0, tex1, ratio) {
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.uniform1i(gl.getUniformLocation(this.prog, "tex0"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.uniform1i(gl.getUniformLocation(this.prog, "tex1"), 1);

    gl.uniform1f(gl.getUniformLocation(this.prog, "ratio"), ratio);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  blendTex(tex0, tex1, ratio) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex, 0);

    this.blend(tex0, tex1, ratio);
  }
}

class Blur {
  constructor(gl, width, height) {
    this.width = width;
    this.height = height;
    this.prog = createProgram(
      IDENTITY_VS,
      `#version 300 es
      precision highp float;
      precision highp sampler2D;

      uniform sampler2D tex;
      uniform float ratio;
      out vec4 color_out;

      vec4 cubic(float v) {
        vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
        vec4 s = n * n * n;
        float x = s.x;
        float y = s.y - 4.0 * s.x;
        float z = s.z - 4.0 * s.y + 6.0 * s.x;
        float w = 6.0 - x - y - z;
        return vec4(x, y, z, w) * (1.0/6.0);
      }

      vec4 textureBicubic(sampler2D sampler, vec2 texCoords){
        vec2 texSize = vec2(textureSize(sampler, 0));
        vec2 invTexSize = 1.0 / texSize;
        
        texCoords = texCoords * texSize - 0.5;
        vec2 fxy = fract(texCoords);
        texCoords -= fxy;
    
        vec4 xcubic = cubic(fxy.x);
        vec4 ycubic = cubic(fxy.y);
    
        vec4 c = texCoords.xxyy + vec2 (-0.5, +1.5).xyxy;
        
        vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
        vec4 offset = c + vec4 (xcubic.yw, ycubic.yw) / s;
        
        offset *= invTexSize.xxyy;
        
        vec4 sample0 = texture(sampler, offset.xz);
        vec4 sample1 = texture(sampler, offset.yz);
        vec4 sample2 = texture(sampler, offset.xw);
        vec4 sample3 = texture(sampler, offset.yw);
    
        float sx = s.x / (s.x + s.y);
        float sy = s.z / (s.z + s.w);
    
        return mix(
          mix(sample3, sample2, sx), mix(sample1, sample0, sx)
        , sy);
     }

      void main() {        
        vec3 col = vec3(1, 1, 1) * textureBicubic(tex, gl_FragCoord.xy / vec2(${width}, ${height})).r;
        col *= (vec3(1) + vec3(2, 1, 4) * 0.05);
        col = smoothstep(0.4, 1.0, col);
        col = smoothstep(0.05, 0.1, col);
        color_out = vec4(col, 1);
      }
    `
    );
  }

  blur(outTex) {
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.uniform1i(gl.getUniformLocation(this.prog, "tex"), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

class FPS {
  constructor() {
    this.fpsElem = document.getElementById("fps"); 
    this.lastFrame = performance.now();
  }

  done() {
    const now = performance.now();

    this.fpsElem.innerHTML = (1000 / (now - this.lastFrame)).toFixed(0);

    this.lastFrame = now;
  }
}

function slider(id, fmt, on=()=>{}) {
  const elem = document.getElementById(id);
  const valueElem = document.querySelector(`label[for="${id}"] + span`);
  const updateValue = () => valueElem.innerHTML = fmt(elem.value);
  elem.addEventListener("input", () => {
    updateValue();
    on(elem.value);
  });
  updateValue();
  return elem;
}


const speed = slider("speed", v => (100 * v).toFixed(1));
const fps = new FPS();

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

console.log(canvas.width, canvas.height);

let sim = new Sim(gl, Math.ceil(canvas.width / 50), Math.floor(canvas.height / 50));
let blend = new Blend(gl, sim.width * 2, sim.height * 2);
let blur = new Blur(gl, canvas.width, canvas.height);

let ratio = 0;

function renderLoop() {
  blend.blendTex(sim.tex1, sim.tex0, ratio);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  blur.blur(blend.outTex);

  ratio = ratio += parseFloat(speed.value);

  if (ratio >= 1) {
    sim.step();
    ratio = 0;
  }

  gl.finish();
  fps.done();

  requestAnimationFrame(renderLoop);
}

sim.step();
renderLoop();
