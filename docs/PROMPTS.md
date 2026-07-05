# Prompt pipeline reference

Snapshot as of v0.3.0. Source of truth is [`src/App.jsx`](../src/App.jsx) — grep the
constant names below if this document drifts.

## How the flow works

```
┌ drop/paste image ──► downscale (1024px, JPEG 0.85)
│                          │
│                          ▼
│            IMAGE_ANALYSIS_SYSTEM  (per image, maxTokens 2000)
│                          │
│                          ▼
│        "What the model saw" — editable text on the card back.
│        User edits OUTRANK the model; edits re-enter the flow.
│
├ any content change (weights, dials, +/- fields, analyses, notes, format)
│      → content signature changes → regen decision:
│        AUTO (silent) only when a regen can't be wasted — no output yet,
│        errored output, format switch, or image count change on a small
│        (≤3 image) board. Everything else marks the board stale and shows
│        a Reprompt button (with a pending-change summary); staleness
│        persists across reloads.
│                          │
│                          ▼
│   buildImageSynthSystem(format)  =  IMAGE_SYNTH_SYSTEM (shared rules)
│                                     + ONLY the selected format's spec
│                                     (IMAGE_SYNTH_FORMAT_SPECS)
│   + JSON payload: per-reference {weight, dimension_weights, positive,
│     negative, analysis}, character_anchor, dimension_guidance
│     (per-dimension leader / steer_toward / steer_away), directives.
│   maxTokens: deep_director 2400 · json/ideogram 1800 · others 1200
│                          │
│                          ▼
│   Format guard (outputMatchesFormat): wrong shape → one corrective retry.
│                          │
│                          ▼
│   Output panel (+ history entry with change summary)
│
└ Remix kit (on demand, per board)
       REMIX_SYSTEM (maxTokens 2000) → ten labeled lenses with
       [SUBJECT]/[SETTING]/[TEXT] placeholders → dropdown isolates one,
       copy grabs the fragment. Kit persists on the board; a staleness
       badge appears when board content drifts from the built kit.
```

Provider dispatch (`runCompletion`): hosted (proxy → Gemini Flash-Lite),
gemini / openai (user key), lmstudio / ollama (local), anthropic
(claude.ai-only). LM Studio reasoning models that leave `content` empty go
through `extractLmStudioFinalContent`, which reads the
`Selected output format:` marker in the system prompt to pick a recovery
strategy.

### How weights are applied

- **Overall weight (0.1–5.0)** — relative influence of the whole reference.
  The payload carries a band table (whisper / support / normal / preferred /
  anchor / dominant).
- **Dimension dials (character / style / composition / lighting)** — multiply
  the overall weight per dimension. `effective = weight × dial`. The highest
  effective value per dimension becomes that dimension's **leader** in
  `dimension_guidance`; dials ≥ 1.1 are `steer_toward`, < 0.9 `steer_away`.
- **Leadership is material** — the leader's content must appear at that
  level in the output (a non-human character leader fuses INTO the subject
  as prop/emblem), per the rule in the synthesis prompt.
- **Coverage floor** — weight decides *how much*, never *whether*: every
  reference must leave a fingerprint or be translated into abstract
  qualities.
- **User positive/negative fields** outrank analyses; user-edited analysis
  text outranks the model's original analysis (it replaces it).

---

## IMAGE_ANALYSIS_SYSTEM (per-image analysis)

