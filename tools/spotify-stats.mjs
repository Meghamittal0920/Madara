/**
 * spotify-stats.mjs
 * -----------------------------------------------------------------------------
 * Writes assets/spotify-stats.json for the corner player.
 *
 * QUICK START
 *   1. cp .env.example .env
 *   2. paste your token into SPOTIFY_TOKEN in .env
 *   3. node tools/spotify-stats.mjs
 *
 * -----------------------------------------------------------------------------
 * ABOUT "LISTENERS"
 *
 * The Spotify Web API does not return a listener count. Not for playlists, not
 * for artists. "Monthly listeners" appears on artist pages inside Spotify's own
 * apps but is not served by any Web API endpoint — sites that show it scrape it
 * or pay for licensed data (Chartmetric, Songstats).
 *
 * The real audience figures the API does return, all of which this collects:
 *
 *   playlist followers   how many people saved the playlist
 *   artist followers     how many people follow an artist
 *   popularity           0-100, Spotify's own measure of recent play volume
 *
 * There is likewise no play count, stream count, or view count anywhere.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT FRONT-END CODE
 *
 *   1. Tokens expire. Every Spotify token returns expires_in: 3600 — one hour.
 *      A token pasted into app.js is dead by tomorrow.
 *   2. Front-end code is public. A user token with `user-top-read` lets any
 *      visitor read your listening history; a client secret lets them spend
 *      your quota.
 *
 * So the fetch happens here and the page reads static JSON: permanent, free,
 * instant, and carrying nothing sensitive.
 *
 * -----------------------------------------------------------------------------
 * CONFIG lives in .env (see .env.example). Real environment variables win over
 * .env, so CI can override without editing the file.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/* ---- tiny .env reader: no dependency, no surprises ---- */
async function loadEnv(file = '.env') {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return false;
  const text = await readFile(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (val.length > 1 && /^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
  return true;
}

const usedEnvFile = await loadEnv();

const TOKEN         = process.env.SPOTIFY_TOKEN;
const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const RAW_PLAYLIST  = process.env.SPOTIFY_PLAYLIST_ID;
const RAW_ARTIST    = process.env.SPOTIFY_ARTIST_ID;
const WANT_POP      = /^(1|true|yes)$/i.test(process.env.SPOTIFY_POPULARITY || '');
const WANT_TOP      = /^(1|true|yes)$/i.test(process.env.SPOTIFY_TOP || '');
const TOP_RANGE     = process.env.SPOTIFY_TOP_RANGE || 'long_term';
const TOP_LIMIT     = Math.min(Number(process.env.SPOTIFY_TOP_LIMIT || 5) || 5, 50);
const OUT           = process.env.SPOTIFY_OUT || 'assets/spotify-stats.json';
/* Monthly listeners has no API endpoint — this is a figure you read off the
   artist page and type into .env. Carried through with its label and date so
   the page can never present a stale number as live. */
const ML_VALUE      = process.env.SPOTIFY_MONTHLY_LISTENERS;
const ML_LABEL      = process.env.SPOTIFY_MONTHLY_LISTENERS_LABEL;
const ML_DATE       = process.env.SPOTIFY_MONTHLY_LISTENERS_DATE;

const fail = (msg) => { console.error('\n  ' + msg + '\n'); process.exit(1); };
const warn = (msg) => console.warn('  ! ' + msg);

if (!TOKEN && !(CLIENT_ID && CLIENT_SECRET)) {
  fail('No credentials.\n' +
       (usedEnvFile ? '  .env was read, but SPOTIFY_TOKEN is still blank.\n'
                    : '  No .env found. Run: cp .env.example .env\n') +
       '  Fill in SPOTIFY_TOKEN, or SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET.\n' +
       '  Tokens: https://developer.spotify.com/documentation/web-api/concepts/authorization');
}
if (!RAW_PLAYLIST && !RAW_ARTIST && !WANT_TOP) {
  fail('Nothing to fetch. Set SPOTIFY_PLAYLIST_ID, SPOTIFY_ARTIST_ID, or SPOTIFY_TOP=1 in .env.');
}
if (WANT_TOP && !TOKEN) {
  fail('SPOTIFY_TOP needs SPOTIFY_TOKEN.\n' +
       '  /v1/me/top/tracks is user-scoped: a client-credentials token has no\n' +
       '  user attached and always returns 401 there. Use a user token carrying\n' +
       '  the `user-top-read` scope.');
}

/* accepts a bare id, a spotify: uri, or an open.spotify.com link */
const idFrom = (raw, kind) => raw
  ? (String(raw).match(new RegExp('(?:' + kind + '[:/])([A-Za-z0-9]+)'))?.[1] ?? String(raw).trim())
  : null;

const PLAYLIST_ID = idFrom(RAW_PLAYLIST, 'playlist');
const ARTIST_ID   = idFrom(RAW_ARTIST, 'artist');

async function mintToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) fail('Token request failed (' + res.status + '). Check the client id and secret in .env.');
  return (await res.json()).access_token;
}

