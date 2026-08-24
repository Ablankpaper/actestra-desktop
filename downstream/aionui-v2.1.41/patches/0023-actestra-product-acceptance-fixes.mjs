import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
// Contract markers: stream-terminal, optimistic-user, textOnly,
// team-invalid-request, attempt-failed, and chat.history.refresh are all
// intentionally represented by this downstream-only product patch.
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(outputRoot, relativePath), "utf8");
}

function write(relativePath, contents) {
  fs.writeFileSync(path.join(outputRoot, relativePath), contents, "utf8");
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one 0023 context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

// The source copy is deliberately imported through an Actestra-owned alias. It
// is renderer-only and has no persistence, filesystem, credential, or transport
// authority.
replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/runtime/useConversationRuntimeView.ts",
  "import { ipcBridge } from '@/common';",
  "import { ipcBridge } from '@/common';\nimport { isErrorTipMessage } from '@/common/chat/chatLib';\nimport { emitter } from '@/renderer/utils/emitter';\nimport { isTerminalRuntimeForTurn } from '@/actestra/renderer/conversationTerminal';",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/runtime/useConversationRuntimeView.ts",
  "  useEffect(() => {\n    if (!conversation_id) {\n      return;\n    }\n\n    const turnCompletedEmitter = ipcBridge.conversation.turnCompleted;\n    const listChangedEmitter = ipcBridge.conversation.listChanged;\n    if (!turnCompletedEmitter || !listChangedEmitter) {\n      return;\n    }\n\n    const disposeTurnCompleted = turnCompletedEmitter.on((event) => {\n      if (event.session_id !== conversation_id) {\n        return;\n      }\n      flushRuntimeViewLogs(turnCompleted(conversation_id, event.turn_id, event.runtime));\n    });\n\n    const disposeListChanged = listChangedEmitter.on((event) => {\n      if (event.conversation_id !== conversation_id || event.action !== 'deleted') {\n        return;\n      }\n      flushRuntimeViewLogs(conversationDeleted(conversation_id));\n    });\n\n    return () => {\n      disposeTurnCompleted();\n      disposeListChanged();\n    };\n  }, [conversation_id]);",
  `  useEffect(() => {
    if (!conversation_id) {
      return;
    }

    let disposed = false;
    const disposers: Array<() => void> = [];
    const terminalBackoffMs = [0, 150, 500, 1000, 2000, 4000];

    const wait = (milliseconds: number): Promise<void> =>
      milliseconds === 0
        ? Promise.resolve()
        : new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
          });

    const reconcileStreamTerminal = async (turnId: string | undefined, streamType: string): Promise<void> => {
      // The stream terminal can precede the database commit by a few event-loop
      // turns. Re-read boundedly; never release the local gate merely because a
      // renderer event arrived.
      const observedActiveTurnId = getConversationRuntimeViewSnapshot(conversation_id).activeTurnId;
      emitter.emit('chat.history.refresh');
      for (const delay of terminalBackoffMs) {
        await wait(delay);
        if (disposed) return;
        try {
          const conversation = await getConversationOrNull(conversation_id);
          const runtime = conversation?.runtime;
          if (!runtime) continue;
          const currentActiveTurnId = getConversationRuntimeViewSnapshot(conversation_id).activeTurnId;
          const completedTurnId = turnId ?? observedActiveTurnId ?? runtime.turn_id;
          if (!completedTurnId) continue;
          // Once another turn is active, this terminal belongs to history and
          // must not project its idle runtime over the newer turn.
          if (currentActiveTurnId !== null && currentActiveTurnId !== completedTurnId) return;
          const terminal = isTerminalRuntimeForTurn(runtime, {
            eventTurnId: turnId ?? completedTurnId,
            activeTurnId: currentActiveTurnId ?? observedActiveTurnId,
          });
          if (!terminal) continue;
          flushRuntimeViewLogs(turnCompleted(conversation_id, completedTurnId, runtime));
          emitter.emit('chat.history.refresh');
          logConversationRuntimeView({
            level: 'info',
            event: 'runtime_release_confirmed',
            data: { conversation_id, turn_id: completedTurnId, stream_type: streamType, source: 'stream-terminal' },
          });
          return;
        } catch {
          // A transient read failure must not turn a still-running backend into
          // an idle renderer state. The next bounded attempt is authoritative.
        }
      }
    };

    const onStreamMessage = (message: { conversation_id: string; type: string; turn_id?: string }) => {
      if (message.conversation_id !== conversation_id) return;
      if (message.type !== 'finish' && message.type !== 'error' && !isErrorTipMessage(message as never)) return;
      void reconcileStreamTerminal(message.turn_id, 'stream-terminal');
    };

    const conversationStream = ipcBridge.conversation.responseStream;
    const acpStream = ipcBridge.acpConversation?.responseStream;
    if (conversationStream) disposers.push(conversationStream.on(onStreamMessage));
    if (acpStream) disposers.push(acpStream.on(onStreamMessage));

    const turnCompletedEmitter = ipcBridge.conversation.turnCompleted;
    const listChangedEmitter = ipcBridge.conversation.listChanged;
    if (turnCompletedEmitter) {
      disposers.push(
        turnCompletedEmitter.on((event) => {
          if (event.session_id !== conversation_id) return;
          flushRuntimeViewLogs(turnCompleted(conversation_id, event.turn_id, event.runtime));
          emitter.emit('chat.history.refresh');
        }),
      );
    }
    if (listChangedEmitter) {
      disposers.push(
        listChangedEmitter.on((event) => {
          if (event.conversation_id !== conversation_id || event.action !== 'deleted') return;
          flushRuntimeViewLogs(conversationDeleted(conversation_id));
        }),
      );
    }

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [conversation_id]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "import { useCallback, useEffect, useRef } from 'react';",
  "import { useCallback, useEffect, useRef } from 'react';\nimport { addEventListener } from '@/renderer/utils/emitter';\nimport {\n  acknowledgeActestraOptimisticUserMessage,\n  reconcileActestraOptimisticUserMessages,\n} from '@/actestra/renderer/optimisticUserMessage';",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "  const sameConversation = currentList.filter((message) => message.conversation_id === conversationId);",
  "  const sameConversation = reconcileActestraOptimisticUserMessages(\n    currentList.filter((message) => message.conversation_id === conversationId),\n    messages,\n  );",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "      update((list) => {\n        const index = getOrBuildIndex(list);\n        return composeMessageWithIndex(",
  "      update((list) => {\n        const reconciled = reconcileActestraOptimisticUserMessages(list, [\n          {\n            msg_id: payload.msg_id,\n            conversation_id: payload.conversation_id,\n            type: 'text',\n            position: payload.position,\n            content: { content: payload.content },\n          },\n        ]);\n        const index = getOrBuildIndex(reconciled);\n        return composeMessageWithIndex(",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "          list,\n          index\n        );\n      });\n    });\n  }, [key, update]);",
  "          reconciled,\n          index\n        );\n      });\n    });\n  }, [key, update]);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "export const useAddOrUpdateMessage = useMergeLiveMessage;\n\nexport const useRemoveMessageByMsgId = () => {",
  `export const useAddOrUpdateMessage = useMergeLiveMessage;

/** Optimistic user input must enter the list in the same event turn as the click. */
export const useProjectActestraOptimisticUserMessage = () => {
  const update = useUpdateMessageList();
  return useCallback(
    (message: TMessage) => {
      update((list) => list.concat(message));
    },
    [update],
  );
};

export const useAcknowledgeActestraOptimisticUserMessage = () => {
  const update = useUpdateMessageList();
  return useCallback(
    (optimisticMessageId: string, canonicalMessageId: string) => {
      update((list) =>
        acknowledgeActestraOptimisticUserMessage(
          list,
          optimisticMessageId,
          canonicalMessageId,
        ),
      );
    },
    [update],
  );
};

export const useRemoveMessageByMsgId = () => {`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "  useEffect(() => {\n    if (!key) {\n      return;\n    }\n\n    return ipcBridge.conversation.userCreated.on((payload) => {",
  "  useEffect(() => {\n    if (!key) {\n      return;\n    }\n\n    const disposeRefresh = addEventListener('chat.history.refresh', () => {\n      void loadMessages().catch((error) => {\n        console.error('[useMessageLstCache] Failed to refresh messages from database:', error);\n      });\n    });\n    const disposeUserCreated = ipcBridge.conversation.userCreated.on((payload) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts",
  "    });\n  }, [key, update]);\n};\n\nexport const beforeUpdateMessageList",
  "    });\n    return () => {\n      disposeRefresh();\n      disposeUserCreated();\n    };\n  }, [key, loadMessages, update]);\n};\n\nexport const beforeUpdateMessageList",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
  "    case 'attempt-failed': return translate('team.actestra.blocked.attemptFailed');",
  "    case 'attempt-failed': return node.blocked_explanation ?? translate('team.actestra.blocked.attemptFailed');",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  onMobilePlusClick?: () => void;\n}> = ({",
  "  onMobilePlusClick?: () => void;\n  /** General v1 Team conversations are text-only and cannot read workspace files. */\n  textOnly?: boolean;\n}> = ({",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  onMobilePlusClick,\n}) => {",
  "  onMobilePlusClick,\n  textOnly = false,\n}) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  const isMobile = layout?.isMobile ?? false;",
  "  const isMobile = layout?.isMobile ?? false;\n  const isTextOnly = textOnly === true;",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  const { isFileDragging, dragHandlers } = useDragUpload({\n    supportedExts,\n    onFilesAdded,",
  "  const { isFileDragging, dragHandlers } = useDragUpload({\n    supportedExts: isTextOnly ? [] : supportedExts,\n    onFilesAdded: isTextOnly ? undefined : onFilesAdded,",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  const activeAtFileQuery = useMemo(() => {\n    if (!conversationContext?.workspace) {",
  "  const activeAtFileQuery = useMemo(() => {\n    if (isTextOnly || !conversationContext?.workspace) {",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  }, [caretPosition, conversationContext?.workspace, input]);",
  "  }, [caretPosition, conversationContext?.workspace, input, isTextOnly]);",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "    if (onSlashBuiltinCommand) {",
  "    if (onSlashBuiltinCommand && !isTextOnly) {",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "    if (conversationContext?.conversation_id) {",
  "    if (conversationContext?.conversation_id) {",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "      commands.push({\n        name: 'actestra',",
  "      if (!isTextOnly) commands.push({\n        name: 'actestra',",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "  }, [conversationContext?.conversation_id, enableBtw, onSlashBuiltinCommand, t]);",
  "  }, [conversationContext?.conversation_id, enableBtw, isTextOnly, onSlashBuiltinCommand, t]);",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "    Boolean(conversationContext?.workspace) &&\n    Boolean(activeAtFileQuery)",
  "    !isTextOnly &&\n    Boolean(conversationContext?.workspace) &&\n    Boolean(activeAtFileQuery)",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "    if (isUploading) return;\n    if (enableBtw && btwQuestion !== null) {",
  "    if (isUploading) return;\n    if (isTextOnly && (hasPendingAttachments || domSnippets.length > 0)) {\n      message.warning('General v1 accepts text only; remove files or workspace references before sending.');\n      return;\n    }\n    if (enableBtw && btwQuestion !== null) {",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "        {...dragHandlers}",
  "        {...(isTextOnly ? {} : dragHandlers)}",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "          {unmatchedSelectedWorkspaceItems.length > 0 && onSelectedWorkspaceItemsChange && (",
  "          {!isTextOnly && unmatchedSelectedWorkspaceItems.length > 0 && onSelectedWorkspaceItemsChange && (",
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  "              onPaste={onPaste}",
  "              onPaste={isTextOnly ? undefined : onPaste}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx",
  "  teamRuntime?: TeamSendBoxRuntime;\n  assistantId?: string;",
  "  teamRuntime?: TeamSendBoxRuntime;\n  assistantId?: string;\n  textOnly?: boolean;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<{ message_id: string }>;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx",
  "  teamRuntime,\n  assistantId,\n}) => {",
  "  teamRuntime,\n  assistantId,\n  textOnly = false,\n}) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx",
  "            teamRuntime={teamRuntime}\n          />",
  "            teamRuntime={teamRuntime}\n            textOnly={textOnly}\n          />",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "import { useAionrsMessage } from './useAionrsMessage';",
  "import { useAionrsMessage } from './useAionrsMessage';\nimport {\n  useAcknowledgeActestraOptimisticUserMessage,\n  useProjectActestraOptimisticUserMessage,\n  useRemoveMessageByMsgId,\n} from '@/renderer/pages/conversation/Messages/hooks';\nimport { createActestraOptimisticUserMessage } from '@/actestra/renderer/optimisticUserMessage';\nimport { isBackendHttpError } from '@/common/adapter/httpBridge';",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<{ message_id: string }>;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "  teamRuntime?: TeamSendBoxRuntime;\n}> = ({ conversation_id, modelSelection, session_mode, agent_name, teamSendMessage, teamRuntime }) => {",
  "  teamRuntime?: TeamSendBoxRuntime;\n  textOnly?: boolean;\n}> = ({ conversation_id, modelSelection, session_mode, agent_name, teamSendMessage, teamRuntime, textOnly = false }) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "  const { thought, running, setActiveMsgId, setWaitingResponse, resetState } = useAionrsMessage(conversation_id, {",
  "  const projectOptimisticUserMessage = useProjectActestraOptimisticUserMessage();\n  const acknowledgeOptimisticUserMessage = useAcknowledgeActestraOptimisticUserMessage();\n  const removeMessageByMsgId = useRemoveMessageByMsgId();\n  const { thought, running, setActiveMsgId, setWaitingResponse, resetState } = useAionrsMessage(conversation_id, {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      const displayMessage = buildDisplayMessage(input, files, workspacePath);\n      try {",
  "      const displayMessage = buildDisplayMessage(input, files, workspacePath);\n      const optimistic = createActestraOptimisticUserMessage(conversation_id, displayMessage);\n      projectOptimisticUserMessage(optimistic);\n      try {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      if (teamPermission) await teamPermission.warmupSession();\n      if (!current_model?.use_model) {",
  "      if (!current_model?.use_model) {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      projectOptimisticUserMessage(optimistic);\n      try {\n        void checkAndUpdateTitle(conversation_id, input);",
  "      projectOptimisticUserMessage(optimistic);\n      try {\n        if (teamPermission) await teamPermission.warmupSession();\n        void checkAndUpdateTitle(conversation_id, input);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        if (teamSendMessage) {\n          await teamSendMessage({ input: displayMessage, files });",
  "        if (teamSendMessage) {\n          const acknowledgement = await teamSendMessage({ input: displayMessage, files });\n          acknowledgeOptimisticUserMessage(optimistic.msg_id, acknowledgement.message_id);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        setActiveMsgId(res.msg_id);\n        markSendAccepted(res.turn_id, res.runtime, res.msg_id);",
  "        acknowledgeOptimisticUserMessage(optimistic.msg_id, res.msg_id);\n        setActiveMsgId(res.msg_id);\n        markSendAccepted(res.turn_id, res.runtime, res.msg_id);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      } catch (error) {\n        const errorMessage =",
  "      } catch (error) {\n        removeMessageByMsgId(optimistic.msg_id);\n        const errorMessage =",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        const busyError = classifyConversationBusyError(error);",
  "        const isTeamInvalidRequest = isBackendHttpError(error) && error.code === 'team-invalid-request';\n        if (isTeamInvalidRequest) {\n          Message.error(\n            `${t('team.actestra.invalidRequest')} ${t('team.actestra.invalidRequestNextStep')}`,\n          );\n        }\n        const busyError = classifyConversationBusyError(error);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        markSendFailed({ kind: 'ordinary', reason: errorMessage });\n        Message.error(errorMessage);",
  "        markSendFailed({ kind: 'ordinary', reason: errorMessage });\n        if (!isTeamInvalidRequest) Message.error(errorMessage);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      workspacePath,\n    ]",
  "      workspacePath,\n      acknowledgeOptimisticUserMessage,\n      projectOptimisticUserMessage,\n      removeMessageByMsgId,\n    ]",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}",
  "        onMobilePlusClick={!textOnly && isMobile ? () => setIsMobileSheetOpen(true) : undefined}\n        textOnly={textOnly}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        onFilesAdded={handleFilesAdded}",
  "        onFilesAdded={textOnly ? undefined : handleFilesAdded}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        tools={\n          <FileAttachButton",
  "        tools={\n          textOnly ? undefined : (\n            <FileAttachButton",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "          />\n        }\n        rightTools=",
  "            />\n          )\n        }\n        rightTools=",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        selectedWorkspaceItems={atPath}",
  "        selectedWorkspaceItems={textOnly ? undefined : atPath}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        onSelectedWorkspaceItemsChange={(items) => {",
  "        onSelectedWorkspaceItemsChange={textOnly ? undefined : (items) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        supportedExts={allSupportedExts}",
  "        supportedExts={textOnly ? [] : allSupportedExts}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "        prefix={\n          <>\n            {uploadFile.length > 0 && (",
  "        prefix={\n          textOnly ? undefined : <>\n            {uploadFile.length > 0 && (",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx",
  "      {isMobile && (\n        <>\n          <MobileActionSheet",
  "      {!textOnly && isMobile && (\n        <>\n          <MobileActionSheet",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts",
  "            setStreamRunning(false);\n            setWaitingResponse(false);\n            setThought({ subject: '', description: '' });\n            if (message.msg_id) {",
  "            setStreamRunning(false);\n            streamRunningRef.current = false;\n            setWaitingResponse(false);\n            waitingResponseRef.current = false;\n            setHasActiveTools(false);\n            hasActiveToolsRef.current = false;\n            setThought({ subject: '', description: '' });\n            if (message.msg_id) {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx",
  "  teamRuntime?: TeamSendBoxRuntime;\n  assistantId?: string;",
  "  teamRuntime?: TeamSendBoxRuntime;\n  assistantId?: string;\n  textOnly?: boolean;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<{ message_id: string }>;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx",
  "  teamRuntime,\n  assistantId,\n}) => {",
  "  teamRuntime,\n  assistantId,\n  textOnly = false,\n}) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx",
  "              teamRuntime={teamRuntime}\n            ></AcpSendBox>",
  "              teamRuntime={teamRuntime}\n              textOnly={textOnly}\n            ></AcpSendBox>",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "import type { UseAcpMessageReturn } from './useAcpMessage';",
  "import type { UseAcpMessageReturn } from './useAcpMessage';\nimport {\n  useAcknowledgeActestraOptimisticUserMessage,\n  useProjectActestraOptimisticUserMessage,\n  useRemoveMessageByMsgId,\n} from '@/renderer/pages/conversation/Messages/hooks';\nimport { createActestraOptimisticUserMessage } from '@/actestra/renderer/optimisticUserMessage';",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;",
  "  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<{ message_id: string }>;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "  teamRuntime?: TeamSendBoxRuntime;\n}> = ({",
  "  teamRuntime?: TeamSendBoxRuntime;\n  textOnly?: boolean;\n}> = ({",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "  teamRuntime,\n}) => {",
  "  teamRuntime,\n  textOnly = false,\n}) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "  const addOrUpdateMessage = useAddOrUpdateMessage(); // Move this here so it's available in useEffect",
  "  const addOrUpdateMessage = useAddOrUpdateMessage(); // Move this here so it's available in useEffect\n  const projectOptimisticUserMessage = useProjectActestraOptimisticUserMessage();\n  const acknowledgeOptimisticUserMessage = useAcknowledgeActestraOptimisticUserMessage();\n  const removeMessageByMsgId = useRemoveMessageByMsgId();",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "      try {\n        if (teamPermission) await teamPermission.warmupSession();",
  "      const optimistic = createActestraOptimisticUserMessage(conversation_id, displayMessage);\n      projectOptimisticUserMessage(optimistic);\n      try {\n        if (teamPermission) await teamPermission.warmupSession();",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        if (teamSendMessage) {\n          await teamSendMessage({ input: displayMessage, files });",
  "        if (teamSendMessage) {\n          const acknowledgement = await teamSendMessage({ input: displayMessage, files });\n          acknowledgeOptimisticUserMessage(optimistic.msg_id, acknowledgement.message_id);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        markSendAccepted(result.turn_id, result.runtime, result.msg_id);",
  "        acknowledgeOptimisticUserMessage(optimistic.msg_id, result.msg_id);\n        markSendAccepted(result.turn_id, result.runtime, result.msg_id);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "      } catch (error: unknown) {\n        const errorMsg =",
  "      } catch (error: unknown) {\n        removeMessageByMsgId(optimistic.msg_id);\n        const errorMsg =",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        const busyError = classifyConversationBusyError(error);",
  "        if (isBackendHttpError(error) && error.code === 'team-invalid-request') {\n          Message.error(\n            `${t('team.actestra.invalidRequest')} ${t('team.actestra.invalidRequestNextStep')}`,\n          );\n          markSendFailed({ kind: 'ordinary', reason: errorMsg });\n          resetState();\n          setAiProcessing(false);\n          throw error;\n        }\n        const busyError = classifyConversationBusyError(error);",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "      workspacePath,\n    ]",
  "      workspacePath,\n      acknowledgeOptimisticUserMessage,\n      projectOptimisticUserMessage,\n      removeMessageByMsgId,\n    ]",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}",
  "        onMobilePlusClick={!textOnly && isMobile ? () => setIsMobileSheetOpen(true) : undefined}\n        textOnly={textOnly}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        selectedWorkspaceItems={atPath}",
  "        selectedWorkspaceItems={textOnly ? undefined : atPath}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        onSelectedWorkspaceItemsChange={(items) => {",
  "        onSelectedWorkspaceItemsChange={textOnly ? undefined : (items) => {",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        onFilesAdded={actestraCodingJourneySelector ? undefined : handleFilesAdded}",
  "        onFilesAdded={textOnly || actestraCodingJourneySelector ? undefined : handleFilesAdded}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "          !actestraCodingJourneySelector && isSideQuestionSupported({ type: 'acp', backend })",
  "          !textOnly && !actestraCodingJourneySelector && isSideQuestionSupported({ type: 'acp', backend })",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        supportedExts={actestraCodingJourneySelector ? [] : allSupportedExts}",
  "        supportedExts={textOnly || actestraCodingJourneySelector ? [] : allSupportedExts}",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        tools={\n          actestraCodingJourneySelector ? undefined : (",
  "        tools={\n          textOnly || actestraCodingJourneySelector ? undefined : (",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "        prefix={\n          <>\n            {uploadFile.length > 0 && (",
  "        prefix={\n          textOnly ? undefined : <>\n            {uploadFile.length > 0 && (",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  "      {isMobile && (\n        <>\n          <MobileActionSheet",
  "      {!textOnly && isMobile && (\n        <>\n          <MobileActionSheet",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "  mcp_statuses?: IConversationMcpStatus[];\n};",
  "  mcp_statuses?: IConversationMcpStatus[];\n  assistant_backend?: string;\n};",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "type TeamSendOverride = (payload: { input: string; files: string[] }) => Promise<void>;",
  "type TeamSendOverride = (payload: { input: string; files: string[] }) => Promise<ITeamRunAck>;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "          clearTeamRequestNonce(conversation.id, targetSlotId, requestNonce);\n          onTeamRunAck?.(ack);\n          return;",
  "          clearTeamRequestNonce(conversation.id, targetSlotId, requestNonce);\n          onTeamRunAck?.(ack);\n          return ack;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "        const ack = await ipcBridge.team.sendMessage.invoke({ team_id, input, files });\n        onTeamRunAck?.(ack);\n        return;",
  "        const ack = await ipcBridge.team.sendMessage.invoke({ team_id, input, files });\n        onTeamRunAck?.(ack);\n        return ack;",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "      const ack = await ipcBridge.team.sendMessageToAgent.invoke({ team_id, slot_id, input, files });\n      onTeamRunAck?.(ack);\n    },",
  "      const ack = await ipcBridge.team.sendMessageToAgent.invoke({ team_id, slot_id, input, files });\n      onTeamRunAck?.(ack);\n      return ack;\n    },",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "  loadedMcpStatuses?: IConversationMcpStatus[];\n}> = ({",
  "  loadedMcpStatuses?: IConversationMcpStatus[];\n  textOnly?: boolean;\n}> = ({",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "  loadedMcpStatuses,\n}) => {\n  const onSelectModel",
  "  loadedMcpStatuses,\n  textOnly = false,\n}) => {\n  const onSelectModel",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "      loadedMcpStatuses={loadedMcpStatuses}\n    />",
  "      loadedMcpStatuses={loadedMcpStatuses}\n      textOnly={textOnly}\n    />",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "  const capabilitySnapshot = conversation.extra as TeamConversationCapabilitySnapshot | undefined;",
  "  const capabilitySnapshot = conversation.extra as TeamConversationCapabilitySnapshot | undefined;\n  const textOnly = Boolean(\n    team_id &&\n      !isLeader &&\n      (assistant_backend === 'general' || capabilitySnapshot?.assistant_backend === 'general'),\n  );",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "            loadedMcpStatuses={capabilitySnapshot?.mcp_statuses}\n          />\n        );\n      case 'aionrs':",
  "            loadedMcpStatuses={capabilitySnapshot?.mcp_statuses}\n            textOnly={textOnly}\n          />\n        );\n      case 'aionrs':",
);

replaceOnce(
  "packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx",
  "            loadedMcpStatuses={capabilitySnapshot?.mcp_statuses}\n          />\n        );\n      default:",
  "            loadedMcpStatuses={capabilitySnapshot?.mcp_statuses}\n            textOnly={textOnly}\n          />\n        );\n      default:",
);

// The Team leader is the structured task-admission surface: an explicit file
// selection is converted by Main into General requirements and rejected before
// model execution. A direct General-member conversation remains text-only and
// therefore exposes no file-selection or workspace-tool affordance.
replaceOnce(
  "tests/unit/renderer/team/TeamChatView.dom.test.tsx",
  "  it.each([\n    ['runtime_starting', 'Waiting for this assistant to start…', true],",
  `  it('keeps explicit file selection available on a General Team leader', async () => {
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(
      <TeamChatView
        team_id='team-1'
        isLeader
        assistant_backend='general'
        conversation={{
          id: 'conv-general-leader',
          type: 'acp',
          name: 'General leader',
          created_at: Date.now(),
          updated_at: Date.now(),
          extra: { workspace: '/tmp', assistant_backend: 'general' },
        }}
      />
    );

    expect(await screen.findByTestId('mock-acp-chat')).toBeInTheDocument();
    expect(acpChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ textOnly: false })
    );
  });

  it('keeps a direct General member conversation text-only', async () => {
    usePresetAssistantInfoMock.mockReturnValue({ info: null });

    render(
      <TeamChatView
        team_id='team-1'
        slot_id='general-worker-1'
        isLeader={false}
        assistant_backend='general'
        conversation={{
          id: 'conv-general-worker',
          type: 'acp',
          name: 'General worker',
          created_at: Date.now(),
          updated_at: Date.now(),
          extra: { workspace: '/tmp', assistant_backend: 'general' },
        }}
      />
    );

    expect(await screen.findByTestId('mock-acp-chat')).toBeInTheDocument();
    expect(acpChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ textOnly: true })
    );
  });

  it.each([
    ['runtime_starting', 'Waiting for this assistant to start…', true],`,
);

// Renderer regressions lock the exact optimistic lifecycle without changing the
// frozen test source: synchronous projection, canonical acknowledgement, and
// removal of only the rejected local ID.
replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  "import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';",
  "import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';\nimport { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';",
);

replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  "const turnCompletedListeners = vi.hoisted(() => ({\n  current: [] as Array<\n    (event: { session_id: string; turn_id: string; state: string; runtime: TConversationRuntimeSummary }) => void\n  >,\n}));",
  `const turnCompletedListeners = vi.hoisted(() => ({
  current: [] as Array<
    (event: { session_id: string; turn_id: string; state: string; runtime: TConversationRuntimeSummary }) => void
  >,
}));

const runtimeViewMocks = vi.hoisted(() => ({
  responseStreamListeners: [] as Array<
    (event: { conversation_id: string; type: string; turn_id?: string }) => void
  >,
  acpResponseStreamListeners: [] as Array<
    (event: { conversation_id: string; type: string; turn_id?: string }) => void
  >,
  getConversationOrNull: vi.fn(),
  emitterEmit: vi.fn(),
}));`,
);

replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  `vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: {
        on: vi.fn((listener) => {
          turnCompletedListeners.current.push(listener);
          return () => {
            turnCompletedListeners.current = turnCompletedListeners.current.filter((item) => item !== listener);
          };
        }),
      },
    },
  },
}));`,
  `vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: vi.fn((listener) => {
          runtimeViewMocks.responseStreamListeners.push(listener);
          return () => {
            runtimeViewMocks.responseStreamListeners = runtimeViewMocks.responseStreamListeners.filter(
              (item) => item !== listener,
            );
          };
        }),
      },
      turnCompleted: {
        on: vi.fn((listener) => {
          turnCompletedListeners.current.push(listener);
          return () => {
            turnCompletedListeners.current = turnCompletedListeners.current.filter((item) => item !== listener);
          };
        }),
      },
      listChanged: {
        on: vi.fn(() => () => {}),
      },
    },
    acpConversation: {
      responseStream: {
        on: vi.fn((listener) => {
          runtimeViewMocks.acpResponseStreamListeners.push(listener);
          return () => {
            runtimeViewMocks.acpResponseStreamListeners = runtimeViewMocks.acpResponseStreamListeners.filter(
              (item) => item !== listener,
            );
          };
        }),
      },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: runtimeViewMocks.getConversationOrNull,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: runtimeViewMocks.emitterEmit },
  useAddEventListener: vi.fn(),
}));`,
);

replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  "    turnCompletedListeners.current = [];\n    resetConversationRuntimeViewStoreForTest();",
  "    turnCompletedListeners.current = [];\n    runtimeViewMocks.responseStreamListeners = [];\n    runtimeViewMocks.acpResponseStreamListeners = [];\n    runtimeViewMocks.getConversationOrNull.mockReset();\n    runtimeViewMocks.emitterEmit.mockReset();\n    resetConversationRuntimeViewStoreForTest();",
);

replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  "  it('drains a queued command when the runtime becomes idle', async () => {",
  `  it('does not let a delayed old Finish terminal release a newer accepted turn', async () => {
    const oldRunningRuntime = runtime({
      state: 'running',
      can_send_message: false,
      has_task: true,
      task_status: 'running',
      is_processing: true,
      turn_id: 'turn-old',
    });
    const newRunningRuntime = runtime({ ...oldRunningRuntime, turn_id: 'turn-new' });
    let resolveOldTerminalRead!: (value: { runtime: TConversationRuntimeSummary }) => void;
    runtimeViewMocks.getConversationOrNull
      .mockResolvedValueOnce({ runtime: oldRunningRuntime })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldTerminalRead = resolve;
        }),
      )
      .mockResolvedValue({ runtime: newRunningRuntime });

    const { result } = renderHook(() => useConversationRuntimeView('conv-newer-turn'));
    await waitFor(() => expect(result.current.activeTurnId).toBe('turn-old'));

    act(() => {
      runtimeViewMocks.responseStreamListeners[0]?.({
        conversation_id: 'conv-newer-turn',
        type: 'finish',
        turn_id: 'turn-old',
      });
    });
    await waitFor(() => expect(runtimeViewMocks.getConversationOrNull).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.markSendAccepted('turn-new', newRunningRuntime);
    });
    await act(async () => {
      resolveOldTerminalRead({ runtime: runtime({ turn_id: null }) });
      await Promise.resolve();
    });

    expect(result.current.activeTurnId).toBe('turn-new');
    expect(result.current.isProcessing).toBe(true);
    expect(result.current.canSendMessage).toBe(false);
  });

  it('keeps a no-id Finish terminal when an older running hydration arrives afterward', async () => {
    const runningRuntime = runtime({
      state: 'running',
      can_send_message: false,
      has_task: true,
      task_status: 'running',
      is_processing: true,
      turn_id: 'turn-no-id',
    });
    const terminalRuntime = runtime({ turn_id: null });
    let resolveStaleHydration!: (value: { runtime: TConversationRuntimeSummary }) => void;
    runtimeViewMocks.getConversationOrNull
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStaleHydration = resolve;
        }),
      )
      .mockResolvedValueOnce({ runtime: terminalRuntime });

    const { result } = renderHook(() => useConversationRuntimeView('conv-no-id'));

    act(() => {
      result.current.markSendAccepted('turn-no-id', runningRuntime);
    });
    await waitFor(() => {
      expect(result.current.activeTurnId).toBe('turn-no-id');
      expect(result.current.isProcessing).toBe(true);
      expect(runtimeViewMocks.responseStreamListeners).toHaveLength(1);
    });

    act(() => {
      runtimeViewMocks.responseStreamListeners[0]?.({
        conversation_id: 'conv-no-id',
        type: 'finish',
      });
    });
    await waitFor(() => expect(result.current.isProcessing).toBe(false));

    await act(async () => {
      resolveStaleHydration({ runtime: runningRuntime });
      await Promise.resolve();
    });

    expect(result.current.activeTurnId).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.canSendMessage).toBe(true);
  });

  it('drains a queued command when the runtime becomes idle', async () => {`,
);

replaceOnce(
  "tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx",
  "  it('drains a queued command when the runtime becomes idle', async () => {",
  `  it('keeps the turn busy after Finish until a delayed durable runtime read confirms the same turn is terminal', async () => {
    const runningRuntime = runtime({
      state: 'running',
      can_send_message: false,
      has_task: true,
      task_status: 'running',
      is_processing: true,
      turn_id: 'turn-finish',
    });
    const terminalRuntime = runtime({ turn_id: null });
    let resolveFirstTerminalRead!: (value: { runtime: TConversationRuntimeSummary }) => void;
    runtimeViewMocks.getConversationOrNull
      .mockResolvedValueOnce({ runtime: runningRuntime })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstTerminalRead = resolve;
        }),
      )
      .mockResolvedValueOnce({ runtime: terminalRuntime });

    const { result } = renderHook(() => useConversationRuntimeView('conv-finish'));

    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
      expect(result.current.isProcessing).toBe(true);
    });
    expect(runtimeViewMocks.responseStreamListeners).toHaveLength(1);

    act(() => {
      runtimeViewMocks.responseStreamListeners[0]?.({
        conversation_id: 'conv-finish',
        type: 'finish',
        turn_id: 'turn-finish',
      });
    });
    await waitFor(() => expect(runtimeViewMocks.getConversationOrNull).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirstTerminalRead({ runtime: runningRuntime });
      await Promise.resolve();
    });
    expect(result.current.isProcessing).toBe(true);

    await waitFor(() => expect(result.current.isProcessing).toBe(false), { timeout: 1_000 });
    expect(runtimeViewMocks.getConversationOrNull).toHaveBeenCalledTimes(3);
    expect(runtimeViewMocks.emitterEmit.mock.calls.filter(([event]) => event === 'chat.history.refresh')).toHaveLength(
      2,
    );
  });

  it('drains a queued command when the runtime becomes idle', async () => {`,
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "  addOrUpdateMessageMock,\n  resetStateMock,",
  "  addOrUpdateMessageMock,\n  projectOptimisticUserMessageMock,\n  acknowledgeOptimisticUserMessageMock,\n  removeMessageByMsgIdMock,\n  messageErrorMock,\n  resetStateMock,",
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "  addOrUpdateMessageMock: vi.fn(),\n  resetStateMock: vi.fn(),",
  "  addOrUpdateMessageMock: vi.fn(),\n  projectOptimisticUserMessageMock: vi.fn(),\n  acknowledgeOptimisticUserMessageMock: vi.fn(),\n  removeMessageByMsgIdMock: vi.fn(),\n  messageErrorMock: vi.fn(),\n  resetStateMock: vi.fn(),",
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "    Message: {\n      success: vi.fn(),\n      error: vi.fn(),\n    },",
  "    Message: {\n      success: vi.fn(),\n      error: messageErrorMock,\n    },",
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "  useAddOrUpdateMessage: () => addOrUpdateMessageMock,\n  useRemoveMessageByMsgId: () => vi.fn(),",
  "  useAddOrUpdateMessage: () => addOrUpdateMessageMock,\n  useProjectActestraOptimisticUserMessage: () => projectOptimisticUserMessageMock,\n  useAcknowledgeActestraOptimisticUserMessage: () => acknowledgeOptimisticUserMessageMock,\n  useRemoveMessageByMsgId: () => removeMessageByMsgIdMock,",
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "    expect(addOrUpdateMessageMock).not.toHaveBeenCalled();\n    expect(resetStateMock).not.toHaveBeenCalled();",
  "    expect(projectOptimisticUserMessageMock).toHaveBeenCalledTimes(1);\n    expect(projectOptimisticUserMessageMock.mock.calls[0]?.[0]).toMatchObject({\n      content: { content: 'Hello' },\n      position: 'right',\n      status: 'pending',\n    });\n    expect(acknowledgeOptimisticUserMessageMock).not.toHaveBeenCalled();\n    expect(removeMessageByMsgIdMock).toHaveBeenCalledTimes(1);\n    expect(addOrUpdateMessageMock).not.toHaveBeenCalled();\n    expect(resetStateMock).not.toHaveBeenCalled();",
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "  it('suppresses internal error cards and loading reset for active-turn busy conflicts', async () => {",
  `  it('shows only the dedicated Team invalid-request error and clears the failed optimistic send', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/conv-1/messages',
        status: 400,
        body: {
          success: false,
          code: 'team-invalid-request',
          error: 'Team task contains an invalid control character',
        },
      }),
    );

    render(
      <AcpSendBox
        conversation_id='conv-1'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />,
    );
    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalled();
    });
    messageErrorMock.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledTimes(1);
    });
    expect(projectOptimisticUserMessageMock).toHaveBeenCalledTimes(1);
    expect(removeMessageByMsgIdMock).toHaveBeenCalledTimes(1);
    expect(addOrUpdateMessageMock).not.toHaveBeenCalled();
    expect(resetStateMock).toHaveBeenCalledTimes(1);
  });

  it('suppresses internal error cards and loading reset for active-turn busy conflicts', async () => {`,
);

replaceOnce(
  "tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx",
  "  it('uses container-responsive fluid width instead of a fixed max width', () => {",
  `  it('projects the user message before ACP acknowledgement and then binds its canonical id', async () => {
    let resolveSend!: (value: { turn_id: string; runtime: null; msg_id: string }) => void;
    sendMessageInvokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    render(
      <AcpSendBox
        conversation_id='conv-1'
        backend='codex'
        workspacePath='/tmp/workspace'
        messageState={makeMessageState()}
      />,
    );

    act(() => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(projectOptimisticUserMessageMock).toHaveBeenCalledTimes(1);
    expect(acknowledgeOptimisticUserMessageMock).not.toHaveBeenCalled();
    const optimisticId = projectOptimisticUserMessageMock.mock.calls[0]?.[0]?.msg_id;

    await act(async () => {
      resolveSend({ turn_id: 'turn-1', runtime: null, msg_id: 'message-1' });
      await Promise.resolve();
    });

    expect(acknowledgeOptimisticUserMessageMock).toHaveBeenCalledWith(
      optimisticId,
      'message-1',
    );
  });

  it('uses container-responsive fluid width instead of a fixed max width', () => {`,
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "  markSendAcceptedMock,\n} = vi.hoisted(() => ({",
  "  markSendAcceptedMock,\n  projectOptimisticUserMessageMock,\n  acknowledgeOptimisticUserMessageMock,\n  removeMessageByMsgIdMock,\n} = vi.hoisted(() => ({",
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "  markSendAcceptedMock: vi.fn(),\n}));",
  "  markSendAcceptedMock: vi.fn(),\n  projectOptimisticUserMessageMock: vi.fn(),\n  acknowledgeOptimisticUserMessageMock: vi.fn(),\n  removeMessageByMsgIdMock: vi.fn(),\n}));",
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({",
  "vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({\n  useProjectActestraOptimisticUserMessage: () => projectOptimisticUserMessageMock,\n  useAcknowledgeActestraOptimisticUserMessage: () => acknowledgeOptimisticUserMessageMock,\n  useRemoveMessageByMsgId: () => removeMessageByMsgIdMock,\n}));\n\nvi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({",
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "    useTeamPermissionMock.mockReturnValue(null);",
  "    useTeamPermissionMock.mockReturnValue(null);\n    sendMessageInvokeMock.mockResolvedValue({ turn_id: 'turn-1', runtime: null, msg_id: 'message-1' });",
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "  it('does not warm up team session when draft content changes', async () => {",
  `  it('projects the Team user message before an asynchronous AionRS warmup completes', async () => {
    let resolveSendWarmup!: () => void;
    const warmupSession = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSendWarmup = resolve;
        }),
      );
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(warmupSession).toHaveBeenCalledTimes(1));
    warmupSession.mockClear();

    act(() => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(warmupSession).toHaveBeenCalledTimes(1);
    expect(projectOptimisticUserMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveSendWarmup();
      await Promise.resolve();
    });
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
  });

  it('does not warm up team session when draft content changes', async () => {`,
);

replaceOnce(
  "tests/unit/renderer/conversation/AionrsSendBox.dom.test.tsx",
  "  it('does not warm up team session when draft content changes', async () => {",
  `  it('projects the user message before AionRS acknowledgement and then binds its canonical id', async () => {
    let resolveSend!: (value: { turn_id: string; runtime: null; msg_id: string }) => void;
    sendMessageInvokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalled());

    act(() => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    expect(projectOptimisticUserMessageMock).toHaveBeenCalledTimes(1);
    expect(acknowledgeOptimisticUserMessageMock).not.toHaveBeenCalled();
    const optimisticId = projectOptimisticUserMessageMock.mock.calls[0]?.[0]?.msg_id;

    await act(async () => {
      resolveSend({ turn_id: 'turn-1', runtime: null, msg_id: 'message-1' });
      await Promise.resolve();
    });

    expect(acknowledgeOptimisticUserMessageMock).toHaveBeenCalledWith(
      optimisticId,
      'message-1',
    );
  });

  it('does not warm up team session when draft content changes', async () => {`,
);

// Existing ACP and AionRS transports already emit each content chunk into the
// message merger. Lock that Finish only terminates state and is not the first
// render on either retained conversation backend.
replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';",
  "import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';\nimport { useAionrsMessage } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage';",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "  responseStreamHandlerRef,\n} = vi.hoisted(() => ({",
  "  responseStreamHandlerRef,\n  aionrsResponseStreamOnMock,\n  aionrsResponseStreamHandlerRef,\n  processLocalCronResponseMock,\n} = vi.hoisted(() => ({",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "  responseStreamHandlerRef: {\n    current: undefined as ((message: IResponseMessage) => void) | undefined,\n  },\n}));",
  "  responseStreamHandlerRef: {\n    current: undefined as ((message: IResponseMessage) => void) | undefined,\n  },\n  aionrsResponseStreamOnMock: vi.fn(),\n  aionrsResponseStreamHandlerRef: {\n    current: undefined as ((message: IResponseMessage) => void) | undefined,\n  },\n  processLocalCronResponseMock: vi.fn(),\n}));",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "    conversation: {\n      ensureRuntime: {",
  "    conversation: {\n      responseStream: {\n        on: aionrsResponseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {\n          aionrsResponseStreamHandlerRef.current = handler;\n          return vi.fn();\n        }),\n      },\n      update: { invoke: vi.fn().mockResolvedValue(undefined) },\n      ensureRuntime: {",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({",
  "vi.mock('@/renderer/pages/conversation/platforms/aionrs/localCronCommands', () => ({\n  processLocalCronResponse: processLocalCronResponseMock,\n}));\n\nvi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "    responseStreamHandlerRef.current = undefined;",
  "    responseStreamHandlerRef.current = undefined;\n    aionrsResponseStreamHandlerRef.current = undefined;\n    processLocalCronResponseMock.mockResolvedValue({ displayContent: undefined, systemResponses: [] });",
);

replaceOnce(
  "tests/unit/renderer/useAcpMessage.dom.test.ts",
  "  it('emits a synthetic thinking done update on finish when the stream never sends one', async () => {",
  `  it('renders content chunks before Finish and does not create the answer at Finish', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    renderHook(() => useAcpMessage('conv-1'));

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'content',
        data: 'first chunk',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'text',
        msg_id: 'assistant-1',
        content: expect.objectContaining({ content: 'first chunk' }),
      }),
    );

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'content',
        data: 'second chunk',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'text',
        msg_id: 'assistant-1',
        content: expect.objectContaining({ content: 'second chunk' }),
      }),
    );

    const callsBeforeFinish = addOrUpdateMessageMock.mock.calls.length;
    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenCalledTimes(callsBeforeFinish);
  });

  it('renders AionRS content chunks before Finish and only finalizes the accumulated response at Finish', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    renderHook(() => useAionrsMessage('conv-aionrs'));

    act(() => {
      aionrsResponseStreamHandlerRef.current?.({
        type: 'content',
        data: 'first chunk',
        msg_id: 'assistant-aionrs',
        conversation_id: 'conv-aionrs',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'text',
        msg_id: 'assistant-aionrs',
        content: expect.objectContaining({ content: 'first chunk' }),
      }),
    );

    act(() => {
      aionrsResponseStreamHandlerRef.current?.({
        type: 'content',
        data: 'second chunk',
        msg_id: 'assistant-aionrs',
        conversation_id: 'conv-aionrs',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'text',
        msg_id: 'assistant-aionrs',
        content: expect.objectContaining({ content: 'second chunk' }),
      }),
    );

    const callsBeforeFinish = addOrUpdateMessageMock.mock.calls.length;
    act(() => {
      aionrsResponseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        msg_id: 'assistant-aionrs',
        conversation_id: 'conv-aionrs',
      });
    });
    expect(addOrUpdateMessageMock).toHaveBeenCalledTimes(callsBeforeFinish);
    await waitFor(() => {
      expect(processLocalCronResponseMock).toHaveBeenCalledWith(
        'conv-aionrs',
        'first chunksecond chunk',
      );
    });
  });

  it('emits a synthetic thinking done update on finish when the stream never sends one', async () => {`,
);
