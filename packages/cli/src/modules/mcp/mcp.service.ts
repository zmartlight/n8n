import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { User } from '@n8n/db';
import { Service } from '@n8n/di';

import { createWorkflowDetailsTool } from './tools/get-workflow-details.tool';
import { createExecuteWorkflowTool } from './tools/execute-workflow.tool';
import { createSearchWorkflowsTool } from './tools/search-workflows.tool';

import { CredentialsService } from '@/credentials/credentials.service';
import { UrlService } from '@/services/url.service';
import { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import { WorkflowService } from '@/workflows/workflow.service';
import { TestWebhooks } from '@/webhooks/test-webhooks';

@Service()
export class McpService {
	constructor(
		private readonly workflowFinderService: WorkflowFinderService,
		private readonly workflowService: WorkflowService,
		private readonly urlService: UrlService,
		private readonly credentialsService: CredentialsService,
		private readonly workflowExecutionService: WorkflowExecutionService,
		private readonly testWebhooks: TestWebhooks,
	) {}

	getServer(user: User) {
		const server = new McpServer({
			name: 'n8n MCP Server',
			version: '1.0.0',
		});

		const workflowSearchTool = createSearchWorkflowsTool(user, this.workflowService);
		server.registerTool(
			workflowSearchTool.name,
			workflowSearchTool.config,
			workflowSearchTool.handler,
		);

		const executeWorkflowTool = createExecuteWorkflowTool(
			user,
			this.workflowFinderService,
			this.workflowExecutionService,
			this.testWebhooks,
		);
		server.registerTool(
			executeWorkflowTool.name,
			executeWorkflowTool.config,
			executeWorkflowTool.handler,
		);

		const workflowDetailsTool = createWorkflowDetailsTool(
			user,
			this.urlService.getWebhookBaseUrl(),
			this.workflowFinderService,
			this.credentialsService,
		);
		server.registerTool(
			workflowDetailsTool.name,
			workflowDetailsTool.config,
			workflowDetailsTool.handler,
		);

		return server;
	}
}
