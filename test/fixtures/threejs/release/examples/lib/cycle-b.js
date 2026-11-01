import { a } from './cycle-a.js';

export const b = () => `b, b sees ${a}`;
