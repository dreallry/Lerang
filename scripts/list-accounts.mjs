import { firebaseAdmin } from './firebase-admin.mjs';

const { env, projectId, request } = await firebaseAdmin();
const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
const profiles = await Promise.all(['users', 'staff', 'legacy_users', 'legacy_staff'].map(async path => {
  const response = await request(`${base}/${path}.json`);
  if (!response.ok) throw new Error(`Tidak dapat membaca ${path}: HTTP ${response.status}`);
  return await response.json() || {};
}));
const accounts = [];
let nextPageToken = '';
do {
  const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet`);
  url.searchParams.set('maxResults', '1000');
  if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
  const response = await request(url);
  if (!response.ok) throw new Error(`Daftar Auth ditolak: HTTP ${response.status}`);
  const data = await response.json();
  for (const user of data.users || []) {
    const participant = profiles[0][user.localId];
    const staff = profiles[1][user.localId];
    accounts.push({
      email: user.email, name: staff?.nama_petugas || participant?.nama_lengkap || user.displayName || '',
      role: staff?.role || (participant ? 'masyarakat' : 'belum memiliki profil'),
      auth_enabled: !user.disabled, email_verified: Boolean(user.emailVerified),
      providers: (user.providerUserInfo || []).map(provider => provider.providerId),
      application_access: !user.disabled && (staff ? staff.active === true : Boolean(participant)),
      demo: staff?.demo_account === true || participant?.demo_account === true,
    });
  }
  nextPageToken = data.nextPageToken || '';
} while (nextPageToken);
console.log(JSON.stringify({ project: projectId, accounts, archived_sql_participants: Object.values(profiles[2]).filter(Boolean).length, archived_sql_staff: Object.values(profiles[3]).filter(Boolean).length }, null, 2));
