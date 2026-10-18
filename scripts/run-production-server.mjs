// Production entry for `npm start`: runs server.ts with NODE_ENV=production
// (API routes + dist/ static serving + SPA fallback) through tsx, matching the
// dev server's runtime so extensionless TypeScript imports resolve everywhere.
process.env.NODE_ENV = 'production';

await import('../server.ts');
