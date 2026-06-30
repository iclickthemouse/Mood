---
name: mood-text-distillation-agent
description: distill mood text boards into precise reusable writing-voice skill files. use for text-board workflows that analyze notes, pasted writing, transcripts, essays, newsletters, social posts, or other writing samples; extract voice, rhythm, diction, structure, habits, themes, and avoidances; and generate a complete skill.md that can reproduce the source voice consistently.
---

# mood Text Distillation Agent

## Purpose

Turn a text board into a complete reusable writing-voice `skill.md`.

The text board is not a scrapbook of notes. It is evidence of a voice. Read the writing samples, identify the repeatable patterns, separate signal from accident, and generate a practical skill file that another model can follow.

The final `skill.md` must be specific, source-derived, and usable. It must not sound like a generic style guide. It must not include placeholders. It must not flatter the writing. It must name the actual habits that make the voice recognizable.

## Core promise

Writing goes in. A reusable voice skill comes out.

The skill file should let a model write, rewrite, critique, and calibrate text in the source voice without needing to see the original board again.

## Operating mode

The app may call this file in five jobs:

1. `assess_sample_readiness`
2. `analyze_text_sample`
3. `synthesize_voice_profile`
4. `generate_skill_md`
5. `revise_skill_md`

For `assess_sample_readiness`, return readiness JSON only.

For `analyze_text_sample`, return text-sample analysis JSON only.

For `synthesize_voice_profile`, return voice-profile JSON only.

For `generate_skill_md`, return a complete `skill.md` document only.

For `revise_skill_md`, return a complete revised `skill.md` document only.

Do not add greetings, explanations, markdown fences, or process notes unless the app explicitly sets `debug` to `true`.

## Input contract

The app should pass a JSON instruction object with these fields:

- `job`: one of `assess_sample_readiness`, `analyze_text_sample`, `synthesize_voice_profile`, `generate_skill_md`, or `revise_skill_md`
- `board_id`: stable board id
- `board_name`: human board name
- `notes`: ordered note objects
- `sample_analyses`: ordered text-sample analysis objects when synthesis is requested
- `voice_profile`: existing voice profile when skill generation is requested
- `minimum_notes`: minimum number of notes required for a full skill
- `minimum_words`: minimum word count required for a reliable full skill
- `target_use`: optional intended use for the generated writing skill
- `strictness`: one of `loose`, `balanced`, or `strict`
- `previous_skill_md`: existing skill file when revision is requested
- `revision_request`: natural-language change request when revision is requested
- `debug`: boolean

Each note object should contain:

- `id`: stable note id
- `title`: note title
- `text`: note text
- `source_type`: `typed_note`, `pasted_text`, `text_file`, `transcript`, `essay`, `newsletter`, `social_post`, `script`, `unknown`
- `created_order`: integer order on the board
- `last_edited_at`: timestamp when available

If a field is absent, continue with sensible defaults:

- `minimum_notes`: `5`
- `minimum_words`: `750`
- `target_use`: `general writing in the captured voice`
- `strictness`: `balanced`
- `debug`: `false`

## Priority order

Use this order when deciding what matters:

1. Repeated patterns across multiple samples
2. Patterns present in longer or more complete samples
3. Board-level target use
4. Strong signature moves that appear less often but are clearly distinctive
5. Recently edited notes when content quality is comparable
6. Single-sample quirks only when marked as rare or optional

Do not let one unusually polished, messy, formal, or short sample dominate the whole voice unless the user marks it as the anchor.

## Readiness rules

A full writing-voice skill is reliable when the board has at least 5 usable notes and at least 750 total usable words.

A note is usable when it contains at least 25 words of prose, dialogue, narration, essay, script, caption, or other meaningful writing. A note is not usable when it is only a title, outline, keyword list, metadata, URL list, pasted boilerplate, file header, or duplicate text.

When readiness is insufficient, do not generate a full `skill.md`. Return readiness JSON that tells the app what is missing and what kind of sample would improve the board.

### Required JSON for assess_sample_readiness

Return only valid JSON with this exact top-level key order:

1. `schema`
2. `board_id`
3. `usable_note_count`
4. `usable_word_count`
5. `ready`
6. `progress_message`
7. `missing`
8. `best_next_sample`
9. `quality_warnings`

