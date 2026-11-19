// 테스트용: 주어진 크기의 투명 RGBA PNG 를 만든다.
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function makePng(width: number, height: number, { padTo = 0 } = {}): Uint8Array<ArrayBuffer> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw))];
  // 크기 테스트용: 무시되는 보조 청크로 부풀린다
  if (padTo > 0) chunks.push(chunk("tEXt", Buffer.alloc(padTo)));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]));
}
