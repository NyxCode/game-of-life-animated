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
    gl.deleteShader(shader);
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
  asdf() {}

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

    this.asdf();

    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) {
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Render to canvas
    //gl.viewport(0, 0, canvas.width, canvas.height); // Match canvas size
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

  blendTex(tex0, tex1, ratio, texout) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texout, 0);

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
      precision mediump float;

      uniform sampler2D tex;
      uniform float ratio;
      out vec4 color_out;

      // https://www.shadertoy.com/view/Xltfzj
      void main() {
        float Pi = 6.28318530718; // Pi*2
    
        float Directions = 64.0;
        float Quality = 8.0;
        float Size = 48.0;
       
        vec2 Radius = Size / vec2(${width}, ${height});
        vec2 uv = gl_FragCoord.xy / vec2(${width}, ${height});
        float color = texture(tex, uv).r;
        
        for(float d = 0.0; d < Pi; d += Pi / Directions) {
          for(float i = 1.0 / Quality; i <= 1.0; i += 1.0 / Quality) {
            color += texture(tex, uv + vec2(cos(d), sin(d)) * Radius * i).r;		
          }
        }
        
        color /= Quality * Directions - 15.0;
        color = smoothstep(0.3, 1.0, color);
        color = smoothstep(0.1, 0.1, color);
        color_out = vec4(color, color, color, 1);
      }
    `
    );

    this.input = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  blur() {
    gl.useProgram(this.prog);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    gl.uniform1i(gl.getUniformLocation(this.prog, "tex"), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

canvas.width = 2048;
canvas.height = 2048;

let sim = new Sim(gl, 16, 16);
let blend = new Blend(gl, 2048, 2048);
let blur = new Blur(gl, 2048, 2048);

let ratio = 0;

function renderLoop() {
  blend.blendTex(sim.tex1, sim.tex0, ratio, blur.input);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  blur.blur();

  ratio = ratio += 0.01;

  if (ratio >= 1) {
    sim.step();
    ratio = 0;
  }

  requestAnimationFrame(renderLoop);
}

sim.step();
renderLoop();
