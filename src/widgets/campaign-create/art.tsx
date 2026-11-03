/** @jsxImportSource hono/jsx/dom */
import type { ThemeName } from "../../presets/themes";

// One simple scene per theme, drawn the same flat way for every preset. The
// colours are the scene's own, so they stay the same in a dark host.

const SCENES: Record<ThemeName, () => unknown> = {
	emergency: () => (
		<>
			<rect width="160" height="90" fill="#a0b4c8" />
			<path d="M0 70 40 58 90 66 160 56V90H0Z" fill="#5f7d95" />
			<rect x="26" y="34" width="34" height="30" fill="#e9e0d2" />
			<path d="M20 36 43 18 66 36Z" fill="#7a4a3d" />
			<rect x="38" y="46" width="10" height="18" fill="#4a5a68" />
			<rect
				x="92"
				y="34"
				width="46"
				height="6"
				fill="#3d5a78"
				transform="rotate(-8 92 34)"
			/>
			<circle cx="104" cy="62" r="5" fill="#e8b48f" />
			<rect x="99" y="67" width="10" height="14" rx="3" fill="#d9473d" />
			<circle cx="122" cy="62" r="5" fill="#9a6a4f" />
			<rect x="117" y="67" width="10" height="14" rx="3" fill="#f0b43a" />
		</>
	),
	year_end: () => (
		<>
			<rect width="160" height="90" fill="#f0d6a0" />
			<rect y="62" width="160" height="28" fill="#c98f55" />
			<rect x="14" y="40" width="40" height="28" fill="#7a4a3d" />
			<rect x="60" y="44" width="40" height="24" fill="#7a4a3d" />
			<circle cx="26" cy="36" r="6" fill="#d9473d" />
			<circle cx="46" cy="36" r="6" fill="#8bc34a" />
			<circle cx="76" cy="40" r="6" fill="#f0b43a" />
			<circle cx="116" cy="26" r="7" fill="#5f4030" />
			<rect x="108" y="34" width="18" height="34" rx="6" fill="#2f8f74" />
			<circle cx="136" cy="40" r="5" fill="#e8b48f" />
			<rect x="131" y="46" width="11" height="22" rx="4" fill="#f0b43a" />
		</>
	),
	capital: () => (
		<>
			<rect width="160" height="90" fill="#bfe1f5" />
			<rect y="68" width="160" height="22" fill="#78b068" />
			<rect x="38" y="36" width="76" height="34" fill="#f1e4c3" />
			<path d="M30 38 76 12 122 38Z" fill="#c0503f" />
			<rect x="70" y="50" width="14" height="20" fill="#7a4a3d" />
			<rect x="46" y="44" width="14" height="12" fill="#a9d1ee" />
			<rect x="94" y="44" width="14" height="12" fill="#a9d1ee" />
			<rect x="126" y="30" width="14" height="40" fill="#d8cdb8" />
		</>
	),
	giving_day: () => (
		<>
			<rect width="160" height="90" fill="#fbe3d3" />
			<circle cx="34" cy="34" r="14" fill="#f4b04a" />
			<circle cx="130" cy="24" r="8" fill="#5aa5e0" />
			<circle cx="92" cy="52" r="6" fill="#e8584a" />
			<rect x="52" y="54" width="62" height="30" rx="4" fill="#1e6dab" />
			<path
				d="M83 78C70 68 70 60 77 59 80 59 83 61 83 64 83 61 86 59 89 59 96 60 96 68 83 78Z"
				fill="#fff"
			/>
		</>
	),
};

export function ThemeArt(props: { theme: ThemeName }) {
	return (
		<svg
			class="preset-art"
			viewBox="0 0 160 90"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
		>
			{SCENES[props.theme]()}
		</svg>
	);
}
