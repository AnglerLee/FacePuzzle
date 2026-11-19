// 앨범 얼굴을 한 장의 PNG 로 합성한다 (저장·공유용).
import { imageBox, PARTS_BY_Z, type PartId } from "@shared/parts";

const SIZE = 1000;
const FOOTER = 140;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function composeFace(srcs: Partial<Record<PartId, string>>, name: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE + FOOTER;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 쓸 수 없어요");
  ctx.fillStyle = "#fff8ec";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const images = await Promise.all(PARTS_BY_Z.map((p) => (srcs[p.id] ? loadImage(srcs[p.id]!) : Promise.resolve(null))));
  PARTS_BY_Z.forEach((p, i) => {
    const img = images[i];
    if (!img) return;
    const b = imageBox(p);
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
  });

  ctx.fillStyle = "#5b3a1e";
  ctx.font = `64px Jua, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, SIZE / 2, SIZE + FOOTER / 2 - 10, SIZE - 80);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했어요"))), "image/png");
  });
}

/** 휴대폰이면 공유 창, 아니면 파일로 내려받기 */
export async function shareOrDownload(blob: Blob, name: string): Promise<"shared" | "downloaded"> {
  const fileName = `${name.replace(/[\\/:*?"<>|]/g, "")}.png`;
  const file = new File([blob], fileName, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
