import assert from 'node:assert/strict';
import { buildMetadataCsv } from './csv-metadata';

const input = {
  filename: 'cart-promo.mp4',
  title: 'A shopping cart rolls into frame and reveals a promo badge, ecommerce product promotion',
  description: 'A shopping cart rolls into frame and reveals a promo badge',
  keywords: ['cart', 'ecommerce, sale', 'promo "deal"'],
  category: 'shopping',
};
const adobe = buildMetadataCsv('adobe', input);
assert.ok(adobe.startsWith('Filename,Title,Keywords,Category,Releases\n'), 'adobe header is verbatim');
assert.ok(adobe.includes('ecommerce, sale'), 'keyword commas stay inside one cell');
assert.ok(adobe.includes('promo ""deal""'), 'quotes double up');
assert.ok(adobe.split('\n').length === 3, 'header + one row + trailing newline');
const shutter = buildMetadataCsv('shutterstock', { ...input, editorial: true });
assert.ok(shutter.startsWith('Filename,Description,Keywords,Categories,Editorial,Mature content,illustration\n'), 'shutterstock header is verbatim');
assert.ok(shutter.includes(',yes,no,no'), 'flags serialize as yes/no');
const canva = buildMetadataCsv('canva', { ...input, artist: 'studio' });
assert.ok(canva.startsWith('filename,title,keywords,Artist,locale,description\n'), 'canva header is verbatim');
assert.ok(canva.includes(',studio,en,'), 'artist and locale default correctly');
const long = buildMetadataCsv('adobe', { ...input, title: 'x'.repeat(300) });
assert.equal(long.split('\n')[1].split(',')[1].length, 200, 'titles truncate to the marketplace limit');
console.log('csv metadata checks passed');