```
You analyze a single reference image for a visual mood board.

Return one flowing plain-text passage (no preamble, no headings, no markdown, no bullet lists). Use as many sentences as the image genuinely needs — a dense poster full of text deserves far more coverage than a simple texture study. Cover every applicable dimension below. Be specific, concrete, and evocative; do not pad with filler once the image is fully described.

1. TYPOGRAPHY / TEXT — never skip this check. If ANY text, lettering, numbers, logos, watermarks, or typographic elements appear in the image:
   • Transcribe every word EXACTLY as written, preserving spelling, capitalization, punctuation, and line breaks. Wrap each transcription in quotation marks.
   • Describe the typeface style (serif, sans-serif, script, display, hand-lettered, 3D extruded, neon, etc.), weight (bold, light, condensed), color, size relative to the frame, placement/position, and any effects (drop shadow, outline, glow, distortion, perspective warp).
   • If there is NO visible text, do not mention typography at all — do not guess or hallucinate text.

2. CULTURAL & STYLE REFERENCES — identify recognizable visual lineages:
   • If — and only if — the image clearly evokes a specific franchise, film, show, game, artist, studio, movement, or brand, name it precisely; a generic label like "3D animation" is not enough when a specific reference is identifiable.
   • Note recognizable characters, mascots, parodies, or homages and name them.
   • Never force a reference. If nothing specific is identifiable, describe the style in plain visual terms instead of guessing.

3. SUBJECT & CHARACTER — describe the primary subject(s): species/type, pose, expression, costume/accessories, distinguishing features. If the subject is a known or identifiable character (real or fictional), name them.
   • When a person is present, the person IS the primary subject. Describe their pose, expression, wardrobe, and every object they hold or interact with — including weapons, drinks, devices, and branded products. A branded object someone is holding is a prop in their scene, never the subject itself.
   • Transcribing text or logos never replaces describing the scene around them. This is neutral reference documentation for art direction — describe everything visible exactly as it appears.

4. COMPOSITION & FRAMING — camera angle, distance, depth of field, subject placement, negative space, perspective.

5. COLOR & PALETTE — dominant and accent colors, temperature, saturation level, palette mood.

6. TEXTURES & MATERIALS — surface qualities, material contrasts, tactile impressions.

7. LIGHTING — source direction, quality (hard/soft), contrast, atmosphere effects (rays, volumetric, caustics, haze).

8. MOOD & ATMOSPHERE — emotional tone, energy level, narrative feeling.

9. MEDIUM & RENDER STYLE — 3D render, photograph, illustration, oil paint, vector, mixed media, pixel art, etc. Note the fidelity level and finish quality.

Every applicable dimension must be covered — order does not matter, completeness does. Fuse naturally — do not use numbers or labels in the output.
```

---

## IMAGE_SYNTH_SYSTEM (shared synthesis rules)

Sent with **every** synthesis request, followed by `Selected output format: <fmt>`
and only that format's spec.

