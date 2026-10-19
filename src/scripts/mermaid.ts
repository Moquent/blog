export {};
// Renders <pre class="mermaid"> blocks and re-renders on theme change.
type Theme = "light" | "dark";

const palette = {
  dark: {
    background: "#0f1115",
    primaryColor: "#171b22",
    primaryBorderColor: "#3b4351",
    primaryTextColor: "#e6edf3",
    secondaryColor: "#171b22",
    tertiaryColor: "#12151b",
    lineColor: "#8b949e",
    clusterBkg: "#12151b",
    clusterBorder: "#2a303a",
    edgeLabelBackground: "#0f1115",
    noteBkgColor: "#171b22",
    noteTextColor: "#e6edf3",
    actorBkg: "#171b22",
    actorBorder: "#3b4351",
    actorTextColor: "#e6edf3",
    signalColor: "#8b949e",
    signalTextColor: "#e6edf3",
  },
  light: {
    background: "#ffffff",
    primaryColor: "#ffffff",
    primaryBorderColor: "#c9ced6",
    primaryTextColor: "#1f2328",
    secondaryColor: "#f6f8fa",
    tertiaryColor: "#f6f8fa",
    lineColor: "#6e7781",
    clusterBkg: "#f6f8fa",
    clusterBorder: "#d8dee4",
    edgeLabelBackground: "#ffffff",
    noteBkgColor: "#f6f8fa",
    noteTextColor: "#1f2328",
    actorBkg: "#ffffff",
    actorBorder: "#c9ced6",
    actorTextColor: "#1f2328",
    signalColor: "#6e7781",
    signalTextColor: "#1f2328",
  },
};

let counter = 0;

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

async function renderAll(): Promise<void> {
  const blocks = document.querySelectorAll<HTMLElement>("pre.mermaid");
  if (blocks.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  const theme = currentTheme();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      ...palette[theme],
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: "13px",
    },
    flowchart: {
      curve: "basis",
      htmlLabels: true,
      padding: 14,
      nodeSpacing: 30,
      rankSpacing: 40,
      wrappingWidth: 360,
    },
    sequence: { mirrorActors: false, messageMargin: 28 },
  });
  for (const el of blocks) {
    const source = el.dataset.source ?? el.textContent ?? "";
    el.dataset.source = source;
    try {
      const { svg } = await mermaid.render(`mmd-${counter++}`, source);
      el.innerHTML = svg;
      el.dataset.rendered = theme;
    } catch (err) {
      console.error("mermaid render failed", err);
    }
  }
}

function setup(): void {
  void renderAll();
}

setup();
document.addEventListener("astro:page-load", setup);
new MutationObserver(() => void renderAll()).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
