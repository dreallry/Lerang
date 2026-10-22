import path from 'node:path';
import { isFileServingAllowed } from 'vite';

export const privateDevFiles = [
  '.env', '.env.*',
  '**/*.{pem,key,p12,pfx,crt}',
  '**/{.git,.firebase,secrets,artifacts,tmp,uploads,tests}/**',
  '**/*service-account*.json', '**/*firebase*adminsdk*.json',
  '**/*.{sql,sql.*,sqlite,sqlite3,db,bak,zip,7z,tar,gz}',
];

export function protectPrivateDevFiles() {
  return {
    name: 'protect-private-dev-files',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname;
        try {
          pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
          response.statusCode = 400;
          response.end('Invalid path');
          return;
        }
        if (pathname === '/api' || pathname.startsWith('/api/')) return next();
        const file = pathname.startsWith('/@fs/')
          ? pathname.slice('/@fs/'.length)
          : path.resolve(server.config.root, `.${pathname}`);
        // Asset transforms such as ?raw run before Vite's static fs.deny check.
        if (!isFileServingAllowed(file, server)) {
          response.statusCode = 403;
          response.end('Access denied');
          return;
        }
        next();
      });
    },
  };
}