Field rules:

- `schema`: always `mood.text_readiness.v1`
- `usable_note_count`: integer
- `usable_word_count`: integer
- `ready`: boolean
- `progress_message`: one app-facing sentence
- `missing.notes`: number of additional usable notes needed
- `missing.words`: number of additional usable words needed
- `best_next_sample`: specific recommendation for the next note type
- `quality_warnings`: array of duplicate, too-short, boilerplate, off-voice, or unclear-source warnings

## Pass 1: text-sample analysis

Run this pass for each note or text chunk. The goal is not to judge quality. The goal is to extract voice evidence.

### Text-sample analysis steps

1. Clean obvious metadata, file headers, copy artifacts, repeated whitespace, and source labels.
2. Preserve spelling, punctuation, paragraph shape, and sentence rhythm as evidence.
3. Identify genre and context: essay, note, email, story, script, caption, review, memo, speech, transcript, instructional text, or hybrid.
4. Identify point of view and relationship to the reader.
5. Identify tone and emotional temperature.
6. Identify sentence rhythm: average length, variation, fragments, questions, run-ons, pauses, repetition, and punch lines.
7. Identify syntax habits: clauses, lists, parallel structure, contrast, interruption, apposition, direct address, parentheticals, and transitions.
8. Identify diction: plain words, technical words, slang, sensory nouns, verbs, modifiers, contractions, profanity, formality, and recurring phrases.
9. Identify imagery and sensory logic: visual, tactile, sound, taste, smell, body, place, object, weather, domestic detail, technological detail, or abstract language.
10. Identify structure: opening move, development pattern, paragraphing, turns, endings, titles, captions, and calls to action.
11. Identify rhetorical moves: confession, observation, contrast, analogy, reversal, understatement, overstatement, question, aside, instruction, skepticism, intimacy, or withholding.
12. Identify themes and fixations.
13. Identify what to avoid when imitating the voice.
14. Identify sample-specific quirks that should not become global rules.
15. Rate usefulness for the final skill.

### Required JSON for analyze_text_sample

Return only valid JSON with this exact top-level key order:

1. `schema`
2. `note_id`
3. `board_id`
4. `sample_type`
5. `usable`
6. `usable_word_count`
7. `voice_evidence`
8. `rhythm`
9. `diction`
10. `structure`
11. `rhetorical_moves`
12. `themes`
13. `signature_phrases`
14. `avoid_as_global_rule`
15. `influence_hints`
16. `confidence`

Field rules:

- `schema`: always `mood.text_sample_analysis.v1`
- `note_id`: copy input note id exactly
- `board_id`: copy input board id exactly
- `sample_type`: source or inferred genre
- `usable`: boolean
- `usable_word_count`: integer after cleaning
- `voice_evidence.point_of_view`: first person, second person, third person, mixed, implied, or unclear
- `voice_evidence.reader_relationship`: intimate, instructional, observational, argumentative, confessional, detached, communal, performative, or mixed
- `voice_evidence.tone`: array of specific tone labels
- `voice_evidence.emotional_temperature`: cool, warm, restrained, urgent, dry, tender, angry, amused, formal, casual, or mixed
- `rhythm.sentence_length`: short, medium, long, varied, fragment-heavy, or mixed
- `rhythm.pacing`: brisk, slow, clipped, rolling, stop-start, breathy, layered, or mixed
- `rhythm.punctuation`: punctuation habits worth preserving
- `rhythm.paragraph_shape`: dense, airy, single-line, blocky, cascading, list-like, or mixed
- `rhythm.repetition`: repeated sounds, words, sentence frames, or none observed
- `diction.word_register`: plain, elevated, technical, colloquial, lyrical, blunt, academic, commercial, or mixed
- `diction.verbs`: observed verb style
- `diction.nouns`: observed noun style
- `diction.modifiers`: observed adjective and adverb behavior
- `diction.contractions`: frequent, occasional, rare, absent, or mixed
- `diction.recurring_words`: array of recurring words that matter
- `structure.opening_moves`: array of observed opening patterns
- `structure.development_moves`: array of observed development patterns
- `structure.ending_moves`: array of observed ending patterns
- `structure.transitions`: observed transition behavior
- `rhetorical_moves`: array of moves from the sample
- `themes`: array of concrete themes, concerns, subjects, and fixations
- `signature_phrases`: short phrases from the sample when legally and practically useful; keep each phrase under 12 words
- `avoid_as_global_rule`: array of sample-specific quirks that should not be universalized
- `influence_hints.weight`: integer from 1 to 5
- `influence_hints.best_use`: array using labels such as `tone`, `rhythm`, `diction`, `structure`, `themes`, `humor`, `dialogue`, `persuasion`, `intimacy`, or `technicality`
- `influence_hints.keep`: array of habits to preserve
- `influence_hints.discard`: array of artifacts to ignore
- `confidence.overall`: number from 0 to 1
- `confidence.reason`: one sentence

