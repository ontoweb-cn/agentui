import { describe, it, expect, afterEach } from 'vitest';
import { isImtCanvasAgentsEnabled } from './feature-flags';

describe('isImtCanvasAgentsEnabled', () => {
  afterEach(() => {
    process.env.BFF_ENABLE_IMT_CANVAS_AGENTS = 'false';
  });

  it('未设置时默认开启', () => {
    delete process.env.BFF_ENABLE_IMT_CANVAS_AGENTS;
    expect(isImtCanvasAgentsEnabled()).toBe(true);
  });

  it('true 时开启', () => {
    process.env.BFF_ENABLE_IMT_CANVAS_AGENTS = 'true';
    expect(isImtCanvasAgentsEnabled()).toBe(true);
  });

  it('false 时关闭', () => {
    process.env.BFF_ENABLE_IMT_CANVAS_AGENTS = 'false';
    expect(isImtCanvasAgentsEnabled()).toBe(false);
  });
});
