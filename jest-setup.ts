import '@testing-library/jest-dom';

import React from 'react';

// esbuild-jest transforms JSX in classic mode (it only forwards `jsxFactory`
// / `jsxFragment` to esbuild, not `jsx: 'automatic'`). Several modules under
// test — e.g. `src/constants/agent.tsx` — emit JSX without an explicit
// `import React from 'react'`, so they rely on React being in scope. In Vite
// the automatic runtime supplies it; in Jest we expose it globally so classic
// JSX evaluation can find `React` without touching every source file.
(globalThis as unknown as { React: typeof React }).React = React;
