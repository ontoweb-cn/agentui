/** Intellect RAG 上游 origin。未设置时默认本地 9380。尾部斜杠会被去掉。 */
const DEFAULT_RAG_URL = 'http://localhost:9380';

export function getRagBaseUrl(): string {
  const raw = process.env.INTELLECT_RAG_URL?.trim() || DEFAULT_RAG_URL;
  return raw.replace(/\/+$/, '');
}
