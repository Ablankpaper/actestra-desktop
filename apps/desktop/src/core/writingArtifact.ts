export const WRITING_ARTIFACT_MAX_TITLE_BYTES = 256;
export const WRITING_ARTIFACT_MAX_AUDIENCE_BYTES = 256;
export const WRITING_ARTIFACT_MAX_PURPOSE_BYTES = 2 * 1024;
export const WRITING_ARTIFACT_MAX_POINT_BYTES = 2 * 1024;
export const WRITING_ARTIFACT_MAX_POINTS = 8;

export interface WritingArtifactBrief {
  readonly title: string;
  readonly audience: string;
  readonly purpose: string;
  readonly points: readonly string[];
}

export class WritingArtifactBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritingArtifactBriefError";
  }
}

function containsForbiddenControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 31 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    );
  });
}

function parseField(line: string, prefix: string, maximumBytes: number): string {
  if (!line.startsWith(prefix)) {
    throw new WritingArtifactBriefError(`Writing brief requires ${prefix.trim()} in order`);
  }
  const value = line.slice(prefix.length);
  if (
    value.length === 0 ||
    value.trim() !== value ||
    containsForbiddenControl(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new WritingArtifactBriefError(`${prefix.trim()} must contain bounded text`);
  }
  return value;
}

export function parseWritingArtifactBrief(value: string): WritingArtifactBrief {
  if (typeof value !== "string") {
    throw new WritingArtifactBriefError("Writing brief must be text");
  }
  const lines = value.split(/\r?\n/u);
  if (lines.length < 4 || lines.length > 3 + WRITING_ARTIFACT_MAX_POINTS) {
    throw new WritingArtifactBriefError("Writing brief requires one through eight points");
  }

  const title = parseField(lines[0] ?? "", "Title: ", WRITING_ARTIFACT_MAX_TITLE_BYTES);
  const audience = parseField(lines[1] ?? "", "Audience: ", WRITING_ARTIFACT_MAX_AUDIENCE_BYTES);
  const purpose = parseField(lines[2] ?? "", "Purpose: ", WRITING_ARTIFACT_MAX_PURPOSE_BYTES);
  const points = lines
    .slice(3)
    .map((line) => parseField(line, "Point: ", WRITING_ARTIFACT_MAX_POINT_BYTES));

  return Object.freeze({
    title,
    audience,
    purpose,
    points: Object.freeze(points),
  });
}
