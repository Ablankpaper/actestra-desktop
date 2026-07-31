import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { assertOfficeDocumentModel, type OfficeDocumentModel } from "../../core";

export const MAX_OFFICE_DOCUMENT_PACKAGE_BYTES = 1024 * 1024;

export class OfficeDocumentWriterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OfficeDocumentWriterError";
  }
}

export async function createOfficeDocumentPackage(model: OfficeDocumentModel): Promise<Uint8Array> {
  assertOfficeDocumentModel(model);
  const document = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: model.title, bold: true })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Owner: ", bold: true }),
              new TextRun({ text: model.owner }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: model.summary })] }),
          ...model.sections.flatMap((section) => [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [new TextRun({ text: section.heading, bold: true })],
            }),
            new Paragraph({ children: [new TextRun({ text: section.body })] }),
          ]),
        ],
      },
    ],
  });

  let bytes: Uint8Array;
  try {
    bytes = await Packer.toBuffer(document);
  } catch (error) {
    throw new OfficeDocumentWriterError("Office document package generation failed", {
      cause: error,
    });
  }
  if (bytes.byteLength > MAX_OFFICE_DOCUMENT_PACKAGE_BYTES) {
    throw new OfficeDocumentWriterError(
      `Office document package exceeds ${MAX_OFFICE_DOCUMENT_PACKAGE_BYTES} bytes`,
    );
  }
  return bytes;
}
