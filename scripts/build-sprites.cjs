// Optional asset build dependency: sharp. Runtime extension has no dependencies.
// Packs the generated 4 x 2 atlas without repainting the original artwork.
const sharp = require('sharp');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const asset = (name) => path.join(root, 'assets', name);

async function main() {
  const source = asset('fanqie-atlas.png');
  const meta = await sharp(source).metadata();
  if (!meta.hasAlpha) throw new Error('The source atlas must have transparency');
  const cells = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const left = Math.round(col * meta.width / 4);
    const top = Math.round(row * meta.height / 2);
    const width = Math.round((col + 1) * meta.width / 4) - left;
    const height = Math.round((row + 1) * meta.height / 2) - top;
    const { data, info } = await sharp(source).extract({ left, top, width, height })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Find the principal connected silhouette so a neighbouring whisker at a
    // grid boundary cannot enlarge the crop or leave a floating fragment.
    const seen = new Uint8Array(width * height);
    let largest = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || data[start * 4 + 3] <= 16) continue;
      const queue = [start]; seen[start] = 1;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let q = 0; q < queue.length; q++) {
        const p = queue[q], x = p % width, y = Math.floor(p / width);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const n = ny * width + nx;
          if (!seen[n] && data[n * 4 + 3] > 16) { seen[n] = 1; queue.push(n); }
        }
      }
      if (queue.length > largest) {
        largest = queue.length; x0 = minX; y0 = minY; x1 = maxX; y1 = maxY;
      }
    }
    if (x1 < x0) throw new Error(`Empty sprite cell ${i}`);
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
    x1 = Math.min(width - 1, x1 + 2); y1 = Math.min(height - 1, y1 + 2);
    const bounds = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    cells.push({ bounds, buffer: await sharp(data, { raw: info }).extract(bounds).png().toBuffer() });
  }
  // One scale for every pose preserves the character's size across state changes.
  const scale = Math.min(392 / Math.max(...cells.map(c => c.bounds.width)),
    218 / Math.max(...cells.map(c => c.bounds.height)));
  const frames = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const width = Math.round(c.bounds.width * scale);
    const height = Math.round(c.bounds.height * scale);
    const resized = await sharp(c.buffer).resize(width, height).png().toBuffer();
    // Anchor the face side and ground contact; a small flight lift is intentional.
    const lift = i === 3 ? 8 : 0;
    frames.push(await sharp({ create: { width: 420, height: 235, channels: 4,
      background: '#00000000' } }).composite([{ input: resized,
      left: 406 - width, top: 227 - height - lift }]).png().toBuffer());
  }
  await sharp({ create: { width: 420 * 8, height: 235, channels: 4, background: '#00000000' } })
    .composite(frames.map((input, i) => ({ input, left: i * 420, top: 0 })))
    .png().toFile(asset('cat-sprite.png'));
  await sharp(frames[2]).toFile(asset('preview.png'));
  const { data, info } = await sharp(Buffer.concat(await Promise.all(frames.slice(0, 6)
    .map(frame => sharp(frame).raw().toBuffer()))), {
      raw: { width: 420, height: 235 * 6, channels: 4, pageHeight: 235 }
    }).gif({ loop: 0, delay: Array(6).fill(140), effort: 7 }).toBuffer({ resolveWithObject: true });
  await require('node:fs/promises').writeFile(asset('ragdoll-progress.gif'), data);
  console.log(`Packed 8 poses; GIF: ${info.size} bytes; common scale: ${scale.toFixed(3)}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
