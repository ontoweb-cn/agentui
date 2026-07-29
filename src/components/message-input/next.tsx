'use client';

import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadItemProgress,
  FileUploadList,
  FileUploadTrigger,
  type FileUploadProps,
} from '@/components/file-upload';
import { ContextRing } from '@/components/context-ring';
import { SlashCommandPalette } from '@/components/message-input/slash-command-palette';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ICommandContext } from '@/interfaces/command';
import { cn } from '@/lib/utils';
import { t } from 'i18next';
import {
  Atom,
  CircleStop,
  Globe,
  Paperclip,
  Send,
  Upload,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AudioButton } from '../ui/audio-button';

export type NextMessageInputOnPressEnterParameter = {
  enableThinking: boolean;
  enableInternet: boolean;
};

// L2: 稳定的 noop 引用,避免 callback 为 undefined 时每次 render 新建箭头函数破坏 memo
const noop = () => {};

interface NextMessageInputProps {
  disabled: boolean;
  value: string;
  sendDisabled: boolean;
  sendLoading: boolean;
  conversationId: string;
  uploadMethod?: string;
  isShared?: boolean;
  showUploadIcon?: boolean;
  isUploading?: boolean;
  onPressEnter({
    enableThinking,
    enableInternet,
  }: NextMessageInputOnPressEnterParameter): void;
  onInputChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  createConversationBeforeUploadDocument?(message: string): Promise<any>;
  stopOutputMessage?(): void;
  onUpload?: NonNullable<FileUploadProps['onUpload']>;
  removeFile?(file: File): void;
  showReasoning?: boolean;
  showInternet?: boolean;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  /** P2：上一 turn 的 prompt token 数（来自 usage 事件），用于 Context ring 显示 */
  contextPromptTokens?: number;
  /** P2：context length，默认 128000 */
  contextLength?: number;
  /** P2：上一 turn 的 completion token 数 */
  contextCompletionTokens?: number;
  /** P3：Slash 命令面板是否可见（外层根据 value 是否以 / 开头控制） */
  slashCommandVisible?: boolean;
  /** P3：Slash 命令上下文（提供 retry/undo/status/usage/model 等回调） */
  slashCommandContext?: ICommandContext;
  /** P3：Slash 命令执行后回调（外层清空 textarea value） */
  onSlashCommandExecuted?: () => void;
  /** P3：Slash 命令面板关闭回调（按 Esc 或点击外部） */
  onSlashCommandClose?: () => void;
}

