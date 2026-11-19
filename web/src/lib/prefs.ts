// 이 기기에만 기억하는 설정. AnglerBox 의 모든 앱이 같은 출처라서 키에 "facepuzzle:" 를 붙인다.
// 사생활 보호 창 등에서 저장소가 막혀도 앱은 기본값으로 돌아간다.
const PREFIX = "facepuzzle:";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 저장 못 해도 지금 화면에는 그대로 쓴다
  }
}
