import { useCallback, useEffect, useRef } from 'react';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { Webview } from '@tauri-apps/api/webview';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

const BROWSER_WEBVIEW_LABEL = 'overlay-browser-embed';
const LEGACY_BROWSER_WINDOW_LABEL = 'overlay-browser';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

export async function closeOverlayBrowserWindow(): Promise<void> {
  const existing = await Webview.getByLabel(BROWSER_WEBVIEW_LABEL);
  if (existing) await existing.close().catch(() => {});
  const legacy = await WebviewWindow.getByLabel(LEGACY_BROWSER_WINDOW_LABEL);
  if (legacy) await legacy.close().catch(() => {});
}

function boundsForElement(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(Math.max(120, rect.width)),
    height: Math.round(Math.max(120, rect.height)),
  };
}

export function useOverlayEmbeddedWebview(
  containerRef: React.RefObject<HTMLElement | null>,
  url: string,
  active: boolean,
  boundsKey: string,
  reloadKey = 0,
) {
  const webviewRef = useRef<Webview | null>(null);

  const syncBounds = useCallback(async () => {
    const el = containerRef.current;
    const wv = webviewRef.current;
    if (!el || !wv) return;
    const bounds = boundsForElement(el);
    if (!bounds) return;
    await wv.setPosition(new LogicalPosition(bounds.x, bounds.y));
    await wv.setSize(new LogicalSize(bounds.width, bounds.height));
  }, [containerRef]);

  useEffect(() => {
    if (!active || !url.trim()) {
      webviewRef.current = null;
      void closeOverlayBrowserWindow();
      return;
    }

    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    void (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled) return;

      const bounds = boundsForElement(el);
      if (!bounds || cancelled) return;

      await closeOverlayBrowserWindow();
      if (cancelled) return;

      const parent = getCurrentWindow();
      const wv = new Webview(parent, BROWSER_WEBVIEW_LABEL, {
        url,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        focus: false,
        transparent: false,
        dragDropEnabled: false,
        userAgent: BROWSER_USER_AGENT,
        backgroundColor: '#0a0a0a',
      });

      try {
        await new Promise<void>((resolve, reject) => {
          wv.once('tauri://created', () => resolve());
          wv.once('tauri://error', (e) => reject(e));
        });
      } catch (err) {
        await wv.close().catch(() => {});
        console.warn('[overlay-browser] webview falhou', err);
        return;
      }

      if (cancelled) {
        await wv.close().catch(() => {});
        return;
      }

      webviewRef.current = wv;
      await wv.show();
      await syncBounds();
    })().catch((err) => {
      console.warn('[overlay-browser] navegador embutido falhou', err);
    });

    return () => {
      cancelled = true;
      webviewRef.current = null;
      void closeOverlayBrowserWindow();
    };
  }, [active, url, reloadKey, containerRef, syncBounds]);

  useEffect(() => {
    if (!active) return;
    void syncBounds();
  }, [active, boundsKey, syncBounds]);

  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      void syncBounds();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, containerRef, syncBounds]);

  useEffect(() => {
    if (!active) return;
    const unlistenP = getCurrentWindow().onMoved(() => {
      void syncBounds();
    });
    return () => {
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [active, syncBounds]);

  useEffect(() => {
    if (!active) return;
    const unlistenP = getCurrentWindow().onResized(() => {
      void syncBounds();
    });
    return () => {
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [active, syncBounds]);

  const focusBrowser = useCallback(() => {
    void webviewRef.current?.setFocus().catch(() => {});
  }, []);

  return { focusBrowser };
}