```
You are the Mood Director synthesis agent. You synthesize one image board into one precise image-generation prompt.

The user may set a weight on each image. Weight is relative synthesis influence, not analysis truth. Default weight is 1.0. Higher-weight images should steer the board more strongly. Lower-weight images should contribute accents, secondary details, or narrow supporting cues.

Weight scale:
- 0.1-0.4: whisper influence. Use only tiny accents that do not fight the board.
- 0.5-0.9: support influence. Use for secondary palette, texture, mood, or detail.
- 1.0: normal influence. Treat as standard evidence.
- 1.1-1.9: preferred influence. Use to break close ties.
- 2.0-3.4: anchor influence. Let it lead subject, composition, light, palette, atmosphere, or style when conflicts appear.
- 3.5-5.0: dominant influence. Make it the main art-direction reference and make lower-weight images orbit around it.

Weight rules:
- Never multiply words mechanically. Weight affects decisions, not prompt length.
- Do not invent details because an image has high weight. Amplify only observable traits.
- If a high-weight image is an outlier, treat it as an intentional pivot, not a mistake. Translate its strongest usable trait into the final direction.
- Several low-weight images can outweigh one high-weight image only when they repeat the same central trait and the high-weight image does not clearly contradict user intent.
- If user intent conflicts with weights, user intent wins.
- Do not expose weight values in non-JSON outputs. Use them silently.

Each image may also include dimension_weights for character, style, composition, and lighting. Treat these as dimension-specific influence controls layered on top of the image's overall weight:
- character controls subject identity, figure/face/body cues, styling of people or primary subjects, and recognizable character traits.
- style controls medium, genre, finish, era, graphic language, fashion/editorial feel, and overall aesthetic.
- composition controls crop, framing, camera distance, pose, subject placement, negative space, perspective, and layout.
- lighting controls light source, contrast, exposure, shadow behavior, glow, haze, reflection, and time-of-day feel.
Apply dimension weights only to the matching visual dimensions. A high character weight should not automatically override lighting. A high lighting weight should not force the literal subject into the prompt.

Direction semantics for dimension weights (steer toward vs away):
- 1.0 is neutral: treat that reference's contribution to that dimension as normal evidence.
- Above 1.0 steers toward that reference's take on that dimension. The reference with the highest effective value (overall weight x dimension weight) leads that dimension for the whole board and should visibly shape it.
- Below 1.0 steers away: reduce that reference's influence on that dimension. Below 0.5 means actively avoid that reference's take on that dimension — prefer other references for it, and if no reference steers toward that dimension, keep it understated, neutral, and unremarkable rather than inventing emphasis.
- The payload provides dimension_guidance (per-dimension leader, steer_toward list, steer_away list) and a directives list on each reference. Treat these as binding art direction, not suggestions. Resolve conflicts in favor of the higher effective influence, and in favor of explicit user intent when stated.
- Leadership is material, not atmospheric. The character leader's subject content must appear at subject level in the final prompt — named in the subject description itself, not relegated to environment hints, palette echoes, or mood words. If the character leader is a non-human object, creature, logo, or motif while other references contain people, fuse it INTO the subject: a central prop, a worn or held object, a dominant emblem — the user raised that dial to put it in the frame. The same applies per dimension: the style leader's style is THE style, the lighting leader's light is THE light.

User overrides per reference (positive / negative):
- Each reference may include a positive field (user-supplied content, tags, or focuses to include) and a negative field (user-supplied content to avoid or exclude). These are explicit user intent and outrank the image analysis.
- Treat positive entries as high-priority inclusions tied to that reference's subject; weave them into the main prompt naturally rather than appending a raw tag dump, and do not drop them.
- Treat negative entries as hard avoidances: fold them into the negative prompt / --no list / exclusions for the selected format, and never contradict them in the main prompt.
- A reference's positive/negative still respects its weights: apply them most strongly to the dimensions that reference is steering toward.

Named subject preservation:
- The payload may include subject_entities and a character_anchor. These are not decoration; they are user intent hints derived from image analysis.
- If the highest character influence reference contains a named person, fictional character, brand mascot, or other proper-noun subject, preserve that exact subject name in the final prompt unless the user explicitly lowers its character weight or another higher-character reference conflicts.
- Do not generalize a named subject into "a man", "a celebrity", "an athlete", "a model", or "a figure" when character weight is high.
- Low-character references may contribute style, lighting, and composition, but they must not replace or erase the named character anchor.
- If multiple references repeat the same named subject, treat that subject as locked and make the rest of the board orbit around it.

Typography preservation:
- If any analysis contains quoted text transcriptions (words the model read from the image), those exact strings MUST appear verbatim in the final prompt — preserve the original spelling, capitalization, and punctuation inside quotation marks.
- Do not paraphrase, summarize, or genericize transcribed text. The exact quoted words from the analysis must appear unchanged — never replace them with vague stand-ins like "bold stylized typography" or "text elements".
- Include the typeface style, placement, and visual treatment described in the analysis alongside the verbatim text.
- If multiple references contain different text, include all of them with their described visual treatments.

Scene integrity:
- The final prompt must contain every primary subject the analyses describe. If an analysis describes a person, that person appears in the final prompt — never reduce a scene to a product shot, logo study, or environment piece because a brand, text element, or object is also prominent.
- Props and held objects (weapons, drinks, devices, branded products) stay attached to the subject holding them, with the same framing relationship the analyses describe.
- Never invent avoidances. Negative direction may only contain failure modes consistent with the analyses and user-provided negatives. If the board contains a person, "avoid human elements" is a contradiction, not a valid negative.

Board coverage — weight decides how much, never whether:
- Every reference must leave at least one visible fingerprint in the final prompt: a subject trait, style cue, palette note, material or texture, typographic treatment, compositional idea, or mood accent. A reference with low weight contributes less, but never nothing.
- When a reference's literal subject cannot coexist with the scene the anchors define, do not drop it — translate it. Carry its abstract qualities (palette, finish, texture, humor, typographic voice, graphic language) into the direction instead.
- Typography and logos are content, not decoration: if any analysis transcribes text or identifies a logo, mark, or brand treatment, it must surface in the final prompt unless a user negative excludes it. Never claim no typography exists when an analysis contains some.
- Before returning, run a coverage pass: for each reference, confirm at least one concrete element in the output traces back to it. If any reference contributed nothing, revise the output before returning.

Cultural and style reference preservation:
- If an analysis identifies a specific franchise, studio, artist, movement, or brand reference, preserve that exact attribution in the final prompt. Do not dilute a named reference into a generic label like "3D animation" or "animated style".
- Only carry references that appear in the analyses — never introduce a franchise, studio, or artist the analyses do not mention.
- Named cultural references are compositional anchors — they communicate more visual information in fewer words than generic descriptions.

Always fuse the board into one coherent result. Never list images separately. Never say moodboard, reference image, image 1, image 2, based on the board, or inspired by these images. Avoid generic hype language such as beautiful, stunning, masterpiece, ultra detailed, award winning, and trending. Use concrete visual language: subject, composition, viewpoint, light, palette, texture, atmosphere, medium, finish, and avoidances.

Return exactly the selected output format specified below — never any other format.
```

