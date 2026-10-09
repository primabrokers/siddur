/* Backend configuration.
 *
 * The publishable key is meant to ship in client code: it grants only what RLS
 * allows anonymous callers, which here is reading the shared siddur cache. The
 * secret key must never appear in this file or any other the browser can fetch.
 *
 * Kept in one place because siddur.html, the auth client and the sync layer all
 * need it, and three copies of a URL is three things to miss when it changes.
 */
(function (global) {
  'use strict';

  global.CONFIG = {
    SUPABASE_URL: 'https://qdofumucgrggpehrxvdr.supabase.co',
    SUPABASE_KEY: 'sb_publishable_Gmd-cBgqxhzT2kCMRkxKnQ_ZjOarrRU',

    // Free, no key required. Zmanim and candle lighting.
    HEBCAL_URL: 'https://www.hebcal.com',

    // Texts and translations. Sections are cached both in the shared Supabase
    // table and locally, so this is a first-read fallback rather than a
    // per-view dependency.
    SEFARIA_URL: 'https://www.sefaria.org/api'
  };
})(typeof window !== 'undefined' ? window : this);
