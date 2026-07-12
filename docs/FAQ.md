# FAQ

1. How are RTL and mixed-direction OCR results rendered?

Arabic OCR profiles convert visual-order OCR output into logical text before saving it. The
results editor then renders text areas with `dir="auto"`, allowing the browser to choose the base
direction from the text content.

2. Should recognized text be manually reordered before export?

No. Keep the saved annotation text in logical OCR output form. Consumers that display the text
should use Unicode-aware rendering, such as HTML `dir="auto"` or an equivalent text layout setting.
