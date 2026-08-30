/**
 * CTIS 회원국 필터(`msc`)가 받는 **ISO 3166-1 숫자 코드**.
 *
 * **표를 지어내지 않고 실측했다**(2026-08-30). 코드를 하나씩 보내 돌아온 시험들의
 * `trialCountries` 를 봤고, **그 쪽의 모든 결과에 공통으로 든 나라** 를 그 코드의 뜻으로
 * 삼았다. 28개 전부 공통 나라가 정확히 하나였다 — 애매한 것이 없었다.
 *
 * 왜 이렇게까지 하나 — 이름이나 알파벳 코드를 보내면 **0건** 이 온다(실측). 즉 코드가
 * 틀리면 "그런 시험이 없다" 로 보인다. 표를 기억으로 적었다가 하나라도 틀리면 그 나라를
 * 물은 사용자에게 조용히 빈 답이 나간다.
 *
 * 여기 없는 나라는 지원하지 않는다 — `location` 축이 그 이름을 거절하고 아는 이름을 제안한다.
 */
export const CTIS_MSC_CODES: Readonly<Record<string, string>> = {
  'Austria': '40',
  'Belgium': '56',
  'Bulgaria': '100',
  'Croatia': '191',
  'Cyprus': '196',
  'Czechia': '203',
  'Denmark': '208',
  'Estonia': '233',
  'Finland': '246',
  'France': '250',
  'Germany': '276',
  'Greece': '300',
  'Hungary': '348',
  'Iceland': '352',
  'Ireland': '372',
  'Italy': '380',
  'Latvia': '428',
  'Lithuania': '440',
  'Luxembourg': '442',
  'Netherlands': '528',
  'Norway': '578',
  'Poland': '616',
  'Portugal': '620',
  'Romania': '642',
  'Slovakia': '703',
  'Slovenia': '705',
  'Spain': '724',
  'Sweden': '752',
};

/** 대소문자와 앞뒤 공백만 눈감아 준다. 그 밖의 표기 차이는 추측하지 않는다. */
export function toMscCode(name: string): string | undefined {
  const want = name.trim().toLowerCase();
  for (const [country, code] of Object.entries(CTIS_MSC_CODES)) {
    if (country.toLowerCase() === want) return code;
  }
  return undefined;
}

export const CTIS_COUNTRY_NAMES: readonly string[] = Object.keys(CTIS_MSC_CODES);
