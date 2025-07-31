export type DataStoreColumnType = 'string' | 'number' | 'boolean' | 'date';

export type DataStoreColumn = {
	name: string;
	displayName: string;
	type: DataStoreColumnType;
	editable: boolean;
	unique: boolean;
	nullable: boolean;
};

export type DataStoreEntity = {
	id: string;
	name: string;
	size: number;
	recordCount: number;
	columnCount: number;
	createdAt: string;
	updatedAt: string;
	projectId?: string;
};

export type DataStoreValue = string | number | boolean | Date | null;

export type DataStoreRow = Record<string, DataStoreValue>;

export type DataStoreContent = {
	totalRows: number;
	rows: DataStoreRow[];
};

export type DataStoreMetadata = DataStoreEntity & {
	columns: DataStoreColumn[];
	content?: DataStoreContent;
};