export function NextMessageInput({
  isUploading = false,
  value,
  sendDisabled,
  sendLoading,
  disabled,
  showUploadIcon = true,
  resize: _resize = 'none',
  onUpload,
  onInputChange,
  stopOutputMessage,
  onPressEnter,
  removeFile,
  showReasoning = false,
  showInternet = false,
  contextPromptTokens = 0,
  contextLength,
  contextCompletionTokens,
  slashCommandVisible = false,
  slashCommandContext,
  onSlashCommandExecuted,
  onSlashCommandClose,
}: NextMessageInputProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [audioInputValue, setAudioInputValue] = React.useState<string | null>(
    null,
  );

  const [enableThinking, setEnableThinking] = useState(false);
  const [enableInternet, setEnableInternet] = useState(false);

  const handleThinkingToggle = useCallback(() => {
    setEnableThinking((prev) => !prev);
  }, []);

  const handleInternetToggle = useCallback(() => {
    setEnableInternet((prev) => !prev);
  }, []);

  const pressEnter = useCallback(() => {
    onPressEnter({
      enableThinking,
      enableInternet: showInternet ? enableInternet : false,
    });
  }, [onPressEnter, enableThinking, enableInternet, showInternet]);

  useEffect(() => {
    if (audioInputValue !== null) {
      onInputChange({
        target: { value: audioInputValue },
      } as React.ChangeEvent<HTMLTextAreaElement>);

      setTimeout(() => {
        pressEnter();
        setAudioInputValue(null);
      }, 0);
    }
  }, [
    audioInputValue,
    onInputChange,
    onPressEnter,
    enableThinking,
    enableInternet,
    showInternet,
    pressEnter,
  ]);

  const onFileReject = React.useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    });
  }, []);

  const submit = React.useCallback(() => {
    if (isUploading) return;
    pressEnter();
    setFiles([]);
  }, [isUploading, pressEnter]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 与发送按钮 disabled 条件保持一致，避免流式输出期间回车导致
      // 乐观消息被插入但实际 sendMessage 被 if(done) 跳过
      if (sendDisabled || isUploading || sendLoading || !value.trim()) return;
      submit();
    }
  };

  const onSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  const handleRemoveFile = React.useCallback(
    (file: File) => () => {
      removeFile?.(file);
    },
    [removeFile],
  );

  return (
    <FileUpload
      value={files}
      onValueChange={setFiles}
      onUpload={onUpload}
      onFileReject={onFileReject}
      className="relative w-full items-center"
      disabled={isUploading || disabled}
    >
      <FileUploadDropzone
        tabIndex={-1}
        // Prevents the dropzone from triggering on click
        onClick={(event) => event.preventDefault()}
        className="absolute top-0 left-0 z-0 flex size-full items-center justify-center rounded-none border-none bg-background/50 p-0 opacity-0 backdrop-blur transition-opacity duration-200 ease-out data-[dragging]:z-10 data-[dragging]:opacity-100"
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center justify-center rounded-full border p-2.5">
            <Upload className="size-6 text-muted-foreground" />
          </div>
          <p className="font-medium text-sm">Drag & drop files here</p>
          <p className="text-muted-foreground text-xs">
            Upload max 5 files each up to 5MB
          </p>
        </div>
      </FileUploadDropzone>

      <form
        onSubmit={onSubmit}
        className="
          relative flex w-full flex-col gap-2.5 rounded-md
          border-0.5 border-border-default bg-bg-card p-2 outline-none
          has-[textarea:focus]:outline-accent-primary has-[textarea:focus]:outline-1 has-[textarea:focus]:outline-offset-2
        "
      >
        {/* P3: Slash 命令面板（仅当 value 以 / 开头时由外层控制可见） */}
        {/* L2: 直接传递 callback,避免新建箭头函数导致 SlashCommandPalette memo 失效 */}
        {slashCommandVisible && slashCommandContext && (
          <SlashCommandPalette
            value={value}
            visible={slashCommandVisible}
            context={slashCommandContext}
            onCommandExecuted={onSlashCommandExecuted ?? noop}
            onRequestClose={onSlashCommandClose ?? noop}
          />
        )}
        <FileUploadList
          orientation="horizontal"
          className="overflow-x-auto px-0 py-1"
        >
          {files.map((file, index) => (
            <FileUploadItem key={index} value={file} className="max-w-52 p-1.5">
              <FileUploadItemPreview className="size-8 [&>svg]:size-5">
                <FileUploadItemProgress variant="fill" />
              </FileUploadItemPreview>
              <FileUploadItemMetadata size="sm" />
              <FileUploadItemDelete asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="-top-1 -right-1 absolute size-4 shrink-0 cursor-pointer rounded-full"
                  onClick={handleRemoveFile(file)}
                >
                  <X className="size-2.5" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>

        <Textarea
          data-testid="chat-textarea"
          value={value}
          onChange={onInputChange}
          placeholder={t('chat.messagePlaceholder')}
          className="
            min-h-10 max-h-40 w-full p-0 overflow-auto
            !outline-none !border-transparent !bg-transparent !shadow-none !ring-transparent !ring-offset-transparent
          "
          disabled={isUploading || disabled || sendLoading}
          onKeyDown={handleKeyDown}
          autoSize={{ minRows: 2, maxRows: 8 }}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {showUploadIcon && (
              <FileUploadTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="transparent"
                  className="rounded-sm border-0"
                  disabled={isUploading || sendLoading}
                  data-testid="chat-detail-attach"
                >
                  <Paperclip className="size-3.5" />
                  <span className="sr-only">Attach file</span>
                </Button>
              </FileUploadTrigger>
            )}

            {showReasoning && (
              <Button
                type="button"
                size="sm"
                variant={'outline'}
                className={cn('border-0 h-7 text-sm bg-bg-card', {
                  'bg-text-primary text-bg-base': enableThinking,
                })}
                onClick={handleThinkingToggle}
                data-testid="chat-detail-thinking-toggle"
              >
                <Atom />
                <span>Thinking</span>
              </Button>
            )}

            {showInternet && (
              <Button
                type="button"
                variant={enableInternet ? 'accent' : 'transparent'}
                size="icon-xs"
                className="border-0"
                onClick={handleInternetToggle}
                data-testid="chat-detail-internet-toggle"
              >
                <Globe />
              </Button>
            )}

            {contextPromptTokens > 0 && (
              <ContextRing
                promptTokens={contextPromptTokens}
                contextLength={contextLength}
                completionTokens={contextCompletionTokens}
              />
            )}
          </div>

          {sendLoading ? (
            <Button
              data-testid="chat-stream-status"
              onClick={stopOutputMessage}
              size="icon-xs"
            >
              <CircleStop />
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <AudioButton
                onOk={(value) => {
                  setAudioInputValue(value);
                }}
                testId="chat-detail-audio-toggle"
              />

              <Button
                size="icon-xs"
                disabled={
                  sendDisabled || isUploading || sendLoading || !value.trim()
                }
                data-testid="chat-detail-send"
              >
                <Send />
                <span className="sr-only">Send message</span>
              </Button>
            </div>
          )}
        </div>
      </form>
    </FileUpload>
  );
}
