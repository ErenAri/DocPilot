This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started (DocPilot Frontend)

First, configure the backend URL and run the development server:

```bash
npm install
set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser. Use the Login link and demo credentials (e.g. `admin/admin123`).

Auth behavior and API client:
- All API calls use a centralized wrapper `src/lib/api.ts` (`apiFetch`).
  - Always sends `credentials: 'include'` so cookies flow.
  - Production (`NODE_ENV === 'production'`): no `Authorization` header is sent; backend authenticates via httpOnly cookie only.
  - Development: if `localStorage.docpilot_token` exists, it sends `Authorization: Bearer <token>` for convenience.

Backend CORS must allow your frontend origin via `CORS_ALLOW_ORIGINS`, and `NEXT_PUBLIC_API_URL` must point at the backend base URL.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
