import { describe, it, expect, afterEach } from 'vitest';
import { getRagBaseUrl } from './rag-base-url';

describe('getRagBaseUrl', () => {
  afterEach(() => {
    delete process.env.INTELLECT_RAG_URL;
  });

  it('未设置时默认 http://localhost:9380', () => {
    delete process.env.INTELLECT_RAG_URL;
    expect(getRagBaseUrl()).toBe('http://localhost:9380');
  });

  it('读取 INTELLECT_RAG_URL 并去掉尾部斜杠', () => {
    process.env.INTELLECT_RAG_URL = 'http://rag.example:9380/';
    expect(getRagBaseUrl()).toBe('http://rag.example:9380');
  });
});
