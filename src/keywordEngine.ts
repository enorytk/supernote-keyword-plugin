export type ExistingKeyword = {keyword: string; locations?: string[]};

export type RankedKeyword = {
  keyword: string;
  reason: string;
  score: number;
  isExisting: boolean;
  locations?: string[];
};

export type RankInput = {
  text: string;
  heading?: string;
  existingKeywords: Array<string | ExistingKeyword>;
  alreadyOnPage?: string[];
};

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'but', 'by', 'can', 'do', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'me', 'more', 'most', 'my', 'no', 'not', 'of', 'on', 'one', 'or', 'our', 'out', 'she', 'so', 'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'would', 'you', 'your',
]);

// Useful filing concepts when they are part of a phrase. They do not make a
// generic word eligible on its own or override the user's vocabulary.
const CATEGORY_WORDS = new Set([
  'career', 'client', 'decision', 'finance', 'goal', 'health', 'idea',
  'learning', 'meeting', 'plan', 'planning', 'project', 'recipe', 'research',
  'review', 'task', 'travel',
]);

type Token = {raw: string; normalized: string};
type Candidate = {keyword: string; appearances: number; isPhrase: boolean; properName: boolean};

function normalize(value: string): string { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

// Prevent trivial variants such as `meeting` and `meetings` competing without
// pretending to be a full linguistic stemmer.
function canonical(value: string): string {
  return normalize(value).split(' ').map(word => {
    if (word.endsWith('ies') && word.length > 4) {return `${word.slice(0, -3)}y`;}
    // Keep words such as `business`, `class`, and `analysis` intact.
    if (/(?:ss|us|is)$/.test(word)) {return word;}
    return word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word;
  }).join(' ');
}

function escapeForRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countPhrase(text: string, phrase: string): number { return text.match(new RegExp(`\\b${escapeForRegex(phrase)}\\b`, 'gi'))?.length ?? 0; }
function isContentWord(value: string): boolean { return value.length > 2 && !STOP_WORDS.has(value); }
function tokens(text: string): Token[] {
  return text.match(/[\p{L}][\p{L}\p{N}'’-]*/gu)?.map(raw => ({raw, normalized: raw.toLocaleLowerCase()})) ?? [];
}
function isProperName(token: Token): boolean { return /^\p{Lu}/u.test(token.raw) && token.raw !== token.raw.toLocaleUpperCase(); }
function displayPhrase(parts: Token[]): string { return parts.map(part => part.raw).join(' '); }
function hasCategoryWord(keyword: string): boolean { return normalize(keyword).split(' ').some(word => CATEGORY_WORDS.has(word)); }

function collectCandidates(text: string, heading: string): Candidate[] {
  const pageTokens = tokens(text);
  const counts = new Map<string, Candidate>();
  const add = (parts: Token[]) => {
    if (!parts.every(part => isContentWord(part.normalized))) {return;}
    const keyword = displayPhrase(parts);
    const key = normalize(keyword);
    const current = counts.get(key);
    counts.set(key, {
      keyword: current?.keyword ?? keyword,
      appearances: (current?.appearances ?? 0) + 1,
      isPhrase: parts.length > 1,
      properName: (current?.properName ?? false) || parts.some(isProperName),
    });
  };

  for (let index = 0; index < pageTokens.length; index += 1) {
    add(pageTokens.slice(index, index + 1));
    // Adjacent, content-only phrases avoid joining unrelated sentence words.
    if (index + 1 < pageTokens.length) {add(pageTokens.slice(index, index + 2));}
    if (index + 2 < pageTokens.length) {add(pageTokens.slice(index, index + 3));}
  }

  const headingKeys = new Set<string>();
  const headingTokens = tokens(heading);
  for (let index = 0; index < headingTokens.length; index += 1) {
    for (const length of [1, 2, 3]) {
      const parts = headingTokens.slice(index, index + length);
      if (parts.length === length && parts.every(part => isContentWord(part.normalized))) {headingKeys.add(normalize(displayPhrase(parts)));}
    }
  }

  return [...counts.values()].map(candidate => ({...candidate, appearances: candidate.appearances + (headingKeys.has(normalize(candidate.keyword)) ? 1 : 0)}));
}

export function rankKeywords(input: RankInput): RankedKeyword[] {
  const text = input.text.trim();
  const heading = input.heading?.trim() ?? '';
  const alreadyOnPage = new Set((input.alreadyOnPage ?? []).map(canonical));
  const vocabulary = new Map<string, ExistingKeyword>();
  for (const item of input.existingKeywords) {
    const entry = typeof item === 'string' ? {keyword: item} : item;
    const key = canonical(entry.keyword);
    if (!key || alreadyOnPage.has(key)) {continue;}
    const prior = vocabulary.get(key);
    vocabulary.set(key, {
      keyword: prior?.keyword ?? entry.keyword.trim(),
      locations: [...new Set([...(prior?.locations ?? []), ...(entry.locations ?? [])])],
    });
  }

  const familiar = [...vocabulary.values()]
    .map(entry => {
      const appearances = countPhrase(text, entry.keyword);
      const headingAppearances = countPhrase(heading, entry.keyword);
      return {...entry, appearances, headingAppearances, score: 100 + appearances * 18 + headingAppearances * 35};
    })
    .filter(entry => entry.appearances > 0 || entry.headingAppearances > 0)
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, 5);

  const knownForms = new Set([...vocabulary.keys(), ...alreadyOnPage]);
  // A known phrase is already the more useful retrieval handle. Do not dilute
  // it by offering one of its distinctive words as a new one-word keyword
  // (for example, `unification` when `SR Unification` already exists).
  const knownPhraseComponents = new Set(
    [...vocabulary.values()]
      .filter(entry => tokens(entry.keyword).length > 1)
      .flatMap(entry => tokens(entry.keyword).map(token => canonical(token.normalized)))
      .filter(component => isContentWord(component)),
  );
  const familiarKeys = new Set(familiar.map(entry => canonical(entry.keyword)));
  const newTerms = collectCandidates(text, heading)
    .filter(candidate => {
      const key = canonical(candidate.keyword);
      const inHeading = countPhrase(heading, candidate.keyword) > 0;
      return !knownForms.has(key)
        && !familiarKeys.has(key)
        && (candidate.isPhrase || !knownPhraseComponents.has(key))
        && (candidate.appearances >= 2 || inHeading);
    })
    .map(candidate => {
      const inHeading = countPhrase(heading, candidate.keyword) > 0;
      const categoryBonus = candidate.isPhrase && hasCategoryWord(candidate.keyword) ? 12 : 0;
      const specificityBonus = candidate.isPhrase ? 22 : candidate.keyword.length >= 7 ? 5 : 0;
      const properNameBonus = candidate.properName ? 12 : 0;
      const score = candidate.appearances * 10 + (inHeading ? 20 : 0) + categoryBonus + specificityBonus + properNameBonus;
      const type = candidate.isPhrase ? 'specific phrase' : 'topic word';
      const qualifier = categoryBonus ? ' Includes a filing/category term.' : '';
      return {
        keyword: candidate.keyword,
        score,
        isExisting: false,
        reason: `New ${type}; used ${candidate.appearances} time${candidate.appearances === 1 ? '' : 's'} on this page.${inHeading ? ' Also in the heading.' : ''}${qualifier}`,
      };
    })
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));

  const familiarResults: RankedKeyword[] = familiar.map(entry => ({
    keyword: entry.keyword,
    score: entry.score,
    isExisting: true,
    locations: entry.locations?.slice(0, 3),
    reason: `Existing keyword; appears ${entry.appearances} time${entry.appearances === 1 ? '' : 's'} on this page.`,
  }));

  // Familiar vocabulary always leads. When only one or two familiar matches
  // fit, fill the remaining slots with retrieval-worthy page concepts.
  return familiarResults.length <= 2
    ? [...familiarResults, ...newTerms].slice(0, 5)
    : familiarResults;
}
