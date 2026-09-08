/**
 * THE OUTSTANDING BLOCK'S VOCABULARY AND ARITHMETIC, computed away from the
 * JSX, for the reason `slots.ts` and `headings.ts` are: `node --test` cannot
 * render React, and every sentence this block prints is a claim about what the
 * tool did. A wrong one does not crash anything. It sits at the head of the
 * lembar periksa, reads as a finding, and sends an operator to fetch a document
 * that was never going to help -- or stops them fetching one that would.
 *
 * WHAT IS HERE IS WHAT A TEST HAD TO BE ABLE TO REACH. Five sentences on this
 * block were false on screen, and four of them were false in a way no type
 * could catch: a hardcoded count that outlived its list, and three sentences
 * claiming to know something the runtime deliberately does not record. So the
 * words and the figures that decide them live in one module a test can drive
 * with a real `BrowserRun`, rather than inline in a component nothing can
 * import.
 *
 * ## THE THING THIS MODULE KEEPS HAVING TO SAY: A REJECTION LEAVES NO TRACE
 *
 * `rejectProposal` clears the zone and records nothing else, by design. So a
 * berkas whose usulan were every one refused is byte for byte a berkas that
 * yielded none, and a halaman whose usulan was refused is byte for byte a
 * halaman nobody proposed anything about. Neither of those is knowable, and
 * every sentence here is written so it does not need to know: it reports the
 * STATE ("nothing is waiting", "this halaman is in no judul yet"), never the
 * HISTORY ("the AI found nothing", "nobody proposed this").
 */

import { aiExcludedSources } from "../browser/sources.ts";
import type { ProposedSection } from "../forms/overlay.ts";
import type { SlotAggregateStatus } from "./slots.ts";
import type { BrowserRun, SlotState } from "./runtime.ts";

/* ------------------------------------------------------------------ *
 * The five kinds of blank, and the words for them.
 * ------------------------------------------------------------------ */

/**
 * Why a capture is blank. The runtime has no field for this: `onReject` sets
 * `status: "outstanding"` with the zone cleared, which is byte for byte what a
 * search miss looks like.
 *
 * The one surviving trace of a rejection is `origin`, which `applyProposals`
 * writes only when it hands over a zone and which `onReject`'s patch does not
 * clear. So an outstanding capture carrying `origin: "llm"` and no zone had a
 * usulan that a person refused. If that ever stops being true the derivation
 * below falls back to "tidak ditemukan", which is the weaker and still-true
 * claim, never the stronger one.
 */
export type Reason =
  | "unsearched"
  | "notfound"
  | "rejected"
  | "undrawn"
  | "emptied";

export const REASON_WORD: Record<Reason, string> = {
  unsearched: "belum dicari",
  notfound: "tidak ditemukan",
  rejected: "usulan ditolak",
  undrawn: "belum digambar",
  emptied: "sengaja dikosongkan",
};

/** Each kind of blank gets its own SHAPE, not only its own sentence. */
export const REASON_MARK: Record<Reason, SlotAggregateStatus> = {
  unsearched: "pending",
  notfound: "outstanding",
  rejected: "outstanding",
  // The same shape as `unsearched`, because it is the same standing: nothing
  // has been looked for, nothing has failed. What differs is WHY, and that is
  // what the word and the sentence carry.
  undrawn: "pending",
  emptied: "unfilled",
};

export const REASON_SENTENCE: Record<Reason, string> = {
  unsearched:
    "Belum ada pencarian yang menyentuh bagian ini, jadi ini bukan bukti yang hilang.",
  notfound: "Sudah dicari di seluruh halaman yang ada, buktinya tidak ketemu.",
  rejected:
    "Anda menolak usulannya, dan areanya ikut dibuang. Bagian ini kembali kosong.",
  undrawn: "Judul ini Anda buat sendiri, jadi potongannya Anda ambil sendiri.",
  emptied:
    "Dikosongkan atas keputusan Anda, bukan karena terlewat. Selnya tetap muncul kosong di DOKUMEN VALIDASI.",
};

