import React, { useCallback, useRef, useState, useMemo } from 'react';
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiRefreshLine,
  RiCursorLine,
  RiCloseLine,
  RiExternalLinkLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/useUIStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShallow } from 'zustand/shallow';
import { toast } from 'sonner';
import { useTabContext } from '@/contexts/useTabContext';

const DEFAULT_URL = 'http://localhost:3000';

/** Minimal proxy: strips frame-deny headers so iframe can load cross-origin content */
function buildProxyUrl(targetUrl: string): string {
  return `/api/preview-proxy?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Lightweight picker script injected into the iframe.
 * Highlights elements on hover and captures clicks.
 */
const PICKER_SCRIPT = `
(function() {
  if (window.__ocPickerActive) return;
  window.__ocPickerActive = true;

  var overlay = document.createElement('div');
  overlay.id = '__oc-picker-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;border-radius:3px;background:rgba(59,130,246,0.08);transition:all 0.05s ease;display:none;';
  document.body.appendChild(overlay);

  var label = document.createElement('div');
  label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#3b82f6;color:#fff;font:11px/1.4 system-ui,sans-serif;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;';
  document.body.appendChild(label);

  var currentEl = null;

  function updateOverlay(el) {
    if (!el || el === document.body || el === document.documentElement) {
      overlay.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    label.textContent = tag + id + cls;
    label.style.display = 'block';
    label.style.top = Math.max(0, r.top - 22) + 'px';
    label.style.left = r.left + 'px';
  }

  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== overlay && el !== label) {
      currentEl = el;
      updateOverlay(el);
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!currentEl) return;
    var el = currentEl;
    var tag = el.tagName.toLowerCase();
    var text = (el.innerText || el.textContent || '').trim().substring(0, 500);
    var html = el.outerHTML.substring(0, 3000);
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      attrs[a.name] = a.value;
    }
    window.parent.postMessage({
      type: 'OPENCHAMBER_ELEMENT_SELECTED',
      data: { tagName: tag, text: text, outerHTML: html, attributes: attrs }
    }, '*');
    cleanup();
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (label.parentNode) label.parentNode.removeChild(label);
    window.__ocPickerActive = false;
  }

  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); }
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
})();
`;

interface PreviewTabMetadata {
  url?: string;
  historyStack?: string[];
  historyIndex?: number;
}

export const PreviewView: React.FC = () => {
  const { isGlobalResizing } = useUIStore(
    useShallow((state) => ({ isGlobalResizing: state.isGlobalResizing }))
  );
  const tabContext = useTabContext();
  const metadata = (tabContext?.tab.metadata ?? {}) as PreviewTabMetadata;

  const initialUrl = metadata.url ?? DEFAULT_URL;
  const initialHistoryStack = metadata.historyStack ?? [initialUrl];
  const initialHistoryIndex = metadata.historyIndex ?? 0;

  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyStack = useRef<string[]>(initialHistoryStack);
  const historyIndex = useRef(initialHistoryIndex);
  const [, forceUpdate] = useState({});

  const canGoBack = historyIndex.current > 0;
  const canGoForward = historyIndex.current < historyStack.current.length - 1;

  const addAttachedFile = useFileStore((s) => s.addAttachedFile);

  const persistState = useCallback((updates: Partial<PreviewTabMetadata> = {}) => {
    if (tabContext) {
      tabContext.updateMetadata({
        url: updates.url ?? url,
        historyStack: historyStack.current,
        historyIndex: historyIndex.current,
      });
    }
  }, [tabContext, url]);

  const hasValidUrl = url && url.trim() !== '';

  const iframeSrc = useMemo(() => {
    if (!hasValidUrl) return 'about:blank';
    return buildProxyUrl(url);
  }, [url, hasValidUrl]);

  const navigateTo = useCallback((newUrl: string) => {
    let normalized = newUrl.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'http://' + normalized;
    }
    if (historyIndex.current < historyStack.current.length - 1) {
      historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
    }
    historyStack.current.push(normalized);
    historyIndex.current = historyStack.current.length - 1;
    setUrl(normalized);
    setInputUrl(normalized);
    setIsLoading(true);
    setIsSelectMode(false);
    forceUpdate({});
    persistState({ url: normalized });
  }, [persistState]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    historyIndex.current--;
    const prev = historyStack.current[historyIndex.current];
    setUrl(prev);
    setInputUrl(prev);
    setIsLoading(true);
    forceUpdate({});
    persistState();
  }, [canGoBack, persistState]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    historyIndex.current++;
    const next = historyStack.current[historyIndex.current];
    setUrl(next);
    setInputUrl(next);
    setIsLoading(true);
    forceUpdate({});
    persistState();
  }, [canGoForward, persistState]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setIsSelectMode(false);
    forceUpdate({});
  }, []);

  const openExternal = useCallback(() => {
    if (url) window.open(url, '_blank');
  }, [url]);

  const activatePicker = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error('Cannot access iframe');
      const script = doc.createElement('script');
      script.textContent = PICKER_SCRIPT;
      doc.body.appendChild(script);
      doc.body.removeChild(script);
      setIsSelectMode(true);
    } catch {
      toast.error('Cannot activate picker on this page (cross-origin restriction)');
    }
  }, []);

  const handleElementSelected = useCallback(async (data: { tagName: string; text: string; outerHTML: string; attributes: Record<string, string> }) => {
    setIsSelectMode(false);
    const lines: string[] = [];
    lines.push(`# Selected Element: <${data.tagName}>`);
    if (data.attributes.id) lines.push(`ID: #${data.attributes.id}`);
    if (data.attributes.class) lines.push(`Classes: .${data.attributes.class.split(' ').filter(Boolean).join('.')}`);
    lines.push('');
    if (data.text) {
      lines.push('## Text Content');
      lines.push(data.text);
      lines.push('');
    }
    lines.push('## HTML');
    lines.push('```html');
    lines.push(data.outerHTML);
    lines.push('```');

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const fileName = `element-${data.tagName}${data.attributes.id ? `-${data.attributes.id}` : ''}-${Date.now()}.md`;
    const file = new File([blob], fileName, { type: 'text/markdown' });

    try {
      await addAttachedFile(file);
      toast.success('Element attached to chat', {
        description: `<${data.tagName}>${data.attributes.id ? ` #${data.attributes.id}` : ''} selected`,
      });
    } catch {
      toast.error('Failed to attach element');
    }
  }, [addAttachedFile]);

  // Listen for postMessage from iframe picker
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OPENCHAMBER_ELEMENT_SELECTED' && event.data.data) {
        handleElementSelected(event.data.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleElementSelected]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim()) navigateTo(inputUrl);
  }, [inputUrl, navigateTo]);

  const buttonClass = 'h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: 'var(--interactive-border)' }}>
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button type="button" className={buttonClass} onClick={goBack} disabled={!canGoBack} aria-label="Back">
              <RiArrowLeftLine className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button type="button" className={buttonClass} onClick={goForward} disabled={!canGoForward} aria-label="Forward">
              <RiArrowRightLine className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button type="button" className={buttonClass} onClick={refresh} aria-label="Refresh">
              <RiRefreshLine className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL..."
            className="w-full h-7 px-2.5 text-xs rounded border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
            style={{ borderColor: 'var(--interactive-border)' }}
          />
        </form>

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(buttonClass, isSelectMode && 'bg-primary/20 text-primary')}
              onClick={isSelectMode ? () => setIsSelectMode(false) : activatePicker}
              aria-label={isSelectMode ? 'Cancel selection' : 'Select element'}
            >
              {isSelectMode ? <RiCloseLine className="h-4 w-4" /> : <RiCursorLine className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isSelectMode ? 'Cancel selection' : 'Pick element to attach to chat'}</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button type="button" className={buttonClass} onClick={openExternal} aria-label="Open in browser">
              <RiExternalLinkLine className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Open in browser</TooltipContent>
        </Tooltip>
      </div>

      {/* Picker active banner */}
      {isSelectMode && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-primary/10 text-primary text-xs border-b" style={{ borderColor: 'var(--interactive-border)' }}>
          <RiCursorLine className="h-3.5 w-3.5" />
          <span>Click on any element to attach it to your chat</span>
          <button
            type="button"
            onClick={() => setIsSelectMode(false)}
            className="ml-2 px-2 py-0.5 rounded text-xs bg-primary/20 hover:bg-primary/30 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Iframe */}
      <div className="flex-1 overflow-hidden relative">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className={cn('w-full h-full border-0', isGlobalResizing && 'pointer-events-none')}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          title="Preview"
          onLoad={handleIframeLoad}
        />

        {isLoading && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <RiRefreshLine className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          </div>
        )}

        {!hasValidUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="text-center space-y-3 max-w-sm px-6">
              <p className="text-sm text-muted-foreground">
                Enter a URL above to preview. Use the picker button to select elements and attach them to your chat.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
