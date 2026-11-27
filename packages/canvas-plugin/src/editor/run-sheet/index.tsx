import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { IModalProps } from '@/interfaces/common';
import { cn } from '@/lib/utils';
import { useCallback } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BeginId } from '../constant';
import DebugContent from '../debug-content';
import { useGetBeginNodeDataInputs } from '../hooks/use-get-begin-query';
import { useSaveGraphBeforeOpeningDebugDrawer } from '../hooks/use-save-graph';
import { BeginQuery } from '../interface';
import useGraphStore from '../store';
import { buildBeginQueryWithObject } from '../utils';
import { useRunSheetAwait } from './use-run-sheet-await';

const RunSheet = ({
  hideModal,
  showModal: showChatModal,
}: IModalProps<any>) => {
  const { t } = useTranslation();
  const { updateNodeForm, getNode } = useGraphStore((state) => state);

  const inputs = useGetBeginNodeDataInputs();

  const { handleRun, loading } = useSaveGraphBeforeOpeningDebugDrawer(
    showChatModal!,
  );

  // wait-for-user 表单状态：宿主在收到引擎 user_inputs 事件时调用
  // applyUserInputs；提交后由这里发起 resume（BFF 按后端选方言）。
  //
  // 画布 id 取路由参数（与其他画布入口一致：use-send-agent-message 也用
  // useParams().id），不是 Begin 节点 id——BeginId 恒为常量 'begin'，用它拼出
  // 的 /canvas/begin/resume 会打到错误资源。
  const { id: canvasId } = useParams();
  const awaitState = useRunSheetAwait({
    onSubmit: useCallback(
      (inputs: Record<string, BeginQuery>) => {
        const sessionId =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('session_id')
            : null;
        if (!canvasId || !sessionId) {
          // 缺画布或会话句柄时无法续跑：不发半截请求（宿主据此提示用户）。
          return;
        }
        void fetch(`/api/bff/canvas/${encodeURIComponent(canvasId)}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, form: inputs }),
        });
      },
      [canvasId],
    ),
  });

  const handleRunAgent = useCallback(
    (nextValues: BeginQuery[]) => {
      const beginNode = getNode(BeginId);
      const inputs: Record<string, BeginQuery> = beginNode?.data.form.inputs;

      const nextInputs = buildBeginQueryWithObject(inputs, nextValues);

      const currentNodes = updateNodeForm(BeginId, nextInputs, ['inputs']);
      handleRun(currentNodes);
      hideModal?.();
    },
    [getNode, handleRun, hideModal, updateNodeForm],
  );

  const onOk = useCallback(
    async (nextValues: any[]) => {
      handleRunAgent(nextValues);
    },
    [handleRunAgent],
  );

  return (
    <Sheet onOpenChange={hideModal} open modal={false}>
      <SheetContent className={cn('top-20 px-0 flex flex-col')}>
        <SheetHeader>
          <SheetTitle>{t('flow.testRun')}</SheetTitle>
        </SheetHeader>
        <DebugContent
          ok={onOk}
          parameters={inputs}
          loading={loading}
          className="flex-1 overflow-auto min-h-0 pb-5"
          maxHeight="max-h-[83vh]"
        ></DebugContent>
        {awaitState.waiting && (
          /* wait-for-user（plan §4.3 / p0p2-closeout B5-U3）：引擎要求表单
             输入时在 run-sheet 内联渲染，与聊天链路的 user_inputs 表单同源。 */
          <div className="border-t px-4 py-3">
            {awaitState.tips && (
              <p className="mb-2 text-sm text-text-secondary">{awaitState.tips}</p>
            )}
            <DebugContent
              ok={(values: BeginQuery[]) => awaitState.submit(values)}
              parameters={Object.entries(awaitState.inputs).map(([key, val]) => ({
                ...val,
                key,
              }))}
              loading={loading}
              className="max-h-[40vh] overflow-auto"
            ></DebugContent>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default RunSheet;
