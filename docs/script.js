"use strict";

const demo = document.getElementById("reading-demo");
const modes = document.querySelectorAll("[data-mode]");
const wordDemo = document.getElementById("word-demo");
const sentenceDemo = document.getElementById("sentence-demo");
const demoStatus = document.getElementById("demo-status");
const colorInput = document.getElementById("demo-color");
const opacityInput = document.getElementById("demo-opacity");
const opacityValue = document.getElementById("opacity-value");

for (const button of modes) {
  button.addEventListener("click", () => {
    const showWords = button.dataset.mode === "word";
    wordDemo.hidden = !showWords;
    sentenceDemo.hidden = showWords;
    for (const candidate of modes) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
    demoStatus.textContent = showWords ? "当前显示逐词对照示例。" : "当前显示整句翻译示例。";
  });
}

colorInput.addEventListener("input", () => {
  demo.style.setProperty("--gloss-color", colorInput.value);
});
opacityInput.addEventListener("input", () => {
  const transparency = Number(opacityInput.value);
  demo.style.setProperty("--gloss-opacity", String(1 - transparency / 100));
  opacityValue.value = `${transparency}%`;
  opacityInput.setAttribute("aria-valuetext", `${transparency}% 透明度`);
});

const copyButton = document.getElementById("copy-extensions");
const copyStatus = document.getElementById("copy-status");
copyButton.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText("chrome://extensions");
    copyStatus.textContent = "已复制，请粘贴到 Chrome 地址栏打开。";
  } catch {
    copyStatus.textContent = "请手动在 Chrome 地址栏输入 chrome://extensions。";
  }
});
