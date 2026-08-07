// spec-010 v8 A3-7: harness-admin-validation 单元测试
// Constitution Principle VII (Test-First): 覆盖字段校验 + 交叉校验(validateCapabilities)。
// 纯函数测试,无需 mock。

import { describe, it, expect } from 'vitest';
import {
  validateField,
  validateForm,
  validateCapabilities,
  firstError,
} from './harness-admin-validation';
import type { HarnessCapabilities, BackendType } from '../types/harness';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ragCapabilities: HarnessCapabilities = {
  canvas: true,
  knowledgeBase: true,
  memory: true,
  mcp: false,
  multiTenant: false,
  modelManagement: false,
};

const enterpriseCapabilities: HarnessCapabilities = {
  canvas: false,
  knowledgeBase: false,
  memory: true,
  mcp: true,
  multiTenant: true,
  modelManagement: true,
};

const communityCapabilities: HarnessCapabilities = {
  canvas: false,
  knowledgeBase: false,
  memory: false,
  mcp: false,
  multiTenant: false,
  modelManagement: false,
};

const validRagForm = {
  id: 'intellect-rag-default',
  name: 'Intellect RAG Default',
  type: 'intellect-rag' as BackendType,
  endpoint: 'http://localhost:9380',
  adminTokenEnvVar: 'HARNESS_INTELLECT_RAG_ADMIN_TOKEN',
  capabilities: ragCapabilities,
};

// ---------------------------------------------------------------------------
// validateField
// ---------------------------------------------------------------------------

describe('validateField', () => {
  it('id 合法 kebab-case 通过', () => {
    expect(validateField('id', 'intellect-rag-default')).toBeNull();
  });

  it('id 非法(含大写)失败', () => {
    expect(validateField('id', 'IntellectRAG')).toBe(
      'id 必须是 kebab-case(如 intellect-rag-default)',
    );
  });

  it('type 合法(intellect-rag)通过', () => {
    expect(validateField('type', 'intellect-rag')).toBeNull();
  });

  it('type 合法(intellect-community)通过', () => {
    expect(validateField('type', 'intellect-community')).toBeNull();
  });

  it('type 非法(intellect-llm 不进表单)失败', () => {
    expect(validateField('type', 'intellect-llm')).toBe(
      'type 必须是 intellect-rag/intellect-enterprise/intellect-community/hermes/kag/agent-scope 之一',
    );
  });

  it('credentialKind 合法(bearer-token)通过', () => {
    expect(validateField('credentialKind', 'bearer-token')).toBeNull();
  });

  it('credentialKind 合法(email-password)通过', () => {
    expect(validateField('credentialKind', 'email-password')).toBeNull();
  });

  it('credentialKind 非法失败', () => {
    expect(validateField('credentialKind', 'api-key')).toBe(
      'credentialKind 必须是 bearer-token 或 email-password',
    );
  });
});

// ---------------------------------------------------------------------------
// validateCapabilities (spec-010 v8 A3-7 交叉校验)
// ---------------------------------------------------------------------------