const token = TOKEN || await mintToken();
const isUserToken = Boolean(TOKEN);

/**
 * `optional: true` means a refusal is survivable — warn, skip that figure, and
 * keep everything else the run collected. Only a dead token stops the whole
 * script, because nothing can succeed after that.
 */
async function api(path, label, { optional = false } = {}) {
  const res = await fetch('https://api.spotify.com/' + path, {
    headers: { Authorization: 'Bearer ' + token }
  });

  if (res.status === 401) {
    fail('401 on ' + label + '.\n' +
         '  The token is expired or malformed. Spotify tokens last one hour —\n' +
         '  paste a fresh one into .env and run this again. (Or switch to\n' +
         '  SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET, which mints one per run.)');
  }
  if (res.status === 429) {
    fail('429 on ' + label + ' — rate limited. Wait ' +
         (res.headers.get('retry-after') || 'a few') + 's.');
  }
  if (res.status === 403 || res.status === 404) {
    const why = res.status === 403 ? 'refused (403)' : 'not found (404)';
    if (!optional) {
      fail(why + ' on ' + label + '.\n' +
           (res.status === 403
             ? '  Valid token, but not allowed here. On /me/* that means a missing\n' +
               '  scope — `user-top-read` for top tracks — and adding a scope later\n' +
               '  does not upgrade an already-issued token.'
             : '  Check the id, and that the playlist is public.'));
    }
    warn(label + ': ' + why + ' — skipped.');
    return { __failed: true, status: res.status };
  }
  if (!res.ok) {
    if (optional) { warn(label + ': ' + res.status + ' — skipped.'); return { __failed: true }; }
    fail(res.status + ' on ' + label + '.');
  }
  return res.json();
}

const out = {
  playlistId: PLAYLIST_ID,
  name: null,
  owner: null,
  description: null,
  followers: null,
  tracks: null,
  isPublic: null,
  collaborative: null,
  url: PLAYLIST_ID ? 'https://open.spotify.com/playlist/' + PLAYLIST_ID : null,
  image: null,
  artistId: ARTIST_ID,
  artistName: null,
  artistFollowers: null,
  artistPopularity: null,
  artistGenres: null,
  artistUrl: null,
  avgPopularity: null,
  monthlyListeners: null,
  monthlyListenersLabel: null,
  monthlyListenersDate: null,
  curator: null,
  topTracks: null,
  topRange: null,
  updatedAt: new Date().toISOString(),
  unavailable: [],
  note: 'Spotify returns followers and popularity. It has no listener, play or view count.'
};

/* Every call below is best-effort. Spotify refuses different things to
   different apps, so one refusal must never lose the figures that did work. */

/* ---- playlist ---- */
if (PLAYLIST_ID) {
  const fields = 'name,description,public,collaborative,followers(total),tracks(total),external_urls,images,owner(display_name)';
  const pl = await api(
    'v1/playlists/' + PLAYLIST_ID + '?fields=' + encodeURIComponent(fields),
    'playlist ' + PLAYLIST_ID,
    { optional: true }
  );

  if (pl.__failed) {
    warn('  It must be public. Spotify-owned editorial playlists are not');
    warn('  readable this way — use one you created.');
    out.unavailable.push('playlist details');
  } else {
    out.name          = pl.name ?? null;
    out.owner         = pl.owner?.display_name ?? null;
    out.description   = (pl.description || '').replace(/<[^>]*>/g, '').trim() || null;
    out.followers     = pl.followers?.total ?? null;
    out.tracks        = pl.tracks?.total ?? null;
    out.isPublic      = pl.public ?? null;
    out.collaborative = pl.collaborative ?? null;
    out.url           = pl.external_urls?.spotify ?? out.url;
    out.image         = pl.images?.[0]?.url ?? null;
    /* Spotify silently drops fields it will not serve rather than erroring */
    if (out.tracks == null) out.unavailable.push('track count');
  }
}

