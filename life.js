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

    float mixRatio(float ratio) {
        vec2 uv = gl_FragCoord.xy / resolution;

        float dist = distance(uv, vec2(0.5, 0.5));
        float circle = smoothstep(ratio, ratio - .2, dist);

        return min(1., circle + 0.5 * ratio);
    }

    float ease(float x) {
        return 2.08333 * x * x * x + -3.125 * x * x + 2.04167 * x;
    }

    void main() {
        vec2 pos = gl_FragCoord.xy / resolution;
        float a = texture(tex0, pos).r;
        float b = texture(tex1, pos).r;



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

    uniform int n_blank;
    uniform vec2[4] blank0;
    uniform vec2[4] blank1;

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

    float sdBox(vec2 p, vec2 b) {
        vec2 d = abs(p)-b;
        return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution;
        vec2 wrapped_uv = vec2(uv.x, abs(2. * mod(.5 * (uv.y + scroll_y * 0.5) - .5, 1.) - 1.));
        uv.y += scroll_y;

        vec3 col = vec3(textureBicubic(tex, wrapped_uv).r);

        for(int i = 0; i < n_blank; i++) {
            vec2 p0 = blank0[i];
            vec2 p1 = blank1[i];

            vec2 d = max(p0 - uv, uv - p1);
            float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);

            float blur = 0.05; // Blur radius
            float alpha = smoothstep(0.0, blur, -dist + blur/2.);

            col = mix(col, vec3(1), alpha);
        }

        col *= 1. + vec3(2, 1, 4) * 0.01;
        col = smoothstep(0.35, 1., col);
        col = smoothstep(0.05, 0.1, col);
        color_out = vec4(col * 0.7, 1);
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

        const len = Math.pow(2, Math.ceil(Math.log2(this.width * this.height))) * 2; // idk, getting weird "ArrayBufferView not big enough for request" errors.
        console.log(this.width, this.height, len);
        const pixels = new Uint8Array(len);
        for (let x = 0; x < this.width; x++) {
            // if (Math.abs(x - this.width / 2) < 4) continue;
            for (let y = 0; y < this.height; y++) {
                pixels[x + this.width * y] = Math.random() < 0.3 ? 255 : 0;
            }

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
        console.warn("expensive resize of sim");
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


        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    blendTex(tex0, tex1, ratio) {
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex, 0);

        this.blend(tex0, tex1, ratio);
    }

    resize(x, y) {
        console.warn("expensive resize of blend");
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
        this.blankLen = 0;
        this.blank0 = new Float32Array(8);
        this.blank1 = new Float32Array(8);
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
        gl.uniform1i(gl.getUniformLocation(this.prog, "n_blank"), this.blankLen);
        gl.uniform2fv(gl.getUniformLocation(this.prog, "blank0"), this.blank0);
        gl.uniform2fv(gl.getUniformLocation(this.prog, "blank1"), this.blank1);

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
        this.sim.step();
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
        if (Math.abs(w - this.canvas.width) <= 1 && Math.abs(h - this.canvas.height) <= 1) return;
        this.canvas.width = w;
        this.canvas.height = h;

        if (this.isRunning) {
            this.blur.resize(w, h);
        }
    }

    setScale(scale) {
        let newX, newY;
        if (this.canvas.width > this.canvas.height) {
            newX = Math.floor(scale);
            newY = Math.floor(newX * this.canvas.height / this.canvas.width);
        } else {
            newY = Math.floor(scale);
            newX = Math.floor(newY * this.canvas.width / this.canvas.height);
        }
        let changed = Math.abs(newX - this.gridX) > 1 || Math.abs(newY - this.gridY) > 1;

        [this.gridX, this.gridY] = [newX, newY];

        if (this.isRunning) {
            if (changed) {

                this.sim.resize(this.gridX, this.gridY);
                this.sim.step();
            }

            this.blend.resize(this.gridX * 2, this.gridY * 2);
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
            this.blur.blank0[idx] = ax;
            this.blur.blank1[idx++] = bx;

            this.blur.blank0[idx] = 1 - by;
            this.blur.blank1[idx++] = 1 - ay;
        }
        this.blur.blankLen = this.blank.length;
    }

    get isRunning() {
        return this.sim != null;
    }
}