describe('validateCapabilities', () => {
  it('intellect-rag + canvas=true 通过(Principle III)', () => {
    expect(validateCapabilities('intellect-rag', ragCapabilities)).toEqual([]);
  });

  it('intellect-enterprise + canvas=true 失败(Principle III)', () => {
    const bad = { ...enterpriseCapabilities, canvas: true };
    const errors = validateCapabilities('intellect-enterprise', bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('canvas=true 仅 intellect-rag 允许');
  });

  it('intellect-community + canvas=true 失败(Principle III)', () => {
    const bad = { ...communityCapabilities, canvas: true };
    const errors = validateCapabilities('intellect-community', bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('canvas=true 仅 intellect-rag 允许');
  });

  it('intellect-enterprise + multiTenant=true 通过(Principle V)', () => {
    expect(validateCapabilities('intellect-enterprise', enterpriseCapabilities)).toEqual([]);
  });

  it('intellect-rag + multiTenant=true 失败(Principle V)', () => {
    const bad = { ...ragCapabilities, multiTenant: true };
    const errors = validateCapabilities('intellect-rag', bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('multiTenant=true 仅 intellect-enterprise 允许');
  });

  it('同时违反 Principle III + V 返回 2 个错误', () => {
    const bad: HarnessCapabilities = {
      canvas: true,
      knowledgeBase: false,
      memory: false,
      mcp: false,
      multiTenant: true,
      modelManagement: false,
    };
    const errors = validateCapabilities('hermes', bad);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('canvas=true 仅 intellect-rag 允许');
    expect(errors[1]).toContain('multiTenant=true 仅 intellect-enterprise 允许');
  });

  it('intellect-community + 全 false 通过', () => {
    expect(validateCapabilities('intellect-community', communityCapabilities)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateForm (含交叉校验)
// ---------------------------------------------------------------------------

describe('validateForm', () => {
  it('合法 intellect-rag 表单通过', () => {
    const result = validateForm(validRagForm);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('合法 intellect-enterprise 表单通过', () => {
    const result = validateForm({
      ...validRagForm,
      id: 'intellect-enterprise-default',
      type: 'intellect-enterprise' as BackendType,
      endpoint: 'http://localhost:8642',
      adminTokenEnvVar: 'HARNESS_INTELLECT_ENTERPRISE_API_SERVER_KEY',
      capabilities: enterpriseCapabilities,
    });
    expect(result.valid).toBe(true);
  });

  it('交叉校验:intellect-enterprise + canvas=true 失败', () => {
    const bad = {
      ...validRagForm,
      id: 'enterprise-bad',
      type: 'intellect-enterprise' as BackendType,
      endpoint: 'http://localhost:8642',
      adminTokenEnvVar: 'HARNESS_KEY',
      capabilities: { ...enterpriseCapabilities, canvas: true },
    };
    const result = validateForm(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.capabilities).toContain('canvas=true 仅 intellect-rag 允许');
  });

  it('交叉校验:hermes + multiTenant=true 失败', () => {
    const bad = {
      ...validRagForm,
      id: 'hermes-bad',
      type: 'hermes' as BackendType,
      endpoint: 'http://localhost:9000',
      adminTokenEnvVar: 'HARNESS_HERMES_KEY',
      capabilities: { ...communityCapabilities, multiTenant: true },
    };
    const result = validateForm(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.capabilities).toContain('multiTenant=true 仅 intellect-enterprise 允许');
  });

  it('字段级错误优先于交叉校验(type 非法时不执行交叉校验)', () => {
    const result = validateForm({
      ...validRagForm,
      type: 'intellect-llm' as BackendType,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.type).toBeDefined();
    // capabilities 不应有交叉校验错误(type 校验失败时不执行)
    expect(result.errors.capabilities).toBeUndefined();
  });

  it('字段级错误优先于交叉校验(capabilities 非法时不执行交叉校验)', () => {
    const result = validateForm({
      ...validRagForm,
      capabilities: { canvas: 'not-boolean' } as unknown as HarnessCapabilities,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.capabilities).toBeDefined();
    // 错误消息来自字段校验,不是交叉校验
    expect(result.errors.capabilities).toContain('必须是 boolean');
  });

  it('credentialKind 可选字段缺失时通过', () => {
    const result = validateForm(validRagForm);
    expect(result.valid).toBe(true);
    expect(result.errors.credentialKind).toBeUndefined();
  });

  it('credentialKind 非法时失败', () => {
    const result = validateForm({
      ...validRagForm,
      credentialKind: 'api-key',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.credentialKind).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // adminTokenEnvVar 不再必填(任务:移除必填字段,BFF 自动生成 HARNESS_<ID>_TOKEN)
  // -------------------------------------------------------------------------

  it('adminTokenEnvVar 缺失或格式非法时 validateForm 均通过(BFF 自动生成,不再校验)', () => {
    // 1. 缺失:显式移除 adminTokenEnvVar,validateForm 应通过
    const { adminTokenEnvVar: _omit, ...formWithoutVar } = validRagForm;
    void _omit;
    const resultMissing = validateForm(formWithoutVar);
    expect(resultMissing.valid).toBe(true);
    expect(resultMissing.errors.adminTokenEnvVar).toBeUndefined();

    // 2. 格式非法:前端传入 lowercase-invalid,validateForm 不再校验该字段
    //    (路由层会忽略并自动生成 HARNESS_<ID>_TOKEN)
    const resultInvalid = validateForm({
      ...validRagForm,
      adminTokenEnvVar: 'lowercase-invalid',
    });
    expect(resultInvalid.valid).toBe(true);
    expect(resultInvalid.errors.adminTokenEnvVar).toBeUndefined();
  });

  it('非对象表单返回失败', () => {
    const result = validateForm(null);
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBe('表单必须是对象');
  });
});

// ---------------------------------------------------------------------------
// firstError
// ---------------------------------------------------------------------------

describe('firstError', () => {
  it('valid=true 返回默认消息', () => {
    expect(firstError({ valid: true, errors: {} })).toBe('Invalid form');
  });

  it('valid=false 返回第一个错误', () => {
    const result = {
      valid: false,
      errors: { id: 'id 错误', name: 'name 错误' },
    };
    expect(firstError(result)).toBe('id 错误');
  });
});
