import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {FileUtils, PluginCommAPI, PluginFileAPI, PluginManager} from 'sn-plugin-lib';
import {ExistingKeyword, rankKeywords, RankedKeyword} from './src/keywordEngine';
import {consumePendingPress, KEYWORD_BUTTON_PRESS} from './src/pluginEvents';

type ApiResponse<T> = {success?: boolean; result?: T | null; error?: {message?: string} | null};
type PageElement = {numInPage?: number; title?: {controlTrailNums?: number[]} | null};
type FileEntry = {path?: string; type?: number};

let keywordLibrary: ExistingKeyword[] | null = null;
let libraryReadAt = 0;
const LIBRARY_CACHE_MS = 10 * 60 * 1000;
const NOTE_LIBRARY_PERMISSION = 'plugin.permission.FILE:READ';
const KEYWORD_WRITE_PERMISSION = 'plugin.permission.FILE:WRITE';

function resultOf<T>(value: unknown, action: string): T {
  const response = value as ApiResponse<T> | null | undefined;
  if (!response?.success) {throw new Error(response?.error?.message ?? `${action} failed.`);}
  if (response.result === null || response.result === undefined) {throw new Error(`${action} returned no data.`);}
  return response.result;
}

function keywordText(item: unknown): string | null {
  const value = item && typeof item === 'object' ? (item as {keyword?: unknown}).keyword : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function keywordPage(item: unknown): number | null {
  const value = item && typeof item === 'object' ? (item as {page?: unknown}).page : null;
  return typeof value === 'number' ? value : null;
}

function locationFor(notePath: string, page: number | null): string {
  const fileName = notePath.split('/').pop()?.replace(/\.note$/i, '') ?? 'Untitled note';
  return page === null ? fileName : `${fileName} · p. ${page + 1}`;
}

async function buildKeywordLibrary(): Promise<ExistingKeyword[]> {
  if (keywordLibrary && Date.now() - libraryReadAt < LIBRARY_CACHE_MS) {return keywordLibrary;}
  // `getFileList` queries removable storage through a null Activity in the
  // current PluginHost build. Walk the standard NOTE directory instead; unlike
  // that broad helper, `listFiles` operates directly on the supplied path.
  const notePaths = await findNotes('/storage/emulated/0/Note');
  const words = new Map<string, ExistingKeyword>();
  for (const notePath of notePaths) {
    try {
      const pageCount = resultOf<number>(await PluginFileAPI.getNoteTotalPageNum(notePath), `Could not read ${notePath}`);
      if (pageCount < 1) {continue;}
      const pages = Array.from({length: pageCount}, (_, index) => index);
      const response = resultOf<unknown[]>(await PluginFileAPI.getKeyWords(notePath, pages), `Could not read keywords in ${notePath}`);
      response.forEach(item => {
        const keyword = keywordText(item);
        if (!keyword) {return;}
        const key = keyword.toLocaleLowerCase();
        const existing = words.get(key);
        const location = locationFor(notePath, keywordPage(item));
        words.set(key, {keyword: existing?.keyword ?? keyword, locations: [...new Set([...(existing?.locations ?? []), location]) ]});
      });
    } catch (error) {
      // One inaccessible note should not block suggestions for the open note.
      console.warn('Skipping keyword-library source', notePath, error);
    }
  }
  keywordLibrary = [...words.values()];
  libraryReadAt = Date.now();
  return keywordLibrary;
}

async function ensureNoteLibraryPermission(): Promise<void> {
  const permissionStatus = await PluginManager.hasPermission(NOTE_LIBRARY_PERMISSION);
  if (permissionStatus > 0) {return;}
  const choice = await PluginManager.requestPermission(
    NOTE_LIBRARY_PERMISSION,
    'Keyword Suggestor needs access to your Note folder to reuse keywords already in your notes.',
  );
  if (choice === 0) {
    throw new Error('Allow Note-folder access to build suggestions from your existing keywords.');
  }
}

async function ensureKeywordWritePermission(): Promise<void> {
  const permissionStatus = await PluginManager.hasPermission(KEYWORD_WRITE_PERMISSION);
  if (permissionStatus > 0) {return;}
  const choice = await PluginManager.requestPermission(
    KEYWORD_WRITE_PERMISSION,
    'Keyword Suggestor needs permission to add a keyword only after you tap a suggestion.',
  );
  if (choice === 0) {
    throw new Error('Allow keyword-write access to add this suggestion.');
  }
}

async function findNotes(directory: string, depth = 0): Promise<string[]> {
  if (depth > 16) {return [];}
  let entries: FileEntry[];
  try {
    entries = ((await FileUtils.listFiles(directory)) ?? []) as unknown as FileEntry[];
  } catch (error) {
    console.warn('Skipping unreadable note directory', directory, error);
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.path) {continue;}
    if (entry.type === 0) {
      paths.push(...await findNotes(entry.path, depth + 1));
    } else if (entry.path.toLocaleLowerCase().endsWith('.note')) {
      paths.push(entry.path);
    }
  }
  return paths;
}

