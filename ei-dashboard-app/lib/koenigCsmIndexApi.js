import { getIndexScores } from './koenigIndexApi.js';

// "Get CSM Index Score" — see koenigIndexApi.js for the shared shape.
export const getCsmIndexScores = () => getIndexScores('CSMINDEX', 'CSM Index');
