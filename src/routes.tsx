import { lazy, memo, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  redirect,
  type RouteObject,
} from 'react-router';
import FallbackComponent from './components/fallback-component';
import { collectRoutes } from './features/_registry';
import type { LazyRouteConfig } from './features/_types';
import { IS_ENTERPRISE } from './pages/admin/utils';
import authorizationUtil from './utils/authorization-util';
import AuthWrapper from './wrappers/auth';

export enum Routes {
  Root = '/',
  Login = '/login-next',
  Logout = '/logout',
  Home = '/home',
  Datasets = '/datasets',
  DatasetBase = '/dataset',
  Files = '/files',
  Dataset = `${Routes.DatasetBase}/${Routes.Files}`,
  Agent = '/agent',
  AgentTemplates = '/agent-templates',
  Agents = '/agents',
  Explore = '/explore',
  AgentExplore = `${Routes.Agent}/:id/explore`,
  Memories = '/memories',
  Memory = '/memory',
  MemoryMessage = '/memory-message',
  MemorySetting = '/memory-setting',
  AgentList = '/agent-list',
  Searches = '/searches',
  Search = '/search',
  SearchShare = '/search/share',
  Chats = '/chats',
  Chat = '/chat',

  Skills = '/files/skills',
  ProfileSetting = '/profile-setting',
  Profile = '/profile',
  Api = '/api',
  Mcp = '/mcp',
  Team = '/team',
  Plan = '/plan',
  Model = '/model',
  Prompt = '/prompt',
  DataSource = '/data-source',
  DataSourceDetailPage = '/data-source-detail-page',
  ChatChannel = '/chat-channel',
  ProfileMcp = `${ProfileSetting}${Mcp}`,
  ProfileTeam = `${ProfileSetting}${Team}`,
  ProfilePlan = `${ProfileSetting}${Plan}`,
  ProfileModel = `${ProfileSetting}${Model}`,
  ProfilePrompt = `${ProfileSetting}${Prompt}`,
  ProfileProfile = `${ProfileSetting}${Profile}`,
  DatasetTesting = '/retrieval',
  Chunk = '/chunk',
  ChunkResult = `${Chunk}${Chunk}`,
  Parsed = '/parsed',
  ParsedResult = `${Chunk}${Parsed}`,
  Result = '/result',
  ResultView = `${Chunk}${Result}`,
  KnowledgeGraph = '/knowledge-graph',
  AgentLogPage = '/agent-log-page',
  AgentShare = '/agent/share',
  ChatShare = `${Chats}/share`,
  ChatWidget = `${Chats}/widget`,
  UserSetting = '/user-setting',
  DataSetOverview = '/logs',
  DataSetSetting = '/configuration',
  DataflowResult = '/dataflow-result',
  Admin = '/admin',
  AdminServices = `${Admin}/services`,
  AdminUserManagement = `${Admin}/users`,
  AdminSandboxSettings = `${Admin}/sandbox-settings`,
  AdminWhitelist = `${Admin}/whitelist`,
  AdminRoles = `${Admin}/roles`,
  AdminMonitoring = `${Admin}/monitoring`,
  // Multi-Harness P2 (US3):Harness 后端配置 Admin 页面。
  AdminHarnessBackends = `${Admin}/harness-backends`,
  // Multi-Harness P5 (US1/US2/US3):Team/Project/Tenant-binding Admin 页面。
  AdminTeams = `${Admin}/teams`,
  AdminProjects = `${Admin}/projects`,
  AdminTenantBindings = `${Admin}/tenant-bindings`,
}

const defaultRouteFallback = (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
  </div>
);

const withLazyRoute = (
  importer: () => Promise<{ default: React.ComponentType<any> }>,
  fallback: React.ReactNode = defaultRouteFallback,
) => {
  const LazyComponent = lazy(importer);
  const Wrapped: React.FC<any> = (props) => (
    <Suspense fallback={fallback}>
      <LazyComponent {...props} />
    </Suspense>
  );
  Wrapped.displayName = `LazyRoute(${
    (LazyComponent as unknown as React.ComponentType<any>).displayName ||
    LazyComponent.name ||
    'Component'
  })`;
  // 始终返回带 Suspense 边界的 Wrapped 组件。
  // 之前开发模式下返回裸 LazyComponent 是为了 why-did-you-render 兼容,
  // 但 why-did-you-render 已禁用(与 React Router 7 不兼容),且裸 lazy
  // 组件在 AuthWrapper(element 方式)中挂起时无 Suspense 兜底,导致
  // React Router 抛出 "component suspended during synchronous input
  // response" 错误并回退导航。
  return memo(Wrapped);
};

