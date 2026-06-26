import { lazy, memo, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  redirect,
  type RouteObject,
} from 'react-router';
import FallbackComponent from './components/fallback-component';
import { collectRoutes } from './features/_registry';
import { IS_ENTERPRISE } from './pages/admin/utils';
import authorizationUtil from './utils/authorization-util';

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

type LazyRouteConfig = Omit<RouteObject, 'Component' | 'children'> & {
  Component?: () => Promise<{ default: React.ComponentType<any> }>;
  children?: LazyRouteConfig[];
};

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
  return process.env.NODE_ENV === 'development' ? LazyComponent : memo(Wrapped);
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
      },
    ],
  },
  {
    path: Routes.Root,
    Component: () => import('@/layouts/root-layout'),
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
  },
  {
    path: Routes.Chunk,
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

const wrapRoutes = (routes: LazyRouteConfig[]): RouteObject[] =>
  routes.map((item) => {
    const { Component, children, ...rest } = item;
    const next: RouteObject = { ...rest, errorElement: <FallbackComponent /> };
    if (Component) {
      next.Component = withLazyRoute(Component);
    }
    if (children) {
      next.children = wrapRoutes(children);
    }
    return next;
  });

const routeConfig = wrapRoutes([
  ...routeConfigOptions,
  ...collectRoutes(),
]);

const routers = createBrowserRouter(routeConfig, {
  basename: import.meta.env.VITE_BASE_URL || '/',
});

export { routers };
