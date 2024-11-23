const IDENTITY_VS = `#version 300 es
    in vec4 position;
    void main() { gl_Position = position; }
`;

const SIM_FS = `#version 300 es
    precision mediump float;

    uniform ivec2 grid_size;
    uniform sampler2D tex;
    out vec4 color;

    void main() { 
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
`;

const BLEND_FS = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    uniform sampler2D tex0;
    uniform sampler2D tex1;
    uniform float ratio;
    uniform vec2 resolution;
    out vec4 color;

    uniform int n_blank;
    uniform vec2[4] blank0;
    uniform vec2[4] blank1;

    float mixRatio(float ratio) {
        vec2 uv = gl_FragCoord.xy / resolution;

        float dist = distance(uv, vec2(0.5, 0.5));
        float circle = smoothstep(ratio, ratio - .8, dist);

        return min(1., circle + 0.5 * ratio);
    }

    float ease(float x) {
        return 2.08333 * x * x * x + -3.125 * x * x + 2.04167 * x;
    }

    void main() {
        vec2 pos = gl_FragCoord.xy / resolution;
        float a = texture(tex0, pos).r;
        float b = texture(tex1, pos).r;

        for(int i = 0; i < n_blank; i++) {
            vec2 p0 = blank0[i];
            vec2 p1 = blank1[i];
            if(pos.x > p0.x && pos.x < p1.x && pos.y > p0.y && pos.y < p1.y) {
                a = 0.6;
                b = 0.6;
            }
        }

        float eased = ease(ratio);
        color = vec4(mix(a, b, ease(mixRatio(ease(ratio)))), 0, 0, 1); 
    }
`;

const BLUR_FS = `#version 300 es
    precision highp float;
    precision highp sampler2D;

    uniform sampler2D tex;
    uniform float ratio;
    uniform vec2 resolution;
    uniform float scroll_y;
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

        return mix(mix(sample3, sample2, sx), mix(sample1, sample0, sx), sy);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution;
        uv.y += scroll_y;
        
        uv.y = abs(2. * mod(.5 * uv.y - .5, 1.) - 1.);

        vec3 col = vec3(textureBicubic(tex, uv).r);
        col *= 1. + vec3(2, 1, 4) * 0.05;
        col = smoothstep(0.4, 1.0, col);
        col = smoothstep(0.05, 0.1, col);
        color_out = vec4(col, 1);
    }
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

function createProgram(gl, vs, fs) {
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
        this.gl = gl;
        this.width = width;
        this.height = height;
        this.framebuffer = gl.createFramebuffer();
        this.createTextures();
        this.prog = createProgram(gl, IDENTITY_VS, SIM_FS);

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

    createTextures() {
        const gl = this.gl;

        const makeTexture = (pixels) => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.width, this.height, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            return tex;
        };

        const len = Math.pow(2, Math.ceil(Math.log2(this.width * this.height)));
        const pixels = new Uint8Array(len);
        for (let i = 0; i < this.width * this.height; i++) {
            pixels[i] = Math.random() < 0.2 ? 255 : 0;
        }
        this.tex0 = makeTexture(pixels);
        this.tex1 = makeTexture(null);
    }

    render() {
        const gl = this.gl;

        gl.useProgram(this.prog);
        gl.viewport(0, 0, this.width, this.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex0);
        gl.uniform1i(gl.getUniformLocation(this.prog, "tex"), 0);
        gl.uniform2i(gl.getUniformLocation(this.prog, "grid_size"), this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    renderCanvas() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.render();
    }

    step() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex1, 0); // render into tex1

        this.render();
        [this.tex0, this.tex1] = [this.tex1, this.tex0];
    }

    resize(x, y) {
        const gl = this.gl;
        gl.deleteTexture(this.tex0);
        gl.deleteTexture(this.tex1);

        this.width = x;
        this.height = y;
        this.createTextures();
    }
}

