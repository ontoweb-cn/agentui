/**
 * AgentUI 系统级能力（feature flags）。
 *
 * 与 harness 后端能力（HarnessCapabilities）解耦：这里描述宿主自身集成的
 * 外部领域能力，例如统一认证（intellect-auth）。缺省一律 false。
 */
export interface Features {
  /**
   * 统一认证能力。按产品约定 JSON 键名使用连字符 `intellect-auth`。
   * 仅当 INTELLECT_AUTH_ENABLED=true 且 hiedu 断言代理配置完整时为 true。
   */
  'intellect-auth': boolean;
  /**
   * AIHub 能力。仅当 AIHUB_ENABLED=true 且 aihub 代理/断言配置完整时为 true。
   * 控制 AgentUI 顶部「资源」入口与 `/api/bff/aihub/*` 代理总闸。
   */
  aihub: boolean;
}

export interface FeaturesResponse {
  features: Features;
}
