export type SessionStatus = 'loading' | 'authenticated' | 'profile-required' | 'guest' | 'error';

export function authPageDestination(view: string, status: SessionStatus, role: string): string | null {
  if (!['login', 'register'].includes(view)) return null;
  if (status === 'authenticated') return role === 'masyarakat' ? 'catalog' : 'admin-dashboard';
  if (view === 'login' && status === 'profile-required') return 'register';
  return null;
}

export function readEmailAction(href: string) {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.split('?')[1] || '');
  const get = (key: string) => url.searchParams.get(key) || hashParams.get(key) || '';
  return { mode: get('mode'), code: get('oobCode') };
}

export function appLoginUrl(appUrl: string) {
  const url = new URL(appUrl);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Alamat aplikasi belum valid.');
  url.search = '';
  url.hash = 'login';
  return url.href;
}
