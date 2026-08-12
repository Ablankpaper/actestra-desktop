// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAionUiTeamBridgeRequest } from "../../apps/desktop/src/compatibility/aionui/teamBridge";
import { normalizeTeamDefinition } from "../../apps/desktop/src/core/teamRun";
import {
  projectAionCoreTeamModelCatalog,
  resolveAionCoreMainModelBinding,
} from "../../apps/desktop/src/main/model/aionCoreMainModelBinding";

const root = process.cwd();
const patchPath = path.join(root, "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs");
const bridgePath = path.join(root, "apps/desktop/src/compatibility/aionui/teamBridge.ts");
const servicePath = path.join(root, "apps/desktop/src/main/compatibility/aionuiTeamService.ts");

function healthyProvider(models, capabilities = [{ type: "text" }, { type: "function_calling" }]) {
  return {
    id: "provider-explicit",
    platform: "openai",
    name: "Explicit provider",
    base_url: "https://provider.invalid/v1",
    api_key: "test-only-key",
    models,
    capabilities,
    model_enabled: Object.fromEntries(models.map((modelId) => [modelId, true])),
    model_health: Object.fromEntries(models.map((modelId) => [modelId, { status: "healthy" }])),
  };
}

function inertClient() {
  return {
    createChatCompletion: async () => ({
      choices: [{ message: { content: "unused" } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }),
  };
}

describe("Actestra Team planner and Worker readiness boundary", () => {
  it("declares a separate worker-runtime-unavailable projection", () => {
    const bridge = fs.readFileSync(bridgePath, "utf8");
    expect(bridge).toContain('"worker-runtime-unavailable"');
    expect(bridge).toContain("planner-unavailable");
  });

  it("requires an authoritative provider/model selection before Worker composition", () => {
    const patch = fs.readFileSync(patchPath, "utf8");
    const selection = Object.freeze({ providerId: "provider-explicit", modelId: "model-b" });
    const request = {
      contractVersion: 1,
      method: "POST",
      path: "/api/teams",
      body: {
        experience: "orchestrated",
        name: "Explicit model Team",
        description: "Run General and Goose with one user-selected model.",
        workspace: "workspace-explicit-model",
        model_selection: { provider_id: selection.providerId, model_id: selection.modelId },
        agents: [
          {
            name: "General",
            role: "lead",
            assistant_id: "actestra-general-worker",
            model: "default",
          },
          {
            name: "Goose",
            role: "teammate",
            assistant_id: "actestra-goose-worker",
            model: "default",
          },
        ],
      },
    };
    expect(parseAionUiTeamBridgeRequest(request)).toMatchObject({
      kind: "create",
      modelSelection: selection,
    });
    expect(
      parseAionUiTeamBridgeRequest({
        contractVersion: 1,
        method: "GET",
        path: "/api/teams/model-options",
        body: undefined,
      }),
    ).toEqual({ kind: "model-options" });
    expect(() =>
      parseAionUiTeamBridgeRequest({
        ...request,
        body: Object.fromEntries(
          Object.entries(request.body).filter(([key]) => key !== "model_selection"),
        ),
      }),
    ).toThrow(/model selection/u);
    expect(
      normalizeTeamDefinition({
        contractVersion: 1,
        experience: "orchestrated",
        teamId: "team-" + "a".repeat(64),
        name: "Explicit model Team",
        description: "Run General and Goose with one user-selected model.",
        workspaceId: "workspace-explicit-model",
        modelSelection: selection,
        members: [
          {
            memberId: "team-member-" + "b".repeat(64),
            role: "leader",
            capability: "general",
            displayName: "General",
          },
          {
            memberId: "team-member-" + "c".repeat(64),
            role: "teammate",
            capability: "coding",
            displayName: "Goose",
          },
        ],
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      }).modelSelection,
    ).toEqual(selection);
    expect(patch).toContain("worker-runtime-unavailable");
    expect(patch).toContain("deriveActestraTeamWorkerReadiness");
    expect(patch).toContain("input.planner === null");
    expect(patch).toContain("readonly general: TeamGeneralWorkJourneyPort | null;");
    expect(patch).toContain("input.coding === null");
    expect(patch).toContain("resolveAionCoreMainModelBinding");
    expect(patch).toContain("configureActestraTeamWorkerRuntimeAdmission");
    expect(patch).toContain("model_selection");
    expect(patch).toContain("provider_id");
    expect(patch).toContain("model_id");
    const teamClientSource = patch.match(
      /writeNew\(\n  "packages\/desktop\/src\/common\/adapter\/actestraTeamClient\.ts",\n  `([\s\S]*?)`,\n\);/u,
    )?.[1];
    const teamCreateSource = patch.match(
      /writeNew\(\n  "packages\/desktop\/src\/renderer\/pages\/team\/components\/ActestraTeamCreateModal\.tsx",\n  `([\s\S]*?)`,\n\);/u,
    )?.[1];
    expect(teamClientSource).toBeDefined();
    expect(teamCreateSource).toBeDefined();
    expect(teamCreateSource).not.toContain("useModelProviderList");
    expect(teamClientSource).not.toContain("api_key");
    expect(teamClientSource).not.toContain("base_url");
    expect(patch).not.toContain("selection: null,");
    expect(patch).toContain("startTrustedActestraGeneralWorkRuntime");
    expect(patch).not.toContain("modelBinding: null,");
    expect(patch).toContain("listActestraTeamModelOptions");
    expect(patch).toContain("workerRuntimeAdmission:");
    expect(patch).toContain("orchestrator");
    expect(patch).toContain("await teamComposition.recoverStandardAuthority()");
    expect(patch).toContain("window.webContents.once('did-finish-load'");
    expect(patch).toContain("this.#recoverWorkerRuns()");
    expect(patch).not.toContain("await teamComposition.recover();");
    expect(patch).toContain("writeActestraTeamPlannerManifest(resolve(__dirname, '../..'))");

    const service = fs.readFileSync(servicePath, "utf8");
    expect(service).not.toContain("configureOrchestrator");
    expect(service).not.toContain("#orchestrator: AionUiTeamOrchestratorPort");
    const createImplementation = service.match(/async #create\([\s\S]*?\n  async #remove\(/u)?.[0];
    expect(createImplementation).toBeDefined();
    expect(createImplementation).not.toContain("#ensureWorkerRuntime");
  });

  it("projects a credential-free Team model catalog", () => {
    const providers = [healthyProvider(["model-a", "model-b"])];
    const catalog = projectAionCoreTeamModelCatalog(providers);

    expect(catalog).toEqual([
      {
        providerId: "provider-explicit",
        name: "Explicit provider",
        modelIds: ["model-a", "model-b"],
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain("test-only-key");
    expect(JSON.stringify(catalog)).not.toContain("provider.invalid");
  });

  it("fails closed unless the provider explicitly admits text and function calling", async () => {
    const rejectedCapabilities = [
      [],
      [{ type: "text" }],
      [{ type: "function_calling" }],
      [{ type: "text" }, { type: "function_calling", isUserSelected: false }],
    ];
    let clientCreations = 0;

    for (const capabilities of rejectedCapabilities) {
      const provider = healthyProvider(["model-b"], capabilities);
      expect(projectAionCoreTeamModelCatalog([provider])).toEqual([]);
      await expect(
        resolveAionCoreMainModelBinding({
          selection: { providerId: "provider-explicit", modelId: "model-b" },
          listProviders: async () => [provider],
          createClient: async () => {
            clientCreations += 1;
            return inertClient();
          },
        }),
      ).resolves.toBeNull();
    }

    expect(clientCreations).toBe(0);
  });

  it("does not infer a binding when no authoritative provider/model selection exists", async () => {
    let clientCreations = 0;
    const binding = await resolveAionCoreMainModelBinding({
      selection: null,
      listProviders: async () => [healthyProvider(["model-only"])],
      createClient: async () => {
        clientCreations += 1;
        return inertClient();
      },
    });

    expect(binding).toBeNull();
    expect(clientCreations).toBe(0);
  });

  it("binds only the exact explicitly selected healthy provider model", async () => {
    const createdModels = [];
    const providers = [healthyProvider(["model-a", "model-b"])];
    const dependencies = {
      listProviders: async () => providers,
      createClient: async (provider) => {
        createdModels.push(provider.use_model);
        return inertClient();
      },
    };

    const unmatched = await resolveAionCoreMainModelBinding({
      ...dependencies,
      selection: { providerId: "provider-explicit", modelId: "model-missing" },
    });
    expect(unmatched).toBeNull();
    expect(createdModels).toEqual([]);

    const binding = await resolveAionCoreMainModelBinding({
      ...dependencies,
      selection: { providerId: "provider-explicit", modelId: "model-b" },
    });
    expect(binding?.modelId).toBe("model-b");
    expect(createdModels).toEqual(["model-b"]);
  });

  it("rejects an empty provider completion before it reaches a Worker", async () => {
    const binding = await resolveAionCoreMainModelBinding({
      selection: { providerId: "provider-explicit", modelId: "model-b" },
      listProviders: async () => [healthyProvider(["model-b"])],
      createClient: async () => ({
        createChatCompletion: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "",
                reasoning_content: "must-not-cross-the-main-boundary",
              },
            },
          ],
          usage: { prompt_tokens: 19, completion_tokens: 7 },
        }),
      }),
    });

    await expect(
      binding.invokeModel(
        {
          sessionId: "session-provider-empty-1",
          purpose: "coding",
          messages: [{ role: "user", content: "Use only an admitted coding tool." }],
          tools: [],
          responseMode: "text-or-tool-call",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("AionCore model completion is unavailable");
  });

  it("uses the OpenAI-compatible provider default for automatic tool selection", async () => {
    const canonicalToolName = "actestra-capability-proxy__coding.file.read";
    const openAiToolName = "actestra-capability-proxy__coding_file_read";
    const requests = [];
    const binding = await resolveAionCoreMainModelBinding({
      selection: { providerId: "provider-explicit", modelId: "model-b" },
      listProviders: async () => [healthyProvider(["model-b"])],
      createClient: async () => ({
        createChatCompletion: async (request) => {
          requests.push(request);
          if (Object.prototype.hasOwnProperty.call(request, "tool_choice")) {
            return {
              choices: [{ finish_reason: "stop", message: { content: "" } }],
              usage: { prompt_tokens: 754, completion_tokens: 90 },
            };
          }
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call-provider-default-1",
                      type: "function",
                      function: {
                        name: openAiToolName,
                        arguments: '{"contractVersion":1,"relativePath":"README.md"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 754, completion_tokens: 79 },
          };
        },
      }),
    });

    await expect(
      binding.invokeModel(
        {
          sessionId: "session-provider-default-tool-selection-1",
          purpose: "coding",
          messages: [{ role: "user", content: "Read README.md." }],
          tools: [
            {
              name: canonicalToolName,
              description: "Read one admitted workspace file.",
              inputSchema: {
                type: "object",
                properties: {
                  contractVersion: { type: "integer" },
                  relativePath: { type: "string" },
                },
                required: ["contractVersion", "relativePath"],
                additionalProperties: false,
              },
            },
          ],
          responseMode: "text-or-tool-call",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      type: "tool-call",
      callId: "call-provider-default-1",
      name: canonicalToolName,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("tool_choice");
  });

  it("round-trips canonical coding tool names through OpenAI-safe aliases", async () => {
    const canonicalToolName = "actestra-capability-proxy__actestra.coding.file.read-text";
    const openAiToolName = "actestra-capability-proxy__actestra_coding_file_read-text";
    const requests = [];
    const binding = await resolveAionCoreMainModelBinding({
      selection: { providerId: "provider-explicit", modelId: "model-b" },
      listProviders: async () => [healthyProvider(["model-b"])],
      createClient: async () => ({
        createChatCompletion: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            return {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "call-provider-safe-1",
                        type: "function",
                        function: {
                          name: openAiToolName,
                          arguments: '{"contractVersion":1,"relativePath":"README.md"}',
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 11, completion_tokens: 5 },
            };
          }
          return {
            choices: [{ message: { content: "bounded final answer" } }],
            usage: { prompt_tokens: 17, completion_tokens: 3 },
          };
        },
      }),
    });
    const tool = {
      name: canonicalToolName,
      description: "Read one admitted workspace file.",
      inputSchema: {
        type: "object",
        properties: { contractVersion: { type: "integer" }, relativePath: { type: "string" } },
        required: ["contractVersion", "relativePath"],
        additionalProperties: false,
      },
    };
    const firstCompletion = await binding.invokeModel(
      {
        sessionId: "session-provider-safe-1",
        purpose: "coding",
        messages: [{ role: "user", content: "Read README.md." }],
        tools: [tool],
        responseMode: "text-or-tool-call",
      },
      new AbortController().signal,
    );
    expect(firstCompletion).toMatchObject({
      type: "tool-call",
      callId: "call-provider-safe-1",
      name: canonicalToolName,
    });
    expect(requests[0].tools[0].function.name).toBe(openAiToolName);
    expect(requests[0].tools[0].function.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);

    await binding.invokeModel(
      {
        sessionId: "session-provider-safe-1",
        purpose: "coding",
        messages: [
          { role: "user", content: "Read README.md." },
          {
            role: "assistant",
            toolCalls: [
              {
                callId: "call-provider-safe-1",
                name: canonicalToolName,
                arguments: { contractVersion: 1, relativePath: "README.md" },
              },
            ],
          },
          {
            role: "tool",
            callId: "call-provider-safe-1",
            content: "bounded tool result",
          },
        ],
        tools: [tool],
        responseMode: "text-or-tool-call",
      },
      new AbortController().signal,
    );
    expect(requests[1].messages[1].tool_calls[0].function.name).toBe(openAiToolName);
  });

  it("rejects ambiguous OpenAI tool aliases before invoking the provider", async () => {
    let providerCalls = 0;
    const binding = await resolveAionCoreMainModelBinding({
      selection: { providerId: "provider-explicit", modelId: "model-b" },
      listProviders: async () => [healthyProvider(["model-b"])],
      createClient: async () => ({
        createChatCompletion: async () => {
          providerCalls += 1;
          return {
            choices: [{ message: { content: "must not be reached" } }],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
          };
        },
      }),
    });

    await expect(
      binding.invokeModel(
        {
          sessionId: "session-provider-safe-2",
          purpose: "coding",
          messages: [{ role: "user", content: "Do not call an ambiguous tool." }],
          tools: [
            { name: "coding.file.read", inputSchema: { type: "object" } },
            { name: "coding_file_read", inputSchema: { type: "object" } },
          ],
          responseMode: "text-or-tool-call",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("AionCore model tool aliases are ambiguous");
    expect(providerCalls).toBe(0);
  });
});
