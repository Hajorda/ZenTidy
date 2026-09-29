// Realistic tab sets with the grouping a person would expect.
// `expect` lists groups of tab indexes that belong together; tabs not listed
// may go anywhere (usually left unpinned).

export const fixtures = [
  {
    name: "travel + dev + errands",
    tabs: [
      ["https://www.google.com/search?q=lisbon+flights+october", "lisbon flights october - Google Search"],
      ["https://www.kayak.com/flights/IST-LIS/2026-10-12", "IST to LIS flights | KAYAK", 0],
      ["https://www.booking.com/city/pt/lisbon.html", "Hotels in Lisbon, Portugal | Booking.com", 0],
      ["https://www.tripadvisor.com/Tourism-g189158-Lisbon", "Lisbon 2026: Best Things to Do - Tripadvisor", 0],
      ["https://github.com/zen-browser/desktop", "GitHub - zen-browser/desktop: Welcome to a calmer internet"],
      ["https://github.com/zen-browser/desktop/issues/9120", "Folders break after update · Issue #9120 · zen-browser/desktop"],
      ["https://github.com/zen-browser/desktop/pull/9133", "Fix folder restore · Pull Request #9133 · zen-browser/desktop"],
      ["https://developer.mozilla.org/en-US/docs/Web/API/WebSocket", "WebSocket - Web APIs | MDN"],
      ["https://developer.mozilla.org/en-US/docs/Web/CSS/grid", "grid - CSS: Cascading Style Sheets | MDN"],
      ["https://react.dev/reference/react/useEffect", "useEffect – React"],
      ["https://react.dev/learn/thinking-in-react", "Thinking in React – React"],
      ["https://stackoverflow.com/questions/1/react-useeffect-runs-twice", "reactjs - React useEffect runs twice - Stack Overflow"],
      ["https://www.amazon.com/dp/B0XYZ", "Amazon.com: Anker USB-C Charger 65W"],
      ["https://www.amazon.com/dp/B0ABC", "Amazon.com: USB-C Cable 2m braided"],
      ["https://mail.google.com/mail/u/0/#inbox", "Inbox (12) - me@gmail.com - Gmail"],
      ["https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia"],
    ],
    expect: [[0, 1, 2, 3, 15], [4, 5, 6], [7, 8], [9, 10, 11], [12, 13]],
    names: { 0: /lisbon/i, 4: /zen-browser/, 7: /MDN/, 9: /react/i, 12: /amazon/i },
  },
  {
    name: "work day",
    tabs: [
      ["https://docs.google.com/document/d/1/edit", "Q4 planning - Google Docs"],
      ["https://docs.google.com/document/d/2/edit", "Launch checklist - Google Docs"],
      ["https://docs.google.com/spreadsheets/d/3/edit", "Budget 2027 - Google Sheets"],
      ["https://docs.google.com/spreadsheets/d/4/edit", "Hiring tracker - Google Sheets"],
      ["https://acme.atlassian.net/browse/WEB-101", "[WEB-101] Checkout page is slow - Jira"],
      ["https://acme.atlassian.net/browse/WEB-102", "[WEB-102] Add Apple Pay - Jira"],
      ["https://app.slack.com/client/T1/C1", "#web-team (Channel) - Acme - Slack"],
      ["https://www.figma.com/design/abc/Checkout", "Checkout redesign – Figma"],
      ["https://www.figma.com/design/def/Onboarding", "Onboarding flow – Figma"],
      ["https://calendar.google.com/calendar/r", "Google Calendar - Week of September 28"],
    ],
    expect: [[0, 1], [2, 3], [4, 5], [7, 8]],
    names: { 0: /docs/i, 2: /sheets/i, 4: /^Jira$/, 7: /figma/i },
  },
  {
    name: "Turkish research",
    tabs: [
      ["https://www.google.com/search?q=istanbul+kiral%C4%B1k+daire+kad%C4%B1k%C3%B6y", "istanbul kiralık daire kadıköy - Google'da Ara"],
      ["https://www.sahibinden.com/kiralik-daire/istanbul-kadikoy", "Kadıköy Kiralık Daire İlanları - sahibinden.com", 0],
      ["https://www.hepsiemlak.com/kadikoy-kiralik", "Kadıköy Kiralık Daire - Hepsiemlak", 0],
      ["https://www.emlakjet.com/kiralik-daire/istanbul-kadikoy", "Kadıköy Kiralık Daire Fiyatları | Emlakjet", 0],
      ["https://www.trendyol.com/kahve-makinesi", "Kahve Makinesi Modelleri ve Fiyatları - Trendyol"],
      ["https://www.hepsiburada.com/kahve-makineleri", "Kahve Makineleri Fiyatları - Hepsiburada"],
      ["https://www.youtube.com/watch?v=x1", "Barış Özcan - Bilim neden önemli? - YouTube"],
      ["https://www.youtube.com/watch?v=x2", "Ruhi Çenet - Kapadokya belgeseli - YouTube"],
    ],
    expect: [[0, 1, 2, 3], [4, 5], [6, 7]],
    names: { 0: /kiralık|daire|kadıköy/i, 4: /kahve/i, 6: /youtube/i },
  },
  {
    name: "nothing in common",
    tabs: [
      ["https://news.ycombinator.com/item?id=1", "Show HN: A calmer browser | Hacker News"],
      ["https://www.bbc.com/news/science-1", "Why the ocean is getting louder - BBC News"],
      ["https://www.nytimes.com/cooking/1", "Easy weeknight pasta - NYT Cooking"],
      ["https://www.theverge.com/2026/9/1/gadget", "The best e-readers of 2026 | The Verge"],
    ],
    expect: [],
    names: {},
  },
];

export const toInput = (f) =>
  f.tabs.map(([url, title, opener], i) => ({ id: `t${i}`, url, title, openerId: opener === undefined ? null : `t${opener}` }));
