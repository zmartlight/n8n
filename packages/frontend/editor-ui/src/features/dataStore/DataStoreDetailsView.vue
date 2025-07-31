<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { AgGridVue } from 'ag-grid-vue3';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { GridApi, GridReadyEvent, IHeaderParams, ColDef } from 'ag-grid-community';
import { useMessage } from '@/composables/useMessage';
import { MODAL_CONFIRM } from '@/constants';
import type { DataStoreMetadata, DataStoreRow } from './datastore.types';
import { fetchDataStoreMetadata } from './datastore.api';
import { useRootStore } from '@n8n/stores/useRootStore';
import { useToast } from '@/composables/useToast';

// Register all Community features
ModuleRegistry.registerModules([AllCommunityModule]);

// Project id from the route
type Props = {
	id: string;
};

const props = defineProps<Props>();

const message = useMessage();
const toast = useToast();

const rootStore = useRootStore();

const dataStoreMetadata = ref<DataStoreMetadata | null>(null);

const fetching = ref(true);
const initialized = ref(false);
const editInProgress = ref(false);

// AG Grid State
const gridApi = ref<GridApi | null>(null);
const colDefs = ref<ColDef[]>([]);
const rowData = ref<DataStoreRow[]>([]);

// Pagination
const currentPage = ref(1);
const pageSize = ref(20);
const pageSizeOptions = ref([10, 20, 50]);
const totalItems = ref(0);

// Custom header component that includes sorting and conditionally shows the add button
// TODO:
// - Can we re-use default header component and just add a button?
// - Button needs to be n8n-icon-button
const CustomHeaderComponent = {
	template: `
		<div style="display: flex; justify-content: space-between; align-items: center; width: 100%; height: 100%;">
			<div
				style="display: flex; align-items: center; cursor: pointer; flex: 1; height: 100%;"
				@click="onSortRequested"
			>
				<span>{{ params.displayName }}</span>
				<span v-if="sortDirection" style="margin-left: 4px;">
					{{ sortDirection === 'asc' ? '↑' : '↓' }}
				</span>
			</div>
			<button
				v-if="isLastColumn"
				style="background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--color-text-base);"
				@click="onButtonClick"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
				</svg>
			</button>
		</div>
	`,
	setup(componentProps: { params: IHeaderParams }) {
		const sortDirection = ref<'asc' | 'desc' | null>(null);

		const isLastColumn = computed(() => {
			if (!componentProps.params.api) return false;
			const allColumns = componentProps.params.api.getAllDisplayedColumns();
			const lastColumn = allColumns[allColumns.length - 1];
			return lastColumn?.getColId() === componentProps.params.column.getColId();
		});

		const onSortRequested = () => {
			if (!componentProps.params.api) return;

			// Cycle through: null -> asc -> desc -> null
			let newDirection: 'asc' | 'desc' | null = 'asc';
			if (sortDirection.value === 'asc') {
				newDirection = 'desc';
			} else if (sortDirection.value === 'desc') {
				newDirection = null;
			}

			sortDirection.value = newDirection;

			if (newDirection) {
				componentProps.params.api.applyColumnState({
					state: [{ colId: componentProps.params.column.getColId(), sort: newDirection }],
					defaultState: { sort: null },
				});
			} else {
				componentProps.params.api.applyColumnState({
					state: [{ colId: componentProps.params.column.getColId(), sort: null }],
				});
			}
		};

		const onButtonClick = async () => {
			await addNewColumn();
		};

		// Update sort direction when external sorting changes
		const updateSortDirection = () => {
			const columnState = componentProps.params.api?.getColumnState();
			const thisColumnState = columnState?.find(
				(col) => col.colId === componentProps.params.column.getColId(),
			);
			sortDirection.value = (thisColumnState?.sort as 'asc' | 'desc' | null) ?? null;
		};

		// Listen for sort changes
		if (componentProps.params.api) {
			componentProps.params.api.addEventListener('sortChanged', updateSortDirection);
		}

		return {
			params: componentProps.params,
			isLastColumn,
			sortDirection,
			onSortRequested,
			onButtonClick,
		};
	},
};

const addNewColumn = async () => {
	if (editInProgress.value) {
		toast.showError(new Error('Cannot add column while editing is in progress'), 'Error');
		return;
	}
	const promptResponse = await message.prompt('Add New Column', {
		inputValidator: (value) => {
			// TODO: Check duplicate column names if needed
			if (!value) return 'Column name is required';
			return true;
		},
	});
	if (promptResponse.action === MODAL_CONFIRM) {
		const columnName = promptResponse.value.trim();
		if (!columnName) return;

		// Add new column to the grid
		const newColumn = {
			field: columnName,
			editable: true,
			sortable: true,
			headerComponent: CustomHeaderComponent,
		};
		colDefs.value.push(newColumn);

		// Add empty values for the new column to all existing rows
		rowData.value.forEach((row) => {
			row[columnName] = '';
		});

		// Refresh the grid to show the new column and update auto-sizing
		if (gridApi.value) {
			// Update the grid with new column definitions
			gridApi.value.setGridOption('columnDefs', [...colDefs.value]);
			// Auto-resize columns to fit the grid width
			gridApi.value.sizeColumnsToFit();
			// Refresh headers to update the plus button position
			gridApi.value.refreshHeader();
		}
	}
};

const onGridReady = (params: GridReadyEvent) => {
	gridApi.value = params.api;
};

