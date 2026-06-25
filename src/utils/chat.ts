import {
  ChatVariableEnabledField,
  EmptyConversationId,
} from '@/constants/chat';
import { IMessage, Message } from '@/interfaces/database/chat';
import { omit } from 'lodash';
import { v4 as uuid } from 'uuid';
import {
  citationMarkerReg,
  normalizeCitationDigits,
  parseCitationIndex,
} from './citation-utils';

export const isConversationIdExist = (conversationId: string) => {
  return conversationId !== EmptyConversationId && conversationId !== '';
};

export const buildMessageUuid = (message: Partial<Message | IMessage>) => {
  if ('id' in message && message.id) {
    return message.id;
  }
  return uuid();
};

export const buildMessageListWithUuid = (messages?: Message[]) => {
  return (
    messages?.map((x: Message | IMessage) => ({
      ...omit(x, 'reference'),
      id: buildMessageUuid(x),
    })) ?? []
  );
};

export const generateConversationId = () => {
  return uuid().replace(/-/g, '');
};

// When rendering each message, add a prefix to the id to ensure uniqueness.
export const buildMessageUuidWithRole = (
  message: Partial<Message | IMessage>,
) => {
  return `${message.role}_${message.id}`;
};

// Preprocess LaTeX equations to be rendered by KaTeX
// ref: https://github.com/remarkjs/react-markdown/issues/785
//
// Delimiter matching: a previous revision used a negative lookbehind
// `(?<![a-zA-Z])` before `\]`/`\)` to avoid cutting at `\right]` / `\big)`.
// That lookbehind was wrong: it rejected any equation ending in a single
// letter variable (e.g. `\(x < y\)` — the `y` immediately precedes `\)` and
// was treated as a "command name"), so valid inline math was left un-converted.
// The cases the lookbehind was guarding (`\right]`, `\big)`) do not contain
// the `\]` / `\)` delimiter sequence at all (the bracket is bare), so a plain
// non-greedy match against `\]` / `\)` already never stops at them. The
// lookbehind has been removed.

const BLOCK_MATH_RE = /\\\[([\s\S]*?)\\\]/g;
const INLINE_MATH_RE = /\\\(([\s\S]*?)\\\)/g;

export const preprocessLaTeX = (content: string) => {
  // JSON-encoded payloads arrive with backslashes doubled (e.g. `\\(` for an
  // inline delimiter, `\\Delta` for a LaTeX command). Collapse any literal
  // `\\` to a single `\` so both delimiter pairs and command names normalize
  // consistently. A bare single backslash is untouched, and `\\\\` in source
  // collapses to `\\` (the same result the previous delimiter-only normalization
  // produced for `\\[` / `\\(` / `\\]` / `\\)`).
  const normalizedContent = content
    .replace(/\\\\/g, '\\')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  const blockProcessedContent = normalizedContent.replace(
    BLOCK_MATH_RE,
    (_, equation) => `$$${equation}$$`,
  );

  const inlineProcessedContent = blockProcessedContent.replace(
    INLINE_MATH_RE,
    (_, equation) => `$${equation}$`,
  );

  return inlineProcessedContent;
};

export function replaceThinkToSection(text: string = '') {
  const pattern = /<think>([\s\S]*?)<\/think>/g;

  const result = text.replace(pattern, '<details class="think"><summary>Thinking...</summary>$1</details>');

  return result;
}

export function replaceRetrievingToSection(text: string = '') {
  const pattern = /<retrieving>([\s\S]*?)<\/retrieving>/g;

  const result = text.replace(pattern, '<details class="retrieving"><summary>Retrieving...</summary>$1</details>');

  return result;
}

export function setInitialChatVariableEnabledFieldValue(
  field: ChatVariableEnabledField,
) {
  return field !== ChatVariableEnabledField.MaxTokensEnabled;
}

const ShowImageFields = ['image', 'table'];

export function showImage(filed?: string) {
  return ShowImageFields.some((x) => x === filed);
}

export function setChatVariableEnabledFieldValuePage() {
  const variableCheckBoxFieldMap = Object.values(
    ChatVariableEnabledField,
  ).reduce<Record<string, boolean>>((pre, cur) => {
    pre[cur] = cur !== ChatVariableEnabledField.MaxTokensEnabled;
    return pre;
  }, {});

  return variableCheckBoxFieldMap;
}

const oldReg = /(#{2}[0-9\u0660-\u0669\u06F0-\u06F9]+\${2})/g;
export const currentReg = citationMarkerReg;
export { normalizeCitationDigits, parseCitationIndex };

// To be compatible with the old index matching mode
export const replaceTextByOldReg = (text: string) => {
  return text?.replace(oldReg, (substring: string) => {
    return `[ID:${substring.slice(2, -2)}]`;
  });
};
