import { describe, expect, it } from 'vitest';
import { checkUpload, contentDisposition, safeFileName, sniffType } from './file-type.js';

const pdf = Buffer.from('%PDF-1.7\n%%EOF');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const zip = (names: string[]) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join('\0'))]);
const docx = zip(['[Content_Types].xml', 'word/document.xml']);

describe('upload file checks', () => {
  it('recognises allowed types by content', () => {
    expect(sniffType(pdf)).toBe('application/pdf');
    expect(sniffType(png)).toBe('image/png');
    expect(sniffType(jpg)).toBe('image/jpeg');
    expect(sniffType(docx)).toContain('wordprocessingml');
  });

  it('rejects other ZIPs, macro documents, HTML and executables', () => {
    expect(sniffType(zip(['[Content_Types].xml', 'xl/workbook.xml']))).toBeNull();
    expect(
      sniffType(zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'])),
    ).toBeNull();
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('content and extension must agree; empty and oversized files are rejected', () => {
    expect(checkUpload(pdf, 'passport.pdf')).toMatchObject({
      ok: true,
      mimeType: 'application/pdf',
    });
    expect(checkUpload(jpg, 'photo.JPEG')).toMatchObject({ ok: true });
    expect(checkUpload(pdf, 'passport.png')).toMatchObject({ ok: false });
    expect(checkUpload(Buffer.from('<svg/>'), 'x.pdf')).toMatchObject({ ok: false });
    expect(checkUpload(Buffer.alloc(0), 'x.pdf')).toMatchObject({ ok: false });
    expect(
      checkUpload(Buffer.concat([pdf, Buffer.alloc(20 * 1024 * 1024)]), 'big.pdf'),
    ).toMatchObject({ ok: false });
  });

  it('file names are cleaned for storage and download headers', () => {
    expect(safeFileName('C:\\Users\\me\\..\\passport.pdf')).toBe('passport.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a"b\u0007.pdf')).toBe('ab.pdf');
    expect(contentDisposition('Pässport "1".pdf')).toBe(
      `attachment; filename="P_ssport _1_.pdf"; filename*=UTF-8''P%C3%A4ssport%20%221%22.pdf`,
    );
  });
});
