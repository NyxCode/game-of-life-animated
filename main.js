import { Life } from "./life";
import "./src/index.css"

window.addEventListener("load", () => {
    const body = document.body;
    const html = document.documentElement;
    const canvas = document.getElementById("canvas");
    const content = document.getElementById("content");

    const i = new Life(canvas);

    let updateResolution = () => {
        i.setResolution(
            window.innerWidth * window.devicePixelRatio,
            window.innerHeight * window.devicePixelRatio
        );
        i.setScale(48);
        console.log("Resolution:", canvas.width, "x", canvas.height);

        const contentRect = content.getBoundingClientRect();
        const x0 = contentRect.left / window.innerWidth;
        const x1 = contentRect.right / window.innerWidth;
        i.setBlank([[[x0 - 0.01, 0], [x1 + 0.01, 1]]]);
    };

    updateResolution();
    i.start();

    window.addEventListener("scroll", () => {
        i.blur.scrollY = -(html.scrollTop / html.scrollHeight);
    });

    window.addEventListener("resize", () => {
        updateResolution();
    });
})



