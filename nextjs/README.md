# Web3Market Next.js migration preview

This app is intentionally isolated under `nextjs/` and on the `nextjs-migration` branch. The existing GitHub Pages production site remains on `main` and is not modified by this scaffold.

## Current status

- Initial App Router scaffold and responsive preview page.
- Production services are not connected.
- No production credentials are included.
- Metadata is set to `noindex` while this is a private preview.

## Local development

1. Install Node.js 20.9+.
2. Run `cd nextjs`.
3. Run `npm install`.
4. Run `npm run dev` and open `http://localhost:3000`.
5. Before connecting Supabase, create/use a dedicated test project and copy `.env.example` to `.env.local`.

## Migration safety rules

1. Never merge this branch into `main` until the migration is reviewed and approved.
2. Do not change production DNS or GitHub Pages settings during the preview stage.
3. Do not run schema migrations against the production Supabase project during initial development.
4. Keep existing routes, Passport URLs, authentication behavior, and SEO redirects documented and tested before any cutover.
5. Keep server-only secrets out of variables prefixed with `NEXT_PUBLIC_`.
6. The preview is a UI scaffold, not a production-ready marketplace. Authentication, listing submission, file uploads, Deal Room, AI workflows, and database integration still need to be implemented and tested.
