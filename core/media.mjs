export function imageDimensions(url) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    url || "",
  );
  if (!match) throw Error("Use a PNG, JPEG, or WebP image.");
  let raw;
  try {
    raw = atob(match[2]);
  } catch {
    throw Error("Image base64 is invalid.");
  }
  const b = Uint8Array.from(raw, (c) => c.charCodeAt(0)),
    str = (a, n) => String.fromCharCode(...b.slice(a, a + n)),
    u16 = (i) => (b[i] << 8) | b[i + 1],
    u32 = (i) =>
      b[i] * 16777216 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3],
    le24 = (i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
  if (
    match[1] === "png" &&
    b.length >= 33 &&
    str(1, 3) === "PNG" &&
    b[0] === 137 &&
    str(12, 4) === "IHDR"
  )
    return { width: u32(16), height: u32(20) };
  if (
    match[1] === "webp" &&
    b.length >= 30 &&
    str(0, 4) === "RIFF" &&
    str(8, 4) === "WEBP"
  ) {
    const chunk = str(12, 4);
    if (chunk === "VP8X") return { width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42)
      return {
        width: (b[26] + 256 * b[27]) & 16383,
        height: (b[28] + 256 * b[29]) & 16383,
      };
    if (chunk === "VP8L" && b[20] === 47)
      return {
        width: 1 + b[21] + ((b[22] & 63) << 8),
        height: 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10),
      };
  }
  if (match[1] === "jpeg" && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 255) break;
      const marker = b[i + 1],
        length = u16(i + 2);
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return { width: u16(i + 7), height: u16(i + 5) };
      if (length < 2) break;
      i += length + 2;
    }
  }
  throw Error("Invalid or unsupported raster image data.");
}
