interface Signature {
  readonly mimeType: string;
  readonly extensions: readonly string[];
  readonly bytes: ReadonlyArray<number | null>; // null = wildcard
  readonly offset?: number;
}

const SIGNATURES: readonly Signature[] = [
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: 'image/png',
    extensions: ['png'],
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mimeType: 'image/gif', extensions: ['gif'], bytes: [0x47, 0x49, 0x46, 0x38] },
  {
    mimeType: 'image/webp',
    extensions: ['webp'],
    bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  { mimeType: 'application/pdf', extensions: ['pdf'], bytes: [0x25, 0x50, 0x44, 0x46] },
];

export const ALLOWED_MIME_TYPES = new Set(SIGNATURES.map((s) => s.mimeType));

// Derived from SIGNATURES, not hand-kept beside it: a second list drifts, and a format could then
// become presignable with no signature to verify it against on confirm.
export const MIME_EXTENSIONS: ReadonlyMap<string, string> = new Map(
  SIGNATURES.map((s) => [s.mimeType, s.extensions[0]]),
);

export interface DetectedFileType {
  readonly mimeType: string;
  readonly extension: string;
}

export function detectFileType(buffer: Buffer): DetectedFileType | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const expected = sig.bytes[i];
      if (expected === null) continue;
      if (buffer[offset + i] !== expected) {
        match = false;
        break;
      }
    }
    if (match) {
      return { mimeType: sig.mimeType, extension: sig.extensions[0] };
    }
  }
  return null;
}
