import { getIndexScores } from './koenigIndexApi.js';

// "Get TI Index Score" (Trainer Index) — see koenigIndexApi.js for the shared shape.
export const getTrainerIndexScores = () => getIndexScores('TIINDEX', 'Trainer Index');