/**
 * The order the counts state them in: the ones that owe a decision first.
 *
 * `undrawn` SITS LAST OF THE FOUR OWED AND IS NOT A KIND OF FAILURE. The three
 * before it are things that went a certain way -- nobody has looked, the look
 * failed, you refused the answer -- and every one of them is a reason to
 * consider loading another document. This one is not: a judul the operator
 * created is captured by hand by design, so no berkas and no round can ever
 * change it. It is listed with them because it is still a decision they owe,
 * and it is ranked below them because it is the only one where the tool has
 * nothing left to offer.
 */
export const REASON_ORDER: Reason[] = [
  "notfound",
  "rejected",
  "unsearched",
  "undrawn",
  "emptied",
];

/**
 * THE LABEL OVER THE GLOSSARY, AND IT DOES NOT COUNT ITS OWN ENTRIES.
 *
 * It read "Arti keempat keterangan ini" over five of them. `REASON_ORDER` was
 * four words long when that label was typed, `emptied` was added to it, and the
 * numeral stayed -- so the panel explaining this product's vocabulary opened by
 * miscounting the vocabulary, in the one place an operator goes to learn what
 * the words mean.
 *
 * The numeral is GONE rather than bumped to five. A hardcoded count of a list
 * that is one export away is a fact with two spellings, and this one had
 * already gone stale once; the list will grow again. `REASON_ORDER.length` is
 * the count, and it is on screen as the figures beside each word anyway.
 */
export const REASON_HINT_LABEL = "Arti keterangan ini";

/**
 * `searchable` IS `isSearchable(template, key)`, ASKED PER BAGIAN AND PASSED
 * IN, never re-derived here and never a run-wide relabel.
 *
 * When it is false the answer is `undrawn` and nothing else, because none of
 * the other four can be true of a bagian nothing will ever search: it cannot
 * have been searched and missed, and there was no usulan to refuse. The one
 * that CAN still be true is `emptied`, which is a decision rather than an
 * outcome, so it is tested first and keeps its word.
 *
 * It is a parameter rather than a `Template` argument so that the caller has to
 * ask the question about the RIGHT KEY. Only the caller knows whether it is
 * holding a bagian this order's form declares or a state left over from one it
 * does not, and the two want different answers to the same predicate.
 */
export function reasonOf(state: SlotState, searchable: boolean): Reason {
  if (state.status === "unfilled") return "emptied";
  if (!searchable) return "undrawn";
  if (state.status === "pending") return "unsearched";
  return state.origin === "llm" ? "rejected" : "notfound";
}

/* ------------------------------------------------------------------ *
 * Usulan judul: what may be said about one berkas.
 * ------------------------------------------------------------------ */

/**
 * THE SENTENCE OVER A BERKAS WITH NO USULAN WAITING.
 *
 * It said "AI tidak menemukan judul di berkas X", which is a report on what the
 * model did, and the block cannot make one. There are three ways to reach an
 * empty list and only one of them is the sentence's claim:
 *
 *   1. the AI proposed nothing out of that berkas,
 *   2. it proposed and the operator refused every one, or
 *   3. it proposed and the operator ACCEPTED every one -- at which point they
 *      left `overlay.proposed` for `overlay.added`, and the block that reads
 *      the packet's best answer of the session printed it as a failure.
 *
 * Case 2 is not distinguishable from case 1 at all (see this module's header),
 * so the sentence stops claiming and states what is actually on screen: nothing
 * here is waiting on you. That is true in all three, and it is the fact the
 * operator is reading this block for.
 */
export const NO_USULAN_WAITING =
  "Tidak ada usulan judul yang menunggu keputusan di berkas";

/**
 * THE TAIL OF THE UNCLAIMED-HALAMAN LINE, and the same correction one level
 * down.
 *
 * It said "{n} halaman tidak diusulkan jadi judul mana pun", which is a claim
 * about a search: nobody proposed anything for these pages. A halaman whose
 * usulan the operator REFUSED lands in exactly that count and had a judul
 * proposed for it. So the line reports the state instead -- these halaman are
 * in no judul yet -- which holds whether nothing was proposed, something was
 * proposed and refused, or something was proposed and is still waiting.
 *
 * An ACCEPTED usulan takes its pages out of the count (`unclaimed` reads
 * `overlay.added`), so "belum masuk judul" never contradicts a judul the
 * operator can see.
 */
