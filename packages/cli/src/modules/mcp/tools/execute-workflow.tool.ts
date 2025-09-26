import type { ExecutionRepository, IExecutionResponse, User } from '@n8n/db';
import { UserError } from 'n8n-workflow';
import type { IRun } from 'n8n-workflow';
import z from 'zod';

import type { ActiveExecutions } from '@/active-executions';
import { ExecutionNotFoundError } from '@/errors/execution-not-found-error';
import type { TestWebhooks } from '@/webhooks/test-webhooks';
import type { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowRequest } from '@/workflows/workflow.request';

import type { ToolDefinition } from '../mcp.types';
import { isManuallyExecutable } from './manual-execution.utils';

// TODO: Move to constants
const MANUAL_EXECUTION_ERROR_MESSAGE =
	'This workflow requires waiting for an external trigger (for example a webhook) before it can run. Manual execution via MCP is not possible.';

const inputSchema = {
	workflowId: z.string().describe('The ID of the workflow to execute'),
} satisfies z.ZodRawShape;

const outputSchema = {
	success: z.boolean(),
	executionId: z.string().nullable().optional(),
	waitingForWebhook: z.boolean().optional(),
	message: z.string().optional(),
	result: z
		.object({
			id: z.string().optional(),
			status: z.string(),
			finished: z.boolean(),
			mode: z.string(),
			startedAt: z.string(),
			stoppedAt: z.string().nullable(),
			waitTill: z.string().nullable(),
			data: z.unknown(),
			error: z.unknown().nullable().optional(),
		})
		.nullable()
		.optional(),
	error: z.unknown().optional(),
} satisfies z.ZodRawShape;

export const createExecuteWorkflowTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowExecutionService: WorkflowExecutionService,
	testWebhooks: TestWebhooks,
	activeExecutions: ActiveExecutions,
	executionRepository: ExecutionRepository,
): ToolDefinition<typeof inputSchema> => ({
	name: 'execute_workflow',
	config: {
		description: 'Execute a workflow by id',
		inputSchema,
		outputSchema,
	},
	handler: async ({ workflowId }) => {
		const workflow = await workflowFinderService.findWorkflowForUser(workflowId, user, [
			'workflow:read',
		]);

		if (!workflow || workflow.isArchived || !workflow.settings?.availableInMCP) {
			throw new UserError('Workflow not found');
		}

		const canManuallyExecute = await isManuallyExecutable({ user, workflow, testWebhooks });

		// TODO: Refactor
		if (!canManuallyExecute) {
			const content = {
				success: false,
				waitingForWebhook: true,
				message: MANUAL_EXECUTION_ERROR_MESSAGE,
			};
			return {
				content: [{ type: 'text', text: JSON.stringify(content) }],
				structuredContent: content,
			};
		}

		const manualRunPayload: WorkflowRequest.ManualRunPayload = {
			workflowData: workflow,
		};

		const executionResponse = await workflowExecutionService.executeManually(
			manualRunPayload,
			user,
			undefined,
		);

		if (executionResponse.waitingForWebhook) {
			const payload = {
				success: false,
				executionId: executionResponse.executionId ?? null,
				waitingForWebhook: true,
				message: MANUAL_EXECUTION_ERROR_MESSAGE,
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		const executionId = executionResponse.executionId ?? null;

		if (!executionId) {
			const payload = {
				success: false,
				executionId: null,
				message: 'Failed to start execution: no execution ID returned.',
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		const waitForExecutionResult = async (): Promise<IRun | IExecutionResponse | null> => {
			try {
				return (await activeExecutions.getPostExecutePromise(executionId)) ?? null;
			} catch (error) {
				if (error instanceof ExecutionNotFoundError) {
					const execution = await executionRepository.findSingleExecution(executionId, {
						includeData: true,
						unflattenData: true,
					});
					return execution ?? null;
				}
				throw error;
			}
		};

		const toIsoString = (value?: Date | string | null): string | null => {
			if (!value) return null;
			if (value instanceof Date) return value.toISOString();
			return new Date(value).toISOString();
		};

		const serializeError = (error: unknown) => {
			if (error instanceof Error) {
				return {
					name: error.name,
					message: error.message,
					stack: error.stack,
				};
			}
			return error;
		};

		const serializeExecution = (
			execution: IRun | IExecutionResponse | null,
		): {
			id?: string;
			status: string;
			finished: boolean;
			mode: string;
			startedAt: string;
			stoppedAt: string | null;
			waitTill: string | null;
			data: unknown;
			error: unknown;
		} | null => {
			if (!execution) return null;

			const toFinished = (): boolean => {
				if ('finished' in execution && execution.finished !== undefined) {
					return execution.finished;
				}
				return execution.status === 'success';
			};

			const error = execution.data?.resultData?.error ?? null;

			return {
				id: 'id' in execution ? execution.id : undefined,
				status: execution.status,
				finished: toFinished(),
				mode: execution.mode,
				startedAt: toIsoString(execution.startedAt) ?? new Date().toISOString(),
				stoppedAt: toIsoString(execution.stoppedAt ?? null),
				waitTill: toIsoString(execution.waitTill ?? null),
				data: execution.data,
				error,
			};
		};

		let executionResult: ReturnType<typeof serializeExecution>;
		try {
			executionResult = serializeExecution(await waitForExecutionResult());
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed while waiting for manual execution to finish.';

			const payload = {
				success: false,
				executionId,
				message,
				error: serializeError(error),
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		// TODO: Derive this from outputSchema
		const payload: {
			success: boolean;
			executionId: string;
			result: ReturnType<typeof serializeExecution>;
			error?: unknown;
			message?: string;
		} = {
			success: executionResult?.status === 'success',
			executionId,
			result: executionResult,
			error: executionResult?.error ?? undefined,
		};

		if (!executionResult) {
			payload.success = false;
			Object.assign(payload, {
				message: 'Execution finished but result could not be retrieved.',
			});
		}

		if (executionResult?.error && typeof executionResult.error === 'object') {
			const errorWithMessage = executionResult.error as { message?: string };
			payload.message = errorWithMessage.message ?? 'Execution finished with an error.';
		}

		return {
			content: [{ type: 'text', text: JSON.stringify(payload) }],
			structuredContent: payload,
		};
	},
});
