import fs from "node:fs";
import path from "node:path";

const [outputPath, ...inputPaths] = process.argv.slice(2);

if (!outputPath || inputPaths.length === 0) {
  throw new Error("Usage: node script/generate_windows_icon.mjs <output.ico> <input.png>...");
}

function readPngDimensions(contents, inputPath) {
  const pngSignature = "89504e470d0a1a0a";
  if (contents.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`Not a PNG file: ${inputPath}`);
  }
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

const images = inputPaths.map((inputPath) => {
  const contents = fs.readFileSync(inputPath);
  const { width, height } = readPngDimensions(contents, inputPath);
  if (width !== height || width > 256 || width < 1) {
    throw new Error(`ICO input must be square and at most 256px: ${inputPath}`);
  }
  return { contents, size: width };
});

const headerSize = 6;
const entrySize = 16;
const payloadOffset = headerSize + entrySize * images.length;
const header = Buffer.alloc(payloadOffset);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let cursor = payloadOffset;
images.forEach(({ contents, size }, index) => {
  const offset = headerSize + index * entrySize;
  header.writeUInt8(size === 256 ? 0 : size, offset);
  header.writeUInt8(size === 256 ? 0 : size, offset + 1);
  header.writeUInt8(0, offset + 2);
  header.writeUInt8(0, offset + 3);
  header.writeUInt16LE(1, offset + 4);
  header.writeUInt16LE(32, offset + 6);
  header.writeUInt32LE(contents.length, offset + 8);
  header.writeUInt32LE(cursor, offset + 12);
  cursor += contents.length;
});

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([header, ...images.map(({ contents }) => contents)]));