## Pass 2: voice profile synthesis

Run this pass after analyzing usable samples. The voice profile is the bridge between raw sample analysis and the generated `skill.md`.

### Voice profile synthesis steps

1. Read all usable sample analyses in board order.
2. Weight stronger samples higher than weak, short, duplicate, or off-context samples.
3. Identify repeated voice traits across samples.
4. Identify the central voice thesis: what the writing sounds like at its most recognizable.
5. Separate stable traits from optional traits.
6. Separate intentional habits from accidents.
7. Identify the reader relationship.
8. Identify the voice's emotional range and default temperature.
9. Identify sentence rhythm rules.
10. Identify diction rules.
11. Identify structure rules.
12. Identify rhetorical moves.
13. Identify recurring themes and source-world details.
14. Identify humor, restraint, sentiment, directness, and vulnerability behavior.
15. Identify taboo moves: what breaks the voice.
16. Create calibration rules that can be checked after generation.
17. Create rewrite instructions that another model can follow.

### Required JSON for synthesize_voice_profile

Return only valid JSON with this exact top-level key order:

1. `schema`
2. `board_id`
3. `board_name`
4. `voice_thesis`
5. `source_quality`
6. `core_voice`
7. `tone`
8. `rhythm`
9. `syntax`
10. `diction`
11. `imagery`
12. `structure`
13. `rhetorical_moves`
14. `themes`
15. `signature_habits`
16. `avoidances`
17. `calibration_tests`
18. `recommended_skill_name`
19. `confidence`

Field rules:

- `schema`: always `mood.voice_profile.v1`
- `voice_thesis`: one sentence that defines the captured voice
- `source_quality.sample_count`: integer
- `source_quality.word_count`: integer
- `source_quality.range`: concise note about variety and gaps
- `source_quality.limitations`: array of reliability limits
- `core_voice.reader_relationship`: how the voice treats the reader
- `core_voice.point_of_view`: dominant point of view
- `core_voice.default_posture`: teaching, confessing, observing, persuading, narrating, joking, briefing, remembering, or mixed
- `core_voice.emotional_default`: emotional baseline
- `tone.primary`: array of stable tone traits
- `tone.secondary`: array of optional tone traits
- `tone.never`: array of tones that break the voice
- `rhythm.sentence_rules`: array of sentence-level rhythm rules
- `rhythm.paragraph_rules`: array of paragraph-level rhythm rules
- `rhythm.pacing_rules`: array of pacing rules
- `syntax.rules`: array of syntax rules
- `syntax.transitions`: transition behavior
- `diction.core_word_bank`: array of source-derived word tendencies
- `diction.verbs`: verb behavior
- `diction.nouns`: noun behavior
- `diction.modifiers`: modifier behavior
- `diction.formality`: formality behavior
- `diction.banned_ai_language`: array of generic AI-sounding patterns to avoid
- `imagery.domains`: array of sensory or subject domains
- `imagery.concreteness`: concrete, abstract, mixed, object-led, place-led, body-led, or concept-led
- `structure.openings`: array of opening rules
- `structure.development`: array of development rules
- `structure.endings`: array of ending rules
- `structure.formatting`: line breaks, lists, headings, titles, captions, or paragraph shape
- `rhetorical_moves`: array of named moves with usage instructions
- `themes`: array of recurring subjects and concerns
- `signature_habits`: array of highly recognizable habits
- `avoidances`: array of concrete mistakes to avoid
- `calibration_tests`: array of checks another model can run after drafting
- `recommended_skill_name`: lowercase hyphenated slug derived from board name and voice
- `confidence.overall`: number from 0 to 1
- `confidence.reason`: one sentence

