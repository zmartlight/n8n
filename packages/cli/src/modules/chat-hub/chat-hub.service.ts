import {
	PROVIDER_CREDENTIAL_TYPE_MAP,
	type ChatHubProvider,
	type ChatHubLLMProvider,
	type ChatModelsResponse,
	type ChatHubConversationsResponse,
	type ChatHubConversationResponse,
	ChatHubMessageDto,
	type ChatMessageId,
	type ChatSessionId,
	ChatHubConversationModel,
	ChatHubMessageStatus,
	chatHubProviderSchema,
	type EnrichedStructuredChunk,
	ChatHubBaseLLMModel,
	ChatHubN8nModel,
	ChatHubCustomAgentModel,
	emptyChatModelsResponse,
} from '@n8n/api-types';
import { Logger } from '@n8n/backend-common';
import { ExecutionRepository, IExecutionResponse, User, WorkflowRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import type { EntityManager } from '@n8n/typeorm';
import type { Response } from 'express';
import {
	CHAT_TRIGGER_NODE_TYPE,
	OperationalError,
	ManualExecutionCancelledError,
	type INodeCredentials,
	type IWorkflowBase,
	type IWorkflowExecuteAdditionalData,
	type IRun,
	jsonParse,
	StructuredChunk,
	RESPOND_TO_CHAT_NODE_TYPE,
	IExecuteData,
	IRunExecutionData,
	INodeParameters,
	INode,
} from 'n8n-workflow';

import { ActiveExecutions } from '@/active-executions';
import { CredentialsFinderService } from '@/credentials/credentials-finder.service';
import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';
import { ExecutionService } from '@/executions/execution.service';
import { DynamicNodeParametersService } from '@/services/dynamic-node-parameters.service';
import { getBase } from '@/workflow-execute-additional-data';
import { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import { WorkflowService } from '@/workflows/workflow.service';

import { ChatHubAgentService } from './chat-hub-agent.service';
import { ChatHubCredentialsService, CredentialWithProjectId } from './chat-hub-credentials.service';
import type { ChatHubMessage } from './chat-hub-message.entity';
import { ChatHubWorkflowService } from './chat-hub-workflow.service';
import { JSONL_STREAM_HEADERS, NODE_NAMES, PROVIDER_NODE_TYPE_MAP } from './chat-hub.constants';
import type {
	HumanMessagePayload,
	RegenerateMessagePayload,
	EditMessagePayload,
	ModelWithCredentials,
} from './chat-hub.types';
import { ChatHubMessageRepository } from './chat-message.repository';
import { ChatHubSessionRepository } from './chat-session.repository';
import { interceptResponseWrites, createStructuredChunkAggregator } from './stream-capturer';

@Service()
export class ChatHubService {
	constructor(
		private readonly logger: Logger,
		private readonly executionService: ExecutionService,
		private readonly nodeParametersService: DynamicNodeParametersService,
		private readonly executionRepository: ExecutionRepository,
		private readonly workflowExecutionService: WorkflowExecutionService,
		private readonly workflowService: WorkflowService,
		private readonly workflowFinderService: WorkflowFinderService,
		private readonly workflowRepository: WorkflowRepository,
		private readonly activeExecutions: ActiveExecutions,
		private readonly sessionRepository: ChatHubSessionRepository,
		private readonly messageRepository: ChatHubMessageRepository,
		private readonly credentialsFinderService: CredentialsFinderService,
		private readonly chatHubAgentService: ChatHubAgentService,
		private readonly chatHubCredentialsService: ChatHubCredentialsService,
		private readonly chatHubWorkflowService: ChatHubWorkflowService,
	) {}

	async getModels(
		user: User,
		credentialIds: Record<ChatHubLLMProvider, string | null>,
	): Promise<ChatModelsResponse> {
		const additionalData = await getBase({ userId: user.id });
		const providers = chatHubProviderSchema.options;

		const allCredentials = await this.credentialsFinderService.findCredentialsForUser(user, [
			'credential:read',
		]);

		const responses = await Promise.all(
			providers.map<Promise<[ChatHubProvider, ChatModelsResponse[ChatHubProvider]]>>(
				async (provider: ChatHubProvider) => {
					const credentials: INodeCredentials = {};

					if (provider !== 'n8n' && provider !== 'custom-agent') {
						const credentialId = credentialIds[provider];
						if (!credentialId) {
							return [provider, { models: [] }];
						}

						// Ensure the user has the permission to read the credential
						if (!allCredentials.some((credential) => credential.id === credentialId)) {
							return [
								provider,
								{ models: [], error: 'Could not retrieve models. Verify credentials.' },
							];
						}

						credentials[PROVIDER_CREDENTIAL_TYPE_MAP[provider]] = { name: '', id: credentialId };
					}

					try {
						return [
							provider,
							await this.fetchModelsForProvider(user, provider, credentials, additionalData),
						];
					} catch {
						return [
							provider,
							{ models: [], error: 'Could not retrieve models. Verify credentials.' },
						];
					}
				},
			),
		);

		return responses.reduce<ChatModelsResponse>(
			(acc, [provider, res]) => {
				acc[provider] = res;
				return acc;
			},
			{ ...emptyChatModelsResponse },
		);
	}

	private async fetchModelsForProvider(
		user: User,
		provider: ChatHubProvider,
		credentials: INodeCredentials,
		additionalData: IWorkflowExecuteAdditionalData,
	): Promise<ChatModelsResponse[ChatHubProvider]> {
		switch (provider) {
			case 'openai':
				return await this.fetchOpenAiModels(credentials, additionalData);
			case 'anthropic':
				return await this.fetchAnthropicModels(credentials, additionalData);
			case 'google':
				return await this.fetchGoogleModels(credentials, additionalData);
			case 'n8n':
				return await this.fetchAgentWorkflowsAsModels(user);
			case 'custom-agent':
				return await this.chatHubAgentService.getAgentsByUserIdAsModels(user.id);
		}
	}

	private async fetchOpenAiModels(
		credentials: INodeCredentials,
		additionalData: IWorkflowExecuteAdditionalData,
	): Promise<ChatModelsResponse['openai']> {
		const resourceLocatorResults = await this.nodeParametersService.getResourceLocatorResults(
			'searchModels',
			'parameters.model',
			additionalData,
			PROVIDER_NODE_TYPE_MAP.openai,
			{},
			credentials,
		);

		return {
			models: resourceLocatorResults.results.map((result) => ({
				name: result.name,
				description: result.description ?? null,
				model: {
					provider: 'openai',
					model: String(result.value),
				},
				createdAt: null,
				updatedAt: null,
			})),
		};
	}

	private async fetchAnthropicModels(
		credentials: INodeCredentials,
		additionalData: IWorkflowExecuteAdditionalData,
	): Promise<ChatModelsResponse['anthropic']> {
		const resourceLocatorResults = await this.nodeParametersService.getResourceLocatorResults(
			'searchModels',
			'parameters.model',
			additionalData,
			PROVIDER_NODE_TYPE_MAP.anthropic,
			{},
			credentials,
		);

		return {
			models: resourceLocatorResults.results.map((result) => ({
				name: result.name,
				description: result.description ?? null,
				model: {
					provider: 'anthropic',
					model: String(result.value),
				},
				createdAt: null,
				updatedAt: null,
			})),
		};
	}

	private async fetchGoogleModels(
		credentials: INodeCredentials,
		additionalData: IWorkflowExecuteAdditionalData,
	): Promise<ChatModelsResponse['google']> {
		const results = await this.nodeParametersService.getOptionsViaLoadOptions(
			{
				// From Gemini node
				// https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/nodes-langchain/nodes/llms/LmChatGoogleGemini/LmChatGoogleGemini.node.ts#L75
				routing: {
					request: {
						method: 'GET',
						url: '/v1beta/models',
					},
					output: {
						postReceive: [
							{
								type: 'rootProperty',
								properties: {
									property: 'models',
								},
							},
							{
								type: 'filter',
								properties: {
									pass: "={{ !$responseItem.name.includes('embedding') }}",
								},
							},
							{
								type: 'setKeyValue',
								properties: {
									name: '={{$responseItem.name}}',
									value: '={{$responseItem.name}}',
									description: '={{$responseItem.description}}',
								},
							},
							{
								type: 'sort',
								properties: {
									key: 'name',
								},
							},
						],
					},
				},
			},
			additionalData,
			PROVIDER_NODE_TYPE_MAP.google,
			{},
			credentials,
		);

		return {
			models: results.map((result) => ({
				name: String(result.value),
				description: result.description ?? null,
				model: {
					provider: 'google',
					model: String(result.value),
				},
				createdAt: null,
				updatedAt: null,
			})),
		};
	}

	private async fetchAgentWorkflowsAsModels(user: User): Promise<ChatModelsResponse['n8n']> {
		const nodeTypes = [CHAT_TRIGGER_NODE_TYPE];
		const workflows = await this.workflowService.getWorkflowsWithNodesIncluded(
			user,
			nodeTypes,
			true,
		);

		return {
			models: workflows
				// Ensure the user has at least read access to the workflow
				.filter((workflow) => workflow.scopes.includes('workflow:read'))
				.filter((workflow) => workflow.active)
				.flatMap((workflow) => {
					const chatTrigger = workflow.nodes?.find((node) => node.type === CHAT_TRIGGER_NODE_TYPE);
					if (!chatTrigger) {
						return [];
					}

					if (chatTrigger.parameters.availableInChat !== true) {
						return [];
					}

					const name =
						typeof chatTrigger.parameters.agentName === 'string' &&
						chatTrigger.parameters.agentName.length > 0
							? chatTrigger.parameters.agentName
							: workflow.name;

					return [
						{
							name: name ?? 'Unknown Agent',
							description:
								typeof chatTrigger.parameters.agentDescription === 'string' &&
								chatTrigger.parameters.agentDescription.length > 0
									? chatTrigger.parameters.agentDescription
									: null,
							model: {
								provider: 'n8n',
								workflowId: workflow.id,
							},
							createdAt: workflow.createdAt ? workflow.createdAt.toISOString() : null,
							updatedAt: workflow.updatedAt ? workflow.updatedAt.toISOString() : null,
						},
					];
				}),
		};
	}

	private async deleteChatWorkflow(workflowId: string): Promise<void> {
		await this.workflowRepository.delete(workflowId);
	}

	private getErrorMessage(execution: IExecutionResponse): string | undefined {
		if (execution.data.resultData.error) {
			return execution.data.resultData.error.description ?? execution.data.resultData.error.message;
		}

		return undefined;
	}

	private getAIOutput(execution: IExecutionResponse, nodeName: string): string | undefined {
		const agent = execution.data.resultData.runData[nodeName];
		if (!agent || !Array.isArray(agent) || agent.length === 0) return undefined;

		const runIndex = agent.length - 1;
		const mainOutputs = agent[runIndex].data?.main;

		// Check all main output branches for a message
		if (mainOutputs && Array.isArray(mainOutputs)) {
			for (const branch of mainOutputs) {
				if (branch && Array.isArray(branch) && branch.length > 0 && branch[0].json?.output) {
					if (typeof branch[0].json.output === 'string') {
						return branch[0].json.output;
					}
				}
			}
		}

		return undefined;
	}

	private pickCredentialId(
		provider: ChatHubProvider,
		credentials: INodeCredentials,
	): string | null {
		if (provider === 'n8n' || provider === 'custom-agent') {
			return null;
		}

		return credentials[PROVIDER_CREDENTIAL_TYPE_MAP[provider]]?.id ?? null;
	}

	async sendHumanMessage(res: Response, user: User, payload: HumanMessagePayload) {
		const { sessionId, messageId, message, model, credentials, previousMessageId } = payload;
		const { provider } = model;

		const selectedModel = this.getModelWithCredentials(model, credentials);

		const { executionData, workflowData } = await this.messageRepository.manager.transaction(
			async (trx) => {
				const session = await this.getChatSession(user, sessionId, selectedModel, true, trx);
				await this.ensurePreviousMessage(previousMessageId, sessionId, trx);
				const messages = Object.fromEntries((session.messages ?? []).map((m) => [m.id, m]));
				const history = this.buildMessageHistory(messages, previousMessageId);

				await this.saveHumanMessage(
					payload,
					user,
					previousMessageId,
					selectedModel,
					undefined,
					trx,
				);

				if (provider === 'n8n') {
					return await this.prepareCustomAgentWorkflow(user, sessionId, model.workflowId, message);
				}

				if (provider === 'custom-agent') {
					return await this.prepareChatAgentWorkflow(
						model.agentId,
						user,
						sessionId,
						history,
						message,
						trx,
					);
				}

				return await this.prepareBaseChatWorkflow(
					user,
					sessionId,
					credentials,
					model,
					history,
					message,
					undefined,
					trx,
				);
			},
		);

		await this.executeChatWorkflowWithCleanup(
			res,
			user,
			workflowData,
			executionData,
			sessionId,
			messageId,
			selectedModel,
			provider,
		);

		// Generate title for the session on receiving the first human message.
		// This could be moved on a separate API call perhaps, maybe triggered after the first message is sent?
		if (previousMessageId === null) {
			await this.generateSessionTitle(user, sessionId, message, credentials, model).catch(
				(error) => {
					this.logger.error(`Title generation failed: ${error}`);
				},
			);
		}
	}

	async editMessage(res: Response, user: User, payload: EditMessagePayload) {
		const { sessionId, editId, messageId, message, model, credentials } = payload;
		const { provider } = model;

		const selectedModel = this.getModelWithCredentials(model, credentials);

		const workflow = await this.messageRepository.manager.transaction(async (trx) => {
			const session = await this.getChatSession(user, sessionId, selectedModel, true, trx);
			const messageToEdit = await this.getChatMessage(session.id, editId, [], trx);

			if (!['ai', 'human'].includes(messageToEdit.type)) {
				throw new BadRequestError('Only human and AI messages can be edited');
			}

			if (messageToEdit.type === 'ai') {
				// AI edits just change the original message without revisioning or response generation
				await this.messageRepository.updateChatMessage(editId, { content: payload.message }, trx);
				return null;
			}

			if (messageToEdit.type === 'human') {
				const messages = Object.fromEntries((session.messages ?? []).map((m) => [m.id, m]));
				const history = this.buildMessageHistory(messages, messageToEdit.previousMessageId);

				// If the message to edit isn't the original message, we want to point to the original message
				const revisionOfMessageId = messageToEdit.revisionOfMessageId ?? messageToEdit.id;

				await this.saveHumanMessage(
					payload,
					user,
					messageToEdit.previousMessageId,
					selectedModel,
					revisionOfMessageId,
					trx,
				);

				if (provider === 'n8n') {
					return await this.prepareCustomAgentWorkflow(user, sessionId, model.workflowId, message);
				}

				if (provider === 'custom-agent') {
					return await this.prepareChatAgentWorkflow(
						model.agentId,
						user,
						sessionId,
						history,
						message,
						trx,
					);
				}

				return await this.prepareBaseChatWorkflow(
					user,
					sessionId,
					credentials,
					model,
					history,
					message,
					undefined,
					trx,
				);
			}
			return null;
		});

		if (!workflow) {
			return;
		}

		const { workflowData, executionData } = workflow;

		await this.executeChatWorkflowWithCleanup(
			res,
			user,
			workflowData,
			executionData,
			sessionId,
			messageId,
			selectedModel,
			provider,
		);
	}

	async regenerateAIMessage(res: Response, user: User, payload: RegenerateMessagePayload) {
		const { sessionId, retryId, model, credentials } = payload;
		const { provider } = model;

		const selectedModel = this.getModelWithCredentials(model, credentials);

		const {
			workflow: { workflowData, executionData },
			retryOfMessageId,
			previousMessageId,
		} = await this.messageRepository.manager.transaction(async (trx) => {
			const session = await this.getChatSession(user, sessionId, undefined, false, trx);
			const messageToRetry = await this.getChatMessage(session.id, retryId, [], trx);

			if (messageToRetry.type !== 'ai') {
				throw new BadRequestError('Can only retry AI messages');
			}

			const messages = Object.fromEntries((session.messages ?? []).map((m) => [m.id, m]));
			const history = this.buildMessageHistory(messages, messageToRetry.previousMessageId);

			const lastHumanMessage = history.filter((m) => m.type === 'human').pop();
			if (!lastHumanMessage) {
				throw new BadRequestError('No human message found to base the retry on');
			}

			// Remove any (AI) messages that came after the last human message
			const lastHumanMessageIndex = history.indexOf(lastHumanMessage);
			if (lastHumanMessageIndex !== -1) {
				history.splice(lastHumanMessageIndex + 1);
			}

			// Rerun the workflow, replaying the last human message

			// If the message being retried is itself a retry, we want to point to the original message
			const retryOfMessageId = messageToRetry.retryOfMessageId ?? messageToRetry.id;
			const message = lastHumanMessage ? lastHumanMessage.content : '';

			let workflow;
			if (provider === 'n8n') {
				workflow = await this.prepareCustomAgentWorkflow(
					user,
					sessionId,
					model.workflowId,
					message,
				);
			} else if (provider === 'custom-agent') {
				workflow = await this.prepareChatAgentWorkflow(
					model.agentId,
					user,
					sessionId,
					history,
					message,
					trx,
				);
			} else {
				workflow = await this.prepareBaseChatWorkflow(
					user,
					sessionId,
					credentials,
					model,
					history,
					message,
					undefined,
					trx,
				);
			}

			return {
				workflow,
				previousMessageId: lastHumanMessage.id,
				retryOfMessageId,
			};
		});

		await this.executeChatWorkflowWithCleanup(
			res,
			user,
			workflowData,
			executionData,
			sessionId,
			previousMessageId,
			selectedModel,
			provider,
			retryOfMessageId,
		);
	}

	private async prepareBaseChatWorkflow(
		user: User,
		sessionId: ChatSessionId,
		credentials: INodeCredentials,
		model: ChatHubBaseLLMModel,
		history: ChatHubMessage[],
		message: string,
		systemMessage: string | undefined,
		trx: EntityManager,
	) {
		const credential = await this.chatHubCredentialsService.ensureCredentials(
			user,
			model.provider,
			credentials,
			trx,
		);

		return await this.chatHubWorkflowService.createChatWorkflow(
			user.id,
			sessionId,
			credential.projectId,
			history,
			message,
			credentials,
			model,
			systemMessage,
			trx,
		);
	}

	private async prepareChatAgentWorkflow(
		agentId: string,
		user: User,
		sessionId: ChatSessionId,
		history: ChatHubMessage[],
		message: string,
		trx: EntityManager,
	) {
		const agent = await this.chatHubAgentService.getAgentById(agentId, user.id);

		if (!agent) {
			throw new BadRequestError('Agent not found');
		}

		if (!agent.provider || !agent.model) {
			throw new BadRequestError('Provider or model not set for agent');
		}

		if (agent.provider === 'n8n' || agent.provider === 'custom-agent') {
			throw new BadRequestError('Invalid provider');
		}

		const credentialId = agent.credentialId;
		if (!credentialId) {
			throw new BadRequestError('Credentials not set for agent');
		}

		const systemMessage = agent.systemPrompt;

		const model: ChatHubBaseLLMModel = {
			provider: agent.provider,
			model: agent.model,
		};

		const credentials: INodeCredentials = {
			[PROVIDER_CREDENTIAL_TYPE_MAP[agent.provider]]: {
				id: credentialId,
				name: '',
			},
		};

		return await this.prepareBaseChatWorkflow(
			user,
			sessionId,
			credentials,
			model,
			history,
			message,
			systemMessage,
			trx,
		);
	}

	private async prepareCustomAgentWorkflow(
		user: User,
		sessionId: ChatSessionId,
		workflowId: string,
		message: string,
	) {
		const workflowEntity = await this.workflowFinderService.findWorkflowForUser(
			workflowId,
			user,
			['workflow:read'],
			{ includeTags: false, includeParentFolder: false },
		);

		if (!workflowEntity) {
			throw new BadRequestError('Workflow not found');
		}

		const chatTriggers = workflowEntity.nodes.filter(
			(node) => node.type === CHAT_TRIGGER_NODE_TYPE,
		);

		if (chatTriggers.length !== 1) {
			throw new BadRequestError('Workflow must have exactly one chat trigger');
		}

		const chatTriggerNode = chatTriggers[0];

		const chatResponseNodes = workflowEntity.nodes.filter(
			(node) => node.type === RESPOND_TO_CHAT_NODE_TYPE,
		);

		if (chatResponseNodes.length > 0) {
			throw new BadRequestError(
				'Respond to Chat nodes are not supported in custom agent workflows',
			);
		}

		const nodeExecutionStack: IExecuteData[] = [
			{
				node: chatTriggerNode,
				data: {
					main: [
						[
							{
								json: {
									sessionId,
									action: 'sendMessage',
									chatInput: message,
								},
							},
						],
					],
				},
				source: null,
			},
		];

		const executionData: IRunExecutionData = {
			startData: {},
			resultData: {
				runData: {},
			},
			executionData: {
				contextData: {},
				metadata: {},
				nodeExecutionStack,
				waitingExecution: {},
				waitingExecutionSource: {},
			},
			manualData: {
				userId: user.id,
			},
		};

		return {
			workflowData: {
				...workflowEntity,
			},
			executionData,
		};
	}

	private async ensurePreviousMessage(
		previousMessageId: ChatMessageId | null,
		sessionId: string,
		trx?: EntityManager,
	) {
		if (!previousMessageId) {
			return;
		}

		const previousMessage = await this.messageRepository.getOneById(
			previousMessageId,
			sessionId,
			[],
			trx,
		);
		if (!previousMessage) {
			throw new BadRequestError('The previous message does not exist in the session');
		}
	}

	async stopGeneration(user: User, sessionId: ChatSessionId, messageId: ChatMessageId) {
		const session = await this.getChatSession(user, sessionId);
		const message = await this.getChatMessage(session.id, messageId, [
			'execution',
			'execution.workflow',
		]);

		if (message.type !== 'ai') {
			throw new BadRequestError('Can only stop AI messages');
		}

		if (!message.executionId || !message.execution) {
			throw new BadRequestError('Message is not associated with a workflow execution');
		}

		if (message.status !== 'running') {
			throw new BadRequestError('Can only stop messages that are currently running');
		}

		await this.executionService.stop(message.execution.id, [message.execution.workflowId]);
		await this.messageRepository.updateChatMessage(messageId, { status: 'cancelled' });
	}

	private async executeChatWorkflow(
		res: Response,
		user: User,
		workflowData: IWorkflowBase,
		executionData: IRunExecutionData,
		sessionId: ChatSessionId,
		previousMessageId: ChatMessageId,
		selectedModel: ModelWithCredentials,
		retryOfMessageId: ChatMessageId | null = null,
	) {
		this.logger.debug(
			`Starting execution of workflow "${workflowData.name}" with ID ${workflowData.id}`,
		);

		// Capture the streaming response as it's being generated to save
		// partial messages in the database when generation gets cancelled.
		let executionId: string | undefined = undefined;

		const aggregator = createStructuredChunkAggregator(previousMessageId, retryOfMessageId, {
			onBegin: async (message) => {
				await this.saveAIMessage({
					...message,
					sessionId,
					executionId,
					selectedModel,
					retryOfMessageId,
				});
			},
			onItem: (_message, _chunk) => {
				// We could save partial messages to DB here if we wanted to,
				// but they would be very frequent updates.
			},
			onEnd: async (message) => {
				await this.messageRepository.updateChatMessage(message.id, {
					content: message.content,
					status: message.status,
				});
			},
			onError: async (message, _errorText) => {
				await this.messageRepository.manager.transaction(async (trx) => {
					// Always update the content to whatever was generated so far, including the possible error text
					await this.messageRepository.updateChatMessage(
						message.id,
						{
							content: message.content,
						},
						trx,
					);

					// When messages are cancelled they're already marked cancelled on `stopGeneration`
					const savedMessage = await this.messageRepository.getOneById(
						message.id,
						sessionId,
						[],
						trx,
					);
					if (savedMessage?.status === 'cancelled') {
						return;
					}

					// Otherwise mark them as errored
					await this.messageRepository.updateChatMessage(
						message.id,
						{
							status: 'error',
						},
						trx,
					);
				});
			},
		});

		const transform = (text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return text;

			let chunk: StructuredChunk | null = null;
			try {
				chunk = jsonParse<StructuredChunk>(trimmed);
			} catch {
				return text;
			}

			const message = aggregator.ingest(chunk);
			const enriched: EnrichedStructuredChunk = {
				...chunk,
				metadata: {
					...chunk.metadata,
					messageId: message.id,
					previousMessageId: message.previousMessageId,
					retryOfMessageId: message.retryOfMessageId,
				},
			};

			return JSON.stringify(enriched) + '\n';
		};

		const stream = interceptResponseWrites(res, transform);

		stream.on('finish', aggregator.finalizeAll);
		stream.on('close', aggregator.finalizeAll);

		stream.writeHead(200, JSONL_STREAM_HEADERS);
		stream.flushHeaders();

		const execution = await this.workflowExecutionService.executeChatWorkflow(
			workflowData,
			executionData,
			user,
			stream,
			true,
		);

		executionId = execution.executionId;

		if (!executionId) {
			throw new OperationalError('There was a problem starting the chat execution.');
		}

		try {
			// Wait until the execution finishes (or errors) so that we don't delete the workflow too early
			const result = await this.activeExecutions.getPostExecutePromise(executionId);
			if (!result) {
				throw new OperationalError('There was a problem executing the chat workflow.');
			}
		} catch (error: unknown) {
			if (error instanceof ManualExecutionCancelledError) {
				return;
			}

			if (error instanceof Error) {
				this.logger.error(`Error during chat workflow execution: ${error}`);
			}
			throw error;
		}
	}

	private async executeChatWorkflowWithCleanup(
		res: Response,
		user: User,
		workflowData: IWorkflowBase,
		executionData: IRunExecutionData,
		sessionId: ChatSessionId,
		previousMessageId: ChatMessageId,
		selectedModel: ModelWithCredentials,
		provider: ChatHubProvider,
		retryOfMessageId: ChatMessageId | null = null,
	) {
		try {
			await this.executeChatWorkflow(
				res,
				user,
				workflowData,
				executionData,
				sessionId,
				previousMessageId,
				selectedModel,
				retryOfMessageId,
			);
		} finally {
			if (provider !== 'n8n') {
				await this.deleteChatWorkflow(workflowData.id);
			}
		}
	}

	private async generateSessionTitle(
		user: User,
		sessionId: ChatSessionId,
		humanMessage: string,
		credentials: INodeCredentials,
		model: ChatHubConversationModel,
	) {
		const { executionData, workflowData } = await this.prepareTitleGenerationWorkflow(
			user,
			sessionId,
			humanMessage,
			credentials,
			model,
		);

		try {
			const title = await this.runTitleWorkflowAndGetTitle(user, workflowData, executionData);
			if (title) {
				await this.sessionRepository.updateChatTitle(sessionId, title);
			}
		} catch (error: unknown) {
			if (error instanceof Error) {
				this.logger.error(`Error during session title generation workflow execution: ${error}`);
			}
			throw error;
		} finally {
			await this.deleteChatWorkflow(workflowData.id);
		}
	}

	private async prepareTitleGenerationWorkflow(
		user: User,
		sessionId: ChatSessionId,
		humanMessage: string,
		incomingCredentials: INodeCredentials,
		incomingModel: ChatHubConversationModel,
	) {
		return await this.messageRepository.manager.transaction(async (trx) => {
			const { resolvedCredentials, resolvedModel, credential } =
				await this.resolveCredentialsAndModelForTitle(
					user,
					incomingModel,
					incomingCredentials,
					trx,
				);

			if (!credential) {
				throw new BadRequestError('Could not determine credentials for title generation');
			}

			this.logger.debug(
				`Using credential ID ${credential.id} for title generation in project ${credential.projectId}, model ${JSON.stringify(resolvedModel)}`,
			);

			return await this.chatHubWorkflowService.createTitleGenerationWorkflow(
				user.id,
				sessionId,
				credential.projectId,
				humanMessage,
				resolvedCredentials,
				resolvedModel,
				trx,
			);
		});
	}

	private async resolveCredentialsAndModelForTitle(
		user: User,
		model: ChatHubConversationModel,
		credentials: INodeCredentials,
		trx: EntityManager,
	): Promise<{
		resolvedCredentials: INodeCredentials;
		resolvedModel: ChatHubConversationModel;
		credential: CredentialWithProjectId;
	}> {
		if (model.provider === 'n8n') {
			return await this.resolveFromN8nWorkflow(user, model, trx);
		}

		if (model.provider === 'custom-agent') {
			return await this.resolveFromCustomAgent(user, model, trx);
		}

		const credential = await this.chatHubCredentialsService.ensureCredentials(
			user,
			model.provider,
			credentials,
			trx,
		);

		return {
			resolvedCredentials: credentials,
			resolvedModel: model,
			credential,
		};
	}

	private async resolveFromN8nWorkflow(
		user: User,
		model: ChatHubN8nModel,
		trx: EntityManager,
	): Promise<{
		resolvedCredentials: INodeCredentials;
		resolvedModel: ChatHubConversationModel;
		credential: CredentialWithProjectId;
	}> {
		const workflowEntity = await this.workflowFinderService.findWorkflowForUser(
			model.workflowId,
			user,
			['workflow:read'],
			{ includeTags: false, includeParentFolder: false },
		);

		if (!workflowEntity) {
			throw new BadRequestError('Workflow not found for title generation');
		}

		const modelNodes = this.findSupportedLLMNodes(workflowEntity);
		this.logger.debug(
			`Found ${modelNodes.length} LLM nodes in workflow ${workflowEntity.id} for title generation`,
		);

		if (modelNodes.length === 0) {
			throw new BadRequestError('No supported Model nodes found in workflow for title generation');
		}

		const modelNode = modelNodes[0];
		const llmModel = (modelNode.node.parameters?.model as INodeParameters)?.value;
		if (!llmModel) {
			throw new BadRequestError(
				`No model set on Model node "${modelNode.node.name}" for title generation`,
			);
		}

		if (typeof llmModel !== 'string' || llmModel.length === 0 || llmModel.startsWith('=')) {
			throw new BadRequestError(
				`Invalid model set on Model node "${modelNode.node.name}" for title generation`,
			);
		}

		const llmCredentials = modelNode.node.credentials;
		if (!llmCredentials) {
			throw new BadRequestError(
				`No credentials found on Model node "${modelNode.node.name}" for title generation`,
			);
		}

		const credential = await this.chatHubCredentialsService.ensureCredentials(
			user,
			modelNode.provider,
			llmCredentials,
			trx,
		);

		const resolvedModel: ChatHubConversationModel = {
			provider: modelNode.provider,
			model: llmModel,
		};

		const resolvedCredentials: INodeCredentials = {
			[PROVIDER_CREDENTIAL_TYPE_MAP[modelNode.provider]]: {
				id: credential.id,
				name: '',
			},
		};

		return { resolvedCredentials, resolvedModel, credential };
	}

	private findSupportedLLMNodes(workflowEntity: { nodes: INode[]; id: string }) {
		return workflowEntity.nodes.reduce<Array<{ node: INode; provider: ChatHubLLMProvider }>>(
			(acc, node) => {
				const supportedProvider = Object.entries(PROVIDER_NODE_TYPE_MAP).find(
					([_provider, { name }]) => node.type === name,
				);
				if (supportedProvider) {
					const [provider] = supportedProvider;
					acc.push({ node, provider: provider as ChatHubLLMProvider });
				}
				return acc;
			},
			[],
		);
	}

	private async resolveFromCustomAgent(
		user: User,
		model: ChatHubCustomAgentModel,
		trx: EntityManager,
	): Promise<{
		resolvedCredentials: INodeCredentials;
		resolvedModel: ChatHubConversationModel;
		credential: CredentialWithProjectId;
	}> {
		const agent = await this.chatHubAgentService.getAgentById(model.agentId, user.id);
		if (!agent) {
			throw new BadRequestError('Agent not found for title generation');
		}

		if (agent.provider === 'n8n' || agent.provider === 'custom-agent') {
			throw new BadRequestError('Invalid provider for title generation');
		}

		const credentialId = agent.credentialId;
		if (!credentialId) {
			throw new BadRequestError('Credentials not set for agent');
		}

		const resolvedModel: ChatHubConversationModel = {
			provider: agent.provider,
			model: agent.model,
		};

		const resolvedCredentials: INodeCredentials = {
			[PROVIDER_CREDENTIAL_TYPE_MAP[agent.provider]]: {
				id: credentialId,
				name: '',
			},
		};

		const credential = await this.chatHubCredentialsService.ensureCredentials(
			user,
			agent.provider,
			resolvedCredentials,
			trx,
		);

		return { resolvedCredentials, resolvedModel, credential };
	}

	private async runTitleWorkflowAndGetTitle(
		user: User,
		workflowData: IWorkflowBase,
		executionData: IRunExecutionData,
	): Promise<string | null> {
		const started = await this.workflowExecutionService.executeChatWorkflow(
			workflowData,
			executionData,
			user,
		);

		const executionId = started.executionId;
		if (!executionId) {
			throw new OperationalError('There was a problem starting the chat execution.');
		}

		let run: IRun | undefined;
		try {
			run = await this.activeExecutions.getPostExecutePromise(executionId);
			if (!run) {
				throw new OperationalError('There was a problem executing the chat workflow.');
			}
		} catch (error: unknown) {
			if (error instanceof ManualExecutionCancelledError) {
				return null;
			}
			throw error;
		}

		const execution = await this.executionRepository.findWithUnflattenedData(executionId, [
			workflowData.id,
		]);
		if (!execution) {
			throw new OperationalError(`Could not find execution with ID ${executionId}`);
		}

		if (!execution.status || execution.status !== 'success') {
			const message = this.getErrorMessage(execution) ?? 'Failed to generate a response';
			throw new OperationalError(message);
		}

		const title = this.getAIOutput(execution, NODE_NAMES.TITLE_GENERATOR_AGENT);
		return title ?? null;
	}

	private async saveHumanMessage(
		payload: HumanMessagePayload | EditMessagePayload,
		user: User,
		previousMessageId: ChatMessageId | null,
		selectedModel: ModelWithCredentials,
		revisionOfMessageId?: ChatMessageId,
		trx?: EntityManager,
	) {
		await this.messageRepository.createChatMessage(
			{
				id: payload.messageId,
				sessionId: payload.sessionId,
				type: 'human',
				status: 'success',
				content: payload.message,
				previousMessageId,
				revisionOfMessageId,
				...selectedModel,
				name: user.firstName || 'User',
			},
			trx,
		);
	}

	private async saveAIMessage({
		id,
		sessionId,
		executionId,
		previousMessageId,
		content,
		selectedModel,
		retryOfMessageId,
		status,
	}: {
		id: ChatMessageId;
		sessionId: ChatSessionId;
		previousMessageId: ChatMessageId | null;
		content: string;
		selectedModel: ModelWithCredentials;
		executionId?: string;
		retryOfMessageId: ChatMessageId | null;
		editOfMessageId?: ChatMessageId;
		status?: ChatHubMessageStatus;
	}) {
		await this.messageRepository.createChatMessage({
			id,
			sessionId,
			previousMessageId,
			executionId: executionId ? parseInt(executionId, 10) : null,
			type: 'ai',
			name: 'AI',
			status,
			content,
			retryOfMessageId,
			...selectedModel,
		});
	}

	private getModelWithCredentials(
		selectedModel: ChatHubConversationModel,
		credentials: INodeCredentials,
	) {
		const provider = selectedModel.provider;

		const modelWithCredentials: ModelWithCredentials = {
			...selectedModel,
			credentialId: provider !== 'n8n' ? this.pickCredentialId(provider, credentials) : null,
		};

		return modelWithCredentials;
	}

	private async getChatSession(
		user: User,
		sessionId: ChatSessionId,
		selectedModel?: ModelWithCredentials,
		initialize: boolean = false,
		trx?: EntityManager,
	) {
		const existing = await this.sessionRepository.getOneById(sessionId, user.id, trx);
		if (existing) {
			return existing;
		} else if (!initialize) {
			throw new NotFoundError('Chat session not found');
		}

		let agentName: string | undefined = undefined;

		if (selectedModel?.provider === 'custom-agent') {
			// Find the agent to get its name
			const agent = await this.chatHubAgentService.getAgentById(selectedModel.agentId!, user.id);
			if (!agent) {
				throw new BadRequestError('Agent not found for chat session initialization');
			}
			agentName = agent.name;
		}

		if (selectedModel?.provider === 'n8n') {
			// Find the workflow to get its name
			const workflow = await this.workflowFinderService.findWorkflowForUser(
				selectedModel.workflowId!,
				user,
				['workflow:read'],
				{ includeTags: false, includeParentFolder: false },
			);

			if (!workflow) {
				throw new BadRequestError('Workflow not found for chat session initialization');
			}

			const chatTrigger = workflow.nodes?.find((node) => node.type === CHAT_TRIGGER_NODE_TYPE);
			if (!chatTrigger) {
				throw new BadRequestError(
					'Chat trigger not found in workflow for chat session initialization',
				);
			}
			agentName =
				typeof chatTrigger.parameters.agentName === 'string' &&
				chatTrigger.parameters.agentName.length > 0
					? chatTrigger.parameters.agentName
					: workflow.name;
		}

		return await this.sessionRepository.createChatSession(
			{
				id: sessionId,
				ownerId: user.id,
				title: 'New Chat',
				agentName,
				...selectedModel,
			},
			trx,
		);
	}

	private async getChatMessage(
		sessionId: ChatSessionId,
		messageId: ChatMessageId,
		relations: string[] = [],
		trx?: EntityManager,
	) {
		const message = await this.messageRepository.getOneById(messageId, sessionId, relations, trx);
		if (!message) {
			throw new NotFoundError('Chat message not found');
		}
		return message;
	}

	/**
	 * Get all conversations for a user
	 */
	async getConversations(userId: string): Promise<ChatHubConversationsResponse> {
		const sessions = await this.sessionRepository.getManyByUserId(userId);

		return sessions.map((session) => ({
			id: session.id,
			title: session.title,
			ownerId: session.ownerId,
			lastMessageAt: session.lastMessageAt?.toISOString() ?? null,
			credentialId: session.credentialId,
			provider: session.provider,
			model: session.model,
			workflowId: session.workflowId,
			agentId: session.agentId,
			agentName: session.agentName,
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
		}));
	}

	/**
	 * Get a single conversation with messages and ready to render timeline of latest messages
	 * */
	async getConversation(userId: string, sessionId: string): Promise<ChatHubConversationResponse> {
		const session = await this.sessionRepository.getOneById(sessionId, userId);
		if (!session) {
			throw new NotFoundError('Chat session not found');
		}

		const messages = await this.messageRepository.getManyBySessionId(sessionId);

		return {
			session: {
				id: session.id,
				title: session.title,
				ownerId: session.ownerId,
				lastMessageAt: session.lastMessageAt?.toISOString() ?? null,
				credentialId: session.credentialId,
				provider: session.provider,
				model: session.model,
				workflowId: session.workflowId,
				agentId: session.agentId,
				agentName: session.agentName,
				createdAt: session.createdAt.toISOString(),
				updatedAt: session.updatedAt.toISOString(),
			},
			conversation: {
				messages: Object.fromEntries(messages.map((m) => [m.id, this.convertMessageToDto(m)])),
			},
		};
	}

	private convertMessageToDto(message: ChatHubMessage): ChatHubMessageDto {
		return {
			id: message.id,
			sessionId: message.sessionId,
			type: message.type,
			name: message.name,
			content: message.content,
			provider: message.provider,
			model: message.model,
			workflowId: message.workflowId,
			agentId: message.agentId,
			executionId: message.executionId,
			status: message.status,
			createdAt: message.createdAt.toISOString(),
			updatedAt: message.updatedAt.toISOString(),

			previousMessageId: message.previousMessageId,
			retryOfMessageId: message.retryOfMessageId,
			revisionOfMessageId: message.revisionOfMessageId,
		};
	}

	/**
	 * Build the message history chain ending to the message with ID `lastMessageId`
	 */
	private buildMessageHistory(
		messages: Record<ChatMessageId, ChatHubMessage>,
		lastMessageId: ChatMessageId | null,
	) {
		if (!lastMessageId) return [];

		const visited = new Set<string>();
		const historyIds = [];

		let current: ChatMessageId | null = lastMessageId;

		while (current && !visited.has(current)) {
			historyIds.unshift(current);
			visited.add(current);
			current = messages[current]?.previousMessageId ?? null;
		}

		const history = historyIds.flatMap((id) => messages[id] ?? []);
		return history;
	}

	async deleteAllSessions() {
		const result = await this.sessionRepository.deleteAll();
		return result;
	}

	/**
	 * Updates the title of a session
	 */
	async updateSessionTitle(userId: string, sessionId: ChatSessionId, title: string) {
		const session = await this.sessionRepository.getOneById(sessionId, userId);

		if (!session) {
			throw new NotFoundError('Session not found');
		}

		return await this.sessionRepository.updateChatTitle(sessionId, title);
	}

	/**
	 * Updates a session with the provided fields
	 */
	async updateSession(
		user: User,
		sessionId: ChatSessionId,
		updates: {
			title?: string;
			credentialId?: string | null;
			provider?: ChatHubProvider;
			model?: string | null;
			workflowId?: string | null;
			agentId?: string | null;
			agentName?: string | null;
		},
	) {
		const session = await this.sessionRepository.getOneById(sessionId, user.id);

		if (!session) {
			throw new NotFoundError('Session not found');
		}

		if (updates.workflowId) {
			// Validate the workflow exists and is accessible
			const workflow = await this.workflowFinderService.findWorkflowForUser(
				updates.workflowId,
				user,
				['workflow:read'],
				{ includeTags: false, includeParentFolder: false },
			);

			if (!workflow) {
				throw new BadRequestError('Workflow not found');
			}

			const chatTriggers = workflow.nodes.filter((node) => node.type === CHAT_TRIGGER_NODE_TYPE);

			if (chatTriggers.length !== 1) {
				throw new BadRequestError('Workflow must have exactly one chat trigger');
			}

			const chatTrigger = chatTriggers[0];

			updates.agentName =
				typeof chatTrigger.parameters.agentName === 'string' &&
				chatTrigger.parameters.agentName.length > 0
					? chatTrigger.parameters.agentName
					: workflow.name;
		}

		if (updates.agentId) {
			// Validate the agent exists and is accessible
			const agent = await this.chatHubAgentService.getAgentById(updates.agentId, user.id);

			if (!agent) {
				throw new BadRequestError('Agent not found');
			}

			updates.agentName = agent.name;
		}

		if (updates.provider === 'n8n') {
			// n8n provider only stores workflowId
			updates.model = null;
			updates.credentialId = null;
			updates.agentId = null;
		} else if (updates.provider === 'custom-agent') {
			// custom-agent provider only stores agentId & Agent name
			updates.model = null;
			updates.credentialId = null;
			updates.workflowId = null;
		} else if (updates.provider) {
			updates.workflowId = null;
			updates.agentId = null;
			updates.agentName = null;
		}

		return await this.sessionRepository.updateChatSession(sessionId, updates);
	}

	/**
	 * Deletes a session
	 */
	async deleteSession(userId: string, sessionId: ChatSessionId) {
		const session = await this.sessionRepository.getOneById(sessionId, userId);

		if (!session) {
			throw new NotFoundError('Session not found');
		}

		await this.sessionRepository.deleteChatHubSession(sessionId);
	}
}
