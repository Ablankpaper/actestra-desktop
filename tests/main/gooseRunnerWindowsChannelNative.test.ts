import { spawn } from "node:child_process";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

const children = new Set<ReturnType<typeof spawn>>();

afterEach(() => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  children.clear();
});

describe("Windows Goose authenticated channel primitives", () => {
  it.skipIf(process.platform !== "win32")(
    "keeps capability and model channels duplex and isolated",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          [
            "const fs=require('node:fs');",
            "const channels=[5,6];",
            "const buffers=new Map();",
            "for(const fd of channels){",
            "  const reader=fs.createReadStream(null,{fd,autoClose:false});",
            "  const writer=fs.createWriteStream(null,{fd,autoClose:false});",
            "  buffers.set(fd,'');",
            "  reader.on('data',chunk=>{",
            "    const value=buffers.get(fd)+chunk.toString('utf8');",
            "    buffers.set(fd,value);",
            "    if(value.endsWith('\\n')) writer.write(String(fd)+':'+value);",
            "  });",
            "}",
          ].join(""),
        ],
        {
          stdio: ["ignore", "pipe", "pipe", "ignore", "ignore", "overlapped", "overlapped"],
        },
      );
      children.add(child);
      const extendedStdio = child.stdio as unknown as readonly (Duplex | null | undefined)[];
      const capability = extendedStdio[5] ?? null;
      const model = extendedStdio[6] ?? null;
      expect(capability).not.toBeNull();
      expect(model).not.toBeNull();
      if (capability === null || model === null) return;

      const readReply = (stream: NodeJS.ReadableStream): Promise<string> =>
        new Promise((resolve, reject) => {
          let output = "";
          const onData = (chunk: Buffer | string): void => {
            output += chunk.toString();
            if (output.endsWith("\n")) {
              stream.removeListener("data", onData);
              resolve(output);
            }
          };
          stream.on("data", onData);
          stream.once("error", reject);
        });
      const capabilityReply = readReply(capability);
      const modelReply = readReply(model);
      capability.write("capability-nonce\n");
      model.write("model-nonce\n");
      await expect(capabilityReply).resolves.toBe("5:capability-nonce\n");
      await expect(modelReply).resolves.toBe("6:model-nonce\n");
      child.kill();
    },
  );
});
