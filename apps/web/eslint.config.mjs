// Next.js detects its ESLint plugin from the config resolved inside the app directory, so the
// web app has its own entry. It shares the same base as the root config.
import { base, prettier } from '../../eslint.base.mjs';
import { nextConfig } from '../../eslint.next.mjs';

export default [...base, nextConfig(['**/*.{js,mjs,ts,tsx}']), prettier];
