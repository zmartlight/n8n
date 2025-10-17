import { defineStore } from 'pinia';
import { CHAT_STORE } from './constants';
import { computed, ref, shallowRef } from 'vue';
import { v4 as uuidV4 } from 'uuid';
import {
	fetchChatModelsApi,
	sendMessageApi,
	editMessageApi,
	regenerateMessageApi,
	fetchConversationsApi as fetchSessionsApi,
	fetchSingleConversationApi as fetchMessagesApi,
	updateConversationTitleApi,
	deleteConversationApi,
} from './chat.api';
import { useRootStore } from '@n8n/stores/useRootStore';
import type {
	ChatHubConversationModel,
	ChatHubSendMessageRequest,
	ChatModelsResponse,
	ChatHubSessionDto,
	ChatMessageId,
	ChatSessionId,
} from '@n8n/api-types';
import type { StructuredChunk, CredentialsMap, ChatMessage, ChatConversation } from './chat.types';

export const useChatStore = defineStore(CHAT_STORE, () => {
	const rootStore = useRootStore();
	const models = shallowRef<ChatModelsResponse>();
	const loadingModels = ref(false);
	const streamingMessageId = ref<string>();
	const sessions = shallowRef<ChatHubSessionDto[]>([]);

	const isResponding = computed(() => streamingMessageId.value !== undefined);

	const conversationsBySession = shallowRef<Partial<Record<ChatSessionId, ChatConversation>>>({});

	function ensureConversation(sessionId: ChatSessionId): ChatConversation {
		if (!conversationsBySession.value[sessionId]) {
			conversationsBySession.value = {
				...conversationsBySession.value,
				[sessionId]: {
					messages: {},
				},
			};
		}

		const conversation = conversationsBySession.value[sessionId];
		if (!conversation) {
			throw new Error(`Conversation for session ID ${sessionId} not found`);
		}

		return conversation;
	}

	function addMessage(sessionId: ChatSessionId, message: ChatMessage) {
		const conversation = ensureConversation(sessionId);

		conversation.messages[message.id] = message;
	}

	function appendMessage(sessionId: ChatSessionId, messageId: ChatMessageId, chunk: string) {
		const conversation = ensureConversation(sessionId);
		const message = conversation.messages[messageId];
		if (!message) {
			throw new Error(`Message with ID ${messageId} not found in session ${sessionId}`);
		}

		message.content += chunk;
	}

	async function fetchChatModels(credentialMap: CredentialsMap) {
		loadingModels.value = true;
		models.value = await fetchChatModelsApi(rootStore.restApiContext, {
			credentials: credentialMap,
		});
		loadingModels.value = false;
		return models.value;
	}

	async function fetchSessions() {
		sessions.value = await fetchSessionsApi(rootStore.restApiContext);
	}

	async function fetchMessages(sessionId: string) {
		const { conversation } = await fetchMessagesApi(rootStore.restApiContext, sessionId);

		conversationsBySession.value = { ...conversationsBySession.value, [sessionId]: conversation };
	}

	function onBeginMessage(
		sessionId: string,
		messageId: string,
		replyToMessageId: string,
		retryOfMessageId: string | null,
		_nodeId: string,
		_runIndex?: number,
	) {
		streamingMessageId.value = messageId;

		addMessage(sessionId, {
			id: messageId,
			sessionId,
			type: 'ai',
			name: 'AI',
			content: '',
			provider: null,
			model: null,
			workflowId: null,
			executionId: null,
			state: 'active',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			previousMessageId: replyToMessageId,
			turnId: null,
			retryOfMessageId,
			revisionOfMessageId: null,
			runIndex: 0,
		});
	}

	function onChunk(
		sessionId: string,
		messageId: string,
		chunk: string,
		_nodeId?: string,
		_runIndex?: number,
	) {
		appendMessage(sessionId, messageId, chunk);
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function onEndMessage(_messageId: string, _nodeId: string, _runIndex?: number) {
		streamingMessageId.value = undefined;
	}

	function onStreamMessage(
		sessionId: string,
		message: StructuredChunk,
		messageId: string,
		replyToMessageId: string,
		retryOfMessageId: string | null,
	) {
		const nodeId = message.metadata?.nodeId || 'unknown';
		const runIndex = message.metadata?.runIndex;

		switch (message.type) {
			case 'begin':
				onBeginMessage(sessionId, messageId, replyToMessageId, retryOfMessageId, nodeId, runIndex);
				break;
			case 'item':
				onChunk(sessionId, messageId, message.content ?? '', nodeId, runIndex);
				break;
			case 'end':
				onEndMessage(messageId, nodeId, runIndex);
				break;
			case 'error':
				onChunk(
					sessionId,
					messageId,
					`Error: ${message.content ?? 'Unknown error'}`,
					nodeId,
					runIndex,
				);
				onEndMessage(messageId, nodeId, runIndex);
				break;
		}
	}

	async function onStreamDone() {
		streamingMessageId.value = undefined;
		await fetchSessions(); // update the conversation list
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function onStreamError(_e: Error) {
		streamingMessageId.value = undefined;
	}

	function sendMessage(
		sessionId: ChatSessionId,
		previousMessageId: ChatMessageId | null,
		message: string,
		model: ChatHubConversationModel | null,
		credentials: ChatHubSendMessageRequest['credentials'] | null,
	) {
		const messageId = uuidV4();
		const replyId = uuidV4();

		addMessage(sessionId, {
			id: messageId,
			sessionId,
			type: 'human',
			name: 'User',
			content: message,
			provider: null,
			model: model?.model ?? null,
			workflowId: null,
			executionId: null,
			state: 'active',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			previousMessageId,
			turnId: null,
			retryOfMessageId: null,
			revisionOfMessageId: null,
			runIndex: 0,
		});

		if (!model || !credentials) {
			addMessage(sessionId, {
				id: replyId,
				sessionId,
				type: 'ai',
				name: 'AI',
				content: '**ERROR:** Select a model to start a conversation.',
				provider: null,
				model: null,
				workflowId: null,
				executionId: null,
				state: 'active',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				previousMessageId: messageId,
				turnId: null,
				retryOfMessageId: null,
				revisionOfMessageId: null,
				runIndex: 0,
			});
			return;
		}

		sendMessageApi(
			rootStore.restApiContext,
			{
				model,
				messageId,
				sessionId,
				replyId,
				message,
				credentials,
				previousMessageId,
			},
			(chunk: StructuredChunk) => onStreamMessage(sessionId, chunk, replyId, messageId, null),
			onStreamDone,
			onStreamError,
		);
	}

	function editMessage(
		sessionId: ChatSessionId,
		editId: ChatMessageId,
		message: string,
		model: ChatHubConversationModel,
		credentials: ChatHubSendMessageRequest['credentials'],
	) {
		const messageId = uuidV4();
		const replyId = uuidV4();

		const conversation = ensureConversation(sessionId);
		const previousMessageId = conversation.messages[editId]?.previousMessageId ?? null;

		addMessage(sessionId, {
			id: messageId,
			sessionId,
			type: 'human',
			name: 'User',
			content: message,
			provider: null,
			model: null,
			workflowId: null,
			executionId: null,
			state: 'active',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			previousMessageId,
			turnId: null,
			retryOfMessageId: null,
			revisionOfMessageId: editId,
			runIndex: 0,
		});

		editMessageApi(
			rootStore.restApiContext,
			{
				model,
				messageId,
				sessionId,
				replyId,
				editId,
				message,
				credentials,
			},
			(chunk: StructuredChunk) => onStreamMessage(sessionId, chunk, replyId, messageId, null),
			onStreamDone,
			onStreamError,
		);
	}

	function regenerateMessage(
		sessionId: ChatSessionId,
		retryId: ChatMessageId,
		model: ChatHubConversationModel,
		credentials: ChatHubSendMessageRequest['credentials'],
	) {
		const replyId = uuidV4();
		const conversation = ensureConversation(sessionId);
		const previousMessageId = conversation.messages[retryId]?.previousMessageId ?? null;

		if (!previousMessageId) {
			throw new Error('No previous message to base regeneration on');
		}

		regenerateMessageApi(
			rootStore.restApiContext,
			{
				model,
				sessionId,
				retryId,
				replyId,
				credentials,
			},
			(chunk: StructuredChunk) =>
				onStreamMessage(sessionId, chunk, replyId, previousMessageId, retryId),
			onStreamDone,
			onStreamError,
		);
	}

	async function renameSession(sessionId: ChatSessionId, title: string) {
		const updated = await updateConversationTitleApi(rootStore.restApiContext, sessionId, title);

		sessions.value = sessions.value.map((session) =>
			session.id === sessionId ? updated.session : session,
		);
	}

	async function deleteSession(sessionId: ChatSessionId) {
		await deleteConversationApi(rootStore.restApiContext, sessionId);

		sessions.value = sessions.value.filter((session) => session.id !== sessionId);
	}

	return {
		models,
		sessions,
		conversationsBySession,
		loadingModels,
		isResponding,
		streamingMessageId,
		fetchChatModels,
		sendMessage,
		editMessage,
		regenerateMessage,
		fetchSessions,
		fetchMessages,
		renameSession,
		deleteSession,
	};
});
