import { getIndexScores } from './koenigIndexApi.js';

// "Get ASM Index Score" (sales managers) — see koenigIndexApi.js for the shared shape.
export const getAsmIndexScores = () => getIndexScores('ASMINDEX', 'ASM Index');
