# mood weighted image update notes

## What changed

Image items now carry a user-controlled `weight` value. The default is `1.0`. Higher values make that image steer the final prompt more strongly. Lower values keep the image as supporting material.

The image board also carries `promptFormat`, so the board can synthesize into the selected output format:

- `json`
- `verbose_flux_caption`
- `ideogram_json`
- `midjourney_tags`

## App data model

Each image item should include:

```js
{
  id,
  kind: "image",
  src,
  x,
  y,
  z,
  weight: 1.0,
  analysis: null,
  analysisStatus: "loading"
}
```

Each image board should include:

```js
{
  id,
  name,
  type: "image",
  promptFormat: "verbose_flux_caption",
  items: [],
  output: "",
  outputStatus: "idle",
  outputError: ""
}
```

## Regeneration behavior

Changing image position should not regenerate anything.

Changing image weight should regenerate the final board prompt, but should not re-run single-image analysis.

The image-board signature should include:

```js
selectedFormat + "|" + ready.map((r) => `${r.id}:${formatImageWeight(r.weight)}`).join("|")
```

That makes these changes regenerate synthesis:

- adding an analyzed image
- removing an analyzed image
- changing an image weight
- changing the prompt format dropdown

It avoids regenerating synthesis for:

- dragging an image
- panning the canvas
- zooming the canvas

## Synthesis payload

The synthesis call should wrap each existing analysis with the current image weight:

```js
{
  schema: "mood.weighted_image_board.v1",
  selected_format: selectedFormat,
  aspect_ratio: "1:1",
  reference_count: references.length,
  weight_scale: {
    default: 1.0,
    min: 0.1,
    max: 5.0,
    meaning: "weights are relative synthesis influence controls; 1.0 is normal, higher values lead more, lower values support"
  },
  references: references.map((r, i) => ({
    index: i + 1,
    source_id: r.id,
    weight: clampImageWeight(r.weight),
    analysis: r.analysis
  }))
}
```

## Weight interpretation

Use this scale in the model instructions:

- `0.1` to `0.4`: whisper influence
- `0.5` to `0.9`: support influence
- `1.0`: normal influence
- `1.1` to `1.9`: preferred influence
- `2.0` to `3.4`: anchor influence
- `3.5` to `5.0`: dominant influence

The model should apply weights by visual dimension. A high-weight composition reference should steer framing and layout. A high-weight palette reference should steer color. A high-weight texture reference should steer material language. Weight should not force the model to copy the whole image.

## Prompt instruction rule

Do not mention weights in final prompts except in structured JSON audit fields. The user should see the effect of weighting, not bookkeeping language.
