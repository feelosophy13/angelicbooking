import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { API_SCOPE_NAMES } from "./api-scopes";

/**
 * The OpenAPI 3.1 description of /api/v1, built from the route files themselves: every exported GET/POST/PATCH/PUT/DELETE becomes an
 * operation, its path comes from the folder (`[id]` → `{id}`), its scope from the `route("…")` wrapper, and its summary from the doc
 * comment above it. Query names come from the `searchParams.get(…)` calls in the same file, and list endpoints get the shared
 * `limit`/`page` parameters. Request and response bodies are described only generically; the field lists are in /developers.
 *
 * Run `pnpm openapi` after changing a route; a test fails when the committed file is out of date.
 */

export const OPENAPI_PATH = "public/openapi/v1.json";

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

/** The doc comment directly above line `i`, with its markers removed; "" when there is none. */
function docAbove(lines: string[], i: number): string {
  let j = i - 1;
  while (j >= 0 && lines[j]!.trim() === "") j--;
  if (j < 0 || !lines[j]!.trim().endsWith("*/")) return "";
  const parts: string[] = [];
  for (; j >= 0; j--) {
    const t = lines[j]!.trim();
    parts.unshift(t.replace(/^\/\*\*?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim());
    if (t.startsWith("/*")) break;
  }
  return parts.filter(Boolean).join(" ");
}

/** The tag of every operation, for the top-level list. */
function tagsIn(paths: Record<string, Record<string, unknown>>): string[] {
  return Object.values(paths).flatMap((ops) => Object.values(ops).flatMap((o) => (o as { tags: string[] }).tags));
}

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0] ?? text;

export function buildOpenApi(apiDir: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const file of routeFiles(apiDir)) {
    const segments = relative(apiDir, file).split(sep).slice(0, -1);
    const path = "/" + segments.map((s) => s.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    const lines = readFileSync(file, "utf8").split("\n");
    const source = lines.join("\n");
    const queryNames = [...new Set([...source.matchAll(/(?:searchParams|\bq)\.get\("([a-z_]+)"\)/g)].map((m) => m[1]!))].sort();
    const paged = /pageParams\(/.test(source);

    lines.forEach((line, i) => {
      const m = /^export const (GET|POST|PATCH|PUT|DELETE)\b/.exec(line);
      if (!m) return;
      const method = m[1]!;
      const scope = /route(?:<[^>]*>)?\(\s*"([a-z]+:(?:read|write))"/.exec(lines.slice(i, i + 4).join("\n"))?.[1];
      if (!scope || !(API_SCOPE_NAMES as readonly string[]).includes(scope)) {
        throw new Error(`${file}: ${method} is not wrapped in route("<scope>", …)`);
      }
      // Many doc comments open with the route itself ("GET /api/v1/clients?q=…. Notes…"); the operation already says that.
      const doc = docAbove(lines, i).replace(/^(GET|POST|PATCH|PUT|DELETE) \/api\/v1\S*\.?\s*/, "");
      const writes = method !== "GET";
      const parameters: Record<string, unknown>[] = [
        ...params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
        ...(method === "GET" && paged ? [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
        ] : []),
        ...(method === "GET" ? queryNames.filter((n) => n !== "limit" && n !== "page").map((name) => ({ name, in: "query", schema: { type: "string" } })) : []),
      ];
      const operation: Record<string, unknown> = {
        tags: [segments[0] ?? "root"],
        operationId: method.toLowerCase() + path.replace(/[{}]/g, "").split("/").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(""),
        summary: doc ? firstSentence(doc) : `${method} ${path}`,
        ...(doc ? { description: doc } : {}),
        "x-scope": scope,
        ...(parameters.length ? { parameters } : {}),
        ...(writes ? { requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } } } : {}),
        responses: {
          [writes && method === "POST" && !params.length ? "201" : "200"]: {
            description: "Success. The body is `{ data }` (a list adds `page`, `limit` and `has_more`, and `total` where counted), or the bare object for single results.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
          ...(params.length ? { "404": { $ref: "#/components/responses/Error" } } : {}),
          ...(writes ? { "422": { $ref: "#/components/responses/Error" } } : {}),
        },
        security: [{ bearer: [] }],
      };
      paths[path] ??= {};
      paths[path][method.toLowerCase()] = operation;
    });
  }
  // Keep the paths in a stable order so the committed file only changes when the API does.
  const sorted = Object.fromEntries(Object.keys(paths).sort().map((k) => [k, paths[k]!]));
  return {
    openapi: "3.1.0",
    info: {
      title: "Angelic Booking API",
      version: "1.0.0",
      description: "Business-scoped REST API. Authenticate with an API key from Settings → API access, sent as `Authorization: Bearer <key>`. Each key has scopes (`x:read`, `x:write`); a write scope implies its read scope. Rate limit: 120 requests per minute per key; every response carries `X-RateLimit-*` headers.",
    },
    servers: [{ url: "https://app.angelicbooking.com/api/v1" }],
    tags: [...new Set(tagsIn(sorted))].sort().map((name) => ({ name })),
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key from Settings → API access." } },
      responses: {
        Error: {
          description: "An error. `error.code` is machine-readable; `error.message` is for people.",
          content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } } } },
        },
      },
    },
    paths: sorted,
  };
}
