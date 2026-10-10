// A narrow Navigation API contract for TypeScript versions without Window.navigation.
type HistoryNavigationEvent = Event & {
  navigationType: string;
  destination: { key: string; sameDocument: boolean };
  info?: unknown;
};
export type HistoryNavigation = EventTarget & {
  currentEntry: { key: string } | null;
  entries: () => { key: string }[];
  traverseTo: (key: string, options: { info: unknown }) => { committed: Promise<unknown>; finished: Promise<unknown> };
};

/** Cancel before Next receives popstate; resume the original entry only after confirmation. */
export function protectHistoryNavigation(
  navigation: HistoryNavigation,
  blocked: () => boolean,
  confirmLeave: () => Promise<boolean>,
) {
  let active = true, revision = 0;
  let approved: object | undefined;
  const onNavigate = (raw: Event) => {
    const event = raw as HistoryNavigationEvent;
    if (approved && event.info === approved) { approved = undefined; return; }
    const intent = ++revision;
    // Cross-document navigation uses beforeunload. Honor the browser's non-cancelable escape.
    if (event.navigationType !== "traverse" || !event.destination.sameDocument || !event.cancelable || !blocked()) return;
    event.preventDefault();
    const from = navigation.currentEntry?.key, to = event.destination.key;
    void confirmLeave().then(async leave => {
      if (!leave || !active || intent !== revision || navigation.currentEntry?.key !== from || !navigation.entries().some(entry => entry.key === to)) return;
      const token = {};
      approved = token;
      try {
        const result = navigation.traverseTo(to, { info: token });
        // Either promise can reject when another navigation interrupts this one.
        await Promise.all([result.committed, result.finished]);
      } finally {
        if (approved === token) approved = undefined;
      }
    }).catch(() => { /* Keep the existing draft if the history entry disappeared or navigation was aborted. */ });
  };
  navigation.addEventListener("navigate", onNavigate);
  return () => { active = false; revision++; approved = undefined; navigation.removeEventListener("navigate", onNavigate); };
}
