import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { firebaseConfigFromEnv } from './lib/firebaseConfig';

const firebaseConfig = firebaseConfigFromEnv(import.meta.env);

const app = getApps().length > 0
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export default app;
