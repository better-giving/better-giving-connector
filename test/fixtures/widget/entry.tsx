/** @jsxImportSource hono/jsx/dom */
import { render } from "hono/jsx/dom";
import "./style.css";

// the text is a script-breaking literal on purpose: the loader must escape it
const trap = "</script><!-- <script>";

render(
	<p class="hello" data-trap={trap}>
		hello widget
	</p>,
	document.getElementById("root") as HTMLElement,
);
