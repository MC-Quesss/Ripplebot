---
type: procedure
name: write-a-book
confirmed: false
added: 2026-10-30
---

# Writing and signing a book

Dad asked for this on 2026-10-30, after Roz wrote the two history books
([[../stories/book-1-the-homecoming|The Homecoming]], [[../stories/book-2-the-twilight-wood|The Twilight Wood]]).
Any bot can do it: hand it a **book and quill** and ask it to write a book about something.
Examples Dad gave: Private on Antarctica, Muse on Tatooine or Mos Eisley.

## In chat (bots with a brain: local / remote / claude / claude-super / claude-private)

The LLM router has a **`write_book`** intent (`args.topic`). "Muse, write a book about Mos Eisley"
or "write me a story in this book" both route there. `runWriteBook(user, topic)`:
1. Finds a `writable_book` in inventory. If there isn't one, it says it needs a book and quill.
2. Takes a short task (`write_book`); fire duty waits it out.
3. Writes in the persona voice via `expressiveStory` (reactive, so it works in claude-private too):
   13 lines, where **line 1 is the title (≤16 chars)** and lines 2–13 are **12 pages** (≤190 chars each, so each fits in 14 lines).
4. `bot.signBook` signs it with the bot's nickname as author. The server turns it into a `written_book`.
5. Faces the requester and **tosses the signed book to them**. Logs `[book]` and adds a diary note.

Skipped during quiet hours (no LLM). If the voice backend returns nothing, the bot says the words
won't come and keeps the blank book.

## By ctl

- `{"action":"write_book","args":{"topic":"Antarctica","for":"Quesss"}}`: same routine, voice-written.
- `{"action":"sign_book","args":{"title":"…","author":"Roz","pages_file":"data/books/x.json","slot":15}}`:
  sign **hand-written pages** (a JSON array of strings). This is how **helm** bots publish: the
  operator writes the text and paginates it (1.12 limits: **50 pages, 256 chars a page, title 16 chars**).
  `pages` can also be passed inline. `sign:false` writes without signing.
- Hand the book over with `toss_slot` after a `look` toward the reader (verify the yaw).

## Notes
- The 1.12 protocol signs through the `MC|BSign` plugin channel (mineflayer `signBook`). Pages come
  back as JSON text components. Verified live for `sign_book` on 2026-10-30 (30 and 32 pages).
- `write_book` (the LLM path) is **not live-tested yet**. Muse and Private need a restart onto the
  new bot.js to get it.

## Update — 2026-10-30: pages hide text past line 14

Dad found words "missing" at the ends of some pages in the first two books. They weren't lost:
**a 1.12 page shows only 14 lines of a 114 px column**, and text past line 14 is hidden. The first
pass counted characters (≤250 a page), and paragraph breaks and wraps pushed 18 pages to 15–16
lines. **Paginate by rendered lines**: `python3 -I data/books/paginate.py <book.md> <out.json>`
word-wraps with the default font's widths, caps each page at 14 lines *and* 256 chars, and starts
chapters on a fresh page. Signed books are final, so a fix needs fresh book and quills.
