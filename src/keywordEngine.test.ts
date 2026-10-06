import {rankKeywords} from './keywordEngine';

describe('rankKeywords', () => {
  it('puts a matching existing keyword before new terms', () => {
    const suggestions = rankKeywords({
      heading: 'Project planning',
      text: 'Project planning covers the roadmap. The roadmap needs a project owner.',
      existingKeywords: ['project', 'career'],
    });
    expect(suggestions[0]).toEqual(expect.objectContaining({keyword: 'project', isExisting: true}));
    expect(suggestions).toContainEqual(expect.objectContaining({keyword: 'roadmap', isExisting: false}));
  });

  it('suggests a repeated two-word phrase', () => {
    const suggestions = rankKeywords({
      text: 'Budget planning starts today. Budget planning needs a final review.',
      existingKeywords: [],
    });
    expect(suggestions).toContainEqual(expect.objectContaining({keyword: 'Budget planning', isExisting: false}));
  });

  it('boosts a category phrase above its individual words', () => {
    const suggestions = rankKeywords({
      text: 'Recipe testing is useful. Recipe testing needs recipe testing notes.',
      existingKeywords: [],
    });
    expect(suggestions[0]).toEqual(expect.objectContaining({keyword: 'Recipe testing'}));
  });

  it('does not offer a plural variant of a known keyword', () => {
    const suggestions = rankKeywords({
      text: 'Meetings have meetings every week. Meetings need notes.',
      existingKeywords: ['meeting'],
    });
    expect(suggestions.map(suggestion => suggestion.keyword.toLocaleLowerCase())).not.toContain('meetings');
  });

  it('does not dilute an established multi-word keyword with one component', () => {
    const suggestions = rankKeywords({
      text: 'Unification needs review. Unification is ready for release.',
      existingKeywords: ['SR Unification'],
    });
    expect(suggestions.map(suggestion => suggestion.keyword.toLocaleLowerCase())).not.toContain('unification');
  });

  it('does not suggest a keyword already added to the page', () => {
    expect(rankKeywords({
      text: 'Meeting notes for the meeting tomorrow.',
      existingKeywords: ['meeting'],
      alreadyOnPage: ['meeting'],
    })).toEqual([]);
  });

  it('keeps the user’s existing capitalization when reusing vocabulary', () => {
    expect(rankKeywords({
      text: 'TODO: finish this todo before Friday.',
      existingKeywords: ['TODO'],
    })[0]).toEqual(expect.objectContaining({keyword: 'TODO', isExisting: true}));
  });

  it('returns no more than five suggestions', () => {
    const suggestions = rankKeywords({
      text: 'alpha alpha beta beta gamma gamma delta delta epsilon epsilon zeta zeta',
      existingKeywords: [],
    });
    expect(suggestions).toHaveLength(5);
  });

  it('includes native keyword locations in a familiar suggestion', () => {
    const suggestion = rankKeywords({
      text: 'Recipes make recipes easier to find.',
      existingKeywords: [{keyword: 'recipes', locations: ['Meal ideas · p. 4']}],
    })[0];
    expect(suggestion).toEqual(expect.objectContaining({locations: ['Meal ideas · p. 4']}));
  });
});
