/**
 * Provenance: verbatim port from upstream RAGFlow web/ (base 91c702e),零漂移。
 * agentui 适配(接线面,非本文件):ChatPromptEngine 仅一个 Collapse,
 * 只接 advancedSettingOpen;naive/agentic/model 折叠区 agentui 无对应 section,
 * 状态保留以对齐上游 API(见 docs/ragflow-ui-alignment-followup-tasks.md T2.8)。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Elements that flag a validation error: the control marked by FormControl or
// the message paragraph rendered by FormMessage.
const ErrorIndicatorSelector =
  '[aria-invalid="true"], [id$="-form-item-message"]';

/**
 * Reveals validation errors after an invalid submit: expands every collapsed
 * settings section and scrolls the first error into view. The signal counter
 * re-triggers the layout effect on every invalid submit, even when the
 * sections are already open.
 */
export function useRevealSubmitErrors() {
  const [modelSettingOpen, setModelSettingOpen] = useState(false);
  const [advancedSettingOpen, setAdvancedSettingOpen] = useState(false);
  const [naiveSettingOpen, setNaiveSettingOpen] = useState(false);
  const [agenticSettingOpen, setAgenticSettingOpen] = useState(false);
  const [invalidSubmitSignal, setInvalidSubmitSignal] = useState(0);
  const formContainerRef = useRef<HTMLDivElement>(null);

  const handleInvalidSubmit = useCallback(() => {
    setModelSettingOpen(true);
    setAdvancedSettingOpen(true);
    setNaiveSettingOpen(true);
    setAgenticSettingOpen(true);
    setInvalidSubmitSignal((signal) => signal + 1);
  }, []);

  useLayoutEffect(() => {
    if (invalidSubmitSignal === 0) {
      return;
    }
    const firstErrorIndicator = formContainerRef.current?.querySelector(
      ErrorIndicatorSelector,
    );
    firstErrorIndicator?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [invalidSubmitSignal]);

  return {
    formContainerRef,
    handleInvalidSubmit,
    modelSettingOpen,
    onModelSettingOpenChange: setModelSettingOpen,
    advancedSettingOpen,
    onAdvancedSettingOpenChange: setAdvancedSettingOpen,
    naiveSettingOpen,
    onNaiveSettingOpenChange: setNaiveSettingOpen,
    agenticSettingOpen,
    onAgenticSettingOpenChange: setAgenticSettingOpen,
  };
}
