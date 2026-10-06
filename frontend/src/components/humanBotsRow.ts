import type { HumanBotsAvailability } from '../store/capabilitiesStore';

/** The line under the "Human-style bots" row while it cannot be used. */
export const HUMAN_BOTS_NOTE: Partial<Record<HumanBotsAvailability, string>> = {
  starting: 'Starting the bots…',
  online: 'This device plays the online bots.',
  unavailable: 'Not available on this device.',
};
