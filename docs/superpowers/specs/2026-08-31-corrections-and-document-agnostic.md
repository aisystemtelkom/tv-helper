# Corrections from bidang TV 1, and the document-agnostic requirement

Date: 2026-08-31
Status: authoritative. Supersedes the conflicting parts of
`2026-08-30-dokumen-validasi-design.md`, which is amended to match.

Three corrections and one new requirement, all from the user on 2026-08-31.
Two of the corrections are of errors I introduced.

## 1. Order types: what AO/MO/DO actually are

`JENIS ORDER` values are **workflow verbs**, not billing periods:

| Code | Meaning |
| --- | --- |
| AO | Activation Order |
| MO | Modify Order |
| DO | Delete Order |
| ... | more exist; the full list is not yet enumerated |

**My error.** The 2026-08-30 design offered "varies by jenis order" as a
design axis and I never established what the codes meant. Nothing was built on
a wrong expansion, but the question I asked was uninformed, and the answer I
carried forward ("config-driven per order type") is now known to be the wrong
shape. See correction 2.

## 2. The tool is DOCUMENT-AGNOSTIC. The slot list does not vary.

The user's instruction: *"Make sure that the tool is document-agnostic and look
for the same slots in any document."*

So the same slot list is searched for in **whatever documents are supplied**.
The tool must not assume the sample bundle's structure, page ordering, or which
document type carries which field.

**What this invalidates.** The pipeline currently narrows each field's search
pool by `DocType`, decided by `classify.ts` and applied in `generate.mjs`
(`FIELD_DOC_TYPES`). That narrowing must go.

**The tension, stated honestly, because it is a real one.** Pool narrowing was
introduced to fix a live defect: searching everything made `cc` match the
printed email's own `Cc:` header, so both deliverables shipped a wrong customer
name. Removing the narrowing without replacing it re-opens that bug.

**The resolution is better disambiguation, not narrower pools.** A field's
`hint` must describe the thing well enough that the right region wins on
merit anywhere in the bundle: for `cc`, the customer named as the subscriber on
an order request, explicitly not a name appearing in an email header or
distribution list. `classify.ts` output becomes an ordering *hint* (search the
likeliest document first) and never a hard filter.

Any regression here is caught by the measurement gate, which must be re-run.

## 3. The "at most 2 extra lines" tolerance was invented, and is wrong

The user asked whether that rule was made up. **It was, by me**, while writing
the 2026-08-30 spec, with no data behind it. It was then applied as though it
were a requirement.

Cross-checking it against the sample document, as the user asked, settles it.
The twelve human-authored crops range from **2 lines to 43 lines**:

```
image6  2   image4  9   image11  9   image10 15   image7 18   image3 21
image9  27  image5 28   image2  34   image8  34   image1 35   image17 43
```

A fixed +2 allowance is a 100% overshoot budget on the smallest crop and 5% on
the largest. It measures nothing consistent, and it is what failed
`KB / Para Pihak` (+4 lines) and `KB / TTD Pejabat` (+7) even though both
proposals **contained every required line**.

**The rule from now on.** A proposal passes when it lands on an accepted page
and its line range contains every line of the ground-truth crop. Overshoot is
capped proportionally, not absolutely: reject a range more than twice the
required line count, or one that runs the full page when the crop does not.
That catches a genuine runaway while matching how a person actually crops.

Under containment the recorded gate result is 11/12 rather than 9/12. The one
genuine miss, `KB / ToP (2)`, stays a miss.

## 4. New requirement: the "dokumen tambahan" loop

Slots the supplied documents cannot fill must **not** silently ship empty. The
flow the user specified:

1. Search every supplied document for every slot.
2. Report which slots were not found, naming them.
3. Ask the operator whether an additional document (*dokumen tambahan*) exists.
4. If yes, accept the upload and search it for **only the outstanding slots**.
5. Repeat from step 2 for as long as the operator keeps supplying documents.
6. The operator may answer no at any point. The remaining slots then stay
   empty, and each offers **manual zone selection** so the operator can draw
   the region by hand from a document already loaded.

**Why it matters beyond convenience.** It converts "not found" from a silent
gap in the deliverable into a decision the operator makes on the record. A
validation document with an unexplained empty cell is indistinguishable from
one where the evidence genuinely does not exist.

Consequences for the design:

- A run is **resumable and additive**: uploading a document later must not
  discard confirmed zones from earlier rounds.
- Already-confirmed slots are never re-searched when a new document arrives.
  Only outstanding ones are, which also keeps cost proportional.
- Manual zone selection is not a fallback bolted on at the end; it is the
  designed terminal state for any slot the model cannot fill.

## 5. Hosting approval

The client has approved hosting on Google Cloud, not only inference. The open
question recorded in the 2026-08-30 spec ("does processor approval extend from
inference to hosting") is **closed, approved**. Plan C is unblocked.
