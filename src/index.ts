import { createApp } from "./app";
import { createDb } from "./db";
import { PLATFORM_ORIGIN } from "./deployment/origin";
import { env } from "./env";

export default createApp({
	env,
	db: createDb({
		url: env.TURSO_DATABASE_URL,
		authToken: env.TURSO_AUTH_TOKEN,
	}),
	fetch,
	platformOrigin: PLATFORM_ORIGIN,
});
