/**
 * Tier B 共享面注入(docs/canvas-stage4-independent-build-spec.md §三/§四):
 * 把宿主编译期单例经 window.__AGENTUI_SHARED__ 暴露给一方插件(canvas 档),
 * 插件产物经 externals 映射为对本全局的引用,实现共享 React 单例与
 * Provider 树内挂载——与 Tier A(窄面自包含,wargame 档)并存,互不影响。
 *
 * 契约纪律(与窄面 HOST_API_VERSION 同级):
 * - 版本由 @agentui/plugin-sdk/host 的 SHARED_API_VERSION 锁定,快照测试
 *   (host-externals.test.ts)锁定本全局的模块清单与导出名;
 * - **只加不改删**:新增模块/导出 = minor;改签名/删导出/删模块 = 破坏性,
 *   必须 bump major 并同步 SDK 包版本;
 * - 载荷仅模块单例,不含 QueryClient 实例/Router context——那经挂载点
 *   Provider 树传递(S2 实现),不走全局。
 */

import * as react from 'react';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';
import * as reactQuery from '@tanstack/react-query';
import * as jsxRuntime from 'react/jsx-runtime';
import * as router from 'react-router';
import * as reactI18next from 'react-i18next';
import i18n, * as i18nModule from '@/locales/config';
import * as themeProvider from '@/components/theme-provider';
import { cn } from '@/lib/utils';

import * as uiAccordion from '@/components/ui/accordion';
import * as uiBreadcrumb from '@/components/ui/breadcrumb';
import * as uiButton from '@/components/ui/button';
import * as uiCard from '@/components/ui/card';
import * as uiCheckbox from '@/components/ui/checkbox';
import * as uiCollapsible from '@/components/ui/collapsible';
import * as uiCommand from '@/components/ui/command';
import * as uiDatePicker from '@/components/ui/date-picker';
import * as uiDialog from '@/components/ui/dialog';
import * as uiDropdownMenu from '@/components/ui/dropdown-menu';
import * as uiForm from '@/components/ui/form';
import * as uiHoverCard from '@/components/ui/hover-card';
import * as uiInput from '@/components/ui/input';
import * as uiIntellectPagination from '@/components/ui/intellect-pagination';
import * as uiLabel from '@/components/ui/label';
import * as uiMessage from '@/components/ui/message';
import * as uiModal from '@/components/ui/modal/modal';
import * as uiMultiSelect from '@/components/ui/multi-select';
import * as uiPopover from '@/components/ui/popover';
import * as uiProgress from '@/components/ui/progress';
import * as uiRadio from '@/components/ui/radio';
import * as uiRadioGroup from '@/components/ui/radio-group';
import * as uiScrollArea from '@/components/ui/scroll-area';
import * as uiSelect from '@/components/ui/select';
import * as uiSeparator from '@/components/ui/separator';
import * as uiSheet from '@/components/ui/sheet';
import * as uiSkeleton from '@/components/ui/skeleton';
import * as uiSpin from '@/components/ui/spin';
import * as uiSwitch from '@/components/ui/switch';
import * as uiTable from '@/components/ui/table';
import * as uiTabs from '@/components/ui/tabs';
import * as uiTextarea from '@/components/ui/textarea';
import * as uiTooltip from '@/components/ui/tooltip';

import { SHARED_API_VERSION } from '@agentui/plugin-sdk/host';
import type { AgentUISharedHost } from '@agentui/plugin-sdk/host';

export const AGENTUI_SHARED_GLOBAL_KEY = '__AGENTUI_SHARED__';

export function buildAgentUISharedHost(): AgentUISharedHost {
  return {
    SHARED_API_VERSION,
    react,
    reactDom,
    reactDomClient,
    reactQuery,
    jsxRuntime,
    router,
    reactI18next,
    i18n,
    i18nModule,
    themeProvider,
    ui: {
      accordion: uiAccordion,
      breadcrumb: uiBreadcrumb,
      button: uiButton,
      card: uiCard,
      checkbox: uiCheckbox,
      collapsible: uiCollapsible,
      command: uiCommand,
      'date-picker': uiDatePicker,
      dialog: uiDialog,
      'dropdown-menu': uiDropdownMenu,
      form: uiForm,
      'hover-card': uiHoverCard,
      input: uiInput,
      'intellect-pagination': uiIntellectPagination,
      label: uiLabel,
      message: uiMessage,
      modal: uiModal,
      'multi-select': uiMultiSelect,
      popover: uiPopover,
      progress: uiProgress,
      radio: uiRadio,
      'radio-group': uiRadioGroup,
      'scroll-area': uiScrollArea,
      select: uiSelect,
      separator: uiSeparator,
      sheet: uiSheet,
      skeleton: uiSkeleton,
      spin: uiSpin,
      switch: uiSwitch,
      table: uiTable,
      tabs: uiTabs,
      textarea: uiTextarea,
      tooltip: uiTooltip,
    },
    lib: { cn },
  };
}

/** 幂等安装;顶层 Object.freeze 防误改(深层不冻——冻结组件命名空间会破坏
 * 可能在 HMR 中被替换的模块对象)。返回安装后的全局。 */
export function installAgentUISharedHost(): AgentUISharedHost {
  const existing = (globalThis as Record<string, unknown>)[
    AGENTUI_SHARED_GLOBAL_KEY
  ] as AgentUISharedHost | undefined;
  if (existing) {
    return existing;
  }
  const shared = Object.freeze(buildAgentUISharedHost());
  (globalThis as Record<string, unknown>)[AGENTUI_SHARED_GLOBAL_KEY] = shared;
  return shared;
}
