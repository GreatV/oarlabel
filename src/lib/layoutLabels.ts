/** PP-StructureV3-compatible labels emitted by oar-ocr layout models. */
export const LAYOUT_LABELS = [
  "doc_title",
  "paragraph_title",
  "text",
  "content",
  "abstract",
  "image",
  "table",
  "chart",
  "formula",
  "figure_title",
  "table_title",
  "chart_title",
  "figure_table_chart_title",
  "header",
  "header_image",
  "footer",
  "footer_image",
  "footnote",
  "seal",
  "number",
  "reference",
  "reference_content",
  "algorithm",
  "formula_number",
  "aside_text",
  "list",
  "region",
  "other",
  "layout",
] as const;

export function layoutLabelOptions(current: string): readonly string[] {
  return LAYOUT_LABELS.includes(current as (typeof LAYOUT_LABELS)[number])
    ? LAYOUT_LABELS
    : [current, ...LAYOUT_LABELS];
}
