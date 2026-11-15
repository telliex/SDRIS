import { base, prettier } from './eslint.base.mjs';
import { nextConfig } from './eslint.next.mjs';

export default [...base, nextConfig(['apps/web/**/*.{js,mjs,ts,tsx}']), prettier];
