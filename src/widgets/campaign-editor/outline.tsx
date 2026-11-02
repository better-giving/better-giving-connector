/** @jsxImportSource hono/jsx/dom */
import { useState } from "hono/jsx/dom";
import { Button } from "../ui/button";

export type OutlineItem = { key: string; label: string };

/**
 * The page's sections as a list. With `onMove` each row drags, and also has
 * Move up / Move down buttons, so reordering never needs a pointer.
 */
export function Outline(props: {
	items: readonly OutlineItem[];
	selected: number;
	onSelect: (index: number) => void;
	onMove?: (from: number, to: number) => void;
	onRemove?: (index: number) => void;
}) {
	const [dragging, setDragging] = useState<number | null>(null);
	const [over, setOver] = useState<number | null>(null);
	const { onMove, items } = props;
	return (
		<ol class="outline" aria-label="Page sections">
			{items.map((item, i) => (
				<li
					key={item.key}
					class={`outline-item${props.selected === i ? " is-selected" : ""}${over === i && dragging !== i ? " is-over" : ""}${dragging === i ? " is-dragging" : ""}`}
					draggable={onMove ? true : undefined}
					onDragStart={() => setDragging(i)}
					onDragOver={(e: DragEvent) => {
						if (dragging === null) return;
						e.preventDefault();
						setOver(i);
					}}
					onDrop={(e: DragEvent) => {
						e.preventDefault();
						if (dragging !== null && onMove && dragging !== i) onMove(dragging, i);
						setDragging(null);
						setOver(null);
					}}
					onDragEnd={() => {
						setDragging(null);
						setOver(null);
					}}
				>
					{onMove && (
						<span class="outline-grip" aria-hidden="true">
							⋮⋮
						</span>
					)}
					<button
						type="button"
						class="outline-pick"
						aria-pressed={props.selected === i}
						onClick={() => props.onSelect(i)}
					>
						{item.label}
					</button>
					{onMove && (
						<span class="outline-moves">
							<Button
								variant="secondary"
								class="icon-btn"
								label={`Move ${item.label} up`}
								disabled={i === 0}
								onClick={() => onMove(i, i - 1)}
							>
								↑
							</Button>
							<Button
								variant="secondary"
								class="icon-btn"
								label={`Move ${item.label} down`}
								disabled={i === items.length - 1}
								onClick={() => onMove(i, i + 1)}
							>
								↓
							</Button>
						</span>
					)}
					{props.onRemove && (
						<Button
							variant="secondary"
							class="icon-btn"
							label={`Remove ${item.label}`}
							onClick={() => props.onRemove?.(i)}
						>
							✕
						</Button>
					)}
				</li>
			))}
		</ol>
	);
}