class Blend {
    constructor(gl, width, height) {
        this.width = width;
        this.height = height;
        this.prog = createProgram(gl, IDENTITY_VS, BLEND_FS);
        this.gl = gl;
        this.framebuffer = gl.createFramebuffer();
        this.createOutTex();
        this.blankLen = 0;
        this.blank0 = new Float32Array(8);
        this.blank1 = new Float32Array(8);
    }

    createOutTex() {
        const gl = this.gl;
        this.outTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.outTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.width, this.height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    blend(tex0, tex1, ratio) {
        const gl = this.gl;

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
        gl.uniform2f(gl.getUniformLocation(this.prog, "resolution"), this.width, this.height);

        gl.uniform1i(gl.getUniformLocation(this.prog, "n_blank"), this.blankLen);
        gl.uniform2fv(gl.getUniformLocation(this.prog, "blank0"), this.blank0);
        gl.uniform2fv(gl.getUniformLocation(this.prog, "blank1"), this.blank1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    blendTex(tex0, tex1, ratio) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex, 0);

        this.blend(tex0, tex1, ratio);
    }

    resize(x, y) {
        const gl = this.gl;
        gl.deleteTexture(this.outTex);
        this.width = x;
        this.height = y;
        this.createOutTex();
    }
}

class Blur {
    constructor(gl, width, height) {
        this.gl = gl;
        this.width = width;
        this.height = height;
        this.prog = createProgram(gl, IDENTITY_VS, BLUR_FS);
        this.scrollY = 0;
    }

    blur(outTex) {
        const gl = this.gl;

        gl.useProgram(this.prog);
        gl.viewport(0, 0, this.width, this.height);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, outTex);
        gl.uniform1i(gl.getUniformLocation(this.prog, "tex"), 0);
        gl.uniform2f(gl.getUniformLocation(this.prog, "resolution"), this.width, this.height);
        gl.uniform1f(gl.getUniformLocation(this.prog, "scroll_y"), this.scrollY);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    resize(w, h) {
        this.width = w;
        this.height = h;
    }
}

export class Life {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");

        this.setScale(48);
        this.setSpeed(0.1);
    }

    start() {
        this.sim = new Sim(this.gl, this.gridX, this.gridY);
        this.blend = new Blend(this.gl, this.gridX * 2, this.gridY * 2);
        this.blur = new Blur(this.gl, this.canvas.width, this.canvas.height);

        this.updateBlank();
        this.sim.step();

        let lastFrame = document.timeline.currentTime;
        let blendRatio = 0;
        const loop = (now) => {
            const elapsed = now - lastFrame;
            lastFrame = now;
            blendRatio += (elapsed / 1000) * this.speed;
            if (blendRatio >= 1) {
                this.sim.step();
                blendRatio = 0;
            }

            this.blend.blendTex(this.sim.tex1, this.sim.tex0, blendRatio);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this.blur.blur(this.blend.outTex);

            requestAnimationFrame(loop);
        }

        requestAnimationFrame(loop);
    }

    setSpeed(s) {
        this.speed = s;
    }

    setResolution(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;

        if (this.isRunning) {
            this.blur.resize(w, h);
        }
    }

    setScale(scale) {
        if (this.canvas.width > this.canvas.height) {
            this.gridX = Math.floor(scale);
            this.gridY = Math.floor(this.gridX * this.canvas.height / this.canvas.width);
        } else {
            this.gridY = Math.floor(scale);
            this.gridX = Math.floor(this.gridY * this.canvas.width / this.canvas.height);
        }


        if (this.isRunning) {
            this.sim.resize(this.gridX, this.gridY);
            this.blend.resize(this.gridX * 2, this.gridY * 2);
            this.sim.step();
        }
    }

    setBlank(areas) {
        this.blank = areas;

        if (this.isRunning) {
            this.updateBlank();
        }
    }

    updateBlank() {
        let idx = 0;
        for (const [[ax, ay], [bx, by]] of this.blank) {
            this.blend.blank0[idx] = ax;
            this.blend.blank1[idx++] = bx;

            this.blend.blank0[idx] = ay;
            this.blend.blank1[idx++] = by;
        }
        this.blend.blankLen = this.blank.length;
    }

    get isRunning() {
        return this.sim != null;
    }
}