const routeConfigOptions = [
  {
    path: '/login',
    Component: () => import('@/pages/login-next'),
    layout: false,
  },
  {
    path: '/login-next',
    Component: () => import('@/pages/login-next'),
    layout: false,
  },
  {
    path: '/document/:id',
    Component: () => import('@/pages/document-viewer'),
    layout: false,
  },
  {
    path: '/*',
    Component: () => import('@/pages/404'),
    layout: false,
  },
  {
    path: Routes.Root,
    layout: false,
    Component: () => import('@/layouts/root-layout'),
    loader: ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      const auth = url.searchParams.get('auth');
      if (auth) {
        authorizationUtil.setAuthorization(auth);
        url.searchParams.delete('auth');
        return redirect(`${url.pathname}${url.search}`);
      }
      return null;
    },
    children: [
      {
        path: Routes.Root,
        Component: () => import('@/pages/home'),
        authRequired: true,
      },
    ],
  },
  {
    path: Routes.Root,
    Component: () => import('@/layouts/root-layout'),
    authRequired: true,
    children: [
      {
        path: Routes.UserSetting,
        Component: () => import('@/pages/user-setting'),
        layout: false,
        children: [
          {
            path: Routes.UserSetting,
            element: (
              <Navigate to={`/user-setting${Routes.DataSource}`} replace />
            ),
          },
          {
            path: `${Routes.UserSetting}/profile`,
            Component: () => import('@/pages/user-setting/profile'),
          },
          /*
          {
            path: `${Routes.UserSetting}/locale`,
            Component: () => import('@/pages/user-setting/setting-locale'),
          },
          */
          {
            path: `${Routes.UserSetting}/model`,
            Component: () => import('@/pages/user-setting/setting-model'),
          },
          {
            path: `${Routes.UserSetting}/team`,
            Component: () => import('@/pages/user-setting/setting-team'),
          },
          {
            path: `${Routes.UserSetting}${Routes.Api}`,
            Component: () => import('@/pages/user-setting/setting-api'),
          },
          {
            path: `${Routes.UserSetting}${Routes.Mcp}`,
            Component: () => import('@/pages/user-setting/mcp'),
          },

          {
            path: `${Routes.UserSetting}${Routes.DataSource}`,
            Component: () => import('@/pages/user-setting/data-source'),
          },
          {
            path: `${Routes.UserSetting}${Routes.ChatChannel}`,
            Component: () => import('@/pages/user-setting/chat-channel'),
          },
        ],
      },
      {
        path: `${Routes.UserSetting}${Routes.DataSource}${Routes.DataSourceDetailPage}`,
        layout: false,
        Component: () =>
          import('@/pages/user-setting/data-source/data-source-detail-page'),
      },
    ],
  },
  {
    path: `${Routes.DataflowResult}`,
    Component: () => import('@/pages/dataflow-result'),
    authRequired: true,
  },
  {
    path: Routes.Chunk,
    authRequired: true,
    children: [
      {
        path: `${Routes.Chunk}`,
        Component: () => import('@/pages/chunk'),
      },
      {
        path: `${Routes.ParsedResult}/chunks`,
        Component: () =>
          import('@/pages/chunk/parsed-result/add-knowledge/components/knowledge-chunk'),
      },
      {
        path: `${Routes.ChunkResult}/:id`,
        Component: () => import('@/pages/chunk/chunk-result'),
      },
      {
        path: `${Routes.ResultView}/:id`,
        Component: () => import('@/pages/chunk/result-view'),
      },
    ],
  },
  {
    path: Routes.Admin,
    Component: () => import('@/pages/admin/layouts/root-layout'),
    children: [
      {
        path: Routes.Admin,
        Component: () => import('@/pages/admin/login'),
      },
      {
        path: Routes.Admin,
        Component: () => import('@/pages/admin/layouts/authorized-layout'),
        children: [
          {
            path: `${Routes.AdminUserManagement}/:id`,
            Component: () => import('@/pages/admin/user-detail'),
          },
          {
            Component: () => import('@/pages/admin/layouts/navigation-layout'),
            children: [
              {
                path: Routes.AdminServices,
                Component: () => import('@/pages/admin/service-status'),
              },
              {
                path: Routes.AdminUserManagement,
                Component: () => import('@/pages/admin/users'),
              },
              {
                path: Routes.AdminSandboxSettings,
                Component: () => import('@/pages/admin/sandbox-settings'),
              },
              // Multi-Harness P2 (US3):Harness 后端配置 Admin 页面(非企业版独占,所有部署都可用)。
              {
                path: Routes.AdminHarnessBackends,
                Component: () => import('@/pages/admin/harness-backends'),
              },
              // Multi-Harness P5 (US1/US2/US3):Team/Project/Tenant-binding Admin 页面。
              {
                path: Routes.AdminTeams,
                Component: () => import('@/pages/admin/teams'),
              },
              {
                path: Routes.AdminProjects,
                Component: () => import('@/pages/admin/projects'),
              },
              {
                path: Routes.AdminTenantBindings,
                Component: () =>
                  import('@/pages/admin/tenant-bindings'),
              },
              ...(IS_ENTERPRISE
                ? [
                    {
                      path: Routes.AdminWhitelist,
                      Component: () => import('@/pages/admin/whitelist'),
                    },
                    {
                      path: Routes.AdminRoles,
                      Component: () => import('@/pages/admin/roles'),
                    },
                    {
                      path: Routes.AdminMonitoring,
                      Component: () => import('@/pages/admin/monitoring'),
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  } satisfies LazyRouteConfig,
];

const wrapRoutes = (
  routes: LazyRouteConfig[],
  parentAuthRequired?: boolean,
  parentHasAuthWrapper = false,
): RouteObject[] =>
  routes.map((item) => {
    const { Component, children, authRequired, ...rest } = item;
    const next: RouteObject = { ...rest, errorElement: <FallbackComponent /> };
    // 子路由继承父路由的 authRequired(除非显式覆盖)
    const needAuth = authRequired ?? parentAuthRequired;
    // 父路由已有 AuthWrapper 时,子路由渲染在父 Outlet 中已被守卫,无需重复包裹。
    // 避免嵌套 AuthWrapper 导致额外的 useAuth/probe 订阅与冗余渲染。
    const shouldWrap = needAuth && !parentHasAuthWrapper;
    if (Component) {
      const LazyComp = withLazyRoute(Component);
      if (shouldWrap) {
        // 用 AuthWrapper 包裹:未登录跳转,探测中渲染空白,已登录渲染组件
        next.element = <AuthWrapper><LazyComp /></AuthWrapper>;
      } else {
        next.Component = LazyComp;
      }
    }
    if (children) {
      // 仅当本路由实际被 AuthWrapper 包裹(有 Component + shouldWrap)时,
      // 才告知子路由父已有守卫,避免子路由重复包裹
      next.children = wrapRoutes(
        children,
        needAuth,
        shouldWrap && !!Component,
      );
    }
    return next;
  });

const featureRoutes = collectRoutes().map((route) => ({
  ...route,
  authRequired: true,
}));

/**
 * 合并所有 path: '/' 的根路由为单个路由,避免多模块各自定义根路由导致子路由无法匹配。
 *
 * React Router 匹配 URL 时,对于多个同 path 的父路由只会查找第一个匹配父路由的
 * children。6 个 feature 模块(agents/memories/files/chats/datasets/searches)
 * 各自定义 path: '/' 父路由,导致后续模块的子路由(如 /agents)无法被匹配,
 * 回退到 /* 404 兜底。
 *
 * 合并策略:保留首个根路由的 loader(处理 ?auth= query param),将所有根路由的
 * children 合并;authRequired 取真值优先(任意根路由需要认证则合并后也需要)。
 */
function mergeRootRoutes(routes: LazyRouteConfig[]): LazyRouteConfig[] {
  const rootIndices: number[] = [];
  for (let i = 0; i < routes.length; i++) {
    if (routes[i].path === Routes.Root) {
      rootIndices.push(i);
    }
  }

  if (rootIndices.length <= 1) {
    return routes;
  }

  const firstRoot = routes[rootIndices[0]];
  const mergedChildren: LazyRouteConfig[] = [];
  let authRequired = false;

  for (const idx of rootIndices) {
    const route = routes[idx];
    if (route.children) {
      mergedChildren.push(...route.children);
    }
    if (route.authRequired) {
      authRequired = true;
    }
  }

  const result: LazyRouteConfig[] = [];
  let mergedInserted = false;
  for (let i = 0; i < routes.length; i++) {
    if (rootIndices.includes(i)) {
      if (!mergedInserted) {
        result.push({
          ...firstRoot,
          children: mergedChildren,
          authRequired: authRequired || firstRoot.authRequired,
        });
        mergedInserted = true;
      }
    } else {
      result.push(routes[i]);
    }
  }

  return result;
}

const mergedRouteInput = mergeRootRoutes([...routeConfigOptions, ...featureRoutes]);
const routeConfig = wrapRoutes(mergedRouteInput);

const routers = createBrowserRouter(routeConfig, {
  basename: import.meta.env.VITE_BASE_URL || '/',
});

export { routers };
