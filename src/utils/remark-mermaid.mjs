// Turns ```mermaid code fences into <pre class="mermaid"> so the browser
// script can render them. Runs before Shiki, so they are not highlighted.
const escapeHtml = s =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function visit(node) {
  if (!node.children) return;
  node.children = node.children.map(child => {
    if (child.type === "code" && child.lang === "mermaid") {
      return {
        type: "html",
        value: `<figure class="diagram"><pre class="mermaid">${escapeHtml(child.value)}</pre></figure>`,
      };
    }
    visit(child);
    return child;
  });
}

export default function remarkMermaid() {
  return tree => visit(tree);
}
