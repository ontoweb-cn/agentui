import { Outlet } from 'react-router';
import { useState } from 'react';
import { SideBar } from './sidebar';

import { cn } from '@/lib/utils';

const UserSetting = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={cn(
        'pt-0.5 size-full grid grid-cols-[4rem_minmax(0,1fr)] grid-rows-1 min-w-0',
        !collapsed && 'md:grid-cols-[303px_minmax(0,1fr)]',
      )}
    >
      <SideBar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      {/* 内容区间距对齐 chat 页:上 2px/左右 10px/下 10px */}
      <div className="px-2.5 pt-0.5 pb-2.5 flex flex-1 min-w-0 rounded-lg overflow-hidden">
        <Outlet />
      </div>
    </section>
  );
};

export default UserSetting;
