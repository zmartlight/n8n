import type { User } from '@n8n/db';
import type { IWorkflowBase } from 'n8n-workflow';
import { UserError } from 'n8n-workflow';

import * as WorkflowExecuteAdditionalData from '@/workflow-execute-additional-data';
import type { TestWebhooks } from '@/webhooks/test-webhooks';

export const MANUAL_EXECUTION_ERROR_MESSAGE =
	'This workflow requires waiting for an external trigger (for example a webhook) before it can run. Manual execution via MCP is not possible.';

export async function assertManualExecutable({
	user,
	workflow,
	testWebhooks,
}: {
	user: User;
	workflow: IWorkflowBase;
	testWebhooks: TestWebhooks;
}) {
	const additionalData = await WorkflowExecuteAdditionalData.getBase(user.id);

	const needsWebhook = await testWebhooks.needsWebhook({
		userId: user.id,
		workflowEntity: workflow,
		additionalData,
	});

	if (needsWebhook) {
		throw new UserError(MANUAL_EXECUTION_ERROR_MESSAGE);
	}
}