const onColumnMoved = () => {
	// Refresh headers to update the button visibility
	if (gridApi.value) {
		gridApi.value.refreshHeader();
	}
};

const fetchData = async () => {
	try {
		fetching.value = true;
		const fetchedMetadata = await fetchDataStoreMetadata(rootStore.restApiContext, props.id, {
			page: currentPage.value,
			pageSize: pageSize.value,
		});
		if (!fetchedMetadata) {
			toast.showError(
				new Error('Failed to fetch data store metadata'),
				'Error loading data store details',
			);
			return;
		}
		colDefs.value = fetchedMetadata.columns.map((col) => ({
			field: col.name,
			headerName: col.displayName,
			editable: col.editable,
			type: col.type,
			sortable: true,
			// Use custom header for all columns - it will show + button only on last column
			headerComponent: CustomHeaderComponent,
		}));
		rowData.value = fetchedMetadata.content?.rows ?? [];
		dataStoreMetadata.value = fetchedMetadata;
	} catch (error) {
		toast.showError(error, 'Error loading data store details');
	} finally {
		fetching.value = false;
	}
};

const setCurrentPage = async (page: number) => {
	currentPage.value = page;
	await fetchData();
};

const setPageSize = async (size: number) => {
	pageSize.value = size;
	currentPage.value = 1; // Reset to first page on page size change
	await fetchData();
};

const onAddRowClick = async () => {
	// Go to last page if we are not there already
	if (currentPage.value * pageSize.value < totalItems.value) {
		await setCurrentPage(Math.ceil(totalItems.value / pageSize.value));
	}

	// Create a new empty row with default values for all columns
	const newRow: DataStoreRow = {};
	colDefs.value.forEach((col) => {
		if (col.field) {
			// Respect the column type and set default values
			switch (col.type) {
				case 'string':
					newRow[col.field] = '';
					break;
				case 'number':
					newRow[col.field] = 0;
					break;
				case 'boolean':
					newRow[col.field] = false;
					break;
				case 'date':
					newRow[col.field] = new Date().toISOString(); // Use ISO string for date
					break;
				default:
					newRow[col.field] = ''; // Default to empty string for unknown types
					break;
			}
		}
	});

	// Add the new row to the grid
	rowData.value.push(newRow);
	totalItems.value += 1;

	// Refresh the grid to show the new row
	if (gridApi.value) {
		gridApi.value.setGridOption('rowData', [...rowData.value]);

		// Wait for the grid to update, then start editing the first editable cell
		setTimeout(() => {
			if (gridApi.value) {
				editInProgress.value = true;
				// Get all displayed columns in their current order (accounts for reordering)
				const displayedColumns = gridApi.value.getAllDisplayedColumns();
				const firstEditableColumn = displayedColumns.find((col) => {
					const colDef = col.getColDef();
					return colDef.editable === true;
				});

				if (firstEditableColumn) {
					const rowIndex = rowData.value.length - 1;
					gridApi.value.startEditingCell({
						rowIndex,
						colKey: firstEditableColumn.getColId(),
					});
				}
			}
		}, 100);
	}
};

onMounted(async () => {
	await fetchData();
	totalItems.value = dataStoreMetadata.value?.content?.totalRows ?? 0;
	initialized.value = true;
});
</script>
<template>
	<div :class="$style['data-store-details-view']">
		<div v-if="initialized" :class="$style['grid-container']">
			<h1>{{ dataStoreMetadata?.name }}</h1>
			<AgGridVue
				style="width: 100%"
				:row-data="rowData"
				:column-defs="colDefs"
				:dom-layout="'autoHeight'"
				:auto-size-strategy="{ type: 'fitGridWidth' }"
				:animate-rows="false"
				:loading="fetching"
				@grid-ready="onGridReady"
				@column-moved="onColumnMoved"
			/>
			<div :class="$style.listFooter">
				<n8n-icon-button
					icon="plus"
					class="mb-xl"
					type="secondary"
					:disabled="editInProgress"
					@click="onAddRowClick"
				/>
				<el-pagination
					v-model:current-page="currentPage"
					v-model:page-size="pageSize"
					background
					:total="totalItems"
					:page-sizes="pageSizeOptions"
					layout="total, prev, pager, next, sizes"
					data-test-id="data-store-content-pagination"
					@update:current-page="setCurrentPage"
					@size-change="setPageSize"
				/>
			</div>
		</div>
		<div v-else :class="$style['loading-placeholder']">
			<n8n-loading :loading="true" variant="h1" :rows="1" :shrink-last="false" />
			<n8n-loading :loading="true" variant="h1" :rows="15" :shrink-last="false" />
		</div>
	</div>
</template>

<style lang="scss" module>
.data-store-details-view {
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: var(--spacing-xl);
	gap: var(--spacing-xl);
}

.grid-container {
	display: flex;
	flex-direction: column;
	width: 100%;
	align-items: center;
	gap: var(--spacing-m);
}

.loading-placeholder {
	display: flex;
	flex-direction: column;
	gap: var(--spacing-m);
	width: 100%;
}

.listFooter {
	display: flex;
	width: 100%;
	justify-content: space-between;
	margin-bottom: var(--spacing-l);

	:global(.el-pagination__sizes) {
		height: 100%;
		position: relative;
		top: -1px;

		input {
			height: 100%;
			min-height: 28px;
		}

		:global(.el-input__suffix) {
			width: var(--spacing-m);
		}
	}
}
</style>
