import { BrowserWindow, session } from 'electron';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from '../contracts/model';
import { safeMarkup } from '../renderers/validate';
import { themeVariables } from '../ui/theme';
import { preflightMarkup } from '../renderers/preflight';
/** A disposable, permissionless renderer. No preload, Node or generated scripts. */
export async function renderPreflight(artifact: Artifact, distDirectory: string): Promise<void> {
  const partition = 'artifact-preflight',
    s = session.fromPartition(partition);
  s.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  s.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*'] },
    (_d, callback) => callback({ cancel: true }),
  );
  const win = new BrowserWindow({
    show: false,
    width: 1056,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const timer = setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, 3500);
  try {
    const cssName = readdirSync(join(distDirectory, 'ui/assets')).find((n) => n.endsWith('.css'))!;
    const css = readFileSync(join(distDirectory, 'ui/assets', cssName), 'utf8');
    const document = (content: string) =>
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-src about:; form-action 'none'; base-uri 'none'"><style>:root{${themeVariables}}${css}body{padding:20px;font-size:15px}svg{max-width:100%;height:auto}</style></head><body>${content}</body></html>`;
    await win.loadURL(
      'data:text/html;charset=UTF-8,' + encodeURIComponent(document(preflightMarkup(artifact))),
    );
    const fits = await win.webContents.executeJavaScript(
      'document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelectorAll("*").length < 1000',
    );
    if (!fits) throw new Error('RENDER_OVERFLOW');
    for (const block of artifact.blocks) {
      if (block.type !== 'html' && block.type !== 'svg') continue;
      const markup = safeMarkup(block.markup, block.type);
      await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(document(markup)));
      const result = await win.webContents.executeJavaScript(
        '({width:document.documentElement.scrollWidth,height:document.body.scrollHeight,viewport:innerWidth})',
      );
      if (result.width > result.viewport + 1 || result.height > 1200)
        throw new Error('RENDER_OVERFLOW');
    }
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
