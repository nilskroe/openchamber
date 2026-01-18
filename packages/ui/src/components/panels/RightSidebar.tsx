import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RiFileCopyLine, RiFolderOpenLine, RiTerminalBoxLine, RiArrowUpSLine, RiArrowDownSLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import { FileChangesPanel } from './FileChangesPanel';
import { TerminalPanel } from './TerminalPanel';

type RightSidebarTab = 'changes' | 'files';

interface RightSidebarProps {
  directory: string | null;
  className?: string;
}

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const DEFAULT_TERMINAL_HEIGHT_PERCENT = 40;
const MIN_TERMINAL_HEIGHT_PERCENT = 15;
const MAX_TERMINAL_HEIGHT_PERCENT = 70;

export const RightSidebar: React.FC<RightSidebarProps> = ({
  directory,
  className,
}) => {
  const setGlobalResizing = useUIStore((state) => state.setGlobalResizing);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('changes');
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT_PERCENT);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingWidth(true);
    setGlobalResizing(true);
    
    const startX = e.clientX;
    const startWidth = width;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      setWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizingWidth(false);
      setGlobalResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [width, setGlobalResizing]);
  
  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingHeight(true);
    setGlobalResizing(true);
    
    const startY = e.clientY;
    const startHeight = terminalHeight;
    const containerHeight = contentRef.current?.clientHeight ?? 500;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const deltaPercent = (deltaY / containerHeight) * 100;
      const newHeight = Math.max(MIN_TERMINAL_HEIGHT_PERCENT, Math.min(MAX_TERMINAL_HEIGHT_PERCENT, startHeight + deltaPercent));
      setTerminalHeight(newHeight);
    };
    
    const handleMouseUp = () => {
      setIsResizingHeight(false);
      setGlobalResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [terminalHeight, setGlobalResizing]);
  
  const toggleTerminalCollapsed = useCallback(() => {
    setTerminalCollapsed(prev => !prev);
  }, []);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        toggleTerminalCollapsed();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminalCollapsed]);
  
  return (
    <aside
      ref={sidebarRef}
      className={cn(
        'relative flex h-full flex-col border-l bg-sidebar',
        'transition-[opacity] duration-200',
        (isResizingWidth || isResizingHeight) && 'select-none',
        className
      )}
      style={{ 
        width: `${width}px`, 
        minWidth: `${MIN_WIDTH}px`, 
        maxWidth: `${MAX_WIDTH}px`,
        borderColor: 'var(--interactive-border)',
      }}
    >
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10',
          'hover:bg-primary/20 transition-colors',
          isResizingWidth && 'bg-primary/30'
        )}
        onMouseDown={handleWidthResizeStart}
      />
      
      <div ref={contentRef} className="flex flex-1 flex-col overflow-hidden">
        <div 
          className="flex h-10 shrink-0 items-center border-b bg-sidebar"
          style={{ borderColor: 'var(--interactive-border)' }}
        >
          <button
            onClick={() => setActiveTab('changes')}
            className={cn(
              'relative flex h-full items-center gap-2 border-r px-4 text-[11px] font-medium transition-colors',
              activeTab === 'changes'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'
            )}
            style={{ borderColor: 'var(--interactive-border)' }}
          >
            <RiFileCopyLine className="h-3.5 w-3.5" />
            <span>Changes</span>
            {activeTab === 'changes' && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-primary/50" />
            )}
          </button>
          
          <button
            onClick={() => setActiveTab('files')}
            className={cn(
              'relative flex h-full items-center gap-2 border-r px-4 text-[11px] font-medium transition-colors',
              activeTab === 'files'
                ? 'bg-muted/40 text-foreground'
                : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'
            )}
            style={{ borderColor: 'var(--interactive-border)' }}
          >
            <RiFolderOpenLine className="h-3.5 w-3.5" />
            <span>Files</span>
            {activeTab === 'files' && (
              <div className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-primary/50" />
            )}
          </button>
        </div>
        
        <div 
          className="flex-1 overflow-hidden"
          style={{ 
            height: terminalCollapsed ? 'calc(100% - 40px)' : `calc(${100 - terminalHeight}% - 40px)` 
          }}
        >
          {activeTab === 'changes' ? (
            <FileChangesPanel directory={directory} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              <div className="text-center p-4">
                <RiFolderOpenLine className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>File browser coming soon</p>
              </div>
            </div>
          )}
        </div>
        
        <div
          className={cn(
            'border-t bg-sidebar transition-all duration-200 flex flex-col',
            terminalCollapsed ? 'h-10 flex-none' : ''
          )}
          style={{ 
            height: terminalCollapsed ? '40px' : `${terminalHeight}%`,
            minHeight: terminalCollapsed ? '40px' : '120px',
            borderColor: 'var(--interactive-border)',
          }}
        >
          {!terminalCollapsed && (
            <div
              className={cn(
                'h-1 cursor-row-resize hover:bg-primary/20 transition-colors shrink-0',
                isResizingHeight && 'bg-primary/30'
              )}
              onMouseDown={handleHeightResizeStart}
            />
          )}
          
          <div
            className={cn(
              'flex h-10 items-center justify-between border-b px-3 cursor-pointer shrink-0',
              'hover:bg-muted/20 transition-colors'
            )}
            style={{ borderColor: 'var(--interactive-border)' }}
            onClick={toggleTerminalCollapsed}
          >
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <RiTerminalBoxLine className="h-3.5 w-3.5" />
              <span>Terminal</span>
            </div>
            <button 
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/30"
              onClick={(e) => {
                e.stopPropagation();
                toggleTerminalCollapsed();
              }}
            >
              {terminalCollapsed ? (
                <RiArrowUpSLine className="h-4 w-4" />
              ) : (
                <RiArrowDownSLine className="h-4 w-4" />
              )}
            </button>
          </div>
          
          {!terminalCollapsed && (
            <div className="flex-1 overflow-hidden min-h-0">
              <TerminalPanel directory={directory} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
