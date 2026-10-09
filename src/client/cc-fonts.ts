const face = (family: string, file: string) =>
  `@font-face{font-family:${family};src:url("/dsh-clearview/fonts/${file}.woff2") format("woff2");font-weight:300 800;font-style:normal;font-display:swap}`;

/** Claude's three families, served by the plugin's own route; missing files fall through to the fallback stacks. */
export const CLAUDE_FONT_FACES = [face('anthropic-sans', 'sans'), face('anthropic-serif', 'serif'), face('anthropic-mono', 'mono')].join('\n');

export function ensureClaudeFonts(doc: Document = document): void {
  if (doc.getElementById('dsh-clearview-fonts')) return;
  const style = doc.createElement('style');
  style.id = 'dsh-clearview-fonts';
  style.textContent = CLAUDE_FONT_FACES;
  doc.head.appendChild(style);
}
