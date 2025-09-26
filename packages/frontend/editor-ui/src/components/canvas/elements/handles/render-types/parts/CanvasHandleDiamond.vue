<script lang="ts" setup>
import { computed } from 'vue';

const props = withDefaults(
	defineProps<{
		handleClasses?: string;
		executionStatus?: string;
		hasPinnedData?: boolean;
	}>(),
	{
		handleClasses: undefined,
		executionStatus: undefined,
		hasPinnedData: false,
	},
);

const statusClasses = computed(() => {
	if (props.hasPinnedData) {
		return 'pinned';
	}
	if (['error', 'crashed'].includes(props.executionStatus || '')) {
		return 'error';
	}
	if (props.executionStatus === 'success') {
		return 'success';
	}
	return 'default';
});
</script>

<template>
	<div :class="[$style.diamond, handleClasses, $style[statusClasses]]" />
</template>

<style lang="scss" module>
.diamond {
	width: var(--handle--indicator--width);
	height: var(--handle--indicator--height);
	background: var(--node-handle--background);
	background-clip: padding-box; // fix anti-aliasing issue
	transform: rotate(45deg) scale(0.8);
	border: 2px solid var(--canvas--background);

	&:hover {
		background-color: var(--color-primary);
	}

	&.pinned {
		background-color: var(--color-node-pinned-border);

		&:hover {
			background-color: var(--color-secondary-shade-1);
		}
	}

	&.success {
		background-color: var(--color-success);

		&:hover {
			background-color: var(--color-success-shade-1);
		}
	}

	&.error {
		background-color: var(--color-danger);

		&:hover {
			background-color: var(--color-danger-shade-1);
		}
	}

	&.default {
		background-color: var(--node-handle--background);

		&:hover {
			background-color: var(--color-primary);
		}
	}
}
</style>
