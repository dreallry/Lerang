export function firebaseConfigFromEnv(env: Record<string, string | undefined>) {
  const fields = {
    apiKey: 'VITE_FIREBASE_API_KEY',
    authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
    databaseURL: 'VITE_FIREBASE_DATABASE_URL',
    projectId: 'VITE_FIREBASE_PROJECT_ID',
    storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'VITE_FIREBASE_APP_ID',
  } as const;
  const missing = Object.values(fields).filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Konfigurasi Firebase belum lengkap di .env: ${missing.join(', ')}`);
  return Object.fromEntries(Object.entries(fields).map(([field, key]) => [field, env[key]!.trim()])) as Record<keyof typeof fields, string>;
}
