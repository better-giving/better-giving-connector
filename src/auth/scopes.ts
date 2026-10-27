// Dependency-free, so src/mcp and src/connect can import these without
// pulling in better-auth.

export const OFFLINE_ACCESS_SCOPE = "offline_access";
export const READ_ONLY_SCOPE = "read_only";

/** Whether a space-delimited OAuth scope string (RFC 6749 §3.3) grants `read_only`. */
export function isReadOnly(scope: string | undefined | null): boolean {
	return (scope ?? "").split(" ").includes(READ_ONLY_SCOPE);
}