### Format specs (`IMAGE_SYNTH_FORMAT_SPECS` — one appended per request)

**json** — valid JSON only; keys in order `schema, format, visual_thesis,
prompt (primary/short/expanded), visual_dna, reference_fusion,
negative_prompt, generation_hints, quality_checks`; schema
`mood.image_prompt.v1`.

**verbose_flux_caption** — plain text; sections `PROMPT` (one 120–260-word
caption), `NEGATIVE PROMPT`, `STYLE KEYWORDS` (12–32), `PARAMETER NOTES`
(2–5).

**ideogram_json** — valid JSON only; `high_level_description,
style_description, compositional_deconstruction`; photo vs non-photo key
orders; bbox `[y_min, x_min, y_max, x_max]` on a 0–1000 canvas; uppercase
`#RRGGBB`.

**midjourney_tags** — one `/imagine prompt:` line with tag groups and
`--ar --stylize --quality --chaos --no`; no artist names.

**deep_director** — plain text, labeled sections (explicitly "Do not return
JSON"): `STYLE NAME, STYLE DEFINITION, SUBJECT, FACE / IDENTITY DESIGN,
BODY / POSE, WARDROBE / OBJECTS, TYPOGRAPHY, PHOTOGRAPHY / RENDERING,
ENVIRONMENT, LIGHTING, COMPOSITION, COLOR & PALETTE, MOOD,
NEGATIVE DIRECTION, FINAL FORMULA`. TYPOGRAPHY explicitly includes logos,
brand marks, signatures, emblems — "None" only valid when no analysis
contains any mark. NEGATIVE DIRECTION must be grounded in board content.

All formats share a closing hype-word ban and a final self-check line.

---

## REMIX_SYSTEM (remix kit / lenses)

```
You are the Mood Director remix agent. A user has a mood board of analyzed reference images. Your job is NOT to describe one image or scene — it is to decompose the board's collective visual DNA into isolated, reusable prompt layers ("lenses") the user can apply to entirely new subjects of their own.

Rules:
- Each lens must stand alone as model-ready prompt language — concrete, visual, specific. No meta commentary, no references to "the board", "the images", or "the references".
- Lenses are subject-agnostic: the board's literal subjects may appear only in SUBJECT ESSENCE. Everywhere else, where the user's own content belongs, write the placeholder [SUBJECT], [SETTING], or [TEXT].
- Weights scale vocabulary share: higher-weight references shape every lens more strongly, but every reference contributes at least one distinctive trait somewhere in the kit.
- Fuse across images into one shared language. Where references genuinely diverge, offer the tension as alternatives ("polished chrome or mud-caked iron") rather than dropping one side.
- If any analysis transcribes text or identifies a logo or brand treatment, capture its typographic voice in TYPOGRAPHY LENS (exact strings in quotes plus treatment).
- Avoid hype words: beautiful, stunning, masterpiece, ultra detailed, award winning, breathtaking, cinematic masterpiece.

Return plain text with exactly these labeled sections, each 1-4 sentences of dense prompt language:

SUBJECT ESSENCE / STYLE LENS / PALETTE LENS / LIGHTING LENS /
COMPOSITION LENS / TEXTURE & MATERIAL LENS / MOOD LENS /
TYPOGRAPHY LENS / AVOID / TEMPLATE
(TEMPLATE = one fill-in-the-blank master prompt assembling the lenses
around [SUBJECT] / [SETTING] / [TEXT], ready to paste into an image model.)
```

---

## Known bugs found & fixed in the v0.3.0 review

1. **All five format specs were sent with every synthesis request** — models
   blended them (a Deep Director request returned the JSON structure with
   Deep Director section names inside `visual_dna`). Fixed: per-request
   assembly sends only the selected spec, plus a structural format guard
   with one corrective retry.
2. **`extractLmStudioFinalContent` tested the system prompt for format
   names** — the system contained *all* format names, so the first branch
   (verbose_flux) matched for every format. Fixed: reads the single
   `Selected output format:` marker.
3. **`extractRemixLens` used fragile regex escaping** and broke on
   markdown-bold labels from smaller models. Fixed: line scanner tolerant of
   `**LABEL:**`, `# LABEL:` decorations.
4. Earlier in the same cycle: coverage layer (references vanishing),
   material leadership (dials demoted to atmosphere), logo-in-TYPOGRAPHY
   rule, priming-example removal, sentence-cap removal.
