import type { Context } from '@deepseek-ai/cordis';
import { FONT_ROUTE, fontRouteHandler, locateClaudeFonts } from './server/claude-fonts.js';

export const name = 'dsh-clearview';
export const inject: string[] = [];

// Presentation only: no provider, tool, session-log or permission mutations. The only server-side
// effect is a read-only font route, registered once the host webServer exists (never in Electron/tests).
export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-clearview] loaded');
  ctx.inject(['webServer'], scoped => {
    // A plugin body may return its disposer; cordis runs it when the fiber unloads (fiber.ts plugin startup effect).
    return scoped.webServer.register({ kind: 'prefix', path: FONT_ROUTE, handler: fontRouteHandler(() => locateClaudeFonts(process.env.LOCALAPPDATA)) });
  });
}
