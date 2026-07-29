// Multi-Harness P2 (US1):Harness Admin 表单校验工具。
// Constitution Principle VII (Test-First):此文件由 T007 测试覆盖。
// 双层校验:BFF(此文件)+ 前端(Ant Design Form rules,与 BFF 一致)。

import { VALIDATION_RULES } from '../types/harness-admin';
import type { HarnessBackendForm } from '../types/harness-admin';
import type { BackendType, HarnessCapabilities } from '../types/harness';

/**
 * 校验结果。
 * valid=true 时 errors 为空对象;valid=false 时 errors 含字段错误信息。
 */
export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof HarnessBackendForm, string>>;
}

/**
 * 校验单个字段值。
 * @param field 字段名
 * @param value 字段值
 * @returns 错误消息(null 表示通过)
 */
export function validateField(
  field: keyof HarnessBackendForm,
  value: unknown,
): string | null {
  switch (field) {
    case 'id': {
      if (typeof value !== 'string' || !VALIDATION_RULES.id.pattern.test(value)) {
        return VALIDATION_RULES.id.message;
      }
      return null;
    }
    case 'name': {
      if (typeof value !== 'string' || !VALIDATION_RULES.name.pattern.test(value)) {
        return VALIDATION_RULES.name.message;
      }
      return null;
    }
    case 'type': {
      // Admin 表单仅支持 rag/enterprise(intellect-llm 经 JSON 配置,不走表单)
      if (
        typeof value !== 'string' ||
        !(VALIDATION_RULES.type.values as readonly BackendType[]).includes(value as BackendType)
      ) {
        return VALIDATION_RULES.type.message;
      }
      return null;
    }
    case 'endpoint': {
      if (
        typeof value !== 'string' ||
        !VALIDATION_RULES.endpoint.pattern.test(value)
      ) {
        return VALIDATION_RULES.endpoint.message;
      }
      return null;
    }
    case 'adminTokenEnvVar': {
      if (
        typeof value !== 'string' ||
        !VALIDATION_RULES.adminTokenEnvVar.pattern.test(value)
      ) {
        return VALIDATION_RULES.adminTokenEnvVar.message;
      }
      return null;
    }
    case 'credentialKind': {
      // spec-010 v8 A3-7: credentialKind 校验(可选字段,只在传了的时候校验)
      if (
        typeof value !== 'string' ||
        !(VALIDATION_RULES.credentialKind.values as readonly string[]).includes(value)
      ) {
        return VALIDATION_RULES.credentialKind.message;
      }
      return null;
    }
    case 'capabilities': {
      if (typeof value !== 'object' || value === null) {
        return 'capabilities 必须是对象';
      }
      const caps = value as Record<string, unknown>;
      const requiredKeys = [
        'canvas',
        'knowledgeBase',
        'memory',
        'mcp',
        'multiTenant',
        'modelManagement',
      ];
      for (const key of requiredKeys) {
        if (typeof caps[key] !== 'boolean') {
          return `capabilities.${key} 必须是 boolean`;
        }
      }
      return null;
    }
    case 'defaultForTenant': {
      if (value === undefined || value === null) return null; // 可选
      if (typeof value !== 'boolean') {
        return 'defaultForTenant 必须是 boolean';
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * 校验整个表单。
 * @param form 表单数据
 * @returns ValidationResult(valid + errors)
 */
export function validateForm(form: unknown): ValidationResult {
  const errors: ValidationResult['errors'] = {};

  if (typeof form !== 'object' || form === null) {
    return {
      valid: false,
      errors: { name: '表单必须是对象' },
    };
  }

  const f = form as Record<string, unknown>;
  const fields: (keyof HarnessBackendForm)[] = [
    'id',
    'name',
    'type',
    'endpoint',
    'adminTokenEnvVar',
    'capabilities',
  ];

  for (const field of fields) {
    const err = validateField(field, f[field]);
    if (err) {
      errors[field] = err;
    }
  }

  // defaultForTenant 可选,只在传了的时候校验
  if (f.defaultForTenant !== undefined) {
    const err = validateField('defaultForTenant', f.defaultForTenant);
    if (err) errors.defaultForTenant = err;
  }

  // spec-010 v8 A3-7: credentialKind 可选,只在传了的时候校验
  if (f.credentialKind !== undefined) {
    const err = validateField('credentialKind', f.credentialKind);
    if (err) errors.credentialKind = err;
  }

  // spec-010 v8 A3-7: Constitution 约束交叉校验(M5 修正)
  // 仅在 type 与 capabilities 均通过基础校验后执行,避免与字段级错误重复
  if (
    !errors.type &&
    !errors.capabilities &&
    f.type &&
    f.capabilities &&
    typeof f.capabilities === 'object'
  ) {
    const capsErrors = validateCapabilities(
      f.type as BackendType,
      f.capabilities as HarnessCapabilities,
    );
    if (capsErrors.length > 0) {
      errors.capabilities = capsErrors[0];
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Constitution 约束交叉校验(spec-010 v8 A3-7 / M5 修正)。
 *
 * 校验 capabilities 字段是否与 type 字段匹配,违反 Constitution 约束时返回错误消息数组:
 * - Principle III: canvas=true 仅 intellect-rag 允许
 * - Principle V:   multiTenant=true 仅 intellect-enterprise 允许
 *
 * @param type 后端类型
 * @param caps 能力声明
 * @returns 错误消息数组(空数组表示通过)
 */
export function validateCapabilities(
  type: BackendType,
  caps: HarnessCapabilities,
): string[] {
  const errors: string[] = [];
  if (type !== 'intellect-rag' && caps.canvas) {
    errors.push('canvas=true 仅 intellect-rag 允许(Principle III)');
  }
  if (type !== 'intellect-enterprise' && caps.multiTenant) {
    errors.push('multiTenant=true 仅 intellect-enterprise 允许');
  }
  return errors;
}

/**
 * 提取第一个错误消息(用于 HTTP 400 响应)。
 */
export function firstError(result: ValidationResult): string {
  const first = Object.values(result.errors)[0];
  return first ?? 'Invalid form';
}
