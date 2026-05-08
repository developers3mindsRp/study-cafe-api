const { logger } = require('../../../../shared');
const { atomicPublishArticle, enqueueScheduledPublish } = require('../services/article-scheduling.service');

/**
 * Process a single BullMQ "publish-article" job.
 *
 * Uses atomicPublishArticle() — a single conditional SQL UPDATE
 * (WHERE status = 'scheduled') — so this is safe to run concurrently
 * with the poller, reconcile, or other worker instances.
 * If the article was already published by another path, affected rows = 0
 * and we simply skip without error.
 *
 * @param {import('bullmq').Job<{ articleId: number }>} job
 */
async function processArticlePublishJob(job) {
  const articleId = job.data?.articleId;

  if (!articleId) {
    logger.warn('[article-publish] job missing articleId — skipping', {
      jobId: job.id,
      data: job.data,
    });
    return;
  }

  logger.info('[article-publish] processing', {
    articleId,
    jobId: job.id,
    attempt: (job.attemptsMade ?? 0) + 1,
  });

  // Guard against clock skew: if the job fired marginally early re-queue it
  const scheduledFor = job.data.scheduledFor
    ? new Date(job.data.scheduledFor)
    : null;

  if (scheduledFor && scheduledFor.getTime() > Date.now() + 3_000) {
    logger.warn('[article-publish] job fired too early — re-queuing', {
      articleId,
      scheduledFor: scheduledFor.toISOString(),
    });
    await enqueueScheduledPublish(articleId, scheduledFor);
    return;
  }

  const publishedAt = scheduledFor && scheduledFor.getTime() <= Date.now()
    ? scheduledFor
    : new Date();

  const published = await atomicPublishArticle(articleId, publishedAt);

  if (published) {
    logger.info('[article-publish] published', {
      articleId,
      published_at: publishedAt.toISOString(),
    });
  } else {
    logger.info('[article-publish] skipped — already published by another process', {
      articleId,
    });
  }
}

module.exports = { processArticlePublishJob };
