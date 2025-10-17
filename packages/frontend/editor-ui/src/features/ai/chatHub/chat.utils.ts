import {
	chatHubProviderSchema,
	type ChatHubConversationModel,
	type ChatModelsResponse,
	type ChatHubSessionDto,
	type ChatMessageId,
} from '@n8n/api-types';
import type { ChatMessage, GroupedConversations, GroupedMessages } from './chat.types';

export function findOneFromModelsResponse(
	response: ChatModelsResponse,
): ChatHubConversationModel | undefined {
	for (const provider of chatHubProviderSchema.options) {
		if (response[provider].models.length > 0) {
			return { model: response[provider].models[0].name, provider, workflowId: null };
		}
	}

	return undefined;
}

export function getRelativeDate(now: Date, dateString: string | null): string {
	const date = dateString ? new Date(dateString) : now;
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(today);
	lastWeek.setDate(lastWeek.getDate() - 7);

	const conversationDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

	if (conversationDate.getTime() === today.getTime()) {
		return 'Today';
	} else if (conversationDate.getTime() === yesterday.getTime()) {
		return 'Yesterday';
	} else if (conversationDate >= lastWeek) {
		return 'This week';
	} else {
		return 'Older';
	}
}

export function groupConversationsByDate(sessions: ChatHubSessionDto[]): GroupedConversations[] {
	const now = new Date();
	const groups = new Map<string, ChatHubSessionDto[]>();

	// Group sessions by relative date
	for (const session of sessions) {
		const group = getRelativeDate(now, session.lastMessageAt);

		if (!groups.has(group)) {
			groups.set(group, []);
		}

		groups.get(group)!.push(session);
	}

	// Define order for groups
	const groupOrder = ['Today', 'Yesterday', 'This week', 'Older'];

	return groupOrder.flatMap((groupName) => {
		const sessions = groups.get(groupName) ?? [];

		return sessions.length > 0
			? [
					{
						group: groupName,
						sessions: sessions.sort(
							(a, b) =>
								(b.lastMessageAt ? Date.parse(b.lastMessageAt) : +now) -
								(a.lastMessageAt ? Date.parse(a.lastMessageAt) : +now),
						),
					},
				]
			: [];
	});
}

export function computeActiveChain(
	messages: Record<ChatMessageId, ChatMessage>,
	responsesByMessageId: GroupedMessages,
	messageId: ChatMessageId | null,
) {
	const chain: ChatMessage[] = [];
	const messageList = Object.values(messages);

	const navigateFrom =
		messageId && messages[messageId]
			? messageId
			: messageList
					.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) // TODO: Do we need 'state' column at all?
					.pop()?.id;

	if (!navigateFrom) {
		return chain;
	}

	let id: ChatMessageId | undefined;

	// Find the most recent descendant message starting from `navigateFrom`...
	const stack = [navigateFrom];
	let latest: ChatMessageId | null = null;

	while ((id = stack.pop())) {
		const message = messages[id];

		if (!latest || message.createdAt > messages[latest].createdAt) {
			latest = id;
		}

		for (const responseId of responsesByMessageId.get(id) ?? []) {
			stack.push(responseId);
		}
	}

	if (!latest) {
		return chain;
	}

	// ...and then walk back to the root following previousMessageId links
	let current: ChatMessageId | null = latest;
	const visited = new Set<ChatMessageId>();

	while (current && !visited.has(current)) {
		const m: ChatMessage | undefined = messages[current];

		if (m) {
			chain.unshift(m);
			visited.add(current);
			current = m.previousMessageId ?? null;
		}
	}

	return chain;
}

function sortByRunThenTime(a: ChatMessage, b: ChatMessage) {
	// TODO: Disabled for now, messages retried don't get this at the FE before reload
	// TODO: Do we even need runIndex at all?
	// if (a.runIndex !== b.runIndex) {
	// 	return a.runIndex - b.runIndex;
	// }

	if (a.createdAt !== b.createdAt) {
		return a.createdAt < b.createdAt ? -1 : 1;
	}

	return a.id < b.id ? -1 : 1;
}

export function computeMessagesByPreviousId(
	messages: Partial<Record<ChatMessageId, ChatMessage>>,
): GroupedMessages {
	const computeMessagesByPreviousId = new Map<ChatMessageId | null, ChatMessageId[]>();

	for (const message of Object.values(messages)) {
		if (message) {
			const key = message?.previousMessageId ?? null;

			const entry = computeMessagesByPreviousId.get(key) ?? [];

			entry.push(message.id);

			computeMessagesByPreviousId.set(key, entry);
		}
	}

	// Sort all arrays by runIndex and createdAt
	for (const [key, messageIds] of computeMessagesByPreviousId) {
		computeMessagesByPreviousId.set(
			key,
			messageIds
				.map((id) => messages[id]!)
				.sort(sortByRunThenTime)
				.map((m) => m.id),
		);
	}

	return computeMessagesByPreviousId;
}
