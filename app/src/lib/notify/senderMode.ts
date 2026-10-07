/**
 * Whether a request to the sender may really send. It FAILS CLOSED: a real send needs BOTH the environment switch
 * NOTIFY_SENDER_LIVE=1 AND no `?dryRun=1` on the request. Everything else, including a missing, empty or mistyped switch, is a dry run
 * that reads and counts and writes and sends nothing. The query can only ever lower the mode, never raise it, and nothing else about
 * the request (a user, a text, an hour, a kind) is read: the route cannot be used to push an arbitrary message.
 * Read per call, never at module load (the CI build runs with no environment).
 */
export function isLiveRequest(env: Record<string, string | undefined>, url: URL): boolean {
  return env.NOTIFY_SENDER_LIVE === "1" && url.searchParams.get("dryRun") !== "1";
}
