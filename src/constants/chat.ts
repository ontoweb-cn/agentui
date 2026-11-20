export enum MessageType {
  Assistant = 'assistant',
  User = 'user',
}

export enum ChatVariableEnabledField {
  TemperatureEnabled = 'temperatureEnabled',
  TopPEnabled = 'topPEnabled',
  PresencePenaltyEnabled = 'presencePenaltyEnabled',
  FrequencyPenaltyEnabled = 'frequencyPenaltyEnabled',
  MaxTokensEnabled = 'maxTokensEnabled',
}

export const variableEnabledFieldMap = {
  [ChatVariableEnabledField.TemperatureEnabled]: 'temperature',
  [ChatVariableEnabledField.TopPEnabled]: 'top_p',
  [ChatVariableEnabledField.PresencePenaltyEnabled]: 'presence_penalty',
  [ChatVariableEnabledField.FrequencyPenaltyEnabled]: 'frequency_penalty',
  [ChatVariableEnabledField.MaxTokensEnabled]: 'max_tokens',
};

export enum SharedFrom {
  Agent = 'agent',
  Chat = 'chat',
  Search = 'search',
}

export enum ChatSearchParams {
  DialogId = 'dialogId',
  ConversationId = 'conversationId',
  isNew = 'isNew',
}

export const EmptyConversationId = 'empty';

export enum DatasetMetadata {
  Disabled = 'disabled',
  Automatic = 'auto',
  SemiAutomatic = 'semi_auto',
  Manual = 'manual',
}

export enum WebSearchProvider {
  AnySearch = 'anysearch',
  Brave = 'brave',
  Exa = 'exa',
  Firecrawl = 'firecrawl',
  Keirolabs = 'keirolabs',
  Linkup = 'linkup',
  Parallel = 'parallel',
  Perplexity = 'perplexity',
  Querit = 'querit',
  Search1API = 'search1api',
  SearchApi = 'searchapi',
  Serply = 'serply',
  Tavily = 'tavily',
  YouCom = 'youcom',
}

/**
 * Providers usable with no credentials at all — the key field is optional for
 * these, and the Internet switch stays available when it is left blank.
 *
 * AnySearch accepts anonymous requests on the same search endpoint. A saved
 * key is sent as Authorization: Bearer and is not retried anonymously.
 *
 * You.com serves a dedicated keyless ENDPOINT: a different path from the keyed
 * one, the same response shape, rate-limited per source IP. Adding a key
 * switches to the keyed endpoint and lifts that limit.
 *
 * "Free tier" is not the same as "keyless". Exa's free tier (1,000
 * requests/month, no credit card) still requires a key on every request, so it
 * is deliberately absent from this list.
 */
export const KEYLESS_WEB_SEARCH_PROVIDERS: readonly WebSearchProvider[] = [
  WebSearchProvider.AnySearch,
  WebSearchProvider.YouCom,
];
