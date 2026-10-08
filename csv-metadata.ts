export type CsvTemplateId = 'adobe' | 'shutterstock' | 'canva';
export interface CsvMetadataInput {
  filename: string;
  title: string;
  description: string;
  keywords: string[];
  category?: string;
  artist?: string;
  locale?: string;
  editorial?: boolean;
  mature?: boolean;
  illustration?: boolean;
  releases?: string;
}
const escape = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
// Marketplace upload sheets (headers copied verbatim from csv_sample templates).
// Title truncates to 200 chars (Adobe's limit); everything else passes through.
export function buildMetadataCsv(template: CsvTemplateId, input: CsvMetadataInput): string {
  const title = input.title.slice(0, 200);
  const keywords = input.keywords.map((k) => k.trim()).filter(Boolean).join(', ');
  const rows: string[][] = [];
  if (template === 'adobe') {
    rows.push(
      ['Filename', 'Title', 'Keywords', 'Category', 'Releases'],
      [input.filename, title, keywords, input.category ?? '', input.releases ?? ''],
    );
  } else if (template === 'shutterstock') {
    rows.push(
      ['Filename', 'Description', 'Keywords', 'Categories', 'Editorial', 'Mature content', 'illustration'],
      [input.filename, input.description, keywords, input.category ?? '', input.editorial ? 'yes' : 'no', input.mature ? 'yes' : 'no', input.illustration ? 'yes' : 'no'],
    );
  } else {
    rows.push(
      ['filename', 'title', 'keywords', 'Artist', 'locale', 'description'],
      [input.filename, title, keywords, input.artist ?? '', input.locale ?? 'en', input.description],
    );
  }
  return rows.map((row) => row.map(escape).join(',')).join('\n') + '\n';
}
