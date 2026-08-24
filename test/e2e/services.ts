import { dirname, join } from "node:path"

type PackageManifest = {
  readonly dependencies: Readonly<Record<string, string>>
  readonly name: string
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly version: string
}

class FixtureInputError extends Error {
  readonly field: string

  constructor(field: string) {
    super(`Invalid fixture input: ${field}`)
    this.name = "FixtureInputError"
    this.field = field
  }
}

function parseStringRecord(value: unknown, field: string): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixtureInputError(field)
  }

  const parsed: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new FixtureInputError(field)
    parsed[key] = entry
  }
  return parsed
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  const value: unknown = await Bun.file(path).json()
  if (typeof value !== "object" || value === null) {
    throw new FixtureInputError("manifest")
  }
  if (!("name" in value) || typeof value.name !== "string") {
    throw new FixtureInputError("name")
  }
  if (!("version" in value) || typeof value.version !== "string") {
    throw new FixtureInputError("version")
  }
  if (!("dependencies" in value) || !("peerDependencies" in value)) {
    throw new FixtureInputError("dependencies")
  }

  return {
    dependencies: parseStringRecord(value.dependencies, "dependencies"),
    name: value.name,
    peerDependencies: parseStringRecord(value.peerDependencies, "peerDependencies"),
    version: value.version,
  }
}

const manifestPath = Bun.argv[2]
const artifactPath = Bun.argv[3]
if (!manifestPath) throw new FixtureInputError("manifest path")
if (!artifactPath) throw new FixtureInputError("artifact path")

const manifest = await readPackageManifest(manifestPath)
const fixtureDirectory = dirname(manifestPath)
const modelCompleted = Bun.file(join(fixtureDirectory, "model-completed"))
const modelRelease = Bun.file(join(fixtureDirectory, "model-release"))
const modelRequested = Bun.file(join(fixtureDirectory, "model-requested"))
const tarballPath = "/tarballs/plugin.tgz"
const registryOrigin = "http://127.0.0.1:4873"
const registryServer = Bun.serve({
  hostname: "127.0.0.1",
  idleTimeout: 120,
  port: 4873,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === tarballPath) {
      return new Response(Bun.file(artifactPath), {
        headers: { "content-type": "application/octet-stream" },
      })
    }

    const requestedPackage = decodeURIComponent(url.pathname.slice(1))
    if (request.method === "GET" && requestedPackage === manifest.name) {
      return Response.json({
        "dist-tags": { latest: manifest.version },
        name: manifest.name,
        versions: {
          [manifest.version]: {
            dependencies: manifest.dependencies,
            dist: { tarball: `${registryOrigin}${tarballPath}` },
            name: manifest.name,
            peerDependencies: manifest.peerDependencies,
            version: manifest.version,
          },
        },
      })
    }

    const upstream = new URL(`${url.pathname}${url.search}`, "https://registry.npmjs.org")
    const headers = new Headers(request.headers)
    headers.delete("host")
    if (request.method === "GET" || request.method === "HEAD") {
      return fetch(upstream, {
        decompress: false,
        headers,
        method: request.method,
        redirect: "manual",
      })
    }
    return fetch(upstream, {
      body: await request.arrayBuffer(),
      decompress: false,
      headers,
      method: request.method,
      redirect: "manual",
    })
  },
})

const modelServer = Bun.serve({
  hostname: "127.0.0.1",
  idleTimeout: 120,
  port: 8080,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: "deterministic", object: "model" }], object: "list" })
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("not found", { status: 404 })
    }

    await Bun.write(modelRequested, "requested\n")
    const body: unknown = await request.json()
    let released = false
    for (let attempt = 0; attempt < 3000; attempt += 1) {
      if (await modelRelease.exists()) {
        released = true
        break
      }
      await Bun.sleep(10)
    }
    if (!released) throw new FixtureInputError("model release")

    const streaming =
      typeof body === "object" && body !== null && "stream" in body && body.stream === true
    if (!streaming) {
      await Bun.write(modelCompleted, "completed\n")
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: "ok", role: "assistant" },
          },
        ],
        created: 0,
        id: "chatcmpl-e2e",
        model: "deterministic",
        object: "chat.completion",
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
      })
    }

    const chunks = [
      {
        choices: [
          {
            delta: { content: "ok", role: "assistant" },
            finish_reason: null,
            index: 0,
          },
        ],
        created: 0,
        id: "chatcmpl-e2e",
        model: "deterministic",
        object: "chat.completion.chunk",
      },
      {
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        created: 0,
        id: "chatcmpl-e2e",
        model: "deterministic",
        object: "chat.completion.chunk",
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
      },
    ]
    const stream = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
    await Bun.write(modelCompleted, "completed\n")
    return new Response(stream, { headers: { "content-type": "text/event-stream" } })
  },
})

if (registryServer.port !== 4873 || modelServer.port !== 8080) {
  throw new FixtureInputError("service ports")
}
process.stdout.write("ready\n")
await new Promise<never>(() => undefined)
