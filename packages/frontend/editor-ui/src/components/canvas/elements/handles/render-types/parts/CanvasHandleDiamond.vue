<script lang="ts" setup>
import { computed } from 'vue';

const props = withDefaults(
	defineProps<{
		handleClasses?: string;
		executionStatus?: string;
	}>(),
	{
		handleClasses: undefined,
		executionStatus: undefined,
	},
);

const statusClasses = computed(() => {
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
	background: var(--color-foreground-dark);
	transform: rotate(45deg) scale(0.8);

	&:hover {
		background: var(--color-primary);
	}

	&.success {
		background: var(--color-success);

		&:hover {
			background: var(--color-success-shade-1);
		}
	}

	&.error {
		background: var(--color-danger);

		&:hover {
			background: var(--color-danger-shade-1);
		}
	}

	&.default {
		background: var(--color-foreground-dark);

		&:hover {
			background: var(--color-primary);
		}
	}
}
</style>
