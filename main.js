import { Life } from "./life";
import "./src/index.css"

window.addEventListener("load", () => {
    const body = document.body;
    const html = document.documentElement;
    const canvas = document.getElementById("canvas");
    const content = document.getElementById("content");
    const footer = document.getElementById("footer");

    const i = new Life(canvas);

    const getBlank = (elem) => {
        const rect = elem.getBoundingClientRect();
        const x0 = rect.left / window.innerWidth;
        const x1 = rect.right / window.innerWidth;
        const y0 = (window.scrollY + rect.top) / window.innerHeight;
        const y1 = (window.scrollY + rect.bottom) / window.innerHeight;
        let offset = 0.001;
        return [[x0 + offset, y0 + offset], [x1 - offset, y1 - offset]];
    }

    let lastWidth = 0;
    let lastHeight = 0;
    const updateResolution = () => {
        const rect = canvas.getBoundingClientRect();
        const height = (rect.bottom - rect.top) * window.devicePixelRatio;
        const width = window.innerWidth * window.devicePixelRatio;
        if (Math.abs(width - lastWidth) > 5 * width / 100 || Math.abs(height - lastHeight) > 5 * height / 100) {
            i.setResolution(width, height);
            lastHeight = height;
            lastWidth = width;
            i.setScale(48);
        }


        i.setBlank([getBlank(content), getBlank(footer)]);
    };

    updateResolution();
    i.start();

    window.addEventListener("scroll", () => {
        i.blur.scrollY = -(html.scrollTop / window.innerHeight);
    });

    window.addEventListener("resize", () => {
        updateResolution();
    });
})



