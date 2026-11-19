// PNG 머리(시그니처·IHDR)와 끝(IEND)만 확인하는 가벼운 검사기. 디코딩은 하지 않는다.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** PNG 규격이 허용하는 색 형식별 비트 깊이 */
const VALID_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

export function readPngHeader(buf: Uint8Array): PngHeader | null {
  if (buf.length < 8 + 25 + IEND.length) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (buf[i] !== SIGNATURE[i]) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 첫 청크는 길이 13인 IHDR 이어야 한다
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (!VALID_DEPTHS[colorType]?.includes(bitDepth)) return null;
  // 끝은 IEND 청크로 닫혀야 한다 (잘린 파일·뒤에 덧붙인 내용 거부)
  const tail = buf.length - IEND.length;
  for (let i = 0; i < IEND.length; i++) if (buf[tail + i] !== IEND[i]) return null;
  return { width, height, bitDepth, colorType };
}
