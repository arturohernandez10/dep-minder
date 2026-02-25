import fs from "node:fs";

export type WriterEncoding = {
  text: string;
  encoding: "utf8" | "utf16le" | "utf16be";
  hasBom: boolean;
};

export function decodeFileContents(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2) {
    const bom0 = buffer[0];
    const bom1 = buffer[1];
    if (bom0 === 0xff && bom1 === 0xfe) {
      return buffer.subarray(2).toString("utf16le");
    }
    if (bom0 === 0xfe && bom1 === 0xff) {
      const sliced = buffer.subarray(2);
      const swapped = Buffer.allocUnsafe(sliced.length);
      for (let i = 0; i + 1 < sliced.length; i += 2) {
        swapped[i] = sliced[i + 1];
        swapped[i + 1] = sliced[i];
      }
      return swapped.toString("utf16le");
    }
  }
  const zeroBytes = buffer.subarray(0, Math.min(buffer.length, 200)).filter((value) => value === 0x00).length;
  if (zeroBytes > 0) {
    return buffer.toString("utf16le");
  }
  return buffer.toString("utf8");
}

export function decodeFileWithEncoding(filePath: string): WriterEncoding {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2) {
    const bom0 = buffer[0];
    const bom1 = buffer[1];
    if (bom0 === 0xff && bom1 === 0xfe) {
      return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf16le", hasBom: true };
    }
    if (bom0 === 0xfe && bom1 === 0xff) {
      const sliced = buffer.subarray(2);
      const swapped = Buffer.allocUnsafe(sliced.length);
      for (let i = 0; i + 1 < sliced.length; i += 2) {
        swapped[i] = sliced[i + 1];
        swapped[i + 1] = sliced[i];
      }
      return { text: swapped.toString("utf16le"), encoding: "utf16be", hasBom: true };
    }
  }
  const zeroBytes = buffer.subarray(0, Math.min(buffer.length, 200)).filter((value) => value === 0x00)
    .length;
  if (zeroBytes > 0) {
    return { text: buffer.toString("utf16le"), encoding: "utf16le", hasBom: false };
  }
  return { text: buffer.toString("utf8"), encoding: "utf8", hasBom: false };
}
