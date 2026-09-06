// server/router.js
// Route table and matcher. Mutations (POST/PUT/DELETE) are body/token/origin checked
// by server.js; this module only maps method+path -> handler.

import * as h from './handlers.js';

const ROUTES = [
  { method: 'GET', pattern: '/api/session', handler: h.handleSession, limit: null },
  { method: 'GET', pattern: '/api/health', handler: h.handleHealth, limit: null },
  { method: 'GET', pattern: '/api/sources', handler: h.handleListSources, limit: null },
  { method: 'GET', pattern: '/api/sources/builtin', handler: h.handleListBuiltinSources, limit: null },
  { method: 'GET', pattern: '/api/sources/:id', handler: h.handleGetSource, limit: null },
  { method: 'POST', pattern: '/api/sources/import', handler: h.handleImportSource, limit: 'import' },
  { method: 'GET', pattern: '/api/profiles', handler: h.handleListProfiles, limit: null },
  { method: 'POST', pattern: '/api/profiles/import', handler: h.handleImportProfile, limit: 'default' },
  { method: 'POST', pattern: '/api/profiles', handler: h.handleCreateProfile, limit: 'default' },
  { method: 'GET', pattern: '/api/profiles/:id', handler: h.handleGetProfile, limit: null },
  { method: 'PUT', pattern: '/api/profiles/:id', handler: h.handleUpdateProfile, limit: 'default' },
  { method: 'DELETE', pattern: '/api/profiles/:id', handler: h.handleDeleteProfile, limit: null },
  { method: 'POST', pattern: '/api/profiles/:id/duplicate', handler: h.handleDuplicateProfile, limit: 'default' },
  { method: 'GET', pattern: '/api/profiles/:id/export', handler: h.handleExportProfile, limit: null },
  { method: 'GET', pattern: '/api/geometries', handler: h.handleListGeometries, limit: null },
  { method: 'POST', pattern: '/api/geometries', handler: h.handleCreateGeometry, limit: 'default' },
  { method: 'GET', pattern: '/api/geometries/:id', handler: h.handleGetGeometry, limit: null },
  { method: 'GET', pattern: '/api/patterns', handler: h.handleListPatterns, limit: null },
  { method: 'POST', pattern: '/api/patterns', handler: h.handleCreatePattern, limit: 'default' },
  { method: 'GET', pattern: '/api/patterns/:id', handler: h.handleGetPattern, limit: null },
  { method: 'POST', pattern: '/api/layout/compute', handler: h.handleComputeLayout, limit: 'default' },
  { method: 'GET', pattern: '/api/layout/compute-job/:id', handler: h.handleComputeJob, limit: null },
  { method: 'POST', pattern: '/api/validate/line', handler: h.handleValidateLine, limit: 'default' },
  { method: 'POST', pattern: '/api/compare', handler: h.handleCompare, limit: 'default' },
  { method: 'GET', pattern: '/api/layouts', handler: h.handleListLayouts, limit: null },
  { method: 'GET', pattern: '/api/layouts/:id', handler: h.handleGetLayout, limit: null },
  { method: 'POST', pattern: '/api/layouts/:id/lock', handler: h.handleLockLayout, limit: null },
  { method: 'POST', pattern: '/api/layouts/:id/progress', handler: h.handleProgress, limit: 'default' },
  { method: 'POST', pattern: '/api/layouts/:id/candidate', handler: h.handleCreateCandidate, limit: 'default' },
  { method: 'GET', pattern: '/api/layouts/:id/diff', handler: h.handleDiff, limit: null },
  { method: 'GET', pattern: '/api/layouts/:id/search', handler: h.handleSearch, limit: null },
  { method: 'POST', pattern: '/api/layouts/:id/stretch', handler: h.handleStretch, limit: 'default' },
  { method: 'POST', pattern: '/api/layouts/:id/auto-suggest', handler: h.handleAutoSuggest, limit: 'default' },
  { method: 'POST', pattern: '/api/layouts/:id/stretch-book', handler: h.handleStretchBook, limit: 'default' },
  { method: 'GET', pattern: '/api/layouts/:id/stretch-report', handler: h.handleStretchReport, limit: null },
  { method: 'POST', pattern: '/api/layouts/:id/fit-margin', handler: h.handleFitMargin, limit: 'default' },
  { method: 'POST', pattern: '/api/layouts/:id/adopt-candidate', handler: h.handleAdoptCandidate, limit: 'default' },
  { method: 'GET', pattern: '/api/layouts/:id/export', handler: h.handleExport, limit: null },
];

function segments(pattern) {
  return pattern.split('/').filter(Boolean);
}

export function matchRoute(method, pathname) {
  const pathSegs = pathname.split('/').filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const psegs = segments(route.pattern);
    if (psegs.length !== pathSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < psegs.length; i++) {
      if (psegs[i].startsWith(':')) {
        params[psegs[i].slice(1)] = decodeURIComponent(pathSegs[i]);
      } else if (psegs[i] !== pathSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function isMutation(method) {
  return method === 'POST' || method === 'PUT' || method === 'DELETE';
}

export function hasBody(method) {
  return method === 'POST' || method === 'PUT';
}

export function bodyLimitFor(route) {
  if (!route || !route.limit) return null;
  return route.limit;
}
