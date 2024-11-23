import { Life } from "./life";
import "./src/index.css"

window.addEventListener("load", () => {
    const body = document.body;
    const html = document.documentElement;
    const canvas = document.getElementById("canvas");
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = html.scrollHeight * window.devicePixelRatio;
    canvas.style.height = html.scrollHeight + "px";

    console.log("Resolution:", canvas.width, "x", canvas.height);



    const content = document.getElementById("content");
    const contentRect = content.getBoundingClientRect();
    console.log(content.getBoundingClientRect());
    const x0 = contentRect.left / window.innerWidth;
    const x1 = x0 + contentRect.width / window.innerWidth;

    console.log(x0, x1);

    const i = new Life(canvas);
    i.setScale(48);
    i.setBlank([[[x0 - 0.02, 0], [x1 + 0.02, 1]]]);
    i.start()
})



