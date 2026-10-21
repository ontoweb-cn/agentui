import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import ListFilterBar from '@/components/list-filter-bar';
import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IntellectPagination } from '@/components/ui/intellect-pagination';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { useFetchAgentListByPage } from '@/hooks/use-agent-request';
import { Routes } from '@/routes';
import { groupByDate } from '@/utils/date-group';
import { toEpochMs } from '@/utils/message-time';
import { t } from 'i18next';
import { Clipboard, ClipboardPlus, FileInput, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AgentCard } from './agent-card';
import { CreateAgentDialog } from './create-agent-dialog';
import { useCreateAgentOrPipeline } from './hooks/use-create-agent';
import { useSelectFilters } from './hooks/use-select-filters';
import { UploadAgentDialog } from './upload-agent-dialog';
import { useHandleImportJsonFile } from './use-import-json';
import { useRenameAgent } from './use-rename-agent';

const GROUP_LABEL_KEY = {
  today: 'flow.groupToday',
  yesterday: 'flow.groupYesterday',
  earlier: 'flow.groupEarlier',
} as const;

export default function Agents() {
  const {
    data,
    pagination,
    setPagination,
    searchString,
    handleInputChange,
    filterValue,
    handleFilterSubmit,
  } = useFetchAgentListByPage();

  const { navigateToAgentTemplates } = useNavigatePage();

  const {
    agentRenameLoading,
    initialAgentName,
    onAgentRenameOk,
    agentRenameVisible,
    hideAgentRenameModal,
    showAgentRenameModal,
  } = useRenameAgent();

  const {
    creatingVisible,
    hideCreatingModal,
    showCreatingModal,
    loading,
    handleCreateAgentOrPipeline,
  } = useCreateAgentOrPipeline();

  const {
    handleImportJson,
    fileUploadVisible,
    onFileUploadOk,
    hideFileUploadModal,
  } = useHandleImportJsonFile();

  const filters = useSelectFilters();

  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setPagination({ page, pageSize });
    },
    [setPagination],
  );
  const [searchUrl, setSearchUrl] = useSearchParams();
  const isCreate = searchUrl.get('isCreate') === 'true';

  useEffect(() => {
    if (isCreate) {
      showCreatingModal();
      searchUrl.delete('isCreate');
      setSearchUrl(searchUrl);
    }
  }, [isCreate, showCreatingModal, searchUrl, setSearchUrl]);

  const agentList = useMemo(() => data ?? [], [data]);
  const groups = useMemo(
    () =>
      groupByDate(
        agentList,
        (agent) =>
          toEpochMs(agent.update_date) ?? toEpochMs(agent.update_time),
      ),
    [agentList],
  );

  return (
    <>
      <section
        className="flex h-full min-h-0 flex-col"
        data-testid="agents-list"
      >
        <header className="pb-4">
          <ListFilterBar
            title={t('flow.agents')}
            searchString={searchString}
            onSearchChange={handleInputChange}
            searchClassName="w-[280px]"
            filters={filters}
            onChange={handleFilterSubmit}
            value={filterValue}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild data-testid="create-agent">
                <Button>
                  <Plus className="size-[1em]" />
                  {t('flow.createGraph')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent data-testid="agent-create-menu">
                <DropdownMenuItem
                  justifyBetween={false}
                  onClick={showCreatingModal}
                >
                  <Clipboard />
                  {t('flow.createFromBlank')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  justifyBetween={false}
                  onClick={() => navigateToAgentTemplates()}
                >
                  <ClipboardPlus />
                  {t('flow.createFromTemplate')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="agent-import-json"
                  justifyBetween={false}
                  onClick={handleImportJson}
                >
                  <FileInput />
                  {t('flow.importJsonFile')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ListFilterBar>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {agentList.length > 0 ? (
            <div className="space-y-6 pb-4">
              {groups.map((group) => (
                <section key={group.key}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    {t(GROUP_LABEL_KEY[group.key])}
                    <span className="ms-1.5 text-text-disabled">
                      {group.items.length}
                    </span>
                  </h3>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {group.items.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        data={agent}
                        showAgentRenameModal={showAgentRenameModal}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              {searchString ? (
                <EmptyAppCard
                  showIcon
                  size="large"
                  className="w-[480px] p-14"
                  isSearch
                  type={EmptyCardType.Agent}
                  onClick={() => showCreatingModal()}
                />
              ) : (
                <EmptyAppCard
                  showIcon
                  size="large"
                  className="w-[480px] p-14 !cursor-default"
                  type={EmptyCardType.Agent}
                  tabIndex={-1}
                >
                  <ul className="flex flex-col gap-y-5 pt-5 text-sm text-text-secondary">
                    <li data-testid="agents-empty-create">
                      <Button
                        variant="static"
                        size="auto"
                        onClick={showCreatingModal}
                      >
                        <Clipboard className="size-[1em]" />
                        {t('flow.createFromBlank')}
                      </Button>
                    </li>

                    <li>
                      <Button
                        asLink
                        variant="static"
                        size="auto"
                        to={Routes.AgentTemplates}
                      >
                        <ClipboardPlus className="size-[1em]" />
                        {t('flow.createFromTemplate')}
                      </Button>
                    </li>

                    <li>
                      <Button
                        variant="static"
                        size="auto"
                        onClick={handleImportJson}
                      >
                        <FileInput className="size-[1em]" />
                        {t('flow.importJsonFile')}
                      </Button>
                    </li>
                  </ul>
                </EmptyAppCard>
              )}
            </div>
          )}
        </div>

        {(pagination.total ?? 0) > 0 && (
          <div className="pt-3">
            <IntellectPagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={handlePageChange}
            />
          </div>
        )}
      </section>

      {agentRenameVisible && (
        <RenameDialog
          hideModal={hideAgentRenameModal}
          onOk={onAgentRenameOk}
          initialName={initialAgentName}
          loading={agentRenameLoading}
        ></RenameDialog>
      )}
      {creatingVisible && (
        <CreateAgentDialog
          loading={loading}
          visible={creatingVisible}
          hideModal={hideCreatingModal}
          shouldChooseAgent
          onOk={handleCreateAgentOrPipeline}
        ></CreateAgentDialog>
      )}
      {fileUploadVisible && (
        <UploadAgentDialog
          hideModal={hideFileUploadModal}
          onOk={onFileUploadOk}
        ></UploadAgentDialog>
      )}
    </>
  );
}
