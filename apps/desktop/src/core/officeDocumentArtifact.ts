export const OFFICE_DOCUMENT_MAX_TITLE_BYTES = 256;
export const OFFICE_DOCUMENT_MAX_OWNER_BYTES = 256;
export const OFFICE_DOCUMENT_MAX_SUMMARY_BYTES = 2 * 1024;
export const OFFICE_DOCUMENT_MAX_SECTION_HEADING_BYTES = 256;
export const OFFICE_DOCUMENT_MAX_SECTION_BODY_BYTES = 2 * 1024;
export const OFFICE_DOCUMENT_MAX_SECTIONS = 6;
export const OFFICE_DOCUMENT_MODEL_CONTRACT_VERSION = 1 as const;
export const OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH = "brief.docx" as const;

export interface OfficeDocumentSection {
  readonly heading: string;
  readonly body: string;
}

export interface OfficeDocumentBrief {
  readonly title: string;
  readonly owner: string;
  readonly summary: string;
  readonly sections: readonly OfficeDocumentSection[];
}

export interface OfficeDocumentModel {
  readonly contractVersion: typeof OFFICE_DOCUMENT_MODEL_CONTRACT_VERSION;
  readonly title: string;
  readonly owner: string;
  readonly summary: string;
  readonly sections: readonly OfficeDocumentSection[];
}

export class OfficeDocumentBriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeDocumentBriefError";
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

function boundedField(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    containsForbiddenControl(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new OfficeDocumentBriefError(`${label} must contain bounded text`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new OfficeDocumentBriefError(`${label} has unsupported fields`);
  }
}

export function assertOfficeDocumentModel(value: unknown): asserts value is OfficeDocumentModel {
  if (!isRecord(value)) {
    throw new OfficeDocumentBriefError("Office document model must be an object");
  }
  assertExactKeys(
    value,
    ["contractVersion", "title", "owner", "summary", "sections"],
    "Office document model",
  );
  if (value.contractVersion !== OFFICE_DOCUMENT_MODEL_CONTRACT_VERSION) {
    throw new OfficeDocumentBriefError("Office document model contract version is unsupported");
  }
  boundedField(value.title, "Office document title", OFFICE_DOCUMENT_MAX_TITLE_BYTES);
  boundedField(value.owner, "Office document owner", OFFICE_DOCUMENT_MAX_OWNER_BYTES);
  boundedField(value.summary, "Office document summary", OFFICE_DOCUMENT_MAX_SUMMARY_BYTES);
  if (
    !Array.isArray(value.sections) ||
    value.sections.length < 1 ||
    value.sections.length > OFFICE_DOCUMENT_MAX_SECTIONS
  ) {
    throw new OfficeDocumentBriefError("Office document model requires one through six sections");
  }
  for (const section of value.sections) {
    if (!isRecord(section)) {
      throw new OfficeDocumentBriefError("Office document section must be an object");
    }
    assertExactKeys(section, ["heading", "body"], "Office document section");
    boundedField(
      section.heading,
      "Office section heading",
      OFFICE_DOCUMENT_MAX_SECTION_HEADING_BYTES,
    );
    boundedField(section.body, "Office section body", OFFICE_DOCUMENT_MAX_SECTION_BODY_BYTES);
  }
}

export function officeDocumentModelFromBrief(brief: OfficeDocumentBrief): OfficeDocumentModel {
  const value = Object.freeze({
    contractVersion: OFFICE_DOCUMENT_MODEL_CONTRACT_VERSION,
    title: brief.title,
    owner: brief.owner,
    summary: brief.summary,
    sections: Object.freeze(
      brief.sections.map((section) =>
        Object.freeze({
          heading: section.heading,
          body: section.body,
        }),
      ),
    ),
  });
  assertOfficeDocumentModel(value);
  return value;
}

function parseField(line: string, prefix: string, maximumBytes: number): string {
  if (!line.startsWith(prefix)) {
    throw new OfficeDocumentBriefError(`Office brief requires ${prefix.trim()} in order`);
  }
  return boundedField(line.slice(prefix.length), prefix.trim(), maximumBytes);
}

function parseSection(line: string): OfficeDocumentSection {
  const prefix = "Section: ";
  if (!line.startsWith(prefix)) {
    throw new OfficeDocumentBriefError("Office brief requires Section: heading | body in order");
  }
  const value = line.slice(prefix.length);
  const separator = value.indexOf(" | ");
  if (separator < 1) {
    throw new OfficeDocumentBriefError("Office brief Section requires heading | body");
  }
  return Object.freeze({
    heading: boundedField(
      value.slice(0, separator),
      "Office section heading",
      OFFICE_DOCUMENT_MAX_SECTION_HEADING_BYTES,
    ),
    body: boundedField(
      value.slice(separator + 3),
      "Office section body",
      OFFICE_DOCUMENT_MAX_SECTION_BODY_BYTES,
    ),
  });
}

export function parseOfficeDocumentBrief(value: string): OfficeDocumentBrief {
  if (typeof value !== "string") {
    throw new OfficeDocumentBriefError("Office brief must be text");
  }
  const lines = value.split(/\r?\n/u);
  if (lines.length < 4 || lines.length > 3 + OFFICE_DOCUMENT_MAX_SECTIONS) {
    throw new OfficeDocumentBriefError("Office brief requires one through six sections");
  }

  return Object.freeze({
    title: parseField(lines[0] ?? "", "Document: ", OFFICE_DOCUMENT_MAX_TITLE_BYTES),
    owner: parseField(lines[1] ?? "", "Owner: ", OFFICE_DOCUMENT_MAX_OWNER_BYTES),
    summary: parseField(lines[2] ?? "", "Summary: ", OFFICE_DOCUMENT_MAX_SUMMARY_BYTES),
    sections: Object.freeze(lines.slice(3).map(parseSection)),
  });
}
