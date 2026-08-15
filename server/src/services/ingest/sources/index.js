import { PMC2026 } from './pmc2026.js';

/**
 * Registry of automatic ingestion sources. Adding a new city/corporation is a
 * new connector here: fetch official winners (state election commission), map
 * rows -> { wardNumber, wardName, seat, reservation, name, party }.
 */
export const sources = {
  [PMC2026.id]: PMC2026,
};