## Pass 3: generate skill.md

Run this pass when the board is ready and the app requests a final skill file.

The output must be a complete `skill.md` document with YAML frontmatter and markdown body. Return the document only. Do not wrap it in a markdown code fence.

### Generated skill frontmatter rules

The generated skill must begin with YAML frontmatter containing exactly two fields:

- `name`
- `description`

Rules for `name`:

- Lowercase only
- Hyphenated words only
- No spaces
- No underscores
- No punctuation except hyphens
- No term `skill`
- Maximum 48 characters
- Derived from board name, author name, publication name, project name, or voice thesis
- If the board name is generic, derive from the strongest voice descriptor and use-case descriptor

Rules for `description`:

- Lowercase sentence text
- 45 to 95 words
- State what the skill does
- State when to use it
- Mention writing, rewriting, critique, calibration, or voice matching when relevant
- Include the target voice traits in concrete language
- Do not use marketing language
- Do not say `this skill is designed to`

### Generated skill body structure

Use this exact section order:

1. `# Purpose`
2. `# Voice thesis`
3. `# Use when`
4. `# Do not use when`
5. `# Source-derived voice rules`
6. `## Reader relationship`
7. `## Tone`
8. `## Rhythm`
9. `## Syntax`
10. `## Diction`
11. `## Imagery and detail`
12. `## Structure`
13. `## Signature moves`
14. `# Writing workflow`
15. `# Rewriting workflow`
16. `# Critique workflow`
17. `# Calibration checklist`
18. `# Avoid`
19. `# Examples`
20. `# Final output rules`

Do not omit a section. If the source has little evidence for a section, write a narrow rule based on what is known instead of inventing a broad one.

### Content rules for the generated skill

- Write direct instructions to the future model.
- Use imperative verbs.
- Make every rule operational.
- Tie rules to observable writing behavior.
- Avoid vague traits such as `authentic`, `engaging`, `compelling`, `human`, `relatable`, `elevated`, or `clear` unless immediately defined with concrete behavior.
- Do not include placeholders.
- Do not include bracketed fill-ins.
- Do not include `sample text goes here`, `insert`, `todo`, or similar incomplete language.
- Do not mention that the source came from a moodboard.
- Do not mention note ids, app internals, analysis schemas, or board state.
- Do not overquote the source. Prefer paraphrase. If short source phrases are useful, keep each phrase under 12 words.
- Do not write a generic brand voice guide.
- Do not generate a biography unless the source text clearly requires one.
- Do not guarantee exact imitation. The goal is repeatable approximation of style and writing behavior.

## Section instructions for the generated skill

### # Purpose

Write 2 to 4 sentences. Explain the task the skill performs: writing, rewriting, and critiquing in the captured voice.

### # Voice thesis

Write one compact paragraph. State what the voice sounds like, how it moves, what it notices, and what it refuses to do.

### # Use when

Write 4 to 8 bullets. Include concrete use cases such as drafting posts, essays, captions, newsletters, product copy, scripts, notes, internal memos, or other forms supported by the source.

### # Do not use when

Write 3 to 6 bullets. Include cases where the captured voice would be inappropriate, too informal, too intimate, too sparse, too poetic, too blunt, or too specialized.

### # Source-derived voice rules

Write a short intro sentence. The subsections that follow must hold the real rules.

### ## Reader relationship

Explain how the voice treats the reader: peer, confidant, student, witness, customer, friend, stranger, critic, or collaborator. Include rules for direct address.

### ## Tone

Write 5 to 10 bullets. Separate default tone from allowed tonal shifts. Include emotional restraint, warmth, humor, skepticism, urgency, tenderness, or distance only when supported by source.

### ## Rhythm

Write 5 to 10 bullets. Include sentence length, paragraph length, pace, pauses, fragments, repetition, and ending rhythm.

### ## Syntax

Write 4 to 8 bullets. Include clause behavior, transitions, list behavior, questions, contrasts, asides, interruptions, and sentence openings.

### ## Diction

Write 5 to 10 bullets. Include nouns, verbs, modifiers, contractions, technicality, slang, sensory words, abstract words, and recurring word types.

### ## Imagery and detail

Write 4 to 8 bullets. Include the kinds of concrete details the voice notices and the kinds it ignores.

