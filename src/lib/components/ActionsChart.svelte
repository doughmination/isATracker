<!-- src/lib/components/ActionsChart.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	interface DailyCount {
		day: string;
		closures: number;
		reviews: number;
	}

	let { daily }: { daily: DailyCount[] } = $props();

	const width = 720;
	const height = 220;

	const margin = {
		top: 10,
		right: 8,
		bottom: 26,
		left: 32
	};

	const plotWidth = width - margin.left - margin.right;
	const plotHeight = height - margin.top - margin.bottom;
	const baseline = margin.top + plotHeight;
	const barWidth = 14;
	const segmentGap = 2;
	const cornerRadius = 4;

	let hoveredIndex = $state<number | null>(null);

	const slotWidth = $derived(plotWidth / Math.max(daily.length, 1));

	const busiestDay = $derived(Math.max(0, ...daily.map((entry) => entry.closures + entry.reviews)));

	// An even ceiling of at least 4 keeps every tick a whole number
	const scaleMax = $derived(Math.max(4, Math.ceil(busiestDay / 2) * 2));

	const ticks = $derived([0, scaleMax / 2, scaleMax]);

	const hasActions = $derived(busiestDay > 0);

	const hovered = $derived(hoveredIndex === null ? null : daily[hoveredIndex]);

	function slotCentre(index: number): number {
		return margin.left + slotWidth * (index + 0.5);
	}

	function scaleHeight(value: number): number {
		return (value / scaleMax) * plotHeight;
	}

	function tickY(value: number): number {
		return baseline - scaleHeight(value);
	}

	// A bar segment; only the top of a stack gets rounded corners
	function segmentPath(index: number, bottom: number, barHeight: number, rounded: boolean): string {
		const left = slotCentre(index) - barWidth / 2;
		const right = left + barWidth;
		const top = bottom - barHeight;
		const radius = rounded ? Math.min(cornerRadius, barHeight) : 0;

		return [
			`M ${left} ${bottom}`,
			`V ${top + radius}`,
			`Q ${left} ${top} ${left + radius} ${top}`,
			`H ${right - radius}`,
			`Q ${right} ${top} ${right} ${top + radius}`,
			`V ${bottom}`,
			'Z'
		].join(' ');
	}

	function shortDay(day: string): string {
		return day.slice(5);
	}
</script>

<div class="chart">
	<ul class="legend">
		<li><span class="swatch closures"></span>PRs closed</li>
		<li><span class="swatch reviews"></span>Changes requested</li>
	</ul>

	<div class="plot">
		<svg
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label="Stacked bars of moderation actions per day for the last 30 days"
		>
			{#each ticks as tick (tick)}
				<line
					class="grid"
					x1={margin.left}
					x2={width - margin.right}
					y1={tickY(tick)}
					y2={tickY(tick)}
				/>
				<text class="axisLabel" x={margin.left - 8} y={tickY(tick) + 4} text-anchor="end">
					{tick}
				</text>
			{/each}

			{#each daily as entry, index (entry.day)}
				{@const closuresHeight = scaleHeight(entry.closures)}
				{@const reviewsHeight = scaleHeight(entry.reviews)}
				{@const reviewsBottom = baseline - closuresHeight - (entry.closures > 0 ? segmentGap : 0)}

				{#if hoveredIndex === index}
					<rect
						class="hoverBand"
						x={slotCentre(index) - slotWidth / 2}
						y={margin.top}
						width={slotWidth}
						height={plotHeight}
					/>
				{/if}

				{#if entry.closures > 0}
					<path
						class="closures"
						d={segmentPath(index, baseline, closuresHeight, entry.reviews === 0)}
					/>
				{/if}

				{#if entry.reviews > 0}
					<path
						class="reviews"
						d={segmentPath(index, reviewsBottom, Math.max(reviewsHeight - segmentGap, 1), true)}
					/>
				{/if}

				{#if index % 7 === 0 || index === daily.length - 1}
					<text class="axisLabel" x={slotCentre(index)} y={height - 8} text-anchor="middle">
						{shortDay(entry.day)}
					</text>
				{/if}

				<!-- Full-height hit target, wider than the bar itself -->
				<rect
					class="hitTarget"
					role="button"
					tabindex="0"
					aria-label="{entry.day}: {entry.closures} closed, {entry.reviews} changes requested"
					x={slotCentre(index) - slotWidth / 2}
					y={margin.top}
					width={slotWidth}
					height={plotHeight}
					onpointerenter={() => (hoveredIndex = index)}
					onpointerleave={() => (hoveredIndex = null)}
					onfocus={() => (hoveredIndex = index)}
					onblur={() => (hoveredIndex = null)}
				/>
			{/each}

			<line
				class="baseline"
				x1={margin.left}
				x2={width - margin.right}
				y1={baseline}
				y2={baseline}
			/>
		</svg>

		{#if hovered && hoveredIndex !== null}
			<div
				class="tooltip"
				class:alignRight={hoveredIndex > daily.length / 2}
				style="left: {(slotCentre(hoveredIndex) / width) * 100}%"
			>
				<strong>{hovered.day}</strong>
				<span><span class="swatch closures"></span>{hovered.closures} closed</span>
				<span><span class="swatch reviews"></span>{hovered.reviews} changes requested</span>
			</div>
		{/if}

		{#if !hasActions}
			<p class="empty muted">No completed actions in this period yet.</p>
		{/if}
	</div>

	<details>
		<summary>View as table</summary>

		<div class="tableScroll">
			<table>
				<thead>
					<tr>
						<th>Day</th>
						<th class="numeric">PRs closed</th>
						<th class="numeric">Changes requested</th>
					</tr>
				</thead>
				<tbody>
					{#each daily.toReversed() as entry (entry.day)}
						<tr>
							<td>{entry.day}</td>
							<td class="numeric">{entry.closures}</td>
							<td class="numeric">{entry.reviews}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</div>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1.2rem;
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		margin-right: 0.4rem;
		border-radius: 2px;
	}

	.swatch.closures {
		background: var(--series-closures);
	}

	.swatch.reviews {
		background: var(--series-reviews);
	}

	.plot {
		position: relative;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
	}

	path.closures {
		fill: var(--series-closures);
	}

	path.reviews {
		fill: var(--series-reviews);
	}

	.grid {
		stroke: var(--border);
		stroke-width: 1;
	}

	.baseline {
		stroke: var(--text-secondary);
		stroke-width: 1;
	}

	.axisLabel {
		fill: var(--text-secondary);
		font-size: 11px;
	}

	.hoverBand {
		fill: var(--text-secondary);
		opacity: 0.12;
	}

	.hitTarget {
		fill: transparent;
		outline: none;
	}

	.tooltip {
		position: absolute;
		top: 0;
		display: flex;
		flex-direction: column;
		padding: 0.4rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: 0.4rem;
		background: var(--surface-card);
		color: var(--text-primary);
		font-size: 0.85rem;
		white-space: nowrap;
		pointer-events: none;
		transform: translateX(0.75rem);
	}

	.tooltip.alignRight {
		transform: translateX(calc(-100% - 0.75rem));
	}

	.empty {
		position: absolute;
		inset: 35% 0 auto;
		margin: 0;
		text-align: center;
	}

	details {
		margin-top: 0.5rem;
	}

	summary {
		cursor: pointer;
		color: var(--text-secondary);
	}
</style>
