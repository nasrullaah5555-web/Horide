import { spawn, type ChildProcess } from 'node:child_process';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from './storage.provider';

/**
 * Runs S3Storage against moto, a local S3 emulator (`pip install "moto[server]"`).
 * Skipped when moto is not installed. This proves the requests are well-formed S3; it does NOT
 * prove the real bucket's settings (privacy, region, credentials) — that is owner action OA-12.
 */
const PORT = 5077;
const ENDPOINT = `http://127.0.0.1:${PORT}`;

let moto: ChildProcess | null = null;
let available = false;

beforeAll(async () => {
  let output = '';
  moto = spawn(process.env.MOTO_PYTHON ?? 'python3', ['-m', 'moto.server', '-p', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  moto.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  moto.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  moto.on('error', (err) => (output += String(err)));
  // A cold CI machine can take a while to import the emulator.
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(ENDPOINT);
      available = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // In CI the emulator is installed on purpose, so a missing emulator is a failure, not a skip.
  if (!available && process.env.CI) {
    throw new Error(`moto S3 emulator did not start in CI:\n${output.slice(-2000)}`);
  }
  if (available) {
    const admin = new S3Client({
      region: 'us-east-1',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await admin.send(new CreateBucketCommand({ Bucket: 'musride-docs' }));
  }
}, 45_000);

afterAll(() => {
  moto?.kill();
});

function storage(serverSideEncryption = false) {
  return new S3Storage({
    bucket: 'musride-docs',
    region: 'us-east-1',
    endpoint: ENDPOINT,
    forcePathStyle: true,
    accessKeyId: 'test',
    secretAccessKey: 'test',
    serverSideEncryption,
  });
}

describe('S3Storage (against the moto S3 emulator)', () => {
  it('stores, reads back and deletes a document', async () => {
    if (!available) return console.warn('moto not installed: S3 storage test skipped');
    const s = storage(true);
    const key =
      'driver-documents/0b8f2c7e-1d2a-4c3b-9f1e-2a3b4c5d6e7f/8e9f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await s.put(key, data, 'image/jpeg');
    expect(Buffer.compare(await s.get(key), data)).toBe(0);
    await s.remove(key);
    await expect(s.get(key)).rejects.toThrow();
  });

  it('refuses keys that could escape the documents folder', async () => {
    if (!available) return;
    const s = storage();
    await expect(s.put('../secret', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid/);
    await expect(s.put('/abs/key', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid/);
    await expect(s.get('a//b')).rejects.toThrow(/invalid/);
  });
});
