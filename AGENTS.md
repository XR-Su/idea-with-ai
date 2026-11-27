# Repository Guidelines

## Project Structure & Module Organization

Idea with AI is a Chinese-language, browser-only React 19 and TypeScript workspace for capturing ideas and developing plans. Read `DESIGN.md` before changing product behavior; `README.md` covers setup and user flows.

- `src/App.tsx` coordinates the UI; `src/components/` contains reusable dialogs, Markdown rendering, and editors.
- `src/data.ts` handles local storage, archiving, backups, and exports; `src/types.ts` defines shared models.
- `src/ai.ts` handles provider requests; `src/ai-response.ts` parses responses.
- `src/thinking-modes.ts` registers modes; `src/thinking-skills.ts` loads Markdown from `skills/<mode>/`.
- `src/styles.css` contains responsive styles; `public/` holds static assets. Tests live beside source files. Production output goes to `dist/`.

## Build, Test, and Development Commands

Use Node.js 22.12 or newer and npm:

- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start Vite, accessible on the local network.
- `npm test`: run the Vitest suite once.
- `npm run build`: perform TypeScript checks and build production assets.
- `npm run preview`: serve the production build locally.

## Coding Style & Naming Conventions

Follow existing TypeScript conventions: two-space indentation, single quotes, semicolons, and strict typing. Use PascalCase for React components and their files, camelCase for functions and variables, and descriptive lowercase names for utility modules. Keep user-facing text in Chinese. Use native HTML controls, lucide-react icons, and custom CSS. No formatter or linter is configured.

## Testing Guidelines

Use Vitest with jsdom and React Testing Library. Name tests `*.test.ts` or `*.test.tsx` under `src/`; describe observable behavior. Mock AI requests and clear browser storage between tests. Cover changed behavior, especially archive isolation, backup compatibility, stale drafts, cancellation, and late responses. No numeric coverage threshold is configured. Run `npm test` and `npm run build` before submitting.

## Commit & Pull Request Guidelines

Recent commits commonly use `feat: <description>`, alongside plain imperative summaries. Write concise messages describing the change. PRs should explain the problem, resulting behavior, and validation; link related issues and include screenshots for UI changes. Pushes to `main` trigger GitHub Pages deployment.

## Architecture & Configuration

Preserve one continuous conversation per idea and immutable archive snapshots. Create versions only after user confirmation. Keep API keys out of backups and commits; persistence requires explicit opt-in. Maintain the static frontend deployment model.

<!-- postman-cli:installation:start -->
Postman CLI is installed on this device, and can be used for API Engineering work.
<!-- postman-cli:installation:end -->
