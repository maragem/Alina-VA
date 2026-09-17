import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTIC_LENGTH = 8_000;
const CONVERTIBLE_EXTENSIONS = new Set([".doc", ".odt"]);
const PDF_CONVERSION_EXTENSIONS = new Set([".docx"]);

export type DocumentConversionFailure =
  | "converter-unavailable"
  | "invalid-document"
  | "output-too-large"
  | "timeout";

export class DocumentConversionError extends Error {
  constructor(
    readonly reason: DocumentConversionFailure,
    message: string,
  ) {
    super(message);
    this.name = "DocumentConversionError";
  }
}

export type ConvertedDocument = {
  bytes: Buffer;
  fileName: string;
};

let conversionQueue: Promise<void> = Promise.resolve();

export function isConvertibleDocument(fileName: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

export function getConvertedFileName(fileName: string): string {
  const safeName = basename(fileName);
  const extension = extname(safeName);
  const stem = safeName.slice(0, -extension.length).trim() || "document";
  return `${stem}.docx`;
}

function runLibreOffice(
  inputPath: string,
  outputDirectory: string,
  profileDirectory: string,
  outputFormat: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "soffice",
      [
        "--headless",
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        "--convert-to",
        outputFormat,
        "--outdir",
        outputDirectory,
        inputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let diagnostic = "";
    let timedOut = false;

    child.stderr.on("data", (chunk: Buffer) => {
      if (diagnostic.length < MAX_DIAGNOSTIC_LENGTH) {
        diagnostic += chunk.toString().slice(0, MAX_DIAGNOSTIC_LENGTH - diagnostic.length);
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CONVERSION_TIMEOUT_MS);

    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(new DocumentConversionError(
        error.code === "ENOENT" ? "converter-unavailable" : "invalid-document",
        error.message,
      ));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new DocumentConversionError("timeout", "LibreOffice conversion timed out."));
      } else if (code !== 0) {
        reject(new DocumentConversionError(
          "invalid-document",
          diagnostic.trim() || `LibreOffice exited with code ${code ?? "unknown"}.`,
        ));
      } else {
        resolve();
      }
    });
  });
}

async function convertDocumentNow(
  bytes: Uint8Array,
  fileName: string,
  maximumOutputSize: number,
  sourceExtensions: Set<string>,
  outputExtension: string,
  outputFormat: string,
): Promise<ConvertedDocument> {
  const sourceExtension = extname(fileName).toLowerCase();
  if (!sourceExtensions.has(sourceExtension)) {
    throw new DocumentConversionError("invalid-document", "The source format is not convertible.");
  }

  const jobDirectory = await mkdtemp(join(tmpdir(), "alina-conversion-"));
  const outputDirectory = join(jobDirectory, "output");
  const profileDirectory = join(jobDirectory, "profile");
  const inputPath = join(jobDirectory, `input${sourceExtension}`);
  const outputPath = join(outputDirectory, `input${outputExtension}`);

  try {
    await Promise.all([
      mkdir(outputDirectory),
      mkdir(profileDirectory),
      writeFile(inputPath, bytes),
    ]);
    await runLibreOffice(inputPath, outputDirectory, profileDirectory, outputFormat);

    let outputSize: number;
    try {
      outputSize = (await stat(outputPath)).size;
    } catch {
      throw new DocumentConversionError("invalid-document", "LibreOffice did not produce a DOCX file.");
    }
    if (outputSize === 0) {
      throw new DocumentConversionError("invalid-document", "LibreOffice produced an empty DOCX file.");
    }
    if (outputSize > maximumOutputSize) {
      throw new DocumentConversionError("output-too-large", "The converted DOCX exceeds the size limit.");
    }

    return {
      bytes: await readFile(outputPath),
      fileName: outputExtension === ".docx"
        ? getConvertedFileName(fileName)
        : `${basename(fileName, sourceExtension)}${outputExtension}`,
    };
  } finally {
    await rm(jobDirectory, { recursive: true, force: true });
  }
}

export function convertDocumentToDocx(
  bytes: Uint8Array,
  fileName: string,
  maximumOutputSize: number,
): Promise<ConvertedDocument> {
  const conversion = conversionQueue.then(() =>
    convertDocumentNow(
      bytes,
      fileName,
      maximumOutputSize,
      CONVERTIBLE_EXTENSIONS,
      ".docx",
      "docx:Office Open XML Text",
    ),
  );
  conversionQueue = conversion.then(() => undefined, () => undefined);
  return conversion;
}

export function convertDocxToPdf(
  bytes: Uint8Array,
  fileName: string,
  maximumOutputSize: number,
): Promise<ConvertedDocument> {
  const conversion = conversionQueue.then(() =>
    convertDocumentNow(
      bytes,
      fileName,
      maximumOutputSize,
      PDF_CONVERSION_EXTENSIONS,
      ".pdf",
      "pdf:writer_pdf_Export",
    ),
  );
  conversionQueue = conversion.then(() => undefined, () => undefined);
  return conversion;
}