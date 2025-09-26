import type { User } from '@n8n/db';
import { UserError } from 'n8n-workflow';
import z from 'zod';

import type { ToolDefinition } from '../mcp.types';
import { assertManualExecutable } from './manual-execution.utils';

import type { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowRequest } from '@/workflows/workflow.request';
import type { TestWebhooks } from '@/webhooks/test-webhooks';

const inputSchema = {
	workflowId: z.string().describe('The ID of the workflow to execute'),
} satisfies z.ZodRawShape;

const outputSchema = {
	success: z.boolean(),
	executionId: z.string().nullable().optional(),
	waitingForWebhook: z.boolean().optional(),
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

		await assertManualExecutable({ user, workflow, testWebhooks });

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
