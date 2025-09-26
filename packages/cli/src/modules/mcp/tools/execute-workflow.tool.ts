import type { User } from '@n8n/db';
import { UserError } from 'n8n-workflow';
import z from 'zod';

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
} satisfies z.ZodRawShape;

export const createExecuteWorkflowTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowExecutionService: WorkflowExecutionService,
	testWebhooks: TestWebhooks,
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

		const payload = {
			success: executionResponse.waitingForWebhook !== true,
			executionId: executionResponse.executionId ?? null,
			waitingForWebhook: executionResponse.waitingForWebhook,
		};

		return {
			content: [{ type: 'text', text: JSON.stringify(payload) }],
			structuredContent: payload,
		};
	},
});
