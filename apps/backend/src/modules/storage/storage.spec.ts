import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage, sniffDocumentType } from './storage.provider';

describe('sniffDocumentType', () => {
  it('recognises JPEG, PNG and PDF by content', () => {
    expect(sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffDocumentType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  });

  it.each([
    ['HTML', Buffer.from('<html>')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['GIF', Buffer.from('GIF89a')],
    ['empty', Buffer.alloc(0)],
    ['ZIP/DOCX', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('rejects %s', (_name, data) => {
    expect(sniffDocumentType(data)).toBeNull();
  });
});

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'horide-storage-'));
    storage = new LocalDiskStorage(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores and reads back a file', async () => {
    await storage.put('a/b/c', Buffer.from('hello'), 'text/plain');
    expect((await storage.get('a/b/c')).toString()).toBe('hello');
  });

  it('refuses to overwrite an existing file', async () => {
    await storage.put('once', Buffer.from('1'), 'text/plain');
    await expect(storage.put('once', Buffer.from('2'), 'text/plain')).rejects.toThrow();
  });

  it('blocks path traversal', async () => {
    await expect(storage.get('../../etc/passwd')).rejects.toThrow(/invalid storage key/);
    await expect(storage.put('a/../../x', Buffer.from('x'), 'text/plain')).rejects.toThrow();
  });
});
