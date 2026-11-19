// 잭팟: 돌아가는 부위가 모두 같은 가족 작가의 그림으로 맞춰지면 터진다.
// 후보 그림에 작가가 한 명뿐이면 매번 터지므로, 작가가 2명 이상일 때만 센다. 기본 예시 그림(authorId null)은 빼고 센다.

export interface JackpotItem {
  authorId: string | null;
}

export const JACKPOT_MIN_PARTS = 3;

/**
 * @param result 돌아가는 부위별 멈춘 그림
 * @param candidateAuthors 돌아가는 부위들의 후보 그림에 나온 작가 id (예시 그림 제외)
 * @returns 잭팟 작가 id, 아니면 null
 */
export function findJackpot(result: JackpotItem[], candidateAuthors: ReadonlySet<string>): string | null {
  if (result.length < JACKPOT_MIN_PARTS) return null;
  if (candidateAuthors.size < 2) return null;
  const first = result[0].authorId;
  if (!first) return null;
  return result.every((item) => item.authorId === first) ? first : null;
}
