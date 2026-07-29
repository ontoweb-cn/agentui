/**
 * ProviderErrorDetails — Provider 错误详情折叠区块（P3）
 *
 * 参考 webui `<details class="provider-error-details">` (ui.js L6347-6350)。
 *
 * 设计要点：
 * - 使用原生 <details>/<summary> 标签，无需 JS 控制展开/折叠
 * - 样式与 ToolCallCard 一致（rounded-md border bg-muted/30）
 * - 支持 string / object / Error-like 三种 details 类型
 * - 截断超长内容（8000 字符），避免渲染性能问题
 *
 * 数据源（PS8 评审决策）：
 * - 当前 BFF serializeChunk error 分支未透传 details 字段
 * - 本组件读取 message.errorDetails 字段，BFF 后续扩展后自动启用
 * - 在 BFF 透传前，本组件不会渲染（errorDetails 为 undefined 时返回 null）
 *
 * P3 评审修复：
 * - S1: 类型收窄为 ProviderErrorDetailsType，拒绝 function/symbol 等不可序列化类型
 * - Q5: formatDetails 处理循环引用，用 replacer 函数检测循环
 * - Q14: 保留 <pre> 标签（语义正确，代码块需要保留空白），添加注释说明
 */
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const MAX_DETAILS_LENGTH = 8000;

/**
 * S1: 类型收窄，明确 details 的合法类型。
 * 拒绝 function/symbol 等不可序列化类型，避免被误用为 XSS 载体。
 *
 * L1 修复:移除联合类型中的 `unknown`，避免整个类型退化为 unknown 失去类型保护。
 * 上游 BFF safeJsonSerialize 保证产出纯 JSON 兼容类型(string/number/boolean/array/object/null)，
 * 此处覆盖常见形态：字符串、{message} 对象、Error 实例、其他可序列化对象。
 */
export type ProviderErrorDetailsType =
  | string
  | { message: string; [key: string]: unknown }
  | Error
  | Record<string, unknown>;

interface ProviderErrorDetailsProps {
  /**
   * Provider 错误详情。来自 IMessage.errorDetails(unknown 类型,运行时数据源不可控)。
   * 组件内部 formatDetails 做类型守卫,拒绝 function/symbol 等不可序列化类型。
   */
  details: unknown;
}

/**
 * Q5: 安全序列化，处理循环引用。
 * 用 replacer 函数检测已访问的对象，循环引用处替换为 '[Circular]'。
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      obj,
      (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        // S1: 拒绝 function/symbol，返回类型字符串
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'symbol') return '[Symbol]';
        return value;
      },
      2,
    );
  } catch {
    // 兜底：返回对象类型信息，至少有诊断价值
    return Object.prototype.toString.call(obj);
  }
}

function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return '';
  if (typeof details === 'string') return details;
  if (details instanceof Error) {
    return `${details.name}: ${details.message}\n${details.stack ?? ''}`;
  }
  // S1: 拒绝 function/symbol 等不可序列化类型的直接渲染
  if (typeof details === 'function') return `[Function: ${details.name || 'anonymous'}]`;
  if (typeof details === 'symbol') return `[Symbol: ${details.toString()}]`;
  // Q5: 用 safeStringify 处理循环引用
  return safeStringify(details);
}

function ProviderErrorDetailsImpl({ details }: ProviderErrorDetailsProps) {
  const { t } = useTranslation();

  const formatted = useMemo(() => {
    const text = formatDetails(details);
    if (text.length > MAX_DETAILS_LENGTH) {
      return `${text.slice(0, MAX_DETAILS_LENGTH)}\n\n... (truncated, total ${text.length} chars)`;
    }
    return text;
  }, [details]);

  if (!formatted) return null;

  return (
    <details className="rounded-md border border-destructive/30 bg-destructive/5 p-2 my-1 text-xs">
      <summary className="text-destructive cursor-pointer select-none">
        {t('error.providerDetails')}
      </summary>
      {/* Q14: 保留 <pre> 标签，语义正确（代码块需保留空白与换行），与 ContextRing 的 <div> 用途不同 */}
      <pre className="mt-2 p-2 bg-muted rounded overflow-auto whitespace-pre-wrap break-all max-h-60 font-mono">
        {formatted}
      </pre>
    </details>
  );
}

export const ProviderErrorDetails = memo(ProviderErrorDetailsImpl);
