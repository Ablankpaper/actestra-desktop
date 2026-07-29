import { describe, expect, it } from "vitest";
import {
  MAX_WORKLOAD_CONTENT_BYTES,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  WorkloadContentError,
  assertContentReferenceMetadata,
  assertResolveContentReferenceInput,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ContentReferenceOwner,
  type StoreContentReferenceInput,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";

const CREATED_AT = instant("2026-07-29T01:00:00.000Z");
const owner: ContentReferenceOwner = {
  workspaceId: workspaceId("workspace-content"),
  taskId: taskId("task-content"),
  sessionId: sessionId("session-content"),
  workerId: workerId("worker-content"),
  requestId: toolRequestId("request-content"),
  grantId: workspaceGrantId("grant-content"),
};

function createGrant(): WorkspaceGrant {
  return {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    grantId: workspaceGrantId("grant-content"),
    workspaceId: workspaceId("workspace-content"),
    rootPath: "/tmp/actestra-workspace",
    displayName: "Fixture workspace",
    state: "active",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function createContentInput(content = "bounded fixture content"): StoreContentReferenceInput {
  return {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: toolInputReference("input-content"),
    kind: "tool-input",
    owner,
    classification: "workspace-content",
    mediaType: "text/plain; charset=utf-8",
    content,
    createdAt: CREATED_AT,
    expiresAt: instant("2026-07-29T02:00:00.000Z"),
  };
}

describe("workload persistence contracts", () => {
  it("accepts an exact workspace grant and rejects extra or inconsistent fields", () => {
    const grant = createGrant();
    expect(() => assertWorkspaceGrant(grant)).not.toThrow();
    expect(() =>
      assertWorkspaceGrant({
        ...grant,
        unexpected: true,
      }),
    ).toThrow(WorkloadContentError);
    expect(() =>
      assertWorkspaceGrant({
        ...grant,
        state: "revoked",
        updatedAt: instant("2026-07-29T00:59:59.000Z"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid-contract",
      }),
    );
  });

  it("bounds UTF-8 content and rejects non-round-trippable text", () => {
    expect(() => assertStoreContentReferenceInput(createContentInput())).not.toThrow();
    expect(() =>
      assertStoreContentReferenceInput(createContentInput("a".repeat(MAX_WORKLOAD_CONTENT_BYTES))),
    ).not.toThrow();
    expect(() =>
      assertStoreContentReferenceInput(
        createContentInput("a".repeat(MAX_WORKLOAD_CONTENT_BYTES + 1)),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "content-too-large",
      }),
    );
    expect(() => assertStoreContentReferenceInput(createContentInput("\ud800"))).toThrowError(
      expect.objectContaining({
        code: "invalid-content",
      }),
    );
  });

  it("requires exact ownership, time, media, and digest metadata", () => {
    expect(() =>
      assertResolveContentReferenceInput({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: toolInputReference("input-content"),
        kind: "tool-input",
        owner,
        resolvedAt: instant("2026-07-29T01:30:00.000Z"),
        consume: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertContentReferenceMetadata({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: toolInputReference("input-content"),
        kind: "tool-input",
        owner,
        classification: "workspace-content",
        mediaType: "text/plain; charset=utf-8",
        byteLength: 23,
        sha256: "a".repeat(64),
        createdAt: CREATED_AT,
        expiresAt: instant("2026-07-29T02:00:00.000Z"),
        consumedAt: instant("2026-07-29T01:30:00.000Z"),
      }),
    ).not.toThrow();

    expect(() =>
      assertContentReferenceMetadata({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: toolInputReference("input-content"),
        kind: "tool-input",
        owner,
        classification: "workspace-content",
        mediaType: "application/octet-stream",
        byteLength: 23,
        sha256: "not-a-digest",
        createdAt: CREATED_AT,
      }),
    ).toThrow(WorkloadContentError);
  });
});
