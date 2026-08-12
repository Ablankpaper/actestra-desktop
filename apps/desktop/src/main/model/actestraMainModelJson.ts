import { Buffer } from "node:buffer";

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 16_384;
const MAX_JSON_UTF8_BYTES = 256 * 1024;

type SnapshotObject = { [key: string]: unknown };
type SnapshotDestination =
  | Readonly<{ kind: "root" }>
  | Readonly<{ kind: "array"; target: unknown[]; index: number }>
  | Readonly<{ kind: "object"; target: SnapshotObject; key: string }>;
type TraversalFrame =
  | Readonly<{
      kind: "visit";
      value: unknown;
      depth: number;
      destination?: SnapshotDestination;
    }>
  | Readonly<{ kind: "exit"; source: object; snapshot?: object }>;

function invalidJson(): Error {
  return new Error("Actestra Main model JSON value is invalid");
}

function traverseJson(value: unknown, createSnapshot: boolean): unknown {
  const activeAncestors = new Set<object>();
  const stack: TraversalFrame[] = [
    Object.freeze({
      kind: "visit",
      value,
      depth: 0,
      ...(createSnapshot ? { destination: Object.freeze({ kind: "root" }) } : {}),
    }),
  ];
  let nodeCount = 0;
  let utf8Bytes = 0;
  let rootSnapshot: unknown;

  const addUtf8 = (text: string): void => {
    utf8Bytes += Buffer.byteLength(text, "utf8");
    if (utf8Bytes > MAX_JSON_UTF8_BYTES) throw invalidJson();
  };
  const assignSnapshot = (destination: SnapshotDestination, snapshot: unknown): void => {
    if (destination.kind === "root") {
      rootSnapshot = snapshot;
      return;
    }
    if (destination.kind === "array") {
      destination.target[destination.index] = snapshot;
      return;
    }
    Object.defineProperty(destination.target, destination.key, {
      value: snapshot,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "exit") {
      activeAncestors.delete(frame.source);
      if (frame.snapshot !== undefined) Object.freeze(frame.snapshot);
      continue;
    }
    if (frame.depth > MAX_JSON_DEPTH) throw invalidJson();
    nodeCount += 1;
    if (nodeCount > MAX_JSON_NODES) throw invalidJson();

    const current = frame.value;
    if (
      current === null ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    ) {
      if (frame.destination !== undefined) assignSnapshot(frame.destination, current);
      continue;
    }
    if (typeof current === "string") {
      addUtf8(current);
      if (frame.destination !== undefined) assignSnapshot(frame.destination, current);
      continue;
    }
    if (typeof current !== "object" || activeAncestors.has(current)) throw invalidJson();

    if (Array.isArray(current)) {
      if (current.length > MAX_JSON_NODES) throw invalidJson();
      const keys = Reflect.ownKeys(current);
      if (
        keys.length !== current.length + 1 ||
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" &&
              (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length)),
        )
      ) {
        throw invalidJson();
      }
      const snapshot = createSnapshot ? Array.from<unknown>({ length: current.length }) : undefined;
      if (snapshot !== undefined && frame.destination !== undefined) {
        assignSnapshot(frame.destination, snapshot);
      }
      activeAncestors.add(current);
      stack.push(Object.freeze({ kind: "exit", source: current, snapshot }));
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (
          descriptor === undefined ||
          !Object.prototype.hasOwnProperty.call(descriptor, "value")
        ) {
          throw invalidJson();
        }
        stack.push(
          Object.freeze({
            kind: "visit",
            value: descriptor.value,
            depth: frame.depth + 1,
            ...(snapshot === undefined
              ? {}
              : {
                  destination: Object.freeze({
                    kind: "array",
                    target: snapshot,
                    index,
                  }),
                }),
          }),
        );
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw invalidJson();
    const keys = Reflect.ownKeys(current);
    if (keys.length > MAX_JSON_NODES) throw invalidJson();
    for (const key of keys) {
      if (typeof key !== "string") throw invalidJson();
      addUtf8(key);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw invalidJson();
      }
    }
    const snapshot: SnapshotObject | undefined = createSnapshot ? {} : undefined;
    if (snapshot !== undefined && frame.destination !== undefined) {
      assignSnapshot(frame.destination, snapshot);
    }
    activeAncestors.add(current);
    stack.push(Object.freeze({ kind: "exit", source: current, snapshot }));
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]! as string;
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      stack.push(
        Object.freeze({
          kind: "visit",
          value: descriptor.value,
          depth: frame.depth + 1,
          ...(snapshot === undefined
            ? {}
            : {
                destination: Object.freeze({
                  kind: "object",
                  target: snapshot,
                  key,
                }),
              }),
        }),
      );
    }
  }

  return createSnapshot ? rootSnapshot : value;
}

export function isBoundedActestraMainModelJsonValue(value: unknown): boolean {
  try {
    traverseJson(value, false);
    return true;
  } catch {
    return false;
  }
}

export function snapshotBoundedActestraMainModelJsonValue(value: unknown): unknown {
  return traverseJson(value, true);
}
