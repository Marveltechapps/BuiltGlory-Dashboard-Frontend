# BuiltGlory Dashboard

Vite React admin dashboard for BuiltGlory — enquiries, acquisitions, properties, callbacks, and operations.

## Stack

- **React 19** + **TypeScript**
- **Vite 8**
- **Tailwind CSS v4**
- **React Router**

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173` (or the URL shown in the terminal).

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend origin (e.g. `http://localhost:5001`). `/api/v1` is appended in the API client. |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Type-check and production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## Related repos

- **Backend** — `BuiltGlory-Backend` (Express API)
- **App** — `BuiltGlory-App` (customer mobile app)
