import { describe, expect, it } from 'vitest';
import { ALLOWED_MIME_TYPES, detectFileType } from './file-signature';

describe('detectFileType', () => {
  it('detects JPEG', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectFileType(buf)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('detects PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectFileType(buf)).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('detects GIF', () => {
    const buf = Buffer.from('GIF89a');
    expect(detectFileType(buf)).toEqual({ mimeType: 'image/gif', extension: 'gif' });
  });

  it('detects WEBP with RIFF wildcard size', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0xaa, 0xbb, 0xcc, 0xdd, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectFileType(buf)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('detects PDF', () => {
    const buf = Buffer.from('%PDF-1.7\n');
    expect(detectFileType(buf)).toEqual({ mimeType: 'application/pdf', extension: 'pdf' });
  });

  it('returns null for unknown content', () => {
    const buf = Buffer.from('not a real file');
    expect(detectFileType(buf)).toBeNull();
  });

  it('returns null for too-short buffer', () => {
    expect(detectFileType(Buffer.from([0x89]))).toBeNull();
  });

  it('exposes the same allowed mime types as detectable signatures', () => {
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_MIME_TYPES).not.toContain('text/html');
  });
});
