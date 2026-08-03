import { afterEach, describe, expect, it } from "vitest";
import {
  GooseLoopbackModelServerError,
  startGooseLoopbackModelServer,
  type GooseLoopbackModelServer,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";

const MODEL_LEASE = "model-lease-0123456789abcdef0123456789abcdef";
const openServers: GooseLoopbackModelServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("Goose loopback model server", () => {
  it("serves one authenticated caller-selected OpenAI-compatible model catalog", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
    });
    openServers.push(server);

    const response = await fetch(`${server.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "User-Agent": "goose/1.45.0",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "actestra-caller-model",
          object: "model",
          created: 0,
          owned_by: "actestra",
        },
      ],
    });
    expect(Object.keys(server).sort()).toEqual(["baseUrl", "close"]);
  });

  it("rejects a wrong lease and every inference route", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
    });
    openServers.push(server);

    const wrongLease = await fetch(`${server.baseUrl}/models`, {
      headers: { Authorization: "Bearer wrong-lease-0123456789abcdef0123456789abcdef" },
    });
    const inference = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "actestra-caller-model", messages: [] }),
    });

    expect(wrongLease.status).toBe(401);
    expect(inference.status).toBe(404);
  });

  it.each([
    { modelId: "", attemptLease: MODEL_LEASE },
    { modelId: "unsafe model", attemptLease: MODEL_LEASE },
    { modelId: "actestra-caller-model", attemptLease: "short" },
  ])("rejects invalid catalog options before listening", async (options) => {
    await expect(startGooseLoopbackModelServer(options)).rejects.toBeInstanceOf(
      GooseLoopbackModelServerError,
    );
  });
});
