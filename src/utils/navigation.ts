export interface AppRoute {
  view: string;
  id: number | null;
  invoiceId: number | null;
  query: string;
}

const appViews = new Set([
  'catalog', 'login', 'register', 'reset-password', 'auth-action', 'guide',
  'session-detail', 'theme-detail', 'auction-detail', 'wallet', 'c2c-submit',
  'my-listings', 'invoices', 'fulfillment', 'journey', 'admin-dashboard',
  'admin-operations', 'admin-curation', 'admin-sessions', 'admin-auctions',
  'admin-reports', 'admin-users',
]);

function routeID(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseAppHash(hash: string): AppRoute {
  const raw = hash.replace(/^#/, '');
  const separator = raw.indexOf('?');
  const view = (separator < 0 ? raw : raw.slice(0, separator)) || 'catalog';
  const params = new URLSearchParams(separator < 0 ? '' : raw.slice(separator + 1));
  const id = routeID(params.get('id'));
  return { view: appViews.has(view) ? view : 'not-found', id, invoiceId: routeID(params.get('invoiceId')) ?? id, query: params.get('q') || '' };
}

export function buildAppHash(view: string, id?: number): string {
  const params = new URLSearchParams();
  if (id !== undefined && Number.isSafeInteger(id) && id > 0) {
    if (view === 'fulfillment') params.set('invoiceId', String(id));
    else if (['session-detail', 'theme-detail', 'auction-detail'].includes(view)) params.set('id', String(id));
  }
  return `#${view}${params.size ? `?${params}` : ''}`;
}
