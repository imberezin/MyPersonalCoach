/**
 * Whether a request to the sender may really send. It FAILS CLOSED: a real send needs the environment switch NOTIFY_SENDER_LIVE=1 AND no
 * `dryRun` parameter of ANY kind on the request. The parameter lowers the mode whatever its value or spelling (`?dryRun=1`, `?dryRun=true`,
 * `?dryRun=0`, `?dryRun=`, `?DryRun=1`): a rehearsal that is mistyped must never become a send. Everything else, including a missing, empty or
 * mistyped switch, is a dry run that reads and counts and writes and sends nothing. The query can only ever lower the mode, never raise it,
 * and nothing else about the request (a user, a text, an hour, a kind) is read: the route cannot be used to push an arbitrary message.
 * Read per call, never at module load (the CI build runs with no environment).
 */
export function isLiveRequest(env: Record<string, string | undefined>, url: URL): boolean {
  if (env.NOTIFY_SENDER_LIVE !== "1") return false;
  for (const name of url.searchParams.keys()) {
    if (name.toLowerCase() === "dryrun") return false;
  }
  return true;
}
