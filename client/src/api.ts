// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. `createActionClient` returns a proxy that POSTs `{action, args}`
// to `./actions` and returns the typed response.
//
// `import type { Actions }` is type-only by design: the client bundle never
// pulls in any server runtime (bun:sqlite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";

const rawApi = createActionClient<typeof Actions>();

/* ------------------------------------------------------------------ */
/* Session token (production auth)                                     */
/*                                                                     */
/* The server issues a random session token at login / register /      */
/* demo login; only its SHA-256 hash is stored server-side. The raw    */
/* token lives here (module state + localStorage so a reload keeps     */
/* the session) and is attached to every action call automatically —   */
/* call sites keep passing `userId`, and the server rejects any call   */
/* whose session doesn't belong to that user. The auth actions         */
/* themselves are excluded: they receive or mint the token.            */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = "ww-session";
const AUTH_ACTIONS = new Set(["login", "register", "demoLogin", "getSession"]);

let sessionToken: string | null = (() => {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

export function setSessionToken(token: string | null): void {
  sessionToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage may be blocked — the in-memory token still works for this session */ }
}

export function getSessionToken(): string | null {
  return sessionToken;
}

type AnyActionFn = (args: Record<string, unknown>) => Promise<unknown>;

export const api: typeof rawApi = new Proxy(rawApi, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver) as unknown;
    if (typeof prop !== "string" || typeof value !== "function" || AUTH_ACTIONS.has(prop)) {
      return value;
    }
    const fn = value as AnyActionFn;
    return (args: Record<string, unknown> = {}) =>
      sessionToken ? fn({ ...args, sessionToken }) : fn(args);
  },
});

// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
//
// They are also available directly from "@hatch/space-sdk/client".
export type { ApiRequest, ApiResponse } from "@hatch/space-sdk/client";