async function readCurrentPage(): Promise<{path: string; page: number; text: string; heading: string; alreadyOnPage: string[]}> {
  const path = resultOf<string>(await PluginCommAPI.getCurrentFilePath(), 'Could not find the open note');
  if (!path.toLocaleLowerCase().endsWith('.note')) {throw new Error('Open a NOTE file to get keyword suggestions.');}
  const page = resultOf<number>(await PluginCommAPI.getCurrentPageNum(), 'Could not find the current page');
  const [elementsResponse, sizeResponse, keywordsResponse] = await Promise.all([
    PluginFileAPI.getElements(page, path), PluginFileAPI.getPageSize(path, page), PluginFileAPI.getKeyWords(path, [page]),
  ]);
  const elements = resultOf<PageElement[]>(elementsResponse, 'Could not read page content');
  const size = resultOf<{width: number; height: number}>(sizeResponse, 'Could not read page size');
  const keywords = resultOf<unknown[]>(keywordsResponse, 'Could not read page keywords');
  const text = resultOf<string>(await PluginCommAPI.recognizeElements(elements, size), 'Could not recognize page text');
  // The full-page recognition already includes title strokes. A second OCR pass
  // only for the title roughly doubled launch latency on large handwriting pages.
  return {path, page, text, heading: '', alreadyOnPage: keywords.map(keywordText).filter((keyword): keyword is string => Boolean(keyword))};
}

