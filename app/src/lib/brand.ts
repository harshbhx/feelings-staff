/**
 * The salon's wordmark (PRD 12.9 as amended): the client's logo file reduced to its alpha channel
 * (512 x 146 webp, about 9 KB) in `public/brand/`, drawn by the kit's `Logo` as a CSS mask in
 * `--logo` (maroon 800), the website's technique. It is an image, not JS, so it costs the staff
 * entry nothing; the service worker precaches it so the header keeps its logo offline.
 */
export const LOGO_MASK = '/brand/logo-mask.webp';
