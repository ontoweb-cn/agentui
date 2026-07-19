const webAPI = `/v1`;
// Multi-Harness P0-前置 (Constitution Principle I):前端所有 /api/v1/* 改经 BFF 透明反向代理。
// 改回 `/api/v1` 可瞬时回滚(FR-006),无需 BFF 配合。
const restAPIv1 = `/api/bff/proxy/v1`;
// Multi-Harness P1 (US1, Constitution Principle I + II): Agent 域改经 BFF 原生路由调 Adapter。
// 仅 Agent CRUD + Session CRUD + chat/completions 路径迁移到 bffAgents,
// 其余 Agent 子域(components/versions/tags/upload/download)保留 restAPIv1 透传。
// 改回 `${restAPIv1}/agents` 可瞬时回滚。
const bffAgents = `/api/bff/agents`;
// Multi-Harness P2 (US2, Constitution Principle I + II + V + VIII):
// 前端经 BFF 原生路由查询当前 tenant 绑定后端的能力,按 tenant 隔离,用于条件渲染。
const bffCapabilities = `/api/bff/capabilities`;
// BFF-owned admin routes (whitelist, roles, resources). These features were
// either unimplemented or stubbed in Intellect Admin, and are now served by the
// BFF layer. Strongly-coupled admin features (users, services, sandbox, system
// settings) remain on Intellect Admin via /api/v1/admin/*.
const bffAdmin = `/api/bff/admin`;
// Multi-Harness P2 (US1, Constitution Principle I + V + Token Security):
// Harness 后端配置 Admin 路由,运维操作(非租户隔离),响应不含 adminToken 明文。
const bffHarnessAdmin = `/api/bff/admin/harness-backends`;
// Multi-Harness P4b (US1/US2/US3, Constitution Principle I + V + VIII):
// BFF 统一认证路由,按 X-Tenant-Id 分发企业版(intellect-team)或社区版(intellect-rag)。
// 前端认证路径统一经 BFF,token 存 HttpOnly cookie,前端不接触。
// 改回 `${restAPIv1}/auth/*` 可瞬时回滚(FR-006)。
const bffAuth = `/api/bff/auth`;
// spec-008: Canvas routes — 画布脱离 Proxy 路由
// Constitution Principle I + III: 前端画布操作经 BFF /canvas/*
const bffCanvas = '/api/bff/canvas';

export { restAPIv1, webAPI, bffAgents, bffCapabilities, bffHarnessAdmin, bffAuth, bffCanvas };