function App(): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<RankedKeyword[]>([]);
  const [status, setStatus] = useState('Tap the toolbar button to analyze this page.');
  const [loading, setLoading] = useState(false);
  const [pageTarget, setPageTarget] = useState<{path: string; page: number} | null>(null);
  const analysisId = useRef(0);

  const analyze = useCallback(async () => {
    const currentAnalysis = ++analysisId.current;
    setLoading(true); setStatus('Reading this page…'); setSuggestions([]);
    try {
      await ensureNoteLibraryPermission();
      const page = await readCurrentPage();
      if (currentAnalysis !== analysisId.current) {return;}
      const immediate = rankKeywords({text: page.text, heading: page.heading, existingKeywords: [], alreadyOnPage: page.alreadyOnPage});
      setPageTarget({path: page.path, page: page.page}); setSuggestions(immediate);
      setStatus(immediate.length ? 'Page suggestions are ready. Checking your existing keyword library in the background…' : 'Checking your existing keyword library in the background…');
      setLoading(false);

      buildKeywordLibrary().then(existingKeywords => {
        if (currentAnalysis !== analysisId.current) {return;}
        const ranked = rankKeywords({text: page.text, heading: page.heading, existingKeywords, alreadyOnPage: page.alreadyOnPage});
        setSuggestions(ranked);
        setStatus(ranked.length ? 'Choose a suggestion to add it as a native keyword.' : 'No useful keyword suggestions for this page.');
      }).catch(error => {
        if (currentAnalysis === analysisId.current) {setStatus(error instanceof Error ? error.message : 'Could not check the keyword library.');}
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not analyze this page.');
    } finally { if (currentAnalysis === analysisId.current) {setLoading(false);} }
  }, []);

  useEffect(() => {
    const runAnalysis = () => { analyze(); };
    const subscription = DeviceEventEmitter.addListener(KEYWORD_BUTTON_PRESS, runAnalysis);
    if (consumePendingPress()) {runAnalysis();}
    return () => subscription.remove();
  }, [analyze]);

  const addKeyword = useCallback(async (suggestion: RankedKeyword) => {
    if (!pageTarget) {return;}
    setLoading(true);
    try {
      await ensureKeywordWritePermission();
      const added = resultOf<boolean>(await PluginFileAPI.insertKeyWord(pageTarget.path, pageTarget.page, suggestion.keyword), 'Could not add keyword');
      if (!added) {throw new Error('Supernote did not add that keyword.');}
      if (keywordLibrary && !keywordLibrary.some(keyword => keyword.keyword.toLocaleLowerCase() === suggestion.keyword.toLocaleLowerCase())) {
        keywordLibrary.push({keyword: suggestion.keyword, locations: []});
      }
      setSuggestions(current => current.filter(item => item.keyword !== suggestion.keyword));
      setStatus(`Added “${suggestion.keyword}”.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not add keyword.'); }
    finally { setLoading(false); }
  }, [pageTarget]);

  return <View style={styles.screen}>
    <Text style={styles.title}>Keyword suggestions</Text>
    <Text style={styles.subtitle}>Existing keywords are preferred when they fit the page.</Text>
    {loading ? <ActivityIndicator size="small" color="#222" /> : null}
    <Text style={styles.status}>{status}</Text>
    <ScrollView contentContainerStyle={styles.list}>
      {suggestions.map(suggestion => <Pressable accessibilityRole="button" disabled={loading} key={suggestion.keyword} onPress={() => { addKeyword(suggestion); }} style={styles.suggestion}>
        <Text style={styles.keyword}>{suggestion.keyword}</Text>
        <Text style={styles.kind}>{suggestion.isExisting ? 'Existing keyword' : 'New keyword'}</Text>
        <Text style={styles.reason}>{suggestion.reason}</Text>
        {suggestion.locations?.length ? <Text style={styles.location}>Used in: {suggestion.locations.join(' • ')}</Text> : null}
        <Text style={styles.add}>Tap to add</Text>
      </Pressable>)}
    </ScrollView>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => { analyze(); }} style={styles.secondary}><Text style={styles.actionText}>Refresh</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { PluginManager.closePluginView(); }} style={styles.secondary}><Text style={styles.actionText}>Close</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: {backgroundColor: '#f4f1ea', flex: 1, padding: 24}, title: {color: '#111', fontSize: 26, fontWeight: '700'},
  subtitle: {color: '#444', fontSize: 15, lineHeight: 21, marginTop: 6}, status: {color: '#333', fontSize: 15, lineHeight: 22, marginTop: 18},
  list: {gap: 10, paddingVertical: 16}, suggestion: {backgroundColor: '#fff', borderColor: '#292929', borderRadius: 8, borderWidth: 1, padding: 14},
  keyword: {color: '#111', fontSize: 21, fontWeight: '700'}, kind: {color: '#555', fontSize: 13, marginTop: 3},
  reason: {color: '#333', fontSize: 14, lineHeight: 20, marginTop: 8}, location: {color: '#444', fontSize: 13, lineHeight: 18, marginTop: 6}, add: {color: '#111', fontSize: 14, fontWeight: '700', marginTop: 11},
  actions: {flexDirection: 'row', gap: 10}, secondary: {borderColor: '#333', borderRadius: 7, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 11}, actionText: {color: '#111', fontSize: 15, fontWeight: '600'},
});

export default App;
