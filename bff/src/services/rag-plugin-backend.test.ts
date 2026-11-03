// 伴生 RAG 配置构建(P1-b §6 回归测试)
// 向导/harness-admin 创建伴生 RAG 时,modelManagement 必须默认开启——
// capabilities 合并以 RAG 声明为准,置 false 会门控整个模型提供商页。
// docs/model-provider-empty-models-fix-design.md §6

import { describe, it, expect } from 'vitest';
import {
  RAG_PLUGIN_CAPABILITIES,
  buildCompanionRagConfig,
  companionRagBackendId,
} from './rag-plugin-backend';

describe('buildCompanionRagConfig', () => {
  const config = buildCompanionRagConfig({
    enterpriseId: 'ent-1',
    enterpriseName: 'Ent One',
    ragEndpoint: 'http://localhost:9380/',
  });

  it('id 由 enterprise id 派生,endpoint 去尾斜杠', () => {
    expect(config.id).toBe(companionRagBackendId('ent-1'));
    expect(config.id).toBe('ent-1-rag');
    expect(config.endpoint).toBe('http://localhost:9380');
    expect(config.type).toBe('intellect-rag');
  });

  it('modelManagement 默认开启(回归:P1-b §6 前向导默认 false 门控模型页)', () => {
    expect(config.capabilities.modelManagement).toBe(true);
    expect(RAG_PLUGIN_CAPABILITIES.modelManagement).toBe(true);
  });

  it('其余 RAG 能力与 RAG_PLUGIN_CAPABILITIES 一致', () => {
    expect(config.capabilities).toEqual(RAG_PLUGIN_CAPABILITIES);
  });
});