export const PAGES_NOT_IN_JUDUL = "halaman belum masuk judul mana pun.";

/**
 * WHY "Cari judul lagi" IS DOWN ON A BERKAS MARKED TANPA AI.
 *
 * The key ran a whole pass and then answered with a sentence about a search
 * nobody performed: `discoverIds` drops a fenced berkas, so the one thing the
 * operator asked for was the one thing the round could not do. It rides ON the
 * control, per the house rule, because it is routine and the fence is already
 * reported in prose by `FencedBerkas` at the head of the block.
 */
export const DISCOVER_FENCED_REASON =
  "Berkas ini Anda tandai tanpa AI, jadi AI tidak mencari judul di dalamnya.";

/**
 * WHY "Baca dengan AI" IS DOWN WHEN EVERY BERKAS IS FENCED.
 *
 * Not cosmetic, and not the same objection as the key above. A round over a
 * run whose every page carries `searchable: false` returns each wanted key in
 * `outstanding`, and `applyProposals` writes that word onto the bagian -- so
 * pressing it would stamp `tidak ditemukan`, a word fixed in
 * `docs/ui-bahasa.md` to mean SEARCHED AND NOT FOUND, across bagian nothing
 * read a single baris for.
 */
export const SEARCH_ALL_FENCED_REASON =
  "Semua berkas Anda tandai tanpa AI, jadi tidak ada halaman yang bisa dibaca.";

/** One berkas, as the usulan judul block needs it. */
export type BerkasUsulan = {
  id: string;
  name: string;
  /**
   * HAS THE JUDUL QUESTION ACTUALLY BEEN PUT TO THIS BERKAS.
   *
   * `RunSource.sectionsAskedFor`, which records that the question was put and
   * never that the answer was useful. Nothing about unclaimed halaman may be
   * said before it is true: "belum masuk judul mana pun" would otherwise
   * describe a berkas nothing has read, which is the same class of false
   * statement `outOfScope` exists to keep out of `tidak ditemukan`.
   */
  asked: boolean;
  /** Marked "tanpa AI": no round will ever propose a judul out of it. */
  fenced: boolean;
  /** The usulan still waiting on a person. */
  usulan: ProposedSection[];
  /**
   * How many of this berkas's halaman are under no judul yet.
   *
   * A halaman is claimed by a usulan STILL WAITING or by a judul the operator
   * ACCEPTED (`overlay.added`, whose `pages` are positions in `run.pages` like
   * every other page reference in this app). Accepting a usulan therefore moves
   * its halaman from one claimant to the other rather than releasing them,
   * which is what stops this figure growing every time the operator says yes.
   */
  unclaimed: number;
};

/**
 * Every berkas of this order, with what the usulan block may say about it.
 *
 * ONE ENTRY PER SOURCE, unfiltered: which of them are worth drawing is the
 * component's question ("has it been asked, or is something waiting"), and a
 * helper that pre-filtered would leave the panel unable to count what it hid.
 */
export function berkasUsulan(run: BrowserRun): BerkasUsulan[] {
  const fenced = aiExcludedSources(run);

  return run.sources.map((source) => {
    const usulan = run.overlay.proposed.filter(
      (entry) => entry.fromSourceId === source.id,
    );

    const claimed = new Set<number>();
    for (const entry of usulan) {
      for (const page of entry.fromPages) claimed.add(page);
    }
    for (const added of run.overlay.added) {
      if (added.fromSourceId !== source.id) continue;
      for (const page of added.pages ?? []) claimed.add(page);
    }

    // `position`, never `page.index`: `StoredPage.index` restarts at 0 in every
    // berkas, and `fromPages` holds run-global positions in `run.pages`.
    const unclaimed = run.pages.reduce(
      (count, page, position) =>
        page.sourceId === source.id && !claimed.has(position)
          ? count + 1
          : count,
      0,
    );

    return {
      id: source.id,
      name: source.name,
      asked: source.sectionsAskedFor === true,
      fenced: fenced.has(source.id),
      usulan,
      unclaimed,
    };
  });
}
