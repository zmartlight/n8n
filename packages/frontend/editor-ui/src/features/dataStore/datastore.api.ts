// import { makeRestApiRequest } from '@n8n/rest-api-client';
import type { IRestApiContext } from '@n8n/rest-api-client';

import type { DataStoreMetadata, DataStoreEntity } from '@/features/dataStore/datastore.types';

// Personal project id
const PERSONAL_PROJECT_ID = '4KJl0T0erg4DwK70';
// This can be any other project id
const TEST_PROJECT_ID = 'NWBl77TREaNzOhJ2';

export const MOCKED_DATASTORES: DataStoreEntity[] = [
	{
		id: '1',
		name: 'Users',
		size: 1024,
		recordCount: 96,
		columnCount: 9,
		createdAt: '2025-07-07T00:00:00Z',
		updatedAt: '2025-07-17T00:00:00Z',
		projectId: PERSONAL_PROJECT_ID,
	},
	{
		id: '2',
		name: 'Assistant Evaluation',
		size: 2048,
		recordCount: 245,
		columnCount: 17,
		createdAt: '2023-01-01T00:00:00Z',
		updatedAt: '2025-07-07T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '3',
		name: 'Product Catalog',
		size: 4096,
		recordCount: 512,
		columnCount: 12,
		createdAt: '2024-03-15T00:00:00Z',
		updatedAt: '2025-07-20T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '4',
		name: 'Customer Orders',
		size: 8192,
		recordCount: 1024,
		columnCount: 15,
		createdAt: '2024-01-10T00:00:00Z',
		updatedAt: '2025-07-22T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '5',
		name: 'Analytics Events',
		size: 16384,
		recordCount: 2048,
		columnCount: 20,
		createdAt: '2024-02-20T00:00:00Z',
		updatedAt: '2025-07-24T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '6',
		name: 'User Preferences',
		size: 512,
		recordCount: 128,
		columnCount: 6,
		createdAt: '2024-05-01T00:00:00Z',
		updatedAt: '2025-07-18T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '7',
		name: 'Inventory Tracking',
		size: 3072,
		recordCount: 384,
		columnCount: 10,
		createdAt: '2024-04-12T00:00:00Z',
		updatedAt: '2025-07-21T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '8',
		name: 'Support Tickets',
		size: 1536,
		recordCount: 192,
		columnCount: 14,
		createdAt: '2024-06-05T00:00:00Z',
		updatedAt: '2025-07-23T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '9',
		name: 'Marketing Campaigns',
		size: 2560,
		recordCount: 320,
		columnCount: 11,
		createdAt: '2024-03-08T00:00:00Z',
		updatedAt: '2025-07-19T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '10',
		name: 'Financial Transactions',
		size: 12288,
		recordCount: 1536,
		columnCount: 18,
		createdAt: '2024-01-15T00:00:00Z',
		updatedAt: '2025-07-24T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '11',
		name: 'Employee Directory',
		size: 768,
		recordCount: 96,
		columnCount: 9,
		createdAt: '2024-07-01T00:00:00Z',
		updatedAt: '2025-07-22T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
	{
		id: '12',
		name: 'Project Milestones',
		size: 1280,
		recordCount: 160,
		columnCount: 7,
		createdAt: '2024-02-28T00:00:00Z',
		updatedAt: '2025-07-20T00:00:00Z',
		projectId: TEST_PROJECT_ID,
	},
];

export const MOCKED_USERS_STORE: DataStoreMetadata = {
	id: '1',
	name: 'Users',
	size: 1024,
	recordCount: 96,
	columnCount: 8,
	createdAt: '2025-07-07T00:00:00Z',
	updatedAt: '2025-07-17T00:00:00Z',
	projectId: PERSONAL_PROJECT_ID,
	columns: [
		{
			name: 'id',
			displayName: 'ID',
			type: 'string',
			editable: false,
			unique: true,
			nullable: false,
		},
		{
			name: 'name',
			displayName: 'Name',
			type: 'string',
			editable: true,
			unique: false,
			nullable: false,
		},
		{
			name: 'email',
			displayName: 'Email',
			type: 'string',
			editable: true,
			unique: true,
			nullable: false,
		},
		{
			name: 'createdAt',
			displayName: 'Created At',
			type: 'date',
			editable: true,
			unique: false,
			nullable: false,
		},
		{
			name: 'isActive',
			displayName: 'Is Active',
			type: 'boolean',
			editable: true,
			unique: false,
			nullable: false,
		},
		{
			name: 'age',
			displayName: 'Age',
			type: 'number',
			editable: true,
			unique: false,
			nullable: true,
		},
	],
	content: {
		totalRows: 25,
		rows: [
			{
				id: 'user_001',
				name: 'Alice Johnson',
				email: 'alice.johnson@email.com',
				createdAt: '2024-01-15T08:30:00Z',
				isActive: true,
				age: 28,
			},
			{
				id: 'user_002',
				name: 'Bob Smith',
				email: 'bob.smith@email.com',
				createdAt: '2024-01-16T09:15:00Z',
				isActive: true,
				age: 34,
			},
			{
				id: 'user_003',
				name: 'Carol Davis',
				email: 'carol.davis@email.com',
				createdAt: '2024-01-17T10:45:00Z',
				isActive: false,
				age: 42,
			},
			{
				id: 'user_004',
				name: 'David Wilson',
				email: 'david.wilson@email.com',
				createdAt: '2024-01-18T11:20:00Z',
				isActive: true,
				age: 31,
			},
			{
				id: 'user_005',
				name: 'Emma Brown',
				email: 'emma.brown@email.com',
				createdAt: '2024-01-19T12:00:00Z',
				isActive: true,
				age: 26,
			},
			{
				id: 'user_006',
				name: 'Frank Miller',
				email: 'frank.miller@email.com',
				createdAt: '2024-01-20T13:30:00Z',
				isActive: false,
				age: 45,
			},
			{
				id: 'user_007',
				name: 'Grace Lee',
				email: 'grace.lee@email.com',
				createdAt: '2024-01-21T14:15:00Z',
				isActive: true,
				age: 29,
			},
			{
				id: 'user_008',
				name: 'Henry Taylor',
				email: 'henry.taylor@email.com',
				createdAt: '2024-01-22T15:45:00Z',
				isActive: true,
				age: 37,
			},
			{
				id: 'user_009',
				name: 'Ivy Chen',
				email: 'ivy.chen@email.com',
				createdAt: '2024-01-23T16:20:00Z',
				isActive: false,
				age: 33,
			},
			{
				id: 'user_010',
				name: 'Jack Anderson',
				email: 'jack.anderson@email.com',
				createdAt: '2024-01-24T17:00:00Z',
				isActive: true,
				age: 40,
			},
			{
				id: 'user_011',
				name: 'Karen White',
				email: 'karen.white@email.com',
				createdAt: '2024-01-25T08:45:00Z',
				isActive: true,
				age: 35,
			},
			{
				id: 'user_012',
				name: 'Liam Garcia',
				email: 'liam.garcia@email.com',
				createdAt: '2024-01-26T09:30:00Z',
				isActive: false,
				age: 27,
			},
			{
				id: 'user_013',
				name: 'Maya Patel',
				email: 'maya.patel@email.com',
				createdAt: '2024-01-27T10:15:00Z',
				isActive: true,
				age: 32,
			},
			{
				id: 'user_014',
				name: 'Noah Thompson',
				email: 'noah.thompson@email.com',
				createdAt: '2024-01-28T11:00:00Z',
				isActive: true,
				age: 30,
			},
			{
				id: 'user_015',
				name: 'Olivia Martinez',
				email: 'olivia.martinez@email.com',
				createdAt: '2024-01-29T12:30:00Z',
				isActive: false,
				age: 38,
			},
			{
				id: 'user_016',
				name: 'Paul Rodriguez',
				email: 'paul.rodriguez@email.com',
				createdAt: '2024-01-30T13:15:00Z',
				isActive: true,
				age: 41,
			},
			{
				id: 'user_017',
				name: 'Quinn Murphy',
				email: 'quinn.murphy@email.com',
				createdAt: '2024-01-31T14:00:00Z',
				isActive: true,
				age: 25,
			},
			{
				id: 'user_018',
				name: 'Rachel Cooper',
				email: 'rachel.cooper@email.com',
				createdAt: '2024-02-01T15:20:00Z',
				isActive: false,
				age: 36,
			},
			{
				id: 'user_019',
				name: 'Sam Kim',
				email: 'sam.kim@email.com',
				createdAt: '2024-02-02T16:10:00Z',
				isActive: true,
				age: 43,
			},
			{
				id: 'user_020',
				name: 'Tina Walsh',
				email: 'tina.walsh@email.com',
				createdAt: '2024-02-03T17:30:00Z',
				isActive: true,
				age: 39,
			},
			{
				id: 'user_021',
				name: 'Uma Singh',
				email: 'uma.singh@email.com',
				createdAt: '2024-02-04T08:20:00Z',
				isActive: false,
				age: 44,
			},
			{
				id: 'user_022',
				name: 'Victor James',
				email: 'victor.james@email.com',
				createdAt: '2024-02-05T09:45:00Z',
				isActive: true,
				age: 46,
			},
			{
				id: 'user_023',
				name: 'Wendy Clark',
				email: 'wendy.clark@email.com',
				createdAt: '2024-02-06T10:30:00Z',
				isActive: true,
				age: 24,
			},
			{
				id: 'user_024',
				name: 'Xavier Lewis',
				email: 'xavier.lewis@email.com',
				createdAt: '2024-02-07T11:15:00Z',
				isActive: false,
				age: 47,
			},
			{
				id: 'user_025',
				name: 'Yara Hassan',
				email: 'yara.hassan@email.com',
				createdAt: '2024-02-08T12:45:00Z',
				isActive: true,
				age: 23,
			},
		],
	},
};

export const fetchDataStores = async (
	context: IRestApiContext,
	projectId?: string,
	options?: {
		page?: number;
		pageSize?: number;
	},
) => {
	await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate network delay
	const stores = MOCKED_DATASTORES;
	// if (projectId) {
	// 	stores = MOCKED_DATASTORES.filter((store) => store.projectId === projectId);
	// }
	if (options?.page && options?.pageSize) {
		const start = (options.page - 1) * options.pageSize;
		const end = start + options.pageSize;
		return {
			count: stores.length,
			data: stores.slice(start, end),
		};
	}
	if (options?.pageSize) {
		return {
			count: stores.length,
			data: stores.slice(0, options.pageSize),
		};
	}
	return { count: MOCKED_DATASTORES.length, data: stores };
};

// TODO: Add options for pagination
export const fetchDataStoreMetadata = async (
	context: IRestApiContext,
	storeId: string,
	options: {
		page?: number;
		pageSize?: number;
		includeContent?: boolean;
	} = {
		page: 1,
		pageSize: 100,
		includeContent: true,
	},
): Promise<DataStoreMetadata> => {
	await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate network delay
	if (options.page && options.pageSize) {
		const start = (options.page - 1) * options.pageSize;
		const end = start + options.pageSize;
		return {
			...MOCKED_USERS_STORE,
			content: {
				totalRows: MOCKED_USERS_STORE.content?.rows.length || 0,
				rows: MOCKED_USERS_STORE.content?.rows.slice(start, end) || [],
			},
		};
	}
	if (options.pageSize) {
		return {
			...MOCKED_USERS_STORE,
			content: {
				totalRows: MOCKED_USERS_STORE.content?.rows.length || 0,
				rows: MOCKED_USERS_STORE.content?.rows.slice(0, options.pageSize) || [],
			},
		};
	}
	return MOCKED_USERS_STORE;
};