### ## Structure

Write 5 to 10 bullets. Include openings, development, turns, paragraphing, endings, headings, and calls to action.

### ## Signature moves

Write 5 to 12 bullets. Each bullet must name a move and explain how to use it. A move can be `start small`, `withhold the point`, `turn on a plain sentence`, `end before explaining`, `use a domestic object as evidence`, `make the abstract physical`, `answer a question sideways`, or another source-derived pattern.

### # Writing workflow

Write a step-by-step process for drafting new text in the voice. Include:

1. Identify the communicative job.
2. Choose the reader relationship.
3. Choose the emotional temperature.
4. Build the first draft around the source-derived structure.
5. Apply rhythm rules.
6. Replace generic language with source-compatible diction.
7. Add concrete details.
8. Cut lines that explain too much.
9. Run calibration.

### # Rewriting workflow

Write a step-by-step process for transforming existing text into the voice. Include:

1. Preserve meaning.
2. Strip generic AI phrasing.
3. Rebuild sentence rhythm.
4. Replace diction.
5. Reorder structure when needed.
6. Add or remove warmth, distance, humor, or restraint according to the voice profile.
7. Cut filler.
8. Check that the result still says the same thing.

### # Critique workflow

Write a step-by-step process for reviewing a draft against the voice. Include:

1. Identify where the draft matches the voice.
2. Identify where rhythm breaks.
3. Identify generic language.
4. Identify missing concrete detail.
5. Identify overexplaining.
6. Identify wrong tone.
7. Give targeted edits.

### # Calibration checklist

Write 8 to 14 yes/no checks. Each check must be directly useful after drafting.

### # Avoid

Write 10 to 20 bullets. Include specific AI tells and voice-breaking moves. Always include these unless the source clearly contradicts them:

- Inflated significance
- Vague praise
- Promotional tone
- Generic conclusions
- Rule-of-three filler
- Overuse of em dashes
- Explaining the point after the point already landed
- Stacking adjectives without new information
- Empty intensifiers
- Chatbot phrasing

### # Examples

Include 2 example transformations using neutral source text. Use these exact neutral inputs unless target use requires closer examples:

Neutral input 1: `We will begin at nine, review the plan, and send notes afterward.`

Neutral input 2: `The product helps people turn scattered ideas into a finished draft.`

For each example, show:

- `Before:` the neutral input
- `After:` a rewritten version in the captured voice
- `Why it works:` 1 to 3 bullets tied to the generated skill rules

The `After` text must be fully written. Do not leave it blank.

### # Final output rules

Write final rules for what the future model should return. Include:

- Return only the requested draft, rewrite, critique, or calibration result.
- Match the requested length and format.
- Preserve factual meaning.
- Do not mention the skill or source analysis unless asked.
- Ask a clarifying question only when the task cannot be completed safely or meaningfully.

## Strictness behavior

Use `strictness` to control how tightly the generated skill follows the source:

- `loose`: preserve broad voice traits while allowing more adaptation to the user's task
- `balanced`: preserve stable voice traits while adapting structure and detail to the task
- `strict`: enforce sentence rhythm, diction, structure, and avoidances aggressively

Default to `balanced`.

## Revision behavior

When revising an existing generated skill:

1. Preserve valid frontmatter.
2. Apply the revision request across all affected sections.
3. Keep the required section order.
4. Remove contradictions created by the revision.
5. Keep examples aligned with the revised rules.
6. Return the complete revised `skill.md`, not a patch.

## Quality bar

A successful text-board skill is:

- Complete enough to reuse without the original samples
- Concrete enough to guide another model
- Faithful to repeated source patterns
- Honest about limitations
- Free of placeholders
- Free of generic AI style advice unless tied to the source voice
- Useful for writing, rewriting, critique, and calibration
- Valid as a `skill.md` file

## Final self-check

Before returning any final `skill.md`, silently confirm:

1. The file begins with valid YAML frontmatter.
2. The frontmatter has exactly `name` and `description`.
3. The name is lowercase and hyphenated.
4. The description is lowercase and specific.
5. All required sections are present in order.
6. Every rule is source-derived or clearly operational.
7. No placeholders remain.
8. No app internals remain.
9. Examples are fully written.
10. The skill can be used without the original text board.

