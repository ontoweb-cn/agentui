// spec-013 P1-4: 重构 root-layout,根据 feature flag 切换三栏或旧布局
// three-column(默认): ThreeColumnLayout + TopBar + TaskSidebar + ToolPanelHost
// legacy: 旧 RootLayoutContainer + Header

import { Outlet } from 'react-router';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { ThreeColumnLayout } from './three-column-layout';
import { TopBar } from './components/top-bar';
import { TaskSidebar } from './components/task-sidebar';
import { ToolPanelHost } from './components/tool-panel-host';
import { Header } from './components/header';

export function RootLayoutContainer({ children }: React.PropsWithChildren) {
  return (
    <div className="size-full grid grid-rows-[auto_1fr] grid-cols-1 grid-flow-col">
      <Header className="px-5 py-4" />

      <main className="size-full overflow-hidden">{children}</main>
    </div>
  );
}

export default function RootLayout() {
  const { mode } = useLayoutMode();

  if (mode === 'legacy') {
    return (
      <RootLayoutContainer>
        <Outlet />
      </RootLayoutContainer>
    );
  }

  return (
    <ThreeColumnLayout
      topBar={<TopBar />}
      sidebar={
        <TaskSidebar tasks={[]} />
      }
      toolPanel={<ToolPanelHost panels={[]} />}
    >
      <Outlet />
    </ThreeColumnLayout>
  );
}
