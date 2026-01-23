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

  function getAncestry(el) {
    var chain = [];
    var node = el;
    while (node && node !== document.body && chain.length < 6) {
      var tag = node.tagName.toLowerCase();
      var id = node.id ? '#' + node.id : '';
      var role = node.getAttribute('role');
      var roleStr = role ? '[role=' + role + ']' : '';
      chain.unshift(tag + id + roleStr);
      node = node.parentElement;
    }
    return chain.join(' > ');
  }

  function getNearestHeading(el) {
    var node = el;
    while (node && node !== document.body) {
      var h = node.querySelector('h1,h2,h3,h4,h5,h6');
      if (h) return h.textContent.trim().substring(0, 100);
      node = node.parentElement;
    }
    var prev = el;
    while (prev = prev.previousElementSibling) {
      if (/^H[1-6]$/.test(prev.tagName)) return prev.textContent.trim().substring(0, 100);
    }
    return null;
  }

  function getLandmark(el) {
    var landmarks = ['nav','main','header','footer','aside','section','form'];
    var node = el.parentElement;
    while (node && node !== document.body) {
      var tag = node.tagName.toLowerCase();
      if (landmarks.indexOf(tag) !== -1) {
        var lbl = node.getAttribute('aria-label') || node.getAttribute('aria-labelledby') || '';
        return tag + (lbl ? ' (' + lbl + ')' : '');
      }
      var role = node.getAttribute('role');
      if (role && ['navigation','main','banner','contentinfo','complementary','region','form'].indexOf(role) !== -1) {
        var rl = node.getAttribute('aria-label') || '';
        return role + (rl ? ' (' + rl + ')' : '');
      }
      node = node.parentElement;
    }
    return null;
  }

  function getFormContext(el) {
    var form = el.closest('form');
    if (!form) return null;
    return { action: form.action || '', method: form.method || 'get', name: form.getAttribute('name') || '', id: form.id || '' };
  }

  function getAriaInfo(el) {
    var info = {};
    var role = el.getAttribute('role'); if (role) info.role = role;
    var ariaLabel = el.getAttribute('aria-label'); if (ariaLabel) info.label = ariaLabel;
    var ariaDesc = el.getAttribute('aria-describedby');
    if (ariaDesc) {
      var descEl = document.getElementById(ariaDesc);
      if (descEl) info.description = descEl.textContent.trim().substring(0, 200);
    }
    var ariaExpanded = el.getAttribute('aria-expanded'); if (ariaExpanded) info.expanded = ariaExpanded;
    var ariaDisabled = el.getAttribute('aria-disabled') || el.disabled; if (ariaDisabled) info.disabled = String(ariaDisabled);
    var ariaChecked = el.getAttribute('aria-checked'); if (ariaChecked) info.checked = ariaChecked;
    return Object.keys(info).length ? info : null;
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
    var rect = el.getBoundingClientRect();

    // Capture computed styles (most useful for UI work)
    var cs = window.getComputedStyle(el);
    var styles = {};
    var styleProps = ['color','background-color','font-size','font-weight','font-family',
      'padding','margin','border','border-radius','display','position',
      'width','height','gap','opacity','box-shadow','text-align'];
    for (var si = 0; si < styleProps.length; si++) {
      var val = cs.getPropertyValue(styleProps[si]);
      if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)') {
        styles[styleProps[si]] = val;
      }
    }

    var payload = {
      tagName: tag,
      text: text,
      outerHTML: html,
      attributes: attrs,
      page: { url: location.href, path: location.pathname, title: document.title },
      ancestry: getAncestry(el),
      nearestHeading: getNearestHeading(el),
      landmark: getLandmark(el),
      aria: getAriaInfo(el),
      formContext: getFormContext(el),
      dimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
      computedStyles: styles,
      boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      screenshotDataUrl: null
    };

    // Attempt screenshot via SVG foreignObject (best-effort, no external deps)
    try {
      var clone = el.cloneNode(true);
      // Inline computed styles on the clone
      function inlineStyles(src, dst) {
        var srcStyle = window.getComputedStyle(src);
        for (var k = 0; k < srcStyle.length; k++) {
          var p = srcStyle[k];
          dst.style.setProperty(p, srcStyle.getPropertyValue(p));
        }
        var srcChildren = src.children;
        var dstChildren = dst.children;
        for (var c = 0; c < srcChildren.length && c < dstChildren.length; c++) {
          inlineStyles(srcChildren[c], dstChildren[c]);
        }
      }
      inlineStyles(el, clone);

      var w = Math.ceil(rect.width);
      var h = Math.ceil(rect.height);
      var svgNs = 'http://www.w3.org/2000/svg';
      var xhtmlNs = 'http://www.w3.org/1999/xhtml';
      var svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      var fo = document.createElementNS(svgNs, 'foreignObject');
      fo.setAttribute('width', '100%');
      fo.setAttribute('height', '100%');
      var wrapper = document.createElementNS(xhtmlNs, 'div');
      wrapper.setAttribute('xmlns', xhtmlNs);
      wrapper.style.cssText = 'width:' + w + 'px;height:' + h + 'px;overflow:hidden;';
      wrapper.appendChild(clone);
      fo.appendChild(wrapper);
      svg.appendChild(fo);

      var svgData = new XMLSerializer().serializeToString(svg);
      var img = new Image();
      img.onload = function() {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w * 2;
          canvas.height = h * 2;
          var ctx = canvas.getContext('2d');
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          payload.screenshotDataUrl = canvas.toDataURL('image/png');
        } catch(e) {}
        window.parent.postMessage({ type: 'OPENCHAMBER_ELEMENT_SELECTED', data: payload }, '*');
      };
      img.onerror = function() {
        window.parent.postMessage({ type: 'OPENCHAMBER_ELEMENT_SELECTED', data: payload }, '*');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    } catch(e) {
      window.parent.postMessage({ type: 'OPENCHAMBER_ELEMENT_SELECTED', data: payload }, '*');
    }
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

  interface ElementSelection {
    tagName: string;
    text: string;
    outerHTML: string;
    attributes: Record<string, string>;
    page?: { url: string; path: string; title: string };
    ancestry?: string;
    nearestHeading?: string | null;
    landmark?: string | null;
    aria?: Record<string, string> | null;
    formContext?: { action: string; method: string; name: string; id: string } | null;
    dimensions?: { width: number; height: number };
    computedStyles?: Record<string, string>;
    boundingRect?: { top: number; left: number; width: number; height: number };
    screenshotDataUrl?: string;
  }

  /** Convert a data URL (from iframe postMessage) to a File */
  const dataUrlToFile = useCallback((dataUrl: string, fileName: string): File | null => {
    try {
      const [header, data] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
      const bytes = atob(data);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return new File([arr], fileName, { type: mime });
    } catch {
      return null;
    }
  }, []);

  const handleElementSelected = useCallback(async (data: ElementSelection) => {
    setIsSelectMode(false);
    const lines: string[] = [];

    // Header with element identity
    const label = data.attributes.id ? `#${data.attributes.id}` : data.text?.substring(0, 40) || data.tagName;
    lines.push(`# UI Element: <${data.tagName}> "${label}"`);
    lines.push('');

    // Page context — where on the site this element lives
    if (data.page) {
      lines.push('## Page Context');
      lines.push(`URL: ${data.page.url}`);
      lines.push(`Path: ${data.page.path}`);
      if (data.page.title) lines.push(`Page Title: ${data.page.title}`);
      lines.push('');
    }

    // Location in DOM — ancestry breadcrumb + landmark + heading
    lines.push('## Location');
    if (data.ancestry) lines.push(`DOM Path: ${data.ancestry}`);
    if (data.landmark) lines.push(`Landmark: ${data.landmark}`);
    if (data.nearestHeading) lines.push(`Section: "${data.nearestHeading}"`);
    lines.push('');

    // Element identity
    lines.push('## Element');
    lines.push(`Tag: <${data.tagName}>`);
    if (data.attributes.id) lines.push(`ID: #${data.attributes.id}`);
    if (data.attributes.class) lines.push(`Classes: .${data.attributes.class.split(' ').filter(Boolean).join('.')}`);
    if (data.dimensions) lines.push(`Size: ${data.dimensions.width}×${data.dimensions.height}px`);
    lines.push('');

    // Computed styles — most relevant ones for UI work
    if (data.computedStyles && Object.keys(data.computedStyles).length > 0) {
      lines.push('## Computed Styles');
      for (const [prop, val] of Object.entries(data.computedStyles)) {
        lines.push(`${prop}: ${val}`);
      }
      lines.push('');
    }

    // Accessibility / semantics
    if (data.aria && Object.keys(data.aria).length > 0) {
      lines.push('## Accessibility');
      for (const [key, value] of Object.entries(data.aria)) {
        lines.push(`${key}: ${value}`);
      }
      lines.push('');
    }

    // Text content
    if (data.text) {
      lines.push('## Text Content');
      lines.push(data.text);
      lines.push('');
    }

    // Form context
    if (data.formContext) {
      lines.push('## Form Context');
      if (data.formContext.name || data.formContext.id) lines.push(`Form: ${data.formContext.name || data.formContext.id}`);
      if (data.formContext.action) lines.push(`Action: ${data.formContext.action}`);
      lines.push(`Method: ${data.formContext.method.toUpperCase()}`);
      lines.push('');
    }

    // HTML source
    lines.push('## HTML');
    lines.push('```html');
    lines.push(data.outerHTML);
    lines.push('```');

    const content = lines.join('\n');
    const mdBlob = new Blob([content], { type: 'text/markdown' });
    const fileName = `element-${data.tagName}${data.attributes.id ? `-${data.attributes.id}` : ''}-${Date.now()}.md`;
    const mdFile = new File([mdBlob], fileName, { type: 'text/markdown' });

    try {
      // Attach markdown context
      await addAttachedFile(mdFile);

      // Attach screenshot if provided (from picker script via html2canvas)
      if (data.screenshotDataUrl) {
        const screenshot = dataUrlToFile(data.screenshotDataUrl, `element-screenshot-${Date.now()}.png`);
        if (screenshot) await addAttachedFile(screenshot);
      }

      toast.success('Element attached to chat', {
        description: `<${data.tagName}>${data.attributes.id ? ` #${data.attributes.id}` : ''} selected`,
      });
    } catch {
      toast.error('Failed to attach element');
    }
  }, [addAttachedFile, dataUrlToFile]);

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
