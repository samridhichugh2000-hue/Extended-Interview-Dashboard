import { getIndexScores } from './koenigIndexApi.js';

// "Get DM Index Score" (ATMs) — see koenigIndexApi.js for the shared shape.
export const getDmIndexScores = () => getIndexScores('DMINDEX', 'DM Index');
