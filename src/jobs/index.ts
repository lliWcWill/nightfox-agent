import { JobManager } from './job-manager.js';

/**
 * Singleton job manager for background tasks.
 *
 * In-memory only (Pattern A). If you want persistence across restarts, back this with a DB/JSON log.
 */
export const jobManager = new JobManager(1);
