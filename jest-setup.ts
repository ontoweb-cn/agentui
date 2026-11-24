import '@testing-library/jest-dom';

import React from 'react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { merge } from 'lodash';
import translation_en from './src/locales/en';
import translation_en_private from './src/ee/locales/en-private';

// esbuild-jest transforms JSX in classic mode (it only forwards `jsxFactory`
// / `jsxFragment` to esbuild, not `jsx: 'automatic'`). Several modules under
// test — e.g. `src/constants/agent.tsx` — emit JSX without an explicit
// `import React from 'react'`, so they rely on React being in scope. In Vite
// the automatic runtime supplies it; in Jest we expose it globally so classic
// JSX evaluation can find `React` without touching every source file.
(globalThis as unknown as { React: typeof React }).React = React;

// Initialize i18n with English resources so useTranslation() returns actual
// translations instead of raw keys in tests. The ee private keys live in
// src/ee/locales/en-private (T3.4) and are layered on top of the shared bundle
// by src/locales/config.ts at app startup; tests bypass that module, so the
// same merge has to happen here or private keys render as raw keys.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: merge(
          {},
          translation_en.translation,
          translation_en_private.translation,
        ),
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });
}
