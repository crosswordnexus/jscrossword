import JSUnzip from "./jsunzip.js";

/** unzip if needed and return decoded text */
export function maybeUnzipText(data) {
  // Ensure Uint8Array
  if (!(data instanceof Uint8Array)) {
    throw new Error("Parser expects Uint8Array input");
  }

  // detect PK (zip signature)
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const uz = new JSUnzip(data.buffer);
    if (!uz.isZipFile()) {
      throw new Error("Invalid ZIP file");
    }
    uz.readEntries();
    if (uz.entries.length === 0) {
      throw new Error("ZIP archive has no entries");
    }
    // grab first entry and decode its Uint8Array to text
    return new TextDecoder("utf-8").decode(uz.entries[0].data);
  }

  // otherwise assume it's already UTF-8 text
  return new TextDecoder("utf-8").decode(data);
}
