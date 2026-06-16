const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { AppError, logger } = require('../../../../shared');
const usersService = require('./users.service');

const JOB_TTL_MS = 30 * 60 * 1000;
const EXPORT_DIR = path.join(os.tmpdir(), 'studycafe-user-exports');
const jobs = new Map();

function pruneExpiredJobs() {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > JOB_TTL_MS) {
            if (job.filePath) {
                fs.promises.unlink(job.filePath).catch(() => {});
            }
            jobs.delete(id);
        }
    }
}

function publicJobStatus(job) {
    const status = {
        jobId: job.id,
        status: job.status,
        phase: job.phase,
        loaded: job.loaded,
        total: job.total,
        error: job.error,
    };
    if (job.status === 'completed' && job.downloadToken) {
        status.downloadToken = job.downloadToken;
    }
    return status;
}

async function startExportJob(query = {}) {
    pruneExpiredJobs();
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });

    const { total } = await usersService.countForExport(query);
    const jobId = crypto.randomUUID();
    const datePart = new Date().toISOString().slice(0, 10);
    const job = {
        id: jobId,
        status: 'running',
        phase: 'fetching',
        loaded: 0,
        total,
        filePath: path.join(EXPORT_DIR, `${jobId}.csv`),
        filename: `users-export-${datePart}.csv`,
        error: null,
        createdAt: Date.now(),
    };
    jobs.set(jobId, job);

    setImmediate(() => {
        runExportJob(job, query).catch((err) => {
            job.status = 'failed';
            job.phase = 'fetching';
            job.error = err?.message || 'Export failed';
            logger.error('[userExportJob] failed', { jobId, error: job.error });
        });
    });

    return { jobId, total };
}

async function runExportJob(job, query) {
    const result = await usersService.writeExportToFile(query, job.filePath, (progress) => {
        job.loaded = progress.loaded;
        job.total = progress.total ?? job.total;
        job.phase = progress.phase ?? 'fetching';
    }, job.total);

    const stat = await fs.promises.stat(job.filePath);
    if (stat.size <= 0) {
        throw new Error('Export file is empty');
    }

    job.status = 'completed';
    job.phase = 'writing';
    job.loaded = result.exported;
    job.total = result.total;
    job.downloadToken = crypto.randomUUID();
    logger.info('[userExportJob] completed', { jobId: job.id, exported: job.loaded, bytes: stat.size });
}

function getExportJobStatus(jobId) {
    pruneExpiredJobs();
    const job = jobs.get(String(jobId));
    if (!job) return null;
    return publicJobStatus(job);
}

async function downloadExportJob(jobId, res, filenameOverride, downloadToken) {
    pruneExpiredJobs();
    const job = jobs.get(String(jobId));
    if (!job) throw new AppError('Export job not found', 404);
    if (job.status === 'running') throw new AppError('Export is still in progress', 409);
    if (job.status === 'failed') throw new AppError(job.error || 'Export failed', 500);
    if (!job.downloadToken || downloadToken !== job.downloadToken) {
        throw new AppError('Invalid or expired download token', 403);
    }
    if (!job.filePath || !fs.existsSync(job.filePath)) {
        throw new AppError('Export file not found', 404);
    }

    const filename = filenameOverride || job.filename;
    const stat = await fs.promises.stat(job.filePath);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(stat.size));

    try {
        await pipeline(fs.createReadStream(job.filePath), res);
    } catch (err) {
        logger.error('[userExportJob] download stream failed', {
            jobId: job.id,
            error: err?.message || String(err),
        });
        throw err;
    }

    job.downloadToken = null;
    fs.promises.unlink(job.filePath).catch(() => {});
    jobs.delete(job.id);
}

module.exports = {
    startExportJob,
    getExportJobStatus,
    downloadExportJob,
};
