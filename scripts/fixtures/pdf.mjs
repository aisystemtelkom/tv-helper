/**
 * Assembles a one-page PDF with a correct xref table.
 *
 * Fixtures must be synthetic because real client documents are never
 * committed, and they must be built rather than checked in as bytes so the
 * geometry a test asserts on is visible in the test itself.
 */
const encoder = new TextEncoder();

export function makePdf({ width, height, rotate = 0, content = "" }) {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]` +
      `/Rotate ${rotate}/Contents 4 0 R/Resources<<>>>>`,
    `<</Length ${encoder.encode(content).length}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.7\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  return encoder.encode(pdf);
}
