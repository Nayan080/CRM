import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES } from '@crm/contracts';

type Allowed = (typeof ALLOWED_UPLOADS)[number];

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

/**
 * Identifies the file from its content ("magic bytes"), never from the browser's declared type.
 * DOCX is a ZIP that must contain word/document.xml; other ZIPs (and .docm/.xlsx) are rejected.
 */
export function sniffType(buf: Buffer): Allowed['mimeType'] | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const text = buf.toString('latin1');
    const isWord = text.includes('word/document.xml') && text.includes('[Content_Types].xml');
    const hasMacros = text.includes('vbaProject.bin');
    if (isWord && !hasMacros) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  }
  return null;
}

export type FileCheck =
  { ok: true; mimeType: Allowed['mimeType']; fileName: string } | { ok: false; message: string };

/** Size, content type, and file-name extension must all agree. */
export function checkUpload(buf: Buffer, originalName: string): FileCheck {
  if (!buf.length) return { ok: false, message: 'The file is empty.' };
  if (buf.length > MAX_UPLOAD_BYTES)
    return { ok: false, message: 'The file is larger than 20 MB.' };
  const mimeType = sniffType(buf);
  const allowed = ALLOWED_UPLOADS.find((a) => a.mimeType === mimeType);
  if (!mimeType || !allowed) {
    return { ok: false, message: 'Only PDF, JPG, PNG and DOCX files can be uploaded.' };
  }
  const fileName = safeFileName(originalName);
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (!(allowed.extensions as readonly string[]).includes(ext)) {
    return {
      ok: false,
      message: `The file content is ${allowed.label}, but the name ends in ".${ext}".`,
    };
  }
  return { ok: true, mimeType, fileName };
}

/** Keeps a readable name for downloads; strips paths and control characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f && ch !== '"')
    .join('')
    .trim()
    .slice(-150);
  return cleaned || 'file';
}

/** RFC 6266 header with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
