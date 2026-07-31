// spec-013 P1-1: ThreeColumnLayout 三栏布局容器
// 对齐 specs/013-trae-work-ui-refactor/components-api.md §3.1
// CSS Grid 布局,受控/非受控折叠,响应式断点(<1024 图标栏,<768 overlay)

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ThreeColumnLayoutProps {
  /** 左侧栏内容(任务列表) */
  sidebar?: React.ReactNode;
  /** 主区域内容 */
  children: React.ReactNode;
  /** 右侧工具面板内容(可选) */
  toolPanel?: React.ReactNode;
  /** 顶栏内容(可选,默认不渲染) */
  topBar?: React.ReactNode;
  /** 左侧栏宽度(可选,默认 280px) */
  sidebarWidth?: number | string;
  /** 右侧面板宽度(可选,默认 360px) */
  toolPanelWidth?: number | string;
  /** 左侧栏是否可折叠(可选,默认 true) */
  sidebarCollapsible?: boolean;
  /** 右侧面板是否可折叠(可选,默认 true) */
  toolPanelCollapsible?: boolean;
  /** 左侧栏默认折叠(可选,默认 false) */
  defaultSidebarCollapsed?: boolean;
  /** 右侧面板默认折叠(可选,默认 true) */
  defaultToolPanelCollapsed?: boolean;
  /** 受控:左侧栏折叠状态(可选) */
  sidebarCollapsed?: boolean;
  /** 受控:右侧面板折叠状态(可选) */
  toolPanelCollapsed?: boolean;
  /** 折叠状态变更回调(可选) */
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  /** 折叠状态变更回调(可选) */
  onToolPanelCollapsedChange?: (collapsed: boolean) => void;
}

const TABLET_BREAKPOINT = 1024;
const MOBILE_BREAKPOINT = 768;
const ICON_BAR_WIDTH = 56;
const TOPBAR_HEIGHT = 56;

function normalizeWidth(width: number | string): string {
  return typeof width === 'number' ? `${width}px` : width;
}

/**
 * ThreeColumnLayout — 三栏布局容器。
 *
 * CSS Grid: `[topbar] 56px [body] 1fr` × `[sidebar] auto [main] 1fr [toolpanel] auto`。
 * 顶栏跨三列,主区 `min-w-0` 防溢出。
 *
 * 折叠状态支持受控(`sidebarCollapsed`/`toolPanelCollapsed`)与非受控
 * (`defaultSidebarCollapsed`/`defaultToolPanelCollapsed`)两种模式,
 * 使用 `actualCollapsed = prop ?? internal` pattern。
 *
 * 响应式断点:
 * - `< 1024px`(平板):侧栏宽度强制为 56px(图标栏)
 * - `< 768px`(移动):侧栏完全隐藏(width=0),工具面板切换为 overlay 模式
 *   (position: absolute + backdrop),进入移动端时自动折叠侧栏并通知父组件。
 */
