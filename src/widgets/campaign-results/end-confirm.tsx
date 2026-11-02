/** @jsxImportSource hono/jsx/dom */
import { useEffect, useId } from "hono/jsx/dom";
import { Button } from "../ui/button";
import { useLocale } from "../ui/widget";

/**
 * The inline confirm for ending a campaign. Focus starts on "Keep it live";
 * only the filled red button ends the campaign.
 */
export function EndConfirm(props: {
	title: string;
	donors: number;
	busy: boolean;
	onKeep: () => void;
	onEnd: () => void;
}) {
	const id = useId();
	const locale = useLocale();
	useEffect(() => {
		document.getElementById(`${id}-keep`)?.focus();
	}, [id]);
	const who =
		props.donors === 1
			? "1 donor"
			: `${new Intl.NumberFormat(locale).format(props.donors)} donors`;
	return (
		<section
			class="confirm"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-body`}
			onKeyDown={(event: KeyboardEvent) => {
				if (event.key === "Escape") props.onKeep();
			}}
		>
			<h3 id={`${id}-title`} class="confirm-title">
				End “{props.title}” for good?
			</h3>
			<p id={`${id}-body`}>
				The donation page stops taking gifts immediately. <b>{who}</b> have
				given so far. This can't be undone.
			</p>
			<div class="row">
				<Button
					id={`${id}-keep`}
					variant="secondary"
					disabled={props.busy}
					onClick={props.onKeep}
				>
					Keep it live
				</Button>
				<Button
					variant="destructive"
					busy={props.busy}
					onClick={props.onEnd}
					class="confirm-end"
				>
					End campaign
				</Button>
			</div>
		</section>
	);
}
