import { unzipSync, strFromU8 } from "fflate";

/** unzip if needed and return decoded text */
export function maybeUnzipText(data) {
  if (!(data instanceof Uint8Array)) {
    throw new Error("Parser expects Uint8Array input");
  }

  // detect PK (zip signature)
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = unzipSync(data); // returns an object { filename: Uint8Array }
    const names = Object.keys(files);

    if (names.length === 0) {
      throw new Error("ZIP archive has no files");
    }

    const firstFile = names[0];
    return strFromU8(files[firstFile]);
  }

  // otherwise assume it's already UTF-8 text
  return new TextDecoder("utf-8").decode(data);
}
