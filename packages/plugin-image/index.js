import exifr from "exifr";

import { definePlugin } from "@gemme/plugin-api";

import {
  IMAGE_MIME,
  IMAGE_EXT,
  RAW_EXT,
  WEB_IMAGE_EXT,
  EXIF_MAP,
  RENDER_FORMATS,
} from "./constants.js";
import {
  imageSize,
  pushDimensions,
  rafPreview,
  renderImage,
  decodableBuffer,
  parseSpecParams,
  normalizeSpec,
} from "./utils.js";

export default function imagePlugin(options = {}) {
  const wantExif = options.exif ?? true;
  const wantGps = options.gps ?? true;

  return definePlugin({
    id: "image",
    matches(mimeType, filename) {
      return (
        IMAGE_MIME.test(mimeType || "") ||
        IMAGE_EXT.test(filename || "") ||
        RAW_EXT.test(filename || "")
      );
    },
    async extract({ loadBuffer, filename }) {
      const buffer = await loadBuffer();
      const metadata = [];
      const isRaw = RAW_EXT.test(filename || "");

      // Fuji RAF isn't TIFF-based, so exifr can't read it directly — but it embeds
      // a full-size JPEG preview we can slice out. TIFF-based RAW (ARW/NEF/CR2/
      // DNG/…) is read by exifr straight from the buffer.
      const rafJpeg = isRaw ? rafPreview(buffer) : null;

      // Parse EXIF once. For RAF the EXIF lives inside the embedded JPEG; for
      // everything else it's in the file itself.
      let tags = null;
      if (wantExif || isRaw) {
        try {
          tags = (await exifr.parse(rafJpeg || buffer, { gps: wantGps })) || {};
        } catch {
          // Not all images carry (parseable) EXIF; ignore and keep what we can.
        }
      }

      if (isRaw) {
        // RAW dimensions come from EXIF — imageSize's header parser would misread
        // a TIFF-based RAW's thumbnail IFD.
        pushDimensions(
          metadata,
          tags?.ExifImageWidth ?? tags?.ImageWidth,
          tags?.ExifImageHeight ?? tags?.ImageHeight,
        );
      } else {
        const size = imageSize(buffer);
        if (size) pushDimensions(metadata, size.width, size.height);
      }

      if (wantExif && tags) {
        for (const [tag, key, type] of EXIF_MAP) {
          if ((key === "gps_lat" || key === "gps_lng") && !wantGps) continue;
          const value = tags[tag];
          if (value == null) continue;
          metadata.push({
            key,
            value: type === "date" ? new Date(value) : value,
            type,
          });
        }
      }

      return { metadata };
    },

    thumbnail: {
      contentType: "image/webp",
      async generate(source) {
        const buf = await decodableBuffer(source);
        if (!buf) return null;
        const out = await renderImage(buf, { width: 512, format: "webp" });
        return out ? out.data : null;
      },
    },

    preview(file, h) {
      const name = file.original_filename || "";
      if (WEB_IMAGE_EXT.test(name)) {
        return `<img src="${h.url.download()}" alt="">`;
      }
      if (file.thumbnail_type) {
        return `<img src="${h.url.thumbnail()}" alt="">`;
      }
      return null;
    },

    publicEmbed(file, h) {
      const embed = `<img src="${h.url.publicOriginal()}" alt="">`;
      const snippet = `<img
  src="${h.url.publicServe("w=800.webp")}"
  srcset="${h.url.publicServe("w=400.webp")} 400w, ${h.url.publicServe("w=800.webp")} 800w, ${h.url.publicServe("w=1600.webp")} 1600w"
  sizes="(max-width: 800px) 100vw, 800px"
  alt="">`;
      return `<p class="sub">Embed the original:</p>
<pre class="snippet">${h.escapeHtml(embed)}</pre>
<p class="sub">Resized / reformatted variants (drop into <code>srcset</code>):</p>
<pre class="snippet">${h.escapeHtml(snippet)}</pre>`;
    },

    serving: {
      formats: RENDER_FORMATS,
      async serve({ source, segments, ext }, api) {
        const spec = normalizeSpec(
          parseSpecParams(segments[segments.length - 1]),
        );
        const encoder = ext === "jpg" ? "jpeg" : ext;
        return api.rendition({ spec }, ext, `image/${encoder}`, async () => {
          const buf = await decodableBuffer(source);
          if (!buf) return null;
          const out = await renderImage(buf, { ...spec, format: ext });
          return out ? out.data : null;
        });
      },
    },
  });
}