/* ---- average track popularity ---- */
if (PLAYLIST_ID && WANT_POP) {
  const t = await api(
    'v1/playlists/' + PLAYLIST_ID + '/tracks?fields=' +
      encodeURIComponent('items(track(popularity))') + '&limit=100',
    'playlist tracks (for popularity)',
    { optional: true }
  );
  if (t.__failed) {
    if (t.status === 403) {
      warn('  Spotify restricts track-level reads on playlists your app does not own.');
      warn('  Followers still work; average popularity is unavailable for this one.');
    }
    out.unavailable.push('average track popularity');
  } else {
    const scores = (t.items || [])
      .map((i) => i?.track?.popularity)
      .filter((v) => typeof v === 'number');
    if (scores.length) {
      out.avgPopularity = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else {
      out.unavailable.push('average track popularity');
    }
  }
}

/* ---- artist ---- */
if (ARTIST_ID) {
  const a = await api('v1/artists/' + ARTIST_ID, 'artist ' + ARTIST_ID, { optional: true });
  if (a.__failed) {
    out.unavailable.push('artist details');
  } else {
    out.artistName       = a.name ?? null;
    out.artistFollowers  = a.followers?.total ?? null;
    out.artistPopularity = a.popularity ?? null;
    out.artistGenres     = (a.genres || []).slice(0, 3);
    out.artistUrl        = a.external_urls?.spotify ?? null;
  }
}

/* ---- who ran this, only when a track list will actually carry their name.
       Without SPOTIFY_TOP there is no reason to publish a personal identity. ---- */
if (isUserToken && WANT_TOP) {
  const me = await api('v1/me', 'profile', { optional: true });
  if (!me.__failed) out.curator = me.display_name ?? null;
}

/* ---- top tracks: the curator's own most-played ---- */
if (WANT_TOP) {
  const top = await api(
    'v1/me/top/tracks?time_range=' + encodeURIComponent(TOP_RANGE) + '&limit=' + TOP_LIMIT,
    'top tracks',
    { optional: true }
  );
  if (top.__failed || !Array.isArray(top.items)) {
    out.unavailable.push('top tracks');
  } else if (top.items.length === 0) {
    warn('Top tracks came back empty (a new or low-activity account returns nothing).');
    out.unavailable.push('top tracks');
  } else {
    out.topTracks = top.items.map((t) => ({
      id: t.id ?? null,
      /* the uri is what the embed controller loads for click-to-play */
      uri: t.uri ?? (t.id ? 'spotify:track:' + t.id : null),
      name: t.name,
      artists: (t.artists || []).map((x) => x.name).join(', '),
      album: t.album?.name ?? null,
      art: t.album?.images?.slice(-1)[0]?.url ?? null,
      durationMs: t.duration_ms ?? null,
      popularity: typeof t.popularity === 'number' ? t.popularity : null,
      url: t.external_urls?.spotify ?? null
    }));
    out.topRange = TOP_RANGE;
  }
}

/* ---- monthly listeners, entered by hand ---- */
if (ML_VALUE && String(ML_VALUE).trim()) {
  const n = Number(String(ML_VALUE).replace(/[,_\s]/g, ''));
  if (Number.isFinite(n) && n >= 0) {
    out.monthlyListeners      = n;
    out.monthlyListenersLabel = (ML_LABEL || '').trim() || null;
    out.monthlyListenersDate  = (ML_DATE || '').trim() || null;
    if (!out.monthlyListenersDate) {
      warn('SPOTIFY_MONTHLY_LISTENERS has no _DATE — the page will show it undated.');
    }
  } else {
    warn('SPOTIFY_MONTHLY_LISTENERS is not a number — ignored.');
  }
}

/* these are not fields Spotify serves at all — record it so the UI can say so */
if (out.monthlyListeners == null) {
  out.unavailable.push('monthly listeners (not in the Web API)');
}
out.unavailable.push('play / stream / view counts (not in the Web API)');

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

const line = (k, v) => console.log('  ' + k.padEnd(22) + ': ' + (v ?? '—'));
console.log('\n  ' + (out.name ?? PLAYLIST_ID ?? '(no playlist)'));
if (out.owner) line('owner', out.owner);
line('playlist followers', out.followers?.toLocaleString());
line('tracks', out.tracks?.toLocaleString());
line('avg popularity', out.avgPopularity != null ? out.avgPopularity + ' / 100' : null);
if (ARTIST_ID) {
  line((out.artistName ?? 'artist') + ' followers', out.artistFollowers?.toLocaleString());
  line('artist popularity', out.artistPopularity != null ? out.artistPopularity + ' / 100' : null);
}
if (out.topTracks) {
  console.log('  top ' + out.topTracks.length + ' (' + out.topRange + '):');
  out.topTracks.forEach((t, i) => console.log('    ' + (i + 1) + '. ' + t.name + ' — ' + t.artists));
}
if (out.unavailable.length) {
  console.log('  not available:');
  out.unavailable.forEach((u) => console.log('    · ' + u));
}
if (out.monthlyListeners != null) {
  line('monthly listeners', out.monthlyListeners.toLocaleString() + ' (entered by hand' +
       (out.monthlyListenersDate ? ', ' + out.monthlyListenersDate : '') + ')');
}
line('auth', isUserToken ? 'user token' : 'client credentials');
line('config', usedEnvFile ? '.env' : 'environment only');
line('written', OUT);
console.log('');