export function ThreeColumnLayout({
  sidebar,
  children,
  toolPanel,
  topBar,
  sidebarWidth = 280,
  toolPanelWidth = 360,
  sidebarCollapsible = true,
  toolPanelCollapsible = true,
  defaultSidebarCollapsed = false,
  defaultToolPanelCollapsed = true,
  sidebarCollapsed: sidebarCollapsedProp,
  toolPanelCollapsed: toolPanelCollapsedProp,
  onSidebarCollapsedChange,
  onToolPanelCollapsedChange,
}: ThreeColumnLayoutProps) {
  // ---- 受控/非受控: sidebar ----
  const [internalSidebarCollapsed, setInternalSidebarCollapsed] =
    React.useState<boolean>(defaultSidebarCollapsed);
  const isSidebarControlled = sidebarCollapsedProp !== undefined;
  const sidebarCollapsed = isSidebarControlled
    ? (sidebarCollapsedProp as boolean)
    : internalSidebarCollapsed;

  const setSidebarCollapsed = React.useCallback(
    (next: boolean) => {
      if (!isSidebarControlled) {
        setInternalSidebarCollapsed(next);
      }
      onSidebarCollapsedChange?.(next);
    },
    [isSidebarControlled, onSidebarCollapsedChange],
  );

  // ---- 受控/非受控: toolPanel ----
  const [internalToolPanelCollapsed, setInternalToolPanelCollapsed] =
    React.useState<boolean>(defaultToolPanelCollapsed);
  const isToolPanelControlled = toolPanelCollapsedProp !== undefined;
  const toolPanelCollapsed = isToolPanelControlled
    ? (toolPanelCollapsedProp as boolean)
    : internalToolPanelCollapsed;

  const setToolPanelCollapsed = React.useCallback(
    (next: boolean) => {
      if (!isToolPanelControlled) {
        setInternalToolPanelCollapsed(next);
      }
      onToolPanelCollapsedChange?.(next);
    },
    [isToolPanelControlled, onToolPanelCollapsedChange],
  );

  // ---- 响应式断点 ----
  const [isTablet, setIsTablet] = React.useState<boolean>(false);
  const [isMobile, setIsMobile] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const tabletMql = window.matchMedia(
      `(max-width: ${TABLET_BREAKPOINT - 1}px)`,
    );
    const mobileMql = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`,
    );
    const update = () => {
      setIsTablet(tabletMql.matches);
      setIsMobile(mobileMql.matches);
    };
    update();
    tabletMql.addEventListener('change', update);
    mobileMql.addEventListener('change', update);
    return () => {
      tabletMql.removeEventListener('change', update);
      mobileMql.removeEventListener('change', update);
    };
  }, []);

  // ---- 移动端自动折叠侧栏 ----
  // 进入移动端时(<768px)自动折叠 sidebar 并通知父组件。
  // 用 ref 跟踪上一次的 isMobile,仅在 false→true 跳变时触发。
  const prevIsMobileRef = React.useRef<boolean>(false);
  React.useEffect(() => {
    const prev = prevIsMobileRef.current;
    prevIsMobileRef.current = isMobile;
    if (isMobile && !prev) {
      setSidebarCollapsed(true);
    }
  }, [isMobile, setSidebarCollapsed]);

  // ---- 计算实际宽度 ----
  const effectiveSidebarWidth: string = (() => {
    if (isMobile) return '0px'; // 移动端完全隐藏
    if (isTablet) return `${ICON_BAR_WIDTH}px`; // 平板图标栏
    if (sidebarCollapsible && sidebarCollapsed) return '0px';
    return normalizeWidth(sidebarWidth);
  })();

  const effectiveToolPanelWidth: string = (() => {
    if (isMobile) {
      // overlay 模式:展开时为 toolPanelWidth,折叠时为 0
      return toolPanelCollapsed ? '0px' : normalizeWidth(toolPanelWidth);
    }
    if (toolPanelCollapsible && toolPanelCollapsed) return '0px';
    return normalizeWidth(toolPanelWidth);
  })();

  // ---- 渲染 ----
  const hasTopBar = !!topBar;
  const gridTemplateRows = hasTopBar
    ? `[topbar] ${TOPBAR_HEIGHT}px [body] 1fr`
    : `[body] 1fr`;
  const gridTemplateColumns = `[sidebar] auto [main] 1fr [toolpanel] auto`;

  const handleBackdropClick = React.useCallback(() => {
    setToolPanelCollapsed(true);
  }, [setToolPanelCollapsed]);

  const transitionStyle = 'width var(--trae-transition-base, 200ms ease)';

  return (
    <div
      className={cn('relative grid h-full w-full overflow-hidden')}
      style={{
        gridTemplateRows,
        gridTemplateColumns,
      }}
      data-testid="three-column-layout"
      data-is-tablet={isTablet}
      data-is-mobile={isMobile}
      data-sidebar-collapsed={sidebarCollapsed}
      data-toolpanel-collapsed={toolPanelCollapsed}
    >
      {hasTopBar && (
        <div
          className="border-b border-[var(--trae-line)] bg-[var(--trae-nav-bg)]"
          style={{
            gridColumn: '1 / -1',
            gridRow: 'topbar',
            backdropFilter: 'var(--trae-blur-nav)',
            WebkitBackdropFilter: 'var(--trae-blur-nav)',
          }}
          data-testid="three-column-topbar"
        >
          {topBar}
        </div>
      )}

      {sidebar && (
        <aside
          role="complementary"
          aria-label="任务列表"
          className={cn(
            'overflow-hidden border-r border-[var(--trae-line)] bg-[var(--trae-surface)]',
          )}
          style={{
            gridRow: 'body',
            gridColumn: 'sidebar',
            width: effectiveSidebarWidth,
            transition: transitionStyle,
          }}
          data-testid="three-column-sidebar"
        >
          {sidebar}
        </aside>
      )}

      <main
        role="main"
        className={cn('min-w-0 overflow-hidden')}
        style={{
          gridRow: 'body',
          gridColumn: 'main',
        }}
        data-testid="three-column-main"
      >
        {children}
      </main>

      {toolPanel && (
        <>
          {isMobile && !toolPanelCollapsed && (
            <div
              className="absolute inset-0 z-40 bg-black/40"
              style={{
                top: hasTopBar ? `${TOPBAR_HEIGHT}px` : 0,
              }}
              onClick={handleBackdropClick}
              aria-hidden
              data-testid="three-column-backdrop"
            />
          )}
          <aside
            role="complementary"
            aria-label="工具面板"
            className={cn(
              'overflow-hidden border-l border-[var(--trae-line)] bg-[var(--trae-surface)]',
              isMobile && 'absolute z-50',
            )}
            style={
              isMobile
                ? {
                    top: hasTopBar ? `${TOPBAR_HEIGHT}px` : 0,
                    right: 0,
                    bottom: 0,
                    width: effectiveToolPanelWidth,
                    transition: transitionStyle,
                  }
                : {
                    gridRow: 'body',
                    gridColumn: 'toolpanel',
                    width: effectiveToolPanelWidth,
                    transition: transitionStyle,
                  }
            }
            data-testid="three-column-toolpanel"
            data-overlay={isMobile ? 'true' : undefined}
          >
            {toolPanel}
          </aside>
        </>
      )}
    </div>
  );
}