export default {
  // user
  login: `${bffAuth}/login`,
  logout: `${bffAuth}/logout`,
  register: `${bffAuth}/register`,
  authConfig: `${bffAuth}/config`,
  setting: `${restAPIv1}/users/me`,
  userInfo: `${bffAuth}/me`,
  tenantInfo: `${restAPIv1}/users/me/models`,
  loginChannels: `${bffAuth}/login/channels`,
  loginChannel: (channel: string) => `${bffAuth}/login/${channel}`,

  // team
  addTenantUser: (tenantId: string) => `${restAPIv1}/tenants/${tenantId}/users`,
  listTenantUser: (tenantId: string) =>
    `${restAPIv1}/tenants/${tenantId}/users`,
  deleteTenantUser: (tenantId: string) =>
    `${restAPIv1}/tenants/${tenantId}/users`,
  listTenant: `${restAPIv1}/tenants`,
  agreeTenant: (tenantId: string) => `${restAPIv1}/tenants/${tenantId}`,

  // llm model
  listAllAddedModels: `${restAPIv1}/models`,
  defaultModel: `${restAPIv1}/models/default`,
  listProviders: `${restAPIv1}/providers`,
  addProvider: `${restAPIv1}/providers/`,
  addProviderInstance: ({ llm_factory }: { llm_factory: string }) =>
    `${restAPIv1}/providers/${llm_factory}/instances`,
  verifyProviderConnection: ({ provider_name }: { provider_name: string }) =>
    `${restAPIv1}/providers/${provider_name}/connection`,
  listProviderModels: ({ provider_name }: { provider_name: string }) =>
    `${restAPIv1}/providers/${provider_name}/models`,
  listProviderInstances: ({ provider_name }: { provider_name: string }) =>
    `${restAPIv1}/providers/${provider_name}/instances`,
  listInstanceModels: ({
    provider_name,
    instance_name,
  }: {
    provider_name: string;
    instance_name: string;
  }) =>
    `${restAPIv1}/providers/${provider_name}/instances/${instance_name}/models`,
  showProviderInstance: ({
    provider_name,
    instance_name,
  }: {
    provider_name: string;
    instance_name: string;
  }) => `${restAPIv1}/providers/${provider_name}/instances/${instance_name}`,
  addInstanceModel: ({
    provider_name,
    instance_name,
  }: {
    provider_name: string;
    instance_name: string;
  }) =>
    `${restAPIv1}/providers/${provider_name}/instances/${instance_name}/models`,
  editInstanceModel: ({
    provider_name,
    instance_name,
  }: {
    provider_name: string;
    instance_name: string;
  }) =>
    `${restAPIv1}/providers/${provider_name}/instances/${instance_name}/models`,
  deleteProviderInstance: ({ provider_name }: { provider_name: string }) =>
    `${restAPIv1}/providers/${provider_name}/instances`,
  updateModelStatus: ({
    provider_name,
    instance_name,
    model_name,
  }: {
    provider_name: string;
    instance_name: string;
    model_name: string;
  }) =>
    `${restAPIv1}/providers/${provider_name}/instances/${instance_name}/models/${model_name}`,

  // data source
  dataSourceUpdate: (id: string) => `${restAPIv1}/connectors/${id}`,
  dataSourceSet: `${restAPIv1}/connectors`,
  dataSourceList: `${restAPIv1}/connectors`,
  dataSourceDel: (id: string) => `${restAPIv1}/connectors/${id}`,
  dataSourceRebuild: (id: string) => `${restAPIv1}/connectors/${id}/rebuild`,
  dataSourceLogs: (id: string) => `${restAPIv1}/connectors/${id}/logs`,
  dataSourceDetail: (id: string) => `${restAPIv1}/connectors/${id}`,
  dataSourceTest: (id: string) => `${restAPIv1}/connectors/${id}/test`,
  googleWebAuthStart: (type: 'google-drive' | 'gmail') =>
    `${restAPIv1}/connectors/google/oauth/web/start?type=${type}`,
  googleWebAuthResult: (type: 'google-drive' | 'gmail') =>
    `${restAPIv1}/connectors/google/oauth/web/result?type=${type}`,
  boxWebAuthStart: () => `${restAPIv1}/connectors/box/oauth/web/start`,
  boxWebAuthResult: () => `${restAPIv1}/connectors/box/oauth/web/result`,

  // chat channel
  chatChannelSet: `${restAPIv1}/chat-channels`,
  chatChannelList: `${restAPIv1}/chat-channels`,
  chatChannelDetail: (id: string) => `${restAPIv1}/chat-channels/${id}`,
  chatChannelUpdate: (id: string) => `${restAPIv1}/chat-channels/${id}`,
  chatChannelDel: (id: string) => `${restAPIv1}/chat-channels/${id}`,
  chatChannelRuntime: (id: string) =>
    `${restAPIv1}/chat-channels/${id}/runtime`,

  // plugin
  llmTools: `${restAPIv1}/plugin/tools`,

  chatsTranscriptions: `${restAPIv1}/chat/audio/transcription`,

  // knowledge base

  checkEmbedding: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/embedding/check`,
  kbList: `${restAPIv1}/datasets`,
  createKb: `${restAPIv1}/datasets`,
  updateKb: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}`,
  rmKb: `${restAPIv1}/datasets`,
  getKbDetail: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}`,
  getKnowledgeGraph: (knowledgeId: string) =>
    `${restAPIv1}/datasets/${knowledgeId}/graph`,
  knowledgeGraph: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/graph`,
  deleteKnowledgeGraph: (knowledgeId: string) =>
    `${restAPIv1}/datasets/${knowledgeId}/graph`,
  getMeta: `${restAPIv1}/datasets/metadata/flattened`,
  getKnowledgeBasicInfo: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/ingestions/summary`,
  // data pipeline log
  fetchDataPipelineLog: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/ingestions`,
  getPipelineDetail: (datasetId: string, logId: string) =>
    `${restAPIv1}/datasets/${datasetId}/ingestions/${logId}`,
  fetchPipelineDatasetLogs: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/ingestions`,
  runIndex: (datasetId: string, indexType: string) =>
    `${restAPIv1}/datasets/${datasetId}/index?type=${indexType.toLowerCase()}`,
  traceIndex: (datasetId: string, indexType: string) =>
    `${restAPIv1}/datasets/${datasetId}/index?type=${indexType.toLowerCase()}`,
  unbindPipelineTask: (datasetId: string, indexType: string, wipe?: boolean) =>
    `${restAPIv1}/datasets/${datasetId}/${indexType.toLowerCase()}${wipe === false ? '?wipe=false' : ''}`,
  pipelineRerun: `${restAPIv1}/agents/rerun`,
  getMetaData: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/metadata/summary`,
  updateDocumentsMetadata: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/metadatas`,
  kbUpdateMetaData: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/metadata/config`,
  documentUpdateMetaDataConfig: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/metadata/config`,

  // tags
  listTag: (knowledgeId: string) => `${restAPIv1}/datasets/${knowledgeId}/tags`,
  listTagByKnowledgeIds: `${restAPIv1}/datasets/tags/aggregation`,
  removeTag: (knowledgeId: string) =>
    `${restAPIv1}/datasets/${knowledgeId}/tags`,
  renameTag: (knowledgeId: string) =>
    `${restAPIv1}/datasets/${knowledgeId}/tags`,

  // chunk
  chunkList: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/chunks`,
  chunkDetail: (datasetId: string, documentId: string, chunkId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/chunks/${chunkId}`,
  retrievalTest: `${restAPIv1}/datasets/search`,

  // document
  getDocumentList: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents`,
  documentChangeStatus: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/batch-update-status`,
  documentDelete: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents`,
  documentRename: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  documentIngest: `${restAPIv1}/documents/ingest`,
  documentCreate: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents?type=empty`,
  documentChangeParser: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  getDatasetDocumentFileDownload: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  documentThumbnails: `${restAPIv1}/thumbnails`,
  getDocumentFile: `${restAPIv1}/documents`,
  documentUpload: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents`,
  webCrawl: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents?type=web`,
  documentInfoUpload: `${restAPIv1}/documents/upload`,
  setMeta: `${webAPI}/document/set_meta`,
  getDatasetFilter: (datasetId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents?type=filter`,

  // chat
  createChat: `${restAPIv1}/chats`,
  listChats: `${restAPIv1}/chats`,
  getChat: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  updateChat: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  patchChat: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  deleteChat: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  bulkDeleteChats: `${restAPIv1}/chats`,
  createSession: (chatId: string) => `${restAPIv1}/chats/${chatId}/sessions`,
  listSessions: (chatId: string) => `${restAPIv1}/chats/${chatId}/sessions`,
  getSession: (chatId: string, sessionId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}`,
  updateSession: (chatId: string, sessionId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}`,
  removeSessions: (chatId: string) => `${restAPIv1}/chats/${chatId}/sessions`,
  deleteMessage: (chatId: string, sessionId: string, msgId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}/messages/${msgId}`,
  thumbup: (chatId: string, sessionId: string, msgId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}/messages/${msgId}/feedback`,
  completionUrl: `${restAPIv1}/chat/completions`,
  chatsTts: `${restAPIv1}/chat/audio/speech`,
  searchCompletion: (searchId: string) =>
    `${restAPIv1}/searches/${searchId}/completions`,
  chatsMindmap: `${restAPIv1}/chat/mindmap`,
  chatsRelatedQuestions: `${restAPIv1}/chat/recommendation`,

  // next chat
  fetchExternalChatInfo: (id: string) => `${restAPIv1}/chatbots/${id}/info`,

  // file manager
  listFile: `${restAPIv1}/files`,
  uploadFile: `${restAPIv1}/files`,
  removeFile: `${restAPIv1}/files`,
  getAllParentFolder: `${restAPIv1}/files`,
  createFolder: `${restAPIv1}/files`,
  connectFileToKnowledge: `${restAPIv1}/files/link-to-datasets`,
  getFile: `${restAPIv1}/files`,
  moveFile: `${restAPIv1}/files/move`,

  // system
  getSystemVersion: `${restAPIv1}/system/version`,
  getSystemTokenList: `${restAPIv1}/system/tokens`,
  createSystemToken: `${restAPIv1}/system/tokens`,
  removeSystemToken: `${restAPIv1}/system/tokens`,
  getSystemConfig: `${restAPIv1}/system/config`,
  setLangfuseConfig: `${restAPIv1}/langfuse/api-key`,

  // flow — spec-008: 画布相关 endpoint 已迁到 bffCanvas
  listAgentTemplate: `${bffCanvas}/templates`,
  listAgents: `${bffAgents}`,
  listAgentTags: `${bffCanvas}/tags`,
  updateAgentTags: (agentId: string) => `${bffCanvas}/${agentId}/tags`,
  createAgent: `${bffCanvas}`,
  updateAgent: (agentId: string) => `${bffCanvas}/${agentId}`,
  deleteAgent: (agentId: string) => `${bffCanvas}/${agentId}`,
  agentChatCompletion: `${bffAgents}/chat/completions`,
  resetAgent: (agentId: string) => `${bffCanvas}/${agentId}/reset`,
  testDbConnect: `${bffCanvas}/test_db_connection`,
  getInputElements: `${webAPI}/canvas/input_elements`,
  debug: (agentId: string, componentId: string) =>
    `${bffCanvas}/${agentId}/components/${componentId}/debug`,
  trace: (agentId: string, messageId: string) =>
    `${bffCanvas}/${agentId}/logs/${messageId}`,
  cancelCanvas: (taskId: string) => `${bffCanvas}/tasks/${taskId}/cancel`,
  // agent
  inputForm: (agentId: string, componentId: string) =>
    `${bffCanvas}/${agentId}/components/${componentId}/input-form`,
  fetchVersionList: (id: string) => `${bffCanvas}/${id}/versions`,
  fetchVersion: (agentId: string, versionId: string) =>
    `${bffCanvas}/${agentId}/versions/${versionId}`,
  getAgent: (id: string) => `${bffAgents}/${id}`,
  uploadAgentFile: (id?: string) => `${bffCanvas}/${id}/upload`,
  createAgentSession: (agentId: string) => `${bffAgents}/${agentId}/sessions`,
  fetchAgentLogs: (canvasId: string) => `${webAPI}/canvas/${canvasId}/sessions`,
  fetchAgentSessions: (agentId: string) => `${bffAgents}/${agentId}/sessions`,
  fetchAgentSessionById: (agentId: string, sessionId: string) =>
    `${bffAgents}/${agentId}/sessions/${sessionId}`,
  fetchExternalAgentInputs: (canvasId: string) =>
    `${bffCanvas}/${canvasId}/external-inputs`,
  prompt: `${bffCanvas}/prompts`,
  cancelDataflow: (id: string) => `${bffCanvas}/tasks/${id}/cancel`,
  getAttachmentFileDownload: (docId: string) =>
    `${bffCanvas}/attachments/${docId}/download`,
  downloadFile: `${bffCanvas}/download`,
  testWebhook: (id: string) => `${bffCanvas}/${id}/webhook/test`,
  fetchWebhookTrace: (id: string) => `${bffCanvas}/${id}/webhook/logs`,

  // explore

  // mcp server
  listMcpServer: `${restAPIv1}/mcp/servers`,
  getMcpServer: (id: string) => `${restAPIv1}/mcp/servers/${id}`,
  createMcpServer: `${restAPIv1}/mcp/servers`,
  updateMcpServer: (id: string) => `${restAPIv1}/mcp/servers/${id}`,
  deleteMcpServer: (id: string) => `${restAPIv1}/mcp/servers/${id}`,
  importMcpServer: `${restAPIv1}/mcp/servers/import`,
  exportMcpServer: (id: string) =>
    `${restAPIv1}/mcp/servers/${id}?mode=download`,
  testMcpServer: (id: string) => `${restAPIv1}/mcp/servers/${id}/test`,

  // next-search
  createSearch: `${restAPIv1}/searches`,
  getSearchList: `${restAPIv1}/searches`,
  deleteSearch: (params: { search_id: string }) =>
    `${restAPIv1}/searches/${params.search_id}`,
  getSearchDetail: (params: { search_id: string }) =>
    `${restAPIv1}/searches/${params.search_id}`,
  getSearchDetailShare: `${restAPIv1}/searchbots/detail`,
  updateSearchSetting: (params: { search_id: string }) =>
    `${restAPIv1}/searches/${params.search_id}`,
  askShare: `${restAPIv1}/searchbots/ask`,
  mindmapShare: `${restAPIv1}/searchbots/mindmap`,
  getRelatedQuestionsShare: `${restAPIv1}/searchbots/related_questions`,
  retrievalTestShare: `${restAPIv1}/searchbots/retrieval_test`,

  // memory
  createMemory: `${restAPIv1}/memories`,
  getMemoryList: `${restAPIv1}/memories`,
  getMemoryConfig: (id: string) => `${restAPIv1}/memories/${id}/config`,
  deleteMemory: (id: string) => `${restAPIv1}/memories/${id}`,
  getMemoryDetail: (id: string) => `${restAPIv1}/memories/${id}`,
  updateMemorySetting: (id: string) => `${restAPIv1}/memories/${id}`,
  deleteMemoryMessage: (data: { memory_id: string; message_id: string }) =>
    `${restAPIv1}/messages/${data.memory_id}:${data.message_id}`,
  getMessageContent: (data: { memory_id: string; message_id: string }) =>
    `${restAPIv1}/messages/${data.memory_id}:${data.message_id}/content`,
  updateMessageState: (data: { memory_id: string; message_id: string }) =>
    `${restAPIv1}/messages/${data.memory_id}:${data.message_id}`,

  // data pipeline
  fetchDataflow: (id: string) => `${webAPI}/dataflow/get/${id}`,
  setDataflow: `${webAPI}/dataflow/set`,
  removeDataflow: `${webAPI}/dataflow/rm`,
  listDataflow: `${webAPI}/dataflow/list`,
  runDataflow: `${webAPI}/dataflow/run`,

  // admin
  adminLogin: `${restAPIv1}/admin/login`,
  adminLogout: `${restAPIv1}/admin/logout`,
  adminListUsers: `${restAPIv1}/admin/users`,
  adminCreateUser: `${restAPIv1}/admin/users`,
  adminSetSuperuser: (username: string) =>
    `${restAPIv1}/admin/users/${username}/admin`,
  adminGetUserDetails: (username: string) =>
    `${restAPIv1}/admin/users/${username}`,
  adminUpdateUserStatus: (username: string) =>
    `${restAPIv1}/admin/users/${username}/activate`,
  adminUpdateUserPassword: (username: string) =>
    `${restAPIv1}/admin/users/${username}/password`,
  adminDeleteUser: (username: string) => `${restAPIv1}/admin/users/${username}`,
  adminListUserDatasets: (username: string) =>
    `${restAPIv1}/admin/users/${username}/datasets`,
  adminListUserAgents: (username: string) =>
    `${restAPIv1}/admin/users/${username}/agents`,

  adminListServices: `${restAPIv1}/admin/services`,
  adminShowServiceDetails: (serviceId: string) =>
    `${restAPIv1}/admin/services/${serviceId}`,

  adminListRoles: `${bffAdmin}/roles`,
  adminListRolesWithPermission: `${bffAdmin}/roles_with_permission`,
  adminGetRolePermissions: (roleName: string) =>
    `${bffAdmin}/roles/${roleName}/permissions`,
  adminAssignRolePermissions: (roleName: string) =>
    `${bffAdmin}/roles/${roleName}/permission`,
  adminRevokeRolePermissions: (roleName: string) =>
    `${bffAdmin}/roles/${roleName}/permission`,
  adminCreateRole: `${bffAdmin}/roles`,
  adminDeleteRole: (roleName: string) => `${bffAdmin}/roles/${roleName}`,
  adminUpdateRoleDescription: (roleName: string) =>
    `${bffAdmin}/roles/${roleName}`,

  adminUpdateUserRole: (username: string) =>
    `${bffAdmin}/users/${username}/role`,
  adminGetUserPermissions: (username: string) =>
    `${bffAdmin}/users/${username}/permissions`,

  adminListResources: `${bffAdmin}/roles/resource`,

  adminListWhitelist: `${bffAdmin}/whitelist`,
  adminCreateWhitelistEntry: `${bffAdmin}/whitelist/add`,
  adminUpdateWhitelistEntry: (id: number) =>
    `${bffAdmin}/whitelist/${id}`,
  adminDeleteWhitelistEntry: (email: string) =>
    `${bffAdmin}/whitelist/${email}`,
  adminImportWhitelist: `${bffAdmin}/whitelist/batch`,

  adminGetSystemVersion: `${restAPIv1}/admin/version`,

  // Multi-Harness P2 (US1) — Harness Backend Admin CRUD
  // Constitution Principle I + V (非租户隔离) + Token Security。
  // 运维页面专用,前端不带 X-Tenant-Id。
  listHarnessBackends: `${bffHarnessAdmin}`,
  createHarnessBackend: `${bffHarnessAdmin}`,
  updateHarnessBackend: (id: string) => `${bffHarnessAdmin}/${id}`,
  deleteHarnessBackend: (id: string) => `${bffHarnessAdmin}/${id}`,

  // Multi-Harness P2 (US2) — Capabilities 查询(条件渲染)
  // Constitution Principle I + II + V + VIII。
  // 前端按 tenant 隔离查询后端能力,无能力降级(Progressive Enhancement)。
  harnessCapabilities: `${bffCapabilities}`,

  // Multi-Harness P5 (US1/US2/US3) — Team/Project/Tenant-binding Admin CRUD
  // Constitution Principle I + V + VIII: 前端经 BFF 管理 intellect-team Team/Project,
  // BffTenant 绑定真实 team_id 后启用实例内 Team 数据隔离。
  // 真正的租户隔离通过多实例:不同 BffTenant 绑定不同 intellectBackendId(intellect-team 实例)。
  // 对齐 intellect-team 实际契约:slug/display_name/created_by,软删除,独立 /api/projects 路径。
  adminTeams: `${bffAdmin}/teams`,
  adminTeam: (ref: string) => `${bffAdmin}/teams/${ref}`,
  adminProjects: `${bffAdmin}/projects`,
  adminProject: (ref: string) => `${bffAdmin}/projects/${ref}`,
  adminTenantBinding: (tenantId: string) =>
    `${bffAdmin}/tenants/${tenantId}/binding`,

  // Sandbox settings
  adminListSandboxProviders: `${restAPIv1}/admin/sandbox/providers`,
  adminGetSandboxProviderSchema: (providerId: string) =>
    `${restAPIv1}/admin/sandbox/providers/${providerId}/schema`,
  adminGetSandboxConfig: `${restAPIv1}/admin/sandbox/config`,
  adminSetSandboxConfig: `${restAPIv1}/admin/sandbox/config`,
  adminTestSandboxConnection: `${restAPIv1}/admin/sandbox/test`,

  // Skill spaces
  skillSpaces: `${restAPIv1}/skills/spaces`,
  skillSpace: (spaceId: string) => `${restAPIv1}/skills/spaces/${spaceId}`,
  skillSpaceByFolder: `${restAPIv1}/skills/space/by-folder`,
  skillConfig: `${restAPIv1}/skills/config`,
  skillSearch: `${restAPIv1}/skills/search`,
  skillIndex: `${restAPIv1}/skills/index`,
  skillReindex: `${restAPIv1}/skills/reindex`,
};
