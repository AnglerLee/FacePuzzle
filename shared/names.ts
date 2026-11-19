// 완성 얼굴에 붙이는 랜덤 별명. 예: "뽀글뽀글 감자"

export const ADJECTIVES = [
  "뽀글뽀글", "말랑말랑", "반짝반짝", "꾸벅꾸벅", "씰룩씰룩", "엉뚱한", "새침한", "용감한",
  "졸린", "배고픈", "신난", "수줍은", "우당탕", "데굴데굴", "방긋방긋", "깜짝 놀란",
  "개구쟁이", "느긋한", "투덜투덜", "싱글벙글", "꼬질꼬질", "동글동글", "삐죽삐죽", "보들보들",
  "우쭐한", "깡총깡총", "어리둥절", "콧노래 부르는", "심심한", "부끄러운",
] as const;

export const NOUNS = [
  "왕눈이", "감자", "고구마", "만두", "찐빵", "왕자님", "공주님", "대장",
  "박사님", "요정", "도깨비", "외계인", "꼬마 마법사", "해적", "우주인", "곰돌이",
  "펭귄", "고양이", "병아리", "오리", "문어", "떡볶이", "붕어빵", "솜사탕",
  "젤리", "호박", "선장님", "공룡", "눈사람", "도토리",
] as const;

export function randomName(random: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(random() * NOUNS.length)];
  return `${adj} ${noun}`;
}
